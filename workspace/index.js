// MONOHA Workspace: the private staff app under /team.
//
// Server-rendered pages backed by SQLite (workspace/db.js). Nothing here
// is linked from the public site, and every response is noindex/no-store.
//
// Sign-in: email + password (scrypt). Sessions are random tokens stored
// hashed in the database, sent as an httpOnly cookie scoped to /team.
// Every POST needs the per-session CSRF token and a same-origin Origin.
//
// First run: when there are no users, /team/setup creates the first
// SUPER_ADMIN, and asks for ADMIN_PASSWORD (a Coolify environment
// variable) to prove the person setting it up owns the deployment.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { open } = require('./db');

const COOKIE = 'monoha_ws';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE = 10 * 1024 * 1024;
const TZ = 'Asia/Dhaka';
const ASSET_V = '1';

const ROLES = [['SUPER_ADMIN', 'Super admin'], ['ADMIN', 'Admin'], ['MANAGER', 'Manager'], ['TEAM_LEAD', 'Team lead'], ['EMPLOYEE', 'Employee']];
const RANK = { EMPLOYEE: 1, TEAM_LEAD: 2, MANAGER: 3, ADMIN: 4, SUPER_ADMIN: 5 };
const STATUS = [['TODO', 'To do'], ['IN_PROGRESS', 'In progress'], ['REVIEW', 'In review'], ['REVISION', 'Needs revision'], ['DONE', 'Done']];
const PRIORITY = [['URGENT', 'Urgent'], ['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low']];
const PSTATUS = [['PLANNING', 'Planning'], ['ACTIVE', 'Active'], ['ON_HOLD', 'On hold'], ['COMPLETED', 'Completed']];
const label = (list, k) => (list.find((x) => x[0] === k) || [k, k])[1];

// Short confirmations shown after a redirect. Only these keys are accepted.
const MSG = {
  saved: 'Saved.', created: 'Created.', deleted: 'Deleted.', moved: 'Status updated.', approved: 'Task approved and marked done.',
  revision: 'Sent back for revision.', commented: 'Comment added.', checkin: 'Checked in.', checkout: 'Checked out.',
  password: 'Password changed.', reset: 'Password reset. The employee must change it at next sign-in.', read: 'All notifications marked as read.',
};

module.exports = function mountWorkspace(app, { DATA_DIR, esc }) {
  const db = open(DATA_DIR);
  const FILE_DIR = path.join(DATA_DIR, 'workspace-files');
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...a) => q(sql).get(...a);
  const all = (sql, ...a) => q(sql).all(...a);
  const run = (sql, ...a) => q(sql).run(...a);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------------------------------------------------------------- helpers
  const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const pick = (list, v, d) => (list.some((x) => x[0] === v) ? v : d);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const int = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const toDate = (s) => new Date(/Z|T/.test(s) ? s : String(s).replace(' ', 'T') + 'Z');
  const fmtDay = (d) => (isDate(d) ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const fmtTime = (s) => (s ? toDate(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
  const fmtWhen = (s) => (s ? toDate(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const nl = (s) => esc(s).replace(/\n/g, '<br>');

  const hashPw = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
  const checkPw = (pw, stored) => {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const a = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64); const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const pwProblem = (pw) => (String(pw).length < 10 ? 'Use at least 10 characters for the password.' : '');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  const audit = (req, action, entity = '', id = null, detail = '') =>
    run('INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?)', req.user ? req.user.id : null, action, entity, id, t(detail, 500), t(req.ip, 64));
  const notify = (req, userId, text, link) => {
    if (!userId || (req.user && userId === req.user.id)) return;
    run('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)', userId, t(text, 300), link);
  };

  const nextEmpId = () => {
    const r = one("SELECT MAX(CAST(substr(emp_id, 12) AS INTEGER)) AS n FROM users WHERE emp_id LIKE 'MONOHA-EMP-%'");
    return 'MONOHA-EMP-' + String((r.n || 0) + 1).padStart(3, '0');
  };

  // ---------------------------------------------------------------- permissions
  const rank = (u) => RANK[u.role] || 0;
  const seesAll = (u) => rank(u) >= RANK.MANAGER;
  const isAdmin = (u) => rank(u) >= RANK.ADMIN;
  const leadOf = (task) => (task.project_id ? (one('SELECT lead_id FROM projects WHERE id = ?', task.project_id) || {}).lead_id : null);
  const memberOf = (u, pid) => Boolean(pid && one('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? UNION SELECT 1 FROM projects WHERE id = ? AND lead_id = ?', pid, u.id, pid, u.id));
  const canViewTask = (u, x) => seesAll(u) || x.assignee_id === u.id || x.created_by === u.id || memberOf(u, x.project_id);
  const canEditTask = (u, x) => seesAll(u) || x.created_by === u.id || (rank(u) >= RANK.TEAM_LEAD && leadOf(x) === u.id);
  const canApprove = (u, x) => seesAll(u) || (rank(u) >= RANK.TEAM_LEAD && (x.created_by === u.id || leadOf(x) === u.id));
  const canSetStatus = (u, x, s) => (['DONE', 'REVISION'].includes(s) ? canApprove(u, x) : canEditTask(u, x) || x.assignee_id === u.id);
  const canManageProject = (u, p) => seesAll(u) || p.lead_id === u.id;
  const canViewProject = (u, p) => seesAll(u) || memberOf(u, p.id);
  // Admins manage everyone below them; only a super admin manages admins.
  const canManageUser = (u, target) => isAdmin(u) && (u.role === 'SUPER_ADMIN' || rank(target) < RANK.ADMIN);
  const assignableRoles = (u) => ROLES.filter(([r]) => u.role === 'SUPER_ADMIN' || RANK[r] < RANK.ADMIN);
  // The SQL form of canViewTask, for lists.
  const VISIBLE = `(t.assignee_id = $me OR t.created_by = $me
    OR t.project_id IN (SELECT project_id FROM project_members WHERE user_id = $me)
    OR t.project_id IN (SELECT id FROM projects WHERE lead_id = $me))`;

  // ---------------------------------------------------------------- sessions
  const readCookie = (req) => {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
  };
  const setCookie = (req, res, value, maxAgeS) => res.append('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/team; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${req.secure ? '; Secure' : ''}`);
  const startSession = (req, res, user) => {
    const token = crypto.randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    run('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)', sha(token), user.id, crypto.randomBytes(24).toString('hex'), Date.now() + SESSION_MS);
    run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
    setCookie(req, res, token, SESSION_MS / 1000);
  };
  const loadSession = (req) => {
    const token = readCookie(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const s = one('SELECT s.csrf, s.expires_at, s.token_hash, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha(token));
    if (!s || s.expires_at < Date.now() || !s.active) return null;
    return s;
  };

  const sameOrigin = (req) => {
    const o = req.headers.origin || req.headers.referer;
    if (!o) return false;
    try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
  };
  const wantsJson = (req) => /json/.test(req.headers.accept || '');
  const fail = (req, res, code, msg) => (wantsJson(req) || req.path.endsWith('/files')
    ? res.status(code).json({ error: msg })
    : res.status(code).send(shell(req, 'Not allowed', `<div class="ws-empty"><h1>${esc(msg)}</h1><p><a href="/team/dashboard">Back to dashboard</a></p></div>`)));
  const back = (res, to, msg) => res.redirect(303, to + (msg ? (to.includes('?') ? '&' : '?') + 'm=' + msg : ''));

  // ---------------------------------------------------------------- middleware
  app.use('/team', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.use('/team', express.urlencoded({ extended: false, limit: '200kb' }));

  const auth = (req, res, next) => {
    const s = loadSession(req);
    if (!s) {
      if (req.method === 'GET' && !wantsJson(req)) return res.redirect(303, '/team/login?next=' + encodeURIComponent(req.originalUrl));
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    }
    req.user = s; req.csrf = s.csrf;
    if (req.method !== 'GET') {
      const token = (req.body && req.body._csrf) || req.headers['x-csrf'] || '';
      if (!sameOrigin(req) || token !== s.csrf) return fail(req, res, 403, 'This request was blocked. Reload the page and try again.');
    }
    if (s.must_change_pw && !['/team/password', '/team/logout'].includes(req.path)) {
      if (req.method === 'GET') return res.redirect(303, '/team/password');
      return fail(req, res, 403, 'Change your password first.');
    }
    req.unread = one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', s.id).n;
    next();
  };
  const need = (test, msg = 'You do not have access to this page.') => (req, res, next) => (test(req.user) ? next() : fail(req, res, 403, msg));

  // ---------------------------------------------------------------- page shell
  const NAV = [
    ['/team/dashboard', 'Dashboard', 'grid'], ['/team/tasks', 'Tasks', 'check'], ['/team/projects', 'Projects', 'folder'],
    ['/team/attendance', 'Attendance', 'clock'], ['/team/notifications', 'Notifications', 'bell'], ['/team/employees', 'Employees', 'users'],
    ['/team/audit', 'Audit log', 'shield', isAdmin],
  ];
  const ICON = {
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

  function shell(req, title, body, { active = '', bare = false } = {}) {
    const u = req.user;
    const m = MSG[req.query && req.query.m];
    const nav = u && !bare ? `<aside class="ws-side">
  <a class="ws-brand" href="/team/dashboard"><img src="/images/logo.png" alt="" width="34" height="34"><span>MONOHA<small>Workspace</small></span></a>
  <nav aria-label="Workspace">${NAV.filter((n) => !n[3] || n[3](u)).map(([href, name, ic]) => `<a href="${href}"${active === href ? ' aria-current="page"' : ''}>${icon(ic)}<span>${name}</span>${href === '/team/notifications' && req.unread ? `<b class="ws-dot">${req.unread}</b>` : ''}</a>`).join('')}</nav>
  <div class="ws-me"><span class="ws-av">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><small>${esc(u.emp_id)} · ${esc(label(ROLES, u.role))}</small></div>
    <form method="post" action="/team/logout"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button class="ws-icon-btn" title="Sign out" aria-label="Sign out">${icon('out')}</button></form></div>
</aside>` : '';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">${req.csrf ? `<meta name="csrf" content="${esc(req.csrf)}">` : ''}
<title>${esc(title)} · MONOHA Workspace</title>
<link rel="icon" href="/images/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/ws/ws.css?v=${ASSET_V}">
</head><body class="${nav ? 'ws-app' : 'ws-bare'}">
${nav}<main class="ws-main" id="main">${m ? `<p class="ws-flash" role="status">${esc(m)}</p>` : ''}${body}</main>
<script src="/ws/ws.js?v=${ASSET_V}" defer></script>
</body></html>`;
  }
  const send = (req, res, title, body, opts) => res.send(shell(req, title, body, opts));
  const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;
  const options = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const chip = (kind, k, l) => `<span class="chip ${kind}-${k.toLowerCase()}">${esc(l)}</span>`;
  const statusChip = (s) => chip('st', s, label(STATUS, s));
  const prioChip = (p) => chip('pr', p, label(PRIORITY, p));
  const due = (d, done) => (d ? `<span class="due${!done && d < today() ? ' is-late' : ''}">${esc(fmtDay(d))}</span>` : '<span class="muted">No due date</span>');
  const head = (title, sub = '', actions = '') => `<header class="ws-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="ws-actions">${actions}</div>` : ''}</header>`;
  const userOptions = (u, v, blank = 'Unassigned') => {
    const list = rank(u) >= RANK.TEAM_LEAD ? all('SELECT id, name, emp_id FROM users WHERE active = 1 ORDER BY name') : [u];
    return (blank ? `<option value="">${esc(blank)}</option>` : '') + list.map((x) => `<option value="${x.id}"${x.id === Number(v) ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  };
  const projectsFor = (u) => (seesAll(u)
    ? all("SELECT id, name FROM projects WHERE status != 'COMPLETED' ORDER BY name")
    : all("SELECT id, name FROM projects WHERE status != 'COMPLETED' AND (lead_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)) ORDER BY name", u.id, u.id));

  // ---------------------------------------------------------------- sign in / setup
  const fails = new Map();
  const userCount = () => one('SELECT COUNT(*) AS n FROM users').n;
  const safeNext = (n) => (typeof n === 'string' && /^\/team(\/[\w\-/?=&%.]*)?$/.test(n) && !n.startsWith('//') ? n : '/team/dashboard');

  app.get('/team', (req, res) => res.redirect(303, loadSession(req) ? '/team/dashboard' : '/team/login'));

  app.get('/team/login', (req, res) => {
    if (!userCount()) return res.redirect(303, '/team/setup');
    if (loadSession(req)) return res.redirect(303, '/team/dashboard');
    send(req, res, 'Sign in', authCard('Sign in to Workspace', 'For MONOHA staff only. Use the email and password your admin gave you.', `
<form method="post" action="/team/login" class="ws-form">
  <input type="hidden" name="next" value="${esc(safeNext(req.query.next))}">
  <label>Email<input type="email" name="email" id="email" autocomplete="username" required value="${esc(t(req.query.email, 160))}"></label>
  <label>Password<input type="password" name="password" id="password" autocomplete="current-password" required></label>
  ${req.query.e ? `<p class="ws-err" role="alert">${esc({ bad: 'Email or password is incorrect.', many: 'Too many attempts. Try again in 15 minutes.', blocked: 'Sign-in was blocked. Reload the page and try again.' }[req.query.e] || '')}</p>` : ''}
  <button class="ws-btn" type="submit">Sign in</button>
</form>`), { bare: true });
  });

  app.post('/team/login', (req, res) => {
    if (!sameOrigin(req)) return res.redirect(303, '/team/login?e=blocked');
    const email = t(req.body.email, 160).toLowerCase();
    const key = req.ip + '|' + email; const now = Date.now();
    const list = (fails.get(key) || []).filter((x) => now - x < 15 * 60 * 1000);
    const again = (e) => res.redirect(303, `/team/login?e=${e}&email=${encodeURIComponent(email)}&next=${encodeURIComponent(safeNext(req.body.next))}`);
    if (list.length >= 5) return again('many');
    const u = one('SELECT * FROM users WHERE email = ?', email);
    if (!u || !u.active || !checkPw(req.body.password || '', u.password_hash)) {
      list.push(now); fails.set(key, list);
      audit(req, 'login_failed', 'user', u ? u.id : null, email);
      return again('bad');
    }
    fails.delete(key);
    startSession(req, res, u);
    req.user = u; audit(req, 'login', 'user', u.id);
    res.redirect(303, u.must_change_pw ? '/team/password' : safeNext(req.body.next));
  });

  app.post('/team/logout', auth, (req, res) => {
    run('DELETE FROM sessions WHERE token_hash = ?', req.user.token_hash);
    audit(req, 'logout', 'user', req.user.id);
    setCookie(req, res, '', 0);
    res.redirect(303, '/team/login');
  });

  const SETUP_KEY = process.env.ADMIN_PASSWORD || '';
  app.get('/team/setup', (req, res) => {
    if (userCount()) return res.redirect(303, '/team/login');
    const off = !SETUP_KEY;
    send(req, res, 'Set up Workspace', authCard('Set up MONOHA Workspace', off
      ? 'Set ADMIN_PASSWORD in the Coolify environment variables and redeploy, then open this page again.'
      : 'Create the first Super admin account. You will need the ADMIN_PASSWORD set in Coolify to confirm you own this deployment.', off ? '' : `
<form method="post" action="/team/setup" class="ws-form">
  <label>Setup key (ADMIN_PASSWORD)<input type="password" name="key" id="key" autocomplete="off" required></label>
  <label>Your full name<input name="name" id="name" required maxlength="120"></label>
  <label>Your email<input type="email" name="email" id="email" required maxlength="160" autocomplete="username"></label>
  <label>Choose a password<input type="password" name="password" id="password" required minlength="10" autocomplete="new-password"><small>At least 10 characters.</small></label>
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <button class="ws-btn" type="submit">Create Super admin</button>
</form>`), { bare: true });
  });

  app.post('/team/setup', (req, res) => {
    const err = (m) => res.redirect(303, '/team/setup?e=' + encodeURIComponent(m));
    if (userCount() || !SETUP_KEY) return res.redirect(303, '/team/login');
    if (!sameOrigin(req)) return err('Request blocked. Reload and try again.');
    const key = String(req.body.key || ''); const a = Buffer.from(key); const b = Buffer.from(SETUP_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { audit(req, 'setup_failed'); return err('The setup key is not correct.'); }
    const name = t(req.body.name, 120); const email = t(req.body.email, 160).toLowerCase(); const pw = String(req.body.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Enter your name and a valid email.');
    if (pwProblem(pw)) return err(pwProblem(pw));
    const r = run('INSERT INTO users (emp_id, name, email, role, password_hash, must_change_pw, joined_on) VALUES (?,?,?,?,?,0,?)', nextEmpId(), name, email, 'SUPER_ADMIN', hashPw(pw), today());
    const u = one('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
    req.user = u; audit(req, 'setup', 'user', u.id);
    startSession(req, res, u);
    res.redirect(303, '/team/dashboard');
  });

  function authCard(title, lead, form) {
    return `<div class="ws-auth"><a class="ws-brand" href="/"><img src="/images/logo.png" alt="" width="40" height="40"><span>MONOHA<small>Workspace</small></span></a>
<div class="ws-card"><h1>${esc(title)}</h1><p class="muted">${esc(lead)}</p>${form}</div></div>`;
  }

  app.get('/team/password', auth, (req, res) => send(req, res, 'Change password', `${head('Change password', req.user.must_change_pw ? 'Choose your own password before you continue.' : '')}
<div class="ws-card ws-narrow"><form method="post" action="/team/password" class="ws-form">${csrfField(req)}
  <label>Current password<input type="password" name="current" id="current" required autocomplete="current-password"></label>
  <label>New password<input type="password" name="password" id="password" required minlength="10" autocomplete="new-password"><small>At least 10 characters.</small></label>
  <label>Repeat new password<input type="password" name="confirm" id="confirm" required minlength="10" autocomplete="new-password"></label>
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <button class="ws-btn" type="submit">Change password</button></form></div>`, { active: '' }));

  app.post('/team/password', auth, (req, res) => {
    const err = (m) => res.redirect(303, '/team/password?e=' + encodeURIComponent(m));
    const pw = String(req.body.password || '');
    if (!checkPw(req.body.current || '', req.user.password_hash)) return err('Your current password is not correct.');
    if (pwProblem(pw)) return err(pwProblem(pw));
    if (pw !== req.body.confirm) return err('The two new passwords do not match.');
    if (checkPw(pw, req.user.password_hash)) return err('Choose a password different from the current one.');
    run('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', hashPw(pw), req.user.id);
    // End every other session for this account.
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.user.token_hash);
    audit(req, 'password_changed', 'user', req.user.id);
    back(res, '/team/dashboard', 'password');
  });

  // ---------------------------------------------------------------- dashboard
  app.get('/team/dashboard', auth, (req, res) => {
    const u = req.user; const d = today();
    const att = one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', u.id, d);
    const mine = all("SELECT t.*, p.name AS project FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.assignee_id = ? AND t.status != 'DONE' ORDER BY (t.due_date = ''), t.due_date, t.id LIMIT 8", u.id);
    const counts = one(`SELECT COUNT(*) AS open, SUM(due_date != '' AND due_date < ?) AS late, SUM(due_date = ?) AS today,
      SUM(status = 'REVIEW') AS review, SUM(status = 'REVISION') AS revision FROM tasks WHERE assignee_id = ? AND status != 'DONE'`, d, d, u.id);
    const approvals = all(`SELECT t.*, p.name AS project, a.name AS assignee FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.status = 'REVIEW' ORDER BY t.updated_at LIMIT 50`).filter((x) => canApprove(u, x)).slice(0, 6);
    const notes = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5', u.id);
    const team = seesAll(u) ? {
      status: all("SELECT status, COUNT(*) AS n FROM tasks WHERE parent_id IS NULL GROUP BY status"),
      present: one('SELECT COUNT(*) AS n FROM attendance WHERE day = ? AND check_in IS NOT NULL', d).n,
      staff: one('SELECT COUNT(*) AS n FROM users WHERE active = 1').n,
      late: one("SELECT COUNT(*) AS n FROM tasks WHERE status != 'DONE' AND due_date != '' AND due_date < ?", d).n,
    } : null;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date()));
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const stat = (n, l, href, tone = '') => `<a class="ws-stat${tone}" href="${href}"><strong>${n || 0}</strong><span>${l}</span></a>`;

    send(req, res, 'Dashboard', `${head(`${hello}, ${u.name.split(/\s+/)[0]}`, esc(fmtDay(d)) + ' · ' + esc(u.position || label(ROLES, u.role)),
      rank(u) >= RANK.EMPLOYEE ? '<a class="ws-btn" href="/team/tasks/new">New task</a>' : '')}
<div class="ws-grid-dash">
  <section class="ws-card ws-att">
    <h2>Today’s attendance</h2>
    ${attendanceBlock(req, att)}
  </section>
  <section class="ws-stats" aria-label="My tasks">
    ${stat(counts.open, 'Open tasks', '/team/tasks?who=me')}
    ${stat(counts.today, 'Due today', '/team/tasks?who=me')}
    ${stat(counts.late, 'Overdue', '/team/tasks?who=me', counts.late ? ' is-bad' : '')}
    ${stat(counts.revision, 'Needs revision', '/team/tasks?who=me&status=REVISION', counts.revision ? ' is-warn' : '')}
  </section>
</div>
<div class="ws-cols">
  <section class="ws-card"><div class="ws-card-head"><h2>My next tasks</h2><a href="/team/tasks?who=me">All my tasks</a></div>
    ${mine.length ? `<ul class="ws-list">${mine.map((x) => `<li><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong><span class="muted">${esc(x.project || 'No project')}</span></a><span class="ws-meta">${statusChip(x.status)}${due(x.due_date)}</span></li>`).join('')}</ul>`
      : '<p class="muted">Nothing assigned to you right now.</p>'}</section>
  <section class="ws-card"><div class="ws-card-head"><h2>Waiting for your approval</h2></div>
    ${approvals.length ? `<ul class="ws-list">${approvals.map((x) => `<li><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong><span class="muted">${esc(x.assignee || 'Unassigned')} · ${esc(x.project || 'No project')}</span></a><span class="ws-meta">${prioChip(x.priority)}</span></li>`).join('')}</ul>`
      : '<p class="muted">No tasks are waiting for your review.</p>'}</section>
  ${team ? `<section class="ws-card"><div class="ws-card-head"><h2>Team overview</h2><a href="/team/attendance">Attendance</a></div>
    <p class="ws-kv"><span>Checked in today</span><strong>${team.present} of ${team.staff}</strong></p>
    <p class="ws-kv"><span>Overdue tasks</span><strong${team.late ? ' class="is-bad"' : ''}>${team.late}</strong></p>
    ${STATUS.map(([k, l]) => `<p class="ws-kv"><span>${statusChip(k)}</span><strong>${(team.status.find((s) => s.status === k) || { n: 0 }).n}</strong></p>`).join('')}</section>` : ''}
  <section class="ws-card"><div class="ws-card-head"><h2>Latest notifications</h2><a href="/team/notifications">See all</a></div>
    ${notes.length ? `<ul class="ws-notes">${notes.map(noteItem).join('')}</ul>` : '<p class="muted">No notifications yet.</p>'}</section>
</div>`, { active: '/team/dashboard' });
  });

  // ---------------------------------------------------------------- attendance
  function attendanceBlock(req, att) {
    const form = (action, text, cls = '') => `<form method="post" action="/team/attendance/${action}">${csrfField(req)}<button class="ws-btn${cls}" type="submit">${text}</button></form>`;
    if (!att || !att.check_in) return `<p class="muted">You have not checked in yet today.</p>${form('in', 'Check in')}`;
    if (!att.check_out) return `<p class="ws-kv"><span>Checked in</span><strong>${fmtTime(att.check_in)}</strong></p>${form('out', 'Check out', ' ws-btn-ghost')}`;
    return `<p class="ws-kv"><span>Checked in</span><strong>${fmtTime(att.check_in)}</strong></p><p class="ws-kv"><span>Checked out</span><strong>${fmtTime(att.check_out)}</strong></p>`;
  }
  const fromPage = (req) => { try { return safeNext(new URL(req.get('referer')).pathname); } catch (e) { return '/team/dashboard'; } };
  const hours = (a) => (a.check_in && a.check_out ? ((toDate(a.check_out) - toDate(a.check_in)) / 36e5).toFixed(1) + ' h' : '');

  app.post('/team/attendance/in', auth, (req, res) => {
    const d = today();
    const a = one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', req.user.id, d);
    if (!a) { run('INSERT INTO attendance (user_id, day, check_in) VALUES (?,?,?)', req.user.id, d, new Date().toISOString()); audit(req, 'check_in', 'attendance', null, d); }
    back(res, fromPage(req), 'checkin');
  });
  app.post('/team/attendance/out', auth, (req, res) => {
    const d = today();
    const r = run('UPDATE attendance SET check_out = ? WHERE user_id = ? AND day = ? AND check_in IS NOT NULL AND check_out IS NULL', new Date().toISOString(), req.user.id, d);
    if (r.changes) audit(req, 'check_out', 'attendance', null, d);
    back(res, fromPage(req), 'checkout');
  });

  app.get('/team/attendance', auth, (req, res) => {
    const u = req.user; const d = today();
    const day = isDate(req.query.day) ? req.query.day : d;
    const mine = all('SELECT * FROM attendance WHERE user_id = ? ORDER BY day DESC LIMIT 31', u.id);
    const board = seesAll(u) ? all(`SELECT u.id, u.name, u.emp_id, u.position, a.check_in, a.check_out FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.day = ? WHERE u.active = 1 ORDER BY (a.check_in IS NULL), u.name`, day) : null;
    send(req, res, 'Attendance', `${head('Attendance', 'Times are shown in Bangladesh time (GMT+6).')}
<div class="ws-cols">
  <section class="ws-card ws-att"><h2>Today · ${esc(fmtDay(d))}</h2>${attendanceBlock(req, one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', u.id, d))}</section>
  <section class="ws-card"><h2>My last 31 days</h2>
    ${mine.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th></tr></thead><tbody>
    ${mine.map((a) => `<tr><td>${esc(fmtDay(a.day))}</td><td>${fmtTime(a.check_in)}</td><td>${fmtTime(a.check_out) || '<span class="muted">—</span>'}</td><td>${hours(a)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No attendance recorded yet.</p>'}</section>
</div>
${board ? `<section class="ws-card"><div class="ws-card-head"><h2>Team on ${esc(fmtDay(day))}</h2>
  <form method="get" class="ws-inline"><label class="sr-only" for="day">Date</label><input type="date" name="day" id="day" value="${day}" max="${d}"><button class="ws-btn ws-btn-ghost" type="submit">Show</button></form></div>
  <div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Employee</th><th>ID</th><th>In</th><th>Out</th><th>Hours</th></tr></thead><tbody>
  ${board.map((a) => `<tr><td><strong>${esc(a.name)}</strong><br><span class="muted">${esc(a.position)}</span></td><td>${esc(a.emp_id)}</td><td>${a.check_in ? fmtTime(a.check_in) : '<span class="chip st-revision">Not checked in</span>'}</td><td>${fmtTime(a.check_out)}</td><td>${hours(a)}</td></tr>`).join('')}
  </tbody></table></div></section>` : ''}`, { active: '/team/attendance' });
  });

  // ---------------------------------------------------------------- notifications
  const noteItem = (n) => `<li class="${n.read_at ? '' : 'is-new'}"><a href="${esc(n.link || '/team/notifications')}">${esc(n.text)}</a><small>${esc(fmtWhen(n.created_at))}</small></li>`;
  app.get('/team/notifications', auth, (req, res) => {
    const list = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
    send(req, res, 'Notifications', `${head('Notifications', '', req.unread ? `<form method="post" action="/team/notifications/read">${csrfField(req)}<button class="ws-btn ws-btn-ghost">Mark all as read</button></form>` : '')}
<section class="ws-card">${list.length ? `<ul class="ws-notes">${list.map(noteItem).join('')}</ul>` : '<p class="muted">No notifications yet. You will be notified when a task is assigned to you, reviewed or commented on.</p>'}</section>`, { active: '/team/notifications' });
  });
  app.post('/team/notifications/read', auth, (req, res) => {
    run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
    back(res, '/team/notifications', 'read');
  });

  // ---------------------------------------------------------------- tasks
  const TASK_SELECT = `SELECT t.*, p.name AS project, a.name AS assignee, c.name AS creator,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subs, (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'DONE') AS subs_done,
    (SELECT COUNT(*) FROM comments m WHERE m.task_id = t.id) AS comments
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by`;
  const getTask = (id) => (int(id) ? one(TASK_SELECT + ' WHERE t.id = ?', int(id)) : null);
  const loadTask = (req, res, next) => {
    const x = getTask(req.params.id);
    if (!x || !canViewTask(req.user, x)) return fail(req, res, 404, 'This task does not exist or you do not have access to it.');
    req.task = x; next();
  };

  app.get('/team/tasks', auth, (req, res) => {
    const u = req.user;
    const view = req.query.view === 'board' ? 'board' : 'list';
    const f = { who: ['me', 'created', 'all'].includes(req.query.who) ? req.query.who : (seesAll(u) ? 'all' : 'me'), project: int(req.query.project), status: pick(STATUS, req.query.status, ''), q: t(req.query.q, 80) };
    const where = ['t.parent_id IS NULL']; const p = {};
    if (!seesAll(u)) where.push(VISIBLE);
    if (f.who === 'me') where.push('t.assignee_id = $me');
    if (f.who === 'created') where.push('t.created_by = $me');
    if (f.project) { where.push('t.project_id = $project'); p.$project = f.project; }
    if (where.some((w) => w.includes('$me'))) p.$me = u.id;
    if (f.status && view === 'list') { where.push('t.status = $status'); p.$status = f.status; }
    if (f.q) { where.push('(t.title LIKE $q OR t.description LIKE $q)'); p.$q = '%' + f.q.replace(/[%_]/g, '') + '%'; }
    const rows = q(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.status = 'DONE', CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, (t.due_date = ''), t.due_date, t.id DESC LIMIT 500`).all(p);
    const qs = (o) => '?' + new URLSearchParams(Object.entries({ view, who: f.who, project: f.project || '', status: f.status, q: f.q, ...o }).filter(([, v]) => v)).toString();
    const projects = seesAll(u) ? all('SELECT id, name FROM projects ORDER BY name') : projectsFor(u);

    const filters = `<form method="get" class="ws-filters" role="search"><input type="hidden" name="view" value="${view}">
  <label><span>Show</span><select name="who" id="who">${options([['me', 'Assigned to me'], ['created', 'Created by me'], ['all', seesAll(u) ? 'All tasks' : 'All I can see']], f.who)}</select></label>
  <label><span>Project</span><select name="project" id="project"><option value="">All projects</option>${options(projects.map((x) => [x.id, x.name]), f.project)}</select></label>
  ${view === 'list' ? `<label><span>Status</span><select name="status" id="status"><option value="">Any status</option>${options(STATUS, f.status)}</select></label>` : ''}
  <label class="grow"><span>Search</span><input type="search" name="q" id="q" value="${esc(f.q)}" placeholder="Title or description"></label>
  <button class="ws-btn ws-btn-ghost" type="submit">Apply</button></form>`;

    const progress = (x) => (x.subs ? `<span class="ws-sub" title="Subtasks done">${x.subs_done}/${x.subs}</span>` : '');
    const list = rows.length ? `<div class="ws-table-wrap"><table class="ws-table ws-tasks"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead><tbody>
${rows.map((x) => `<tr><td><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong></a><br><span class="muted">${esc(x.project || 'No project')}</span> ${progress(x)}</td>
<td>${esc(x.assignee || '—')}</td><td>${statusChip(x.status)}</td><td>${prioChip(x.priority)}</td><td>${due(x.due_date, x.status === 'DONE')}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="ws-card ws-empty"><h2>No tasks here</h2><p class="muted">${f.q || f.status || f.project ? 'Try clearing the filters.' : 'Create the first task to get started.'}</p></div>`;

    const board = `<div class="kb" aria-label="Task board">${STATUS.map(([k, l]) => {
      const col = rows.filter((x) => x.status === k);
      return `<section class="kb-col" data-status="${k}"><h2>${statusChip(k)}<span class="kb-count">${col.length}</span></h2><div class="kb-list">
${col.map((x) => `<article class="kb-card pr-edge-${x.priority.toLowerCase()}" data-id="${x.id}"${canEditTask(u, x) || x.assignee_id === u.id ? ' draggable="true"' : ''}>
  <a href="/team/tasks/${x.id}">${esc(x.title)}</a>
  <p class="muted">${esc(x.project || 'No project')}</p>
  <div class="kb-foot">${x.assignee ? `<span class="ws-av sm" title="${esc(x.assignee)}">${esc(initials(x.assignee))}</span>` : ''}${prioChip(x.priority)}${x.due_date ? due(x.due_date, k === 'DONE') : ''}${progress(x)}</div>
</article>`).join('')}</div></section>`;
    }).join('')}</div><p class="muted kb-hint">Drag a card to another column to change its status. Moving to Done or Needs revision is for approvers.</p>`;

    send(req, res, 'Tasks', `${head('Tasks', '', `<div class="ws-seg" role="group" aria-label="View"><a href="${qs({ view: 'list' })}"${view === 'list' ? ' aria-current="page"' : ''}>List</a><a href="${qs({ view: 'board', status: '' })}"${view === 'board' ? ' aria-current="page"' : ''}>Board</a></div><a class="ws-btn" href="/team/tasks/new${f.project ? '?project=' + f.project : ''}">New task</a>`)}
${filters}${view === 'board' ? board : list}`, { active: '/team/tasks' });
  });

  const taskForm = (req, x, action, submit) => {
    const u = req.user; const projects = projectsFor(u);
    return `<form method="post" action="${action}" class="ws-form">${csrfField(req)}
  <label>Title<input name="title" id="title" required maxlength="200" value="${esc(x.title || '')}"></label>
  <label>Description<textarea name="description" id="description" rows="6" maxlength="8000">${esc(x.description || '')}</textarea></label>
  <div class="ws-row">
    <label>Project<select name="project_id" id="project_id"><option value="">No project</option>${options(projects.map((p) => [p.id, p.name]), x.project_id)}</select></label>
    <label>Assignee<select name="assignee_id" id="assignee_id">${userOptions(u, x.assignee_id != null ? x.assignee_id : (rank(u) < RANK.TEAM_LEAD ? u.id : ''), rank(u) >= RANK.TEAM_LEAD ? 'Unassigned' : '')}</select></label>
  </div>
  <div class="ws-row">
    <label>Priority<select name="priority" id="priority">${options(PRIORITY, x.priority || 'MEDIUM')}</select></label>
    <label>Due date<input type="date" name="due_date" id="due_date" value="${esc(x.due_date || '')}"></label>
  </div>
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <div class="ws-actions"><button class="ws-btn" type="submit">${submit}</button><a class="ws-btn ws-btn-ghost" href="${x.id ? '/team/tasks/' + x.id : '/team/tasks'}">Cancel</a></div>
</form>`;
  };
  // Validates task input against what this user may do. Returns [fields, error].
  const readTask = (req, prev = {}) => {
    const u = req.user; const b = req.body;
    const title = t(b.title, 200);
    if (!title) return [null, 'Give the task a title.'];
    let project = int(b.project_id);
    if (project && !(seesAll(u) || memberOf(u, project) || project === prev.project_id)) return [null, 'You are not a member of that project.'];
    if (project && !one('SELECT 1 FROM projects WHERE id = ?', project)) project = null;
    let assignee = int(b.assignee_id);
    if (assignee && !one('SELECT 1 FROM users WHERE id = ? AND active = 1', assignee)) return [null, 'That person is not an active employee.'];
    if (rank(u) < RANK.TEAM_LEAD && assignee !== u.id && assignee !== (prev.assignee_id || null)) return [null, 'Only team leads and above can assign tasks to others.'];
    return [{ title, description: t(b.description, 8000), project_id: project, assignee_id: assignee, priority: pick(PRIORITY, b.priority, 'MEDIUM'), due_date: isDate(b.due_date) ? b.due_date : '' }, ''];
  };

  app.get('/team/tasks/new', auth, (req, res) => send(req, res, 'New task', `${head('New task')}
<div class="ws-card ws-narrow">${taskForm(req, { project_id: int(req.query.project) }, '/team/tasks', 'Create task')}</div>`, { active: '/team/tasks' }));

  app.post('/team/tasks', auth, (req, res) => {
    const [f, e] = readTask(req);
    if (e) return back(res, '/team/tasks/new?e=' + encodeURIComponent(e));
    const r = run('INSERT INTO tasks (project_id, title, description, priority, assignee_id, created_by, due_date) VALUES (?,?,?,?,?,?,?)', f.project_id, f.title, f.description, f.priority, f.assignee_id, req.user.id, f.due_date);
    const id = Number(r.lastInsertRowid);
    audit(req, 'task_created', 'task', id, f.title);
    notify(req, f.assignee_id, `${req.user.name} assigned you “${f.title}”`, `/team/tasks/${id}`);
    back(res, `/team/tasks/${id}`, 'created');
  });

  app.get('/team/tasks/:id', auth, loadTask, (req, res) => {
    const u = req.user; const x = req.task;
    const editing = req.query.edit === '1' && canEditTask(u, x);
    if (editing) return send(req, res, 'Edit task', `${head('Edit task')}<div class="ws-card ws-narrow">${taskForm(req, x, `/team/tasks/${x.id}`, 'Save changes')}</div>`, { active: '/team/tasks' });
    const parent = x.parent_id ? one('SELECT id, title FROM tasks WHERE id = ?', x.parent_id) : null;
    const subs = all('SELECT t.*, a.name AS assignee FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id WHERE t.parent_id = ? ORDER BY t.id', x.id);
    const comments = all('SELECT m.*, u.name FROM comments m LEFT JOIN users u ON u.id = m.user_id WHERE m.task_id = ? ORDER BY m.id', x.id);
    const files = all('SELECT f.*, u.name AS uploader FROM files f LEFT JOIN users u ON u.id = f.user_id WHERE f.task_id = ? ORDER BY f.id DESC', x.id);
    const approver = canApprove(u, x); const editor = canEditTask(u, x);
    const can = (s) => canSetStatus(u, x, s);
    const act = (path, body, cls = '', attrs = '') => `<form method="post" action="/team/tasks/${x.id}/${path}"${attrs}>${csrfField(req)}${body}${cls}</form>`;
    const moves = STATUS.filter(([k]) => k !== x.status && can(k) && !(k === 'REVISION'));
    const kb = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

    send(req, res, x.title, `
<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/tasks">Tasks</a>${x.project_id ? ` / <a href="/team/projects/${x.project_id}">${esc(x.project)}</a>` : ''}${parent ? ` / <a href="/team/tasks/${parent.id}">${esc(parent.title)}</a>` : ''}</nav>
${head(x.title, `${statusChip(x.status)} ${prioChip(x.priority)}`, editor ? `<a class="ws-btn ws-btn-ghost" href="/team/tasks/${x.id}?edit=1">Edit</a>${act('delete', '<button class="ws-btn ws-btn-danger" type="submit">Delete</button>', '', ' data-confirm="Delete this task, its subtasks, comments and files?"')}` : '')}
<div class="ws-detail">
  <div class="ws-detail-main">
    <section class="ws-card"><h2>Description</h2>${x.description ? `<p class="ws-prose">${nl(x.description)}</p>` : '<p class="muted">No description.</p>'}</section>

    ${x.status === 'REVIEW' && approver ? `<section class="ws-card ws-review"><h2>Review this task</h2><p class="muted">${esc(x.assignee || 'The assignee')} marked this ready for review.</p>
      <div class="ws-review-grid">
      ${act('approve', '<label>Note (optional)<textarea name="note" id="approve-note" rows="2" maxlength="2000"></textarea></label><button class="ws-btn ws-btn-ok" type="submit">Approve and mark done</button>', '', ' class="ws-form"')}
      ${act('revision', '<label>What needs to change?<textarea name="note" id="revision-note" rows="2" required maxlength="2000"></textarea></label><button class="ws-btn ws-btn-warn" type="submit">Request revision</button>', '', ' class="ws-form"')}
      </div></section>` : ''}

    ${x.parent_id ? '' : `<section class="ws-card"><div class="ws-card-head"><h2>Subtasks</h2>${subs.length ? `<span class="muted">${subs.filter((s) => s.status === 'DONE').length} of ${subs.length} done</span>` : ''}</div>
      ${subs.length ? `<ul class="ws-checks">${subs.map((s) => `<li>${act(`toggle/${s.id}`, `<button type="submit" class="ws-check${s.status === 'DONE' ? ' is-done' : ''}" aria-label="${s.status === 'DONE' ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}"></button>`)}
        <a href="/team/tasks/${s.id}" class="${s.status === 'DONE' ? 'is-done' : ''}">${esc(s.title)}</a><span class="muted">${esc(s.assignee || '')}</span></li>`).join('')}</ul>` : ''}
      ${editor || x.assignee_id === u.id ? act('subtasks', `<label class="sr-only" for="sub-title">New subtask</label><input name="title" id="sub-title" required maxlength="200" placeholder="Add a subtask">
        ${rank(u) >= RANK.TEAM_LEAD ? `<label class="sr-only" for="sub-assignee">Assignee</label><select name="assignee_id" id="sub-assignee">${userOptions(u, x.assignee_id, 'Unassigned')}</select>` : ''}<button class="ws-btn ws-btn-ghost" type="submit">Add</button>`, '', ' class="ws-inline ws-add"') : ''}</section>`}

    <section class="ws-card"><h2>Activity</h2>
      ${comments.length ? `<ol class="ws-thread">${comments.map((c) => `<li class="k-${c.kind.toLowerCase()}"><span class="ws-av sm">${esc(initials(c.name))}</span><div>
        <p class="ws-by"><strong>${esc(c.name || 'Former employee')}</strong>${c.kind === 'APPROVED' ? ' approved this task' : c.kind === 'REVISION' ? ' requested a revision' : ''}<small>${esc(fmtWhen(c.created_at))}</small></p>
        ${c.body ? `<p>${nl(c.body)}</p>` : ''}</div></li>`).join('')}</ol>` : '<p class="muted">No comments yet.</p>'}
      ${act('comments', '<label class="sr-only" for="comment">Comment</label><textarea name="body" id="comment" rows="3" required maxlength="4000" placeholder="Write a comment or update"></textarea><button class="ws-btn" type="submit">Comment</button>', '', ' class="ws-form"')}
    </section>
  </div>

  <aside class="ws-detail-side">
    <section class="ws-card">
      <p class="ws-kv"><span>Assignee</span><strong>${esc(x.assignee || 'Unassigned')}</strong></p>
      <p class="ws-kv"><span>Project</span><strong>${x.project_id ? `<a href="/team/projects/${x.project_id}">${esc(x.project)}</a>` : 'None'}</strong></p>
      <p class="ws-kv"><span>Due</span><strong>${due(x.due_date, x.status === 'DONE')}</strong></p>
      <p class="ws-kv"><span>Created by</span><strong>${esc(x.creator || '—')}</strong></p>
      <p class="ws-kv"><span>Created</span><strong>${esc(fmtWhen(x.created_at))}</strong></p>
      ${x.approved_at ? `<p class="ws-kv"><span>Approved</span><strong>${esc(fmtWhen(x.approved_at))}</strong></p>` : ''}
      ${moves.length ? act('status', `<label>Move to<select name="status" id="status">${options(moves, '')}</select></label><button class="ws-btn ws-btn-ghost" type="submit">Update status</button>`, '', ' class="ws-form ws-move"') : ''}
      ${x.status !== 'REVIEW' && x.status !== 'DONE' && x.assignee_id === u.id && !approver ? '<p class="muted small">When the work is finished, move it to “In review” so it can be approved.</p>' : ''}
    </section>
    <section class="ws-card"><h2>Files</h2>
      ${files.length ? `<ul class="ws-files">${files.map((f) => `<li><a href="/team/files/${f.id}">${esc(f.name)}</a><small>${kb(f.size)} · ${esc(f.uploader || '')}</small>
        ${f.user_id === u.id || editor ? `<form method="post" action="/team/files/${f.id}/delete" data-confirm="Delete this file?">${csrfField(req)}<button class="ws-link-btn" type="submit">Delete</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No files yet.</p>'}
      <form id="upload-form" action="/team/tasks/${x.id}/files" class="ws-form"><label>Add a file<input type="file" name="file" id="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.zip,.txt,.csv"></label>
        <small class="muted">PDF, images, Word, Excel, PowerPoint, ZIP, TXT or CSV. Up to 10 MB.</small><p class="ws-err" role="alert"></p><button class="ws-btn ws-btn-ghost" type="submit">Upload</button></form>
    </section>
  </aside>
</div>`, { active: '/team/tasks' });
  });

  app.post('/team/tasks/:id', auth, loadTask, (req, res) => {
    const x = req.task;
    if (!canEditTask(req.user, x)) return fail(req, res, 403, 'You cannot edit this task.');
    const [f, e] = readTask(req, x);
    if (e) return back(res, `/team/tasks/${x.id}?edit=1&e=${encodeURIComponent(e)}`);
    run("UPDATE tasks SET title = ?, description = ?, project_id = ?, assignee_id = ?, priority = ?, due_date = ?, updated_at = datetime('now') WHERE id = ?",
      f.title, f.description, f.project_id, f.assignee_id, f.priority, f.due_date, x.id);
    if (f.assignee_id !== x.assignee_id) notify(req, f.assignee_id, `${req.user.name} assigned you “${f.title}”`, `/team/tasks/${x.id}`);
    audit(req, 'task_updated', 'task', x.id, f.title);
    back(res, `/team/tasks/${x.id}`, 'saved');
  });

  // Moves a task between statuses and tells the people who need to know.
  const setStatus = (req, x, s) => {
    const done = s === 'DONE';
    run(`UPDATE tasks SET status = ?, updated_at = datetime('now'), approved_by = ?, approved_at = ${done ? "datetime('now')" : 'NULL'} WHERE id = ?`, s, done ? req.user.id : null, x.id);
    audit(req, 'task_status', 'task', x.id, `${x.status} → ${s}`);
    const link = `/team/tasks/${x.id}`;
    if (s === 'REVIEW') new Set([x.created_by, leadOf(x)]).forEach((id) => notify(req, id, `“${x.title}” is ready for your review`, link));
    else if (x.assignee_id) notify(req, x.assignee_id, `${req.user.name} moved “${x.title}” to ${label(STATUS, s)}`, link);
  };

  app.post('/team/tasks/:id/status', auth, loadTask, (req, res) => {
    const x = req.task; const s = pick(STATUS, req.body.status, '');
    if (!s) return fail(req, res, 400, 'Choose a status.');
    if (!canSetStatus(req.user, x, s)) return fail(req, res, 403, s === 'DONE' || s === 'REVISION' ? 'Only an approver can move a task to Done or Needs revision.' : 'You cannot change this task.');
    if (s !== x.status) setStatus(req, x, s);
    if (wantsJson(req)) return res.json({ ok: true });
    back(res, `/team/tasks/${x.id}`, 'moved');
  });

  app.post('/team/tasks/:id/approve', auth, loadTask, (req, res) => {
    const x = req.task;
    if (!canApprove(req.user, x)) return fail(req, res, 403, 'You cannot approve this task.');
    tx(() => {
      run('INSERT INTO comments (task_id, user_id, body, kind) VALUES (?,?,?,?)', x.id, req.user.id, t(req.body.note, 2000), 'APPROVED');
      setStatus(req, x, 'DONE');
    });
    back(res, `/team/tasks/${x.id}`, 'approved');
  });

  app.post('/team/tasks/:id/revision', auth, loadTask, (req, res) => {
    const x = req.task; const note = t(req.body.note, 2000);
    if (!canApprove(req.user, x)) return fail(req, res, 403, 'You cannot review this task.');
    if (!note) return fail(req, res, 400, 'Explain what needs to change.');
    tx(() => {
      run('INSERT INTO comments (task_id, user_id, body, kind) VALUES (?,?,?,?)', x.id, req.user.id, note, 'REVISION');
      setStatus(req, x, 'REVISION');
    });
    back(res, `/team/tasks/${x.id}`, 'revision');
  });

  app.post('/team/tasks/:id/comments', auth, loadTask, (req, res) => {
    const x = req.task; const body = t(req.body.body, 4000);
    if (!body) return back(res, `/team/tasks/${x.id}`);
    run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', x.id, req.user.id, body);
    run("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?", x.id);
    new Set([x.assignee_id, x.created_by]).forEach((id) => notify(req, id, `${req.user.name} commented on “${x.title}”`, `/team/tasks/${x.id}`));
    back(res, `/team/tasks/${x.id}`, 'commented');
  });

  app.post('/team/tasks/:id/subtasks', auth, loadTask, (req, res) => {
    const x = req.task; const u = req.user;
    if (x.parent_id) return fail(req, res, 400, 'Subtasks cannot have their own subtasks.');
    if (!(canEditTask(u, x) || x.assignee_id === u.id)) return fail(req, res, 403, 'You cannot add subtasks here.');
    const title = t(req.body.title, 200);
    if (!title) return back(res, `/team/tasks/${x.id}`);
    let assignee = rank(u) >= RANK.TEAM_LEAD ? int(req.body.assignee_id) : x.assignee_id;
    if (assignee && !one('SELECT 1 FROM users WHERE id = ? AND active = 1', assignee)) assignee = null;
    const r = run('INSERT INTO tasks (project_id, parent_id, title, priority, assignee_id, created_by, due_date) VALUES (?,?,?,?,?,?,?)', x.project_id, x.id, title, x.priority, assignee, u.id, x.due_date);
    audit(req, 'subtask_created', 'task', Number(r.lastInsertRowid), title);
    notify(req, assignee, `${u.name} assigned you a subtask: “${title}”`, `/team/tasks/${x.id}`);
    back(res, `/team/tasks/${x.id}`, 'created');
  });

  // Subtasks work as a checklist: whoever works on the parent can tick them.
  app.post('/team/tasks/:id/toggle/:sub', auth, loadTask, (req, res) => {
    const x = req.task; const u = req.user;
    const s = int(req.params.sub) && one('SELECT * FROM tasks WHERE id = ? AND parent_id = ?', int(req.params.sub), x.id);
    if (!s) return fail(req, res, 404, 'Subtask not found.');
    if (!(canEditTask(u, x) || x.assignee_id === u.id || s.assignee_id === u.id)) return fail(req, res, 403, 'You cannot change this subtask.');
    const next = s.status === 'DONE' ? 'TODO' : 'DONE';
    run("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?", next, s.id);
    audit(req, 'subtask_status', 'task', s.id, next);
    back(res, `/team/tasks/${x.id}`);
  });

  app.post('/team/tasks/:id/delete', auth, loadTask, (req, res) => {
    const x = req.task;
    if (!canEditTask(req.user, x)) return fail(req, res, 403, 'You cannot delete this task.');
    const stored = all('SELECT f.stored FROM files f WHERE f.task_id = ? OR f.task_id IN (SELECT id FROM tasks WHERE parent_id = ?)', x.id, x.id);
    run('DELETE FROM tasks WHERE id = ?', x.id);
    stored.forEach((f) => fs.rm(path.join(FILE_DIR, f.stored), { force: true }, () => {}));
    audit(req, 'task_deleted', 'task', x.id, x.title);
    back(res, x.parent_id ? `/team/tasks/${x.parent_id}` : '/team/tasks', 'deleted');
  });

  // ---------------------------------------------------------------- files
  // Accepted by content, not by name: the first bytes must match the type.
  const sniff = (buf, ext) => {
    const hex = buf.subarray(0, 12).toString('hex');
    if (buf.subarray(0, 5).toString() === '%PDF-') return ext === 'pdf';
    if (hex.startsWith('89504e47')) return ext === 'png';
    if (hex.startsWith('ffd8ff')) return ext === 'jpg' || ext === 'jpeg';
    if (hex.startsWith('47494638')) return ext === 'gif';
    if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return ext === 'webp';
    if (hex.startsWith('504b0304')) return ['docx', 'xlsx', 'pptx', 'zip'].includes(ext);
    if (['txt', 'csv'].includes(ext)) return !buf.includes(0);
    return false;
  };
  app.post('/team/tasks/:id/files', auth, express.raw({ type: 'application/octet-stream', limit: MAX_FILE }), loadTask, (req, res) => {
    const buf = req.body;
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { /* bad header */ }
    name = path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'The file is empty.' });
    if (!name || !sniff(buf, ext)) return res.status(400).json({ error: 'This file type is not allowed, or the file does not match its extension.' });
    fs.mkdirSync(FILE_DIR, { recursive: true });
    const stored = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(FILE_DIR, stored), buf);
    const r = run('INSERT INTO files (task_id, user_id, name, stored, size) VALUES (?,?,?,?,?)', req.task.id, req.user.id, name, stored, buf.length);
    audit(req, 'file_uploaded', 'file', Number(r.lastInsertRowid), name);
    new Set([req.task.assignee_id, req.task.created_by]).forEach((id) => notify(req, id, `${req.user.name} added a file to “${req.task.title}”`, `/team/tasks/${req.task.id}`));
    res.json({ ok: true });
  });

  const loadFile = (req, res, next) => {
    const f = int(req.params.id) && one('SELECT * FROM files WHERE id = ?', int(req.params.id));
    const x = f && getTask(f.task_id);
    if (!f || !x || !canViewTask(req.user, x)) return fail(req, res, 404, 'File not found.');
    req.file = f; req.task = x; next();
  };
  app.get('/team/files/:id', auth, loadFile, (req, res) => {
    const p = path.join(FILE_DIR, req.file.stored);
    if (!fs.existsSync(p)) return fail(req, res, 404, 'File not found.');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.download(p, req.file.name, { headers: { 'Content-Type': 'application/octet-stream' } });
  });
  app.post('/team/files/:id/delete', auth, loadFile, (req, res) => {
    if (!(req.file.user_id === req.user.id || canEditTask(req.user, req.task))) return fail(req, res, 403, 'You cannot delete this file.');
    run('DELETE FROM files WHERE id = ?', req.file.id);
    fs.rm(path.join(FILE_DIR, req.file.stored), { force: true }, () => {});
    audit(req, 'file_deleted', 'file', req.file.id, req.file.name);
    back(res, `/team/tasks/${req.task.id}`, 'deleted');
  });

  // ---------------------------------------------------------------- projects
  const getProject = (id) => (int(id) ? one('SELECT p.*, l.name AS lead FROM projects p LEFT JOIN users l ON l.id = p.lead_id WHERE p.id = ?', int(id)) : null);
  const loadProject = (req, res, next) => {
    const p = getProject(req.params.id);
    if (!p || !canViewProject(req.user, p)) return fail(req, res, 404, 'This project does not exist or you are not a member.');
    req.project = p; next();
  };

  app.get('/team/projects', auth, (req, res) => {
    const u = req.user;
    const rows = all(`SELECT p.*, l.name AS lead,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL) AS total,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status = 'DONE') AS done,
      (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS members
      FROM projects p LEFT JOIN users l ON l.id = p.lead_id ${seesAll(u) ? '' : 'WHERE p.lead_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)'}
      ORDER BY p.status = 'COMPLETED', p.name`, ...(seesAll(u) ? [] : [u.id, u.id]));
    send(req, res, 'Projects', `${head('Projects', '', seesAll(u) ? '<a class="ws-btn" href="/team/projects/new">New project</a>' : '')}
${rows.length ? `<div class="ws-projects">${rows.map((p) => { const pct = p.total ? Math.round((p.done / p.total) * 100) : 0; return `
<a class="ws-card ws-project" href="/team/projects/${p.id}">
  <div class="ws-card-head"><h2>${esc(p.name)}</h2>${chip('ps', p.status, label(PSTATUS, p.status))}</div>
  ${p.description ? `<p class="muted clamp">${esc(p.description)}</p>` : ''}
  <div class="ws-bar" role="img" aria-label="${pct}% of tasks done"><i style="width:${pct}%"></i></div>
  <p class="ws-meta"><span>${p.done}/${p.total} tasks done</span><span>${p.members} member${p.members === 1 ? '' : 's'}</span>${p.due_date ? `<span>Due ${esc(fmtDay(p.due_date))}</span>` : ''}</p>
  <p class="muted small">Lead: ${esc(p.lead || 'Not set')}</p>
</a>`; }).join('')}</div>`
      : `<div class="ws-card ws-empty"><h2>No projects yet</h2><p class="muted">${seesAll(u) ? 'Create a project to group related tasks and people.' : 'You will see projects here once you are added to one.'}</p></div>`}`, { active: '/team/projects' });
  });

  const projectForm = (req, p, action, submit) => `<form method="post" action="${action}" class="ws-form">${csrfField(req)}
  <label>Project name<input name="name" id="name" required maxlength="160" value="${esc(p.name || '')}"></label>
  <label>Description<textarea name="description" id="description" rows="4" maxlength="4000">${esc(p.description || '')}</textarea></label>
  <div class="ws-row">
    <label>Lead<select name="lead_id" id="lead_id">${userOptions(req.user, p.lead_id, 'No lead')}</select></label>
    <label>Status<select name="status" id="status">${options(PSTATUS, p.status || 'ACTIVE')}</select></label>
  </div>
  <div class="ws-row">
    <label>Start date<input type="date" name="start_date" id="start_date" value="${esc(p.start_date || '')}"></label>
    <label>Due date<input type="date" name="due_date" id="due_date" value="${esc(p.due_date || '')}"></label>
  </div>
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <div class="ws-actions"><button class="ws-btn" type="submit">${submit}</button><a class="ws-btn ws-btn-ghost" href="${p.id ? '/team/projects/' + p.id : '/team/projects'}">Cancel</a></div></form>`;
  const readProject = (b) => {
    const name = t(b.name, 160);
    if (!name) return [null, 'Give the project a name.'];
    let lead = int(b.lead_id);
    if (lead && !one('SELECT 1 FROM users WHERE id = ? AND active = 1', lead)) lead = null;
    return [{ name, description: t(b.description, 4000), lead_id: lead, status: pick(PSTATUS, b.status, 'ACTIVE'), start_date: isDate(b.start_date) ? b.start_date : '', due_date: isDate(b.due_date) ? b.due_date : '' }, ''];
  };

  app.get('/team/projects/new', auth, need(seesAll, 'Only managers and above can create projects.'), (req, res) =>
    send(req, res, 'New project', `${head('New project')}<div class="ws-card ws-narrow">${projectForm(req, {}, '/team/projects', 'Create project')}</div>`, { active: '/team/projects' }));

  app.post('/team/projects', auth, need(seesAll, 'Only managers and above can create projects.'), (req, res) => {
    const [f, e] = readProject(req.body);
    if (e) return back(res, '/team/projects/new?e=' + encodeURIComponent(e));
    const id = tx(() => {
      const r = run('INSERT INTO projects (name, description, status, lead_id, start_date, due_date, created_by) VALUES (?,?,?,?,?,?,?)', f.name, f.description, f.status, f.lead_id, f.start_date, f.due_date, req.user.id);
      const pid = Number(r.lastInsertRowid);
      if (f.lead_id) run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', pid, f.lead_id);
      return pid;
    });
    audit(req, 'project_created', 'project', id, f.name);
    notify(req, f.lead_id, `${req.user.name} made you lead of “${f.name}”`, `/team/projects/${id}`);
    back(res, `/team/projects/${id}`, 'created');
  });

  app.get('/team/projects/:id', auth, loadProject, (req, res) => {
    const u = req.user; const p = req.project; const manage = canManageProject(u, p);
    if (req.query.edit === '1' && manage) return send(req, res, 'Edit project', `${head('Edit project')}<div class="ws-card ws-narrow">${projectForm(req, p, `/team/projects/${p.id}`, 'Save changes')}</div>`, { active: '/team/projects' });
    const members = all('SELECT u.id, u.name, u.position, u.emp_id FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name', p.id);
    const others = manage ? all('SELECT id, name FROM users WHERE active = 1 AND id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?) ORDER BY name', p.id) : [];
    const tasks = all(TASK_SELECT + " WHERE t.project_id = ? AND t.parent_id IS NULL ORDER BY t.status = 'DONE', (t.due_date = ''), t.due_date", p.id);
    send(req, res, p.name, `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/projects">Projects</a></nav>
${head(p.name, `${chip('ps', p.status, label(PSTATUS, p.status))} Lead: ${esc(p.lead || 'Not set')}`, `${manage ? `<a class="ws-btn ws-btn-ghost" href="/team/projects/${p.id}?edit=1">Edit</a>` : ''}<a class="ws-btn" href="/team/tasks/new?project=${p.id}">New task</a>`)}
<div class="ws-detail">
  <div class="ws-detail-main">
    ${p.description ? `<section class="ws-card"><p class="ws-prose">${nl(p.description)}</p></section>` : ''}
    <section class="ws-card"><div class="ws-card-head"><h2>Tasks</h2><a href="/team/tasks?view=board&who=all&project=${p.id}">Open board</a></div>
    ${tasks.length ? `<ul class="ws-list">${tasks.map((x) => `<li><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong><span class="muted">${esc(x.assignee || 'Unassigned')}</span></a><span class="ws-meta">${statusChip(x.status)}${due(x.due_date, x.status === 'DONE')}</span></li>`).join('')}</ul>` : '<p class="muted">No tasks in this project yet.</p>'}</section>
  </div>
  <aside class="ws-detail-side">
    <section class="ws-card">
      ${p.start_date ? `<p class="ws-kv"><span>Start</span><strong>${esc(fmtDay(p.start_date))}</strong></p>` : ''}
      ${p.due_date ? `<p class="ws-kv"><span>Due</span><strong>${esc(fmtDay(p.due_date))}</strong></p>` : ''}
      <h2>Members</h2>
      ${members.length ? `<ul class="ws-people">${members.map((m) => `<li><span class="ws-av sm">${esc(initials(m.name))}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.position || m.emp_id)}</small></span>
        ${manage ? `<form method="post" action="/team/projects/${p.id}/members/${m.id}/remove" data-confirm="Remove ${esc(m.name)} from this project?">${csrfField(req)}<button class="ws-link-btn" type="submit" aria-label="Remove ${esc(m.name)}">Remove</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No members yet.</p>'}
      ${manage && others.length ? `<form method="post" action="/team/projects/${p.id}/members" class="ws-inline ws-add">${csrfField(req)}<label class="sr-only" for="member">Add member</label><select name="user_id" id="member">${options(others.map((o) => [o.id, o.name]), '')}</select><button class="ws-btn ws-btn-ghost" type="submit">Add</button></form>` : ''}
    </section>
  </aside>
</div>`, { active: '/team/projects' });
  });

  app.post('/team/projects/:id', auth, loadProject, (req, res) => {
    const p = req.project;
    if (!canManageProject(req.user, p)) return fail(req, res, 403, 'You cannot edit this project.');
    const [f, e] = readProject(req.body);
    if (e) return back(res, `/team/projects/${p.id}?edit=1&e=${encodeURIComponent(e)}`);
    run('UPDATE projects SET name = ?, description = ?, status = ?, lead_id = ?, start_date = ?, due_date = ? WHERE id = ?', f.name, f.description, f.status, f.lead_id, f.start_date, f.due_date, p.id);
    if (f.lead_id) run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', p.id, f.lead_id);
    if (f.lead_id !== p.lead_id) notify(req, f.lead_id, `${req.user.name} made you lead of “${f.name}”`, `/team/projects/${p.id}`);
    audit(req, 'project_updated', 'project', p.id, f.name);
    back(res, `/team/projects/${p.id}`, 'saved');
  });
  app.post('/team/projects/:id/members', auth, loadProject, (req, res) => {
    const p = req.project; const uid = int(req.body.user_id);
    if (!canManageProject(req.user, p)) return fail(req, res, 403, 'You cannot change the members of this project.');
    if (uid && one('SELECT 1 FROM users WHERE id = ? AND active = 1', uid)) {
      run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', p.id, uid);
      audit(req, 'project_member_added', 'project', p.id, String(uid));
      notify(req, uid, `${req.user.name} added you to “${p.name}”`, `/team/projects/${p.id}`);
    }
    back(res, `/team/projects/${p.id}`, 'saved');
  });
  app.post('/team/projects/:id/members/:uid/remove', auth, loadProject, (req, res) => {
    const p = req.project;
    if (!canManageProject(req.user, p)) return fail(req, res, 403, 'You cannot change the members of this project.');
    run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', p.id, int(req.params.uid));
    audit(req, 'project_member_removed', 'project', p.id, String(req.params.uid));
    back(res, `/team/projects/${p.id}`, 'saved');
  });

  // ---------------------------------------------------------------- employees
  app.get('/team/employees', auth, (req, res) => {
    const u = req.user;
    const rows = all(`SELECT * FROM users ${isAdmin(u) ? '' : 'WHERE active = 1'} ORDER BY active DESC, emp_id`);
    send(req, res, 'Employees', `${head('Employees', `${rows.filter((r) => r.active).length} active`, isAdmin(u) ? '<a class="ws-btn" href="/team/employees/new">Add employee</a>' : '')}
<div class="ws-table-wrap ws-card flush"><table class="ws-table"><thead><tr><th>Employee</th><th>ID</th><th>Position</th><th>Role</th><th>Email</th>${isAdmin(u) ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead><tbody>
${rows.map((r) => `<tr class="${r.active ? '' : 'is-off'}"><td><span class="ws-person"><span class="ws-av sm">${esc(initials(r.name))}</span><strong>${esc(r.name)}</strong>${r.active ? '' : ' <span class="chip st-revision">Inactive</span>'}</span></td>
<td class="num">${esc(r.emp_id)}</td><td>${esc(r.position)}${r.department ? `<br><span class="muted">${esc(r.department)}</span>` : ''}</td><td>${esc(label(ROLES, r.role))}</td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
${isAdmin(u) ? `<td>${canManageUser(u, r) ? `<a href="/team/employees/${r.id}">Manage</a>` : ''}</td>` : ''}</tr>`).join('')}
</tbody></table></div>`, { active: '/team/employees' });
  });

  const empForm = (req, r, action, submit) => `<form method="post" action="${action}" class="ws-form">${csrfField(req)}
  <div class="ws-row"><label>Full name<input name="name" id="name" required maxlength="120" value="${esc(r.name || '')}"></label>
    <label>Email<input type="email" name="email" id="email" required maxlength="160" value="${esc(r.email || '')}"></label></div>
  <div class="ws-row"><label>Phone<input type="tel" name="phone" id="phone" maxlength="40" value="${esc(r.phone || '')}"></label>
    <label>Joined on<input type="date" name="joined_on" id="joined_on" value="${esc(r.joined_on || today())}"></label></div>
  <div class="ws-row"><label>Position<input name="position" id="position" maxlength="120" value="${esc(r.position || '')}" placeholder="e.g. Sourcing Coordinator"></label>
    <label>Department<input name="department" id="department" maxlength="120" value="${esc(r.department || '')}"></label></div>
  <label>Role<select name="role" id="role">${options(assignableRoles(req.user), r.role || 'EMPLOYEE')}</select>
    <small>Employee: own tasks. Team lead: assigns and approves in their projects. Manager: all tasks and projects. Admin: also manages employees.</small></label>
  ${r.id ? `<label class="ws-check-row"><input type="checkbox" name="active" id="active" value="1"${r.active ? ' checked' : ''}> Active (can sign in)</label>`
    : '<label>Temporary password<input type="text" name="password" id="password" required minlength="10" autocomplete="off"><small>Share it with the employee privately. They must change it when they first sign in.</small></label>'}
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <div class="ws-actions"><button class="ws-btn" type="submit">${submit}</button><a class="ws-btn ws-btn-ghost" href="/team/employees">Cancel</a></div></form>`;
  const readEmp = (req) => {
    const b = req.body;
    const f = { name: t(b.name, 120), email: t(b.email, 160).toLowerCase(), phone: t(b.phone, 40), position: t(b.position, 120), department: t(b.department, 120),
      joined_on: isDate(b.joined_on) ? b.joined_on : '', role: pick(assignableRoles(req.user), b.role, 'EMPLOYEE') };
    if (!f.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return [null, 'Enter a name and a valid email.'];
    return [f, ''];
  };
  const loadEmp = (req, res, next) => {
    const r = int(req.params.id) && one('SELECT * FROM users WHERE id = ?', int(req.params.id));
    if (!r || !canManageUser(req.user, r)) return fail(req, res, 404, 'Employee not found, or you cannot manage this account.');
    req.emp = r; next();
  };
  const superCount = () => one("SELECT COUNT(*) AS n FROM users WHERE role = 'SUPER_ADMIN' AND active = 1").n;

  app.get('/team/employees/new', auth, need(isAdmin), (req, res) =>
    send(req, res, 'Add employee', `${head('Add employee', `The employee ID will be ${esc(nextEmpId())}.`)}<div class="ws-card ws-narrow">${empForm(req, {}, '/team/employees', 'Add employee')}</div>`, { active: '/team/employees' }));

  app.post('/team/employees', auth, need(isAdmin), (req, res) => {
    const [f, e] = readEmp(req); const pw = String(req.body.password || '');
    const err = (m) => back(res, '/team/employees/new?e=' + encodeURIComponent(m));
    if (e) return err(e);
    if (pwProblem(pw)) return err(pwProblem(pw));
    if (one('SELECT 1 FROM users WHERE email = ?', f.email)) return err('An employee with this email already exists.');
    const empId = nextEmpId();
    const r = run('INSERT INTO users (emp_id, name, email, phone, position, department, role, password_hash, must_change_pw, joined_on) VALUES (?,?,?,?,?,?,?,?,1,?)',
      empId, f.name, f.email, f.phone, f.position, f.department, f.role, hashPw(pw), f.joined_on);
    audit(req, 'employee_created', 'user', Number(r.lastInsertRowid), `${empId} ${f.email} ${f.role}`);
    back(res, '/team/employees', 'created');
  });

  app.get('/team/employees/:id', auth, need(isAdmin), loadEmp, (req, res) => {
    const r = req.emp;
    send(req, res, r.name, `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/employees">Employees</a></nav>${head(r.name, `${esc(r.emp_id)} · last sign-in ${r.last_login_at ? esc(fmtWhen(r.last_login_at)) : 'never'}`)}
<div class="ws-detail"><div class="ws-detail-main"><section class="ws-card">${empForm(req, r, `/team/employees/${r.id}`, 'Save changes')}</section></div>
<aside class="ws-detail-side"><section class="ws-card"><h2>Reset password</h2><p class="muted small">Sets a new temporary password and signs the employee out everywhere.</p>
<form method="post" action="/team/employees/${r.id}/reset" class="ws-form">${csrfField(req)}<label>New temporary password<input type="text" name="password" id="reset-password" required minlength="10" autocomplete="off"></label><button class="ws-btn ws-btn-ghost" type="submit">Reset password</button></form></section></aside></div>`, { active: '/team/employees' });
  });

  app.post('/team/employees/:id', auth, need(isAdmin), loadEmp, (req, res) => {
    const r = req.emp; const [f, e] = readEmp(req);
    const err = (m) => back(res, `/team/employees/${r.id}?e=${encodeURIComponent(m)}`);
    if (e) return err(e);
    const active = req.body.active === '1' ? 1 : 0;
    if (r.id === req.user.id && (!active || f.role !== r.role)) return err('You cannot change your own role or deactivate yourself.');
    if (r.role === 'SUPER_ADMIN' && (f.role !== 'SUPER_ADMIN' || !active) && superCount() <= 1) return err('There must always be at least one active Super admin.');
    if (one('SELECT 1 FROM users WHERE email = ? AND id != ?', f.email, r.id)) return err('Another employee already uses this email.');
    run('UPDATE users SET name = ?, email = ?, phone = ?, position = ?, department = ?, role = ?, joined_on = ?, active = ? WHERE id = ?',
      f.name, f.email, f.phone, f.position, f.department, f.role, f.joined_on, active, r.id);
    if (!active) run('DELETE FROM sessions WHERE user_id = ?', r.id);
    audit(req, 'employee_updated', 'user', r.id, `${r.emp_id} role=${f.role} active=${active}`);
    back(res, `/team/employees/${r.id}`, 'saved');
  });

  app.post('/team/employees/:id/reset', auth, need(isAdmin), loadEmp, (req, res) => {
    const r = req.emp; const pw = String(req.body.password || '');
    if (pwProblem(pw)) return back(res, `/team/employees/${r.id}?e=${encodeURIComponent(pwProblem(pw))}`);
    run('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?', hashPw(pw), r.id);
    run('DELETE FROM sessions WHERE user_id = ?', r.id);
    audit(req, 'password_reset', 'user', r.id, r.emp_id);
    back(res, `/team/employees/${r.id}`, 'reset');
  });

  // ---------------------------------------------------------------- audit log
  app.get('/team/audit', auth, need(isAdmin), (req, res) => {
    const page = Math.max(1, int(req.query.page) || 1); const per = 100;
    const rows = all('SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?', per + 1, (page - 1) * per);
    const more = rows.length > per;
    send(req, res, 'Audit log', `${head('Audit log', 'Every sign-in and change made in the Workspace. Times in Bangladesh time.')}
<div class="ws-table-wrap ws-card flush"><table class="ws-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th><th>IP</th></tr></thead><tbody>
${rows.slice(0, per).map((a) => `<tr><td class="num">${esc(fmtWhen(a.created_at))}</td><td>${esc(a.name || '—')}</td><td><code>${esc(a.action)}</code></td><td>${a.entity ? esc(a.entity + (a.entity_id ? ' #' + a.entity_id : '')) : ''}</td><td>${esc(a.detail)}</td><td class="num muted">${esc(a.ip)}</td></tr>`).join('')}
</tbody></table></div>
<p class="ws-pager">${page > 1 ? `<a href="?page=${page - 1}">Newer</a>` : ''}${more ? `<a href="?page=${page + 1}">Older</a>` : ''}</p>`, { active: '/team/audit' });
  });

  app.all('/team/*', auth, (req, res) => fail(req, res, 404, 'Page not found.'));
};
