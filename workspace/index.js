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
const ASSET_V = '4';
// Fingerprint machine attendance is on hold until FINGERPRINT=1 is set in Coolify.
const FINGERPRINT = process.env.FINGERPRINT === '1';

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
  uploaded: 'Marked as uploaded.', stepback: 'Moved one step back.', fixed: 'Attendance corrected.', posted: 'Announcement posted to everyone.',
  password: 'Password changed.', reset: 'Password reset. The employee must change it at next sign-in.', read: 'All notifications marked as read.',
};

module.exports = function mountWorkspace(app, { DATA_DIR, esc }) {
  const db = open(DATA_DIR);
  const FILE_DIR = path.join(DATA_DIR, 'workspace-files');
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...a) => q(sql).get(...a);
  const all = (sql, ...a) => q(sql).all(...a);
  const run = (sql, ...a) => q(sql).run(...a);
  const q2 = (sql, params) => q(sql).all(params);
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

  // ---------------------------------------------------------------- per-employee access
  // Managers and above open everything. Everyone else opens what the admin ticked on
  // their profile; before anything is ticked, their role's defaults apply.
  // Anyone given daily upload work gets Video uploads with it.
  const MODULES = [['tasks', 'Tasks'], ['uploads', 'Video uploads'], ['projects', 'Projects'], ['attendance', 'Attendance'], ['employees', 'Employee directory'],
    ['inbox', 'Inbox & job applications'], ['reports', 'Reports']];
  const defaultModules = (u) => (rank(u) >= RANK.MANAGER ? MODULES.map((m) => m[0]) : ['tasks', 'projects', 'attendance', 'employees']);
  const parseModules = (u) => { try { const m = JSON.parse(u.modules || 'null'); return Array.isArray(m) ? m : null; } catch (e) { return null; } };
  const hasUploadWork = (u) => Boolean(one("SELECT 1 FROM schedules WHERE assignee_id = ? AND active = 1 UNION SELECT 1 FROM tasks WHERE assignee_id = ? AND kind = 'UPLOAD' AND status != 'DONE' LIMIT 1", u.id, u.id));
  const hasModule = (u, m) => {
    if (seesAll(u)) return true;  // managers and above supervise, so they open everything
    if ((parseModules(u) || defaultModules(u)).includes(m)) return true;
    return m === 'uploads' && hasUploadWork(u);
  };
  const setting = (k, d = '') => { const r = one('SELECT value FROM settings WHERE key = ?', k); return r ? r.value : d; };
  const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
  const deviceMode = () => FINGERPRINT && setting('attendance_mode', 'MANUAL') === 'DEVICE';

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
    ['/team/dashboard', 'Dashboard', 'grid'], ['/team/announcements', 'Announcements', 'megaphone'], ['/team/calendar', 'Calendar', 'calendar'],
    ['/team/tasks', 'Tasks', 'check', (u) => hasModule(u, 'tasks')],
    ['/team/uploads', 'Video uploads', 'video', (u) => hasModule(u, 'uploads')], ['/team/projects', 'Projects', 'folder', (u) => hasModule(u, 'projects')],
    ['/team/attendance', 'Attendance', 'clock', (u) => hasModule(u, 'attendance')], ['/team/notifications', 'Notifications', 'bell'],
    ['/team/inbox', 'Inbox', 'inbox', (u) => hasModule(u, 'inbox')], ['/team/reports', 'Reports', 'chart', (u) => hasModule(u, 'reports')],
    ['/team/employees', 'Employees', 'users', (u) => hasModule(u, 'employees')], ['/team/website', 'Website', 'globe', isAdmin],
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
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

  function shell(req, title, body, { active = '', bare = false } = {}) {
    const u = req.user;
    const m = MSG[req.query && req.query.m];
    const nav = u && !bare ? `<aside class="ws-side">
  <a class="ws-brand" href="/team/dashboard"><img src="/images/logo.png" alt="" width="34" height="34"><span>MONOHA<small>Workspace</small></span></a>
  <form class="ws-search" action="/team/search" role="search"><label class="sr-only" for="ws-q">Search</label><input type="search" name="q" id="ws-q" placeholder="Search tasks, people, applications…" value="${esc(t(req.query && req.query.q, 80))}"></form>
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
${dashAnnouncements()}
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
${hasModule(u, 'uploads') ? uploadsToday(u) : ''}
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
    if (deviceMode()) {
      if (!att || !att.check_in) return '<p class="muted">No fingerprint yet today. Attendance comes from the fingerprint machine at the office.</p>';
      return `<p class="ws-kv"><span>In</span><strong>${fmtTime(att.check_in)}</strong></p>${att.check_out ? `<p class="ws-kv"><span>Out (last punch)</span><strong>${fmtTime(att.check_out)}</strong></p>` : ''}<p class="muted small">${att.source === 'ADMIN' ? 'Corrected by an admin.' : 'From the fingerprint machine.'}</p>`;
    }
    const form = (action, text, cls = '') => `<form method="post" action="/team/attendance/${action}">${csrfField(req)}<button class="ws-btn${cls}" type="submit">${text}</button></form>`;
    if (!att || !att.check_in) return `<p class="muted">You have not checked in yet today.</p>${form('in', 'Check in')}`;
    if (!att.check_out) return `<p class="ws-kv"><span>Checked in</span><strong>${fmtTime(att.check_in)}</strong></p>${form('out', 'Check out', ' ws-btn-ghost')}`;
    return `<p class="ws-kv"><span>Checked in</span><strong>${fmtTime(att.check_in)}</strong></p><p class="ws-kv"><span>Checked out</span><strong>${fmtTime(att.check_out)}</strong></p>`;
  }
  const fromPage = (req) => { try { return safeNext(new URL(req.get('referer')).pathname); } catch (e) { return '/team/dashboard'; } };
  const hours = (a) => (a.check_in && a.check_out ? ((toDate(a.check_out) - toDate(a.check_in)) / 36e5).toFixed(1) + ' h' : '');

  app.post('/team/attendance/in', auth, (req, res) => {
    if (deviceMode()) return fail(req, res, 403, 'Attendance is recorded by the fingerprint machine.');
    const d = today();
    const a = one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', req.user.id, d);
    if (!a) { run('INSERT INTO attendance (user_id, day, check_in) VALUES (?,?,?)', req.user.id, d, new Date().toISOString()); audit(req, 'check_in', 'attendance', null, d); }
    back(res, fromPage(req), 'checkin');
  });
  app.post('/team/attendance/out', auth, (req, res) => {
    if (deviceMode()) return fail(req, res, 403, 'Attendance is recorded by the fingerprint machine.');
    const d = today();
    const r = run('UPDATE attendance SET check_out = ? WHERE user_id = ? AND day = ? AND check_in IS NOT NULL AND check_out IS NULL', new Date().toISOString(), req.user.id, d);
    if (r.changes) audit(req, 'check_out', 'attendance', null, d);
    back(res, fromPage(req), 'checkout');
  });

  app.get('/team/attendance', auth, need((u) => hasModule(u, 'attendance')), (req, res) => {
    const u = req.user; const d = today();
    const day = isDate(req.query.day) ? req.query.day : d;
    const mine = all('SELECT * FROM attendance WHERE user_id = ? ORDER BY day DESC LIMIT 31', u.id);
    const board = seesAll(u) ? all(`SELECT u.id, u.name, u.emp_id, u.position, a.check_in, a.check_out, a.source FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.day = ? WHERE u.active = 1 ORDER BY (a.check_in IS NULL), u.name`, day) : null;
    send(req, res, 'Attendance', `${head('Attendance', 'Times are shown in Bangladesh time (GMT+6).' + (deviceMode() ? ' Recorded by the fingerprint machine.' : ''), isAdmin(u) && FINGERPRINT ? '<a class="ws-btn ws-btn-ghost" href="/team/attendance/devices">Fingerprint machines</a>' : '')}
<div class="ws-cols">
  <section class="ws-card ws-att"><h2>Today · ${esc(fmtDay(d))}</h2>${attendanceBlock(req, one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', u.id, d))}</section>
  <section class="ws-card"><h2>My last 31 days</h2>
    ${mine.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th></tr></thead><tbody>
    ${mine.map((a) => `<tr><td>${esc(fmtDay(a.day))}</td><td>${fmtTime(a.check_in)}</td><td>${fmtTime(a.check_out) || '<span class="muted">—</span>'}</td><td>${hours(a)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No attendance recorded yet.</p>'}</section>
</div>
${board ? `<section class="ws-card"><div class="ws-card-head"><h2>Team on ${esc(fmtDay(day))}</h2>
  <form method="get" class="ws-inline"><label class="sr-only" for="day">Date</label><input type="date" name="day" id="day" value="${day}" max="${d}"><button class="ws-btn ws-btn-ghost" type="submit">Show</button></form></div>
  <div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Employee</th><th>ID</th><th>In</th><th>Out</th><th>Hours</th><th>From</th>${isAdmin(u) ? '<th><span class="sr-only">Fix</span></th>' : ''}</tr></thead><tbody>
  ${board.map((a) => `<tr><td><strong>${esc(a.name)}</strong><br><span class="muted">${esc(a.position)}</span></td><td>${esc(a.emp_id)}</td><td>${a.check_in ? fmtTime(a.check_in) : '<span class="chip st-revision">Not checked in</span>'}</td><td>${fmtTime(a.check_out)}</td><td>${hours(a)}</td>
  <td class="muted">${a.check_in ? esc({ DEVICE: 'Machine', ADMIN: 'Admin fix', MANUAL: 'Button' }[a.source] || '') : ''}</td>${isAdmin(u) ? `<td><a href="/team/attendance/fix?user=${a.id}&day=${day}">Fix</a></td>` : ''}</tr>`).join('')}
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
  const involved = (x) => new Set([x.assignee_id, x.created_by, leadOf(x),
    ...all('SELECT DISTINCT user_id FROM comments WHERE task_id = ? AND user_id IS NOT NULL', x.id).map((r) => r.user_id)].filter(Boolean));
  /** New comments and files on each task since this person last opened it. */
  // Counted by id rather than time, so a comment in the same second as the
  // last visit still counts.
  const unreadMap = (u) => new Map(all(`SELECT task_id, COUNT(*) AS n FROM (
      SELECT c.task_id FROM comments c WHERE c.user_id != ? AND c.id > COALESCE((SELECT last_comment FROM task_reads r WHERE r.user_id = ? AND r.task_id = c.task_id), 0)
      UNION ALL SELECT f.task_id FROM files f WHERE f.user_id != ? AND f.id > COALESCE((SELECT last_file FROM task_reads r WHERE r.user_id = ? AND r.task_id = f.task_id), 0)) x
    GROUP BY task_id`, u.id, u.id, u.id, u.id).map((r) => [r.task_id, r.n]));
  const newBadge = (n) => (n ? `<span class="ws-new" title="${n} new since you last opened it">💬 ${n} new</span>` : '');
  const TASK_SELECT = `SELECT t.*, p.name AS project, a.name AS assignee, c.name AS creator, ch.name AS channel, ch.url AS channel_url,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subs, (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'DONE') AS subs_done,
    (SELECT COUNT(*) FROM comments m WHERE m.task_id = t.id) AS comments
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN channels ch ON ch.id = t.channel_id`;
  const getTask = (id) => (int(id) ? one(TASK_SELECT + ' WHERE t.id = ?', int(id)) : null);
  const loadTask = (req, res, next) => {
    const x = getTask(req.params.id);
    if (!x || !canViewTask(req.user, x)) return fail(req, res, 404, 'This task does not exist or you do not have access to it.');
    req.task = x; next();
  };

  app.get('/team/tasks', auth, need((u) => hasModule(u, 'tasks')), (req, res) => {
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
    const unread = unreadMap(u);
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
${rows.map((x) => `<tr class="${unread.get(x.id) ? 'has-new' : ''}"><td><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong></a> ${newBadge(unread.get(x.id))}<br><span class="muted">${esc(x.project || 'No project')}</span> ${progress(x)}</td>
<td>${esc(x.assignee || '—')}</td><td>${statusChip(x.status)}</td><td>${prioChip(x.priority)}</td><td>${due(x.due_date, x.status === 'DONE')}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="ws-card ws-empty"><h2>No tasks here</h2><p class="muted">${f.q || f.status || f.project ? 'Try clearing the filters.' : 'Create the first task to get started.'}</p></div>`;

    const board = `<div class="kb" aria-label="Task board">${STATUS.map(([k, l]) => {
      const col = rows.filter((x) => x.status === k);
      return `<section class="kb-col" data-status="${k}"><h2>${statusChip(k)}<span class="kb-count">${col.length}</span></h2><div class="kb-list">
${col.map((x) => `<article class="kb-card pr-edge-${x.priority.toLowerCase()}${unread.get(x.id) ? ' has-new' : ''}" data-id="${x.id}"${canEditTask(u, x) || x.assignee_id === u.id ? ' draggable="true"' : ''}>
  <a href="/team/tasks/${x.id}">${esc(x.title)}</a>${newBadge(unread.get(x.id))}
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
    const seenBefore = (one('SELECT last_comment FROM task_reads WHERE user_id = ? AND task_id = ?', u.id, x.id) || {}).last_comment || 0;
    if (req.query.edit !== '1') {
      const lc = one('SELECT COALESCE(MAX(id), 0) AS n FROM comments WHERE task_id = ?', x.id).n;
      const lf = one('SELECT COALESCE(MAX(id), 0) AS n FROM files WHERE task_id = ?', x.id).n;
      run(`INSERT INTO task_reads (user_id, task_id, seen_at, last_comment, last_file) VALUES (?,?,datetime('now'),?,?)
        ON CONFLICT(user_id, task_id) DO UPDATE SET seen_at = excluded.seen_at, last_comment = excluded.last_comment, last_file = excluded.last_file`, u.id, x.id, lc, lf);
    }
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
    ${x.kind === 'UPLOAD' ? uploadPanel(req, x) : ''}
    <section class="ws-card"><h2>${x.kind === 'UPLOAD' ? 'Instructions' : 'Description'}</h2>${x.description ? `<p class="ws-prose">${nl(x.description)}</p>` : '<p class="muted">No description.</p>'}</section>

    ${x.status === 'REVIEW' && approver ? `<section class="ws-card ws-review"><h2>${x.kind === 'UPLOAD' ? 'Check this upload' : 'Review this task'}</h2><p class="muted">${x.kind === 'UPLOAD' ? `${esc(x.assignee || 'The assignee')} uploaded it. ${x.video_url ? `<a href="${esc(x.video_url)}" target="_blank" rel="noopener">Open the video ↗</a>` : ''}` : `${esc(x.assignee || 'The assignee')} marked this ready for review.`}</p>
      <div class="ws-review-grid">
      ${act('approve', '<label>Note (optional)<textarea name="note" id="approve-note" rows="2" maxlength="2000"></textarea></label><button class="ws-btn ws-btn-ok" type="submit">Approve and mark done</button>', '', ' class="ws-form"')}
      ${act('revision', '<label>What needs to change?<textarea name="note" id="revision-note" rows="2" required maxlength="2000"></textarea></label><button class="ws-btn ws-btn-warn" type="submit">Request revision</button>', '', ' class="ws-form"')}
      </div></section>` : ''}

    ${x.parent_id ? '' : `<section class="ws-card"><div class="ws-card-head"><h2>Subtasks</h2>${subs.length ? `<span class="muted">${subs.filter((s) => s.status === 'DONE').length} of ${subs.length} done</span>` : ''}</div>
      ${subs.length ? `<ul class="ws-checks">${subs.map((s) => `<li>${act(`toggle/${s.id}`, `<button type="submit" class="ws-check${s.status === 'DONE' ? ' is-done' : ''}" aria-label="${s.status === 'DONE' ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}"></button>`)}
        <a href="/team/tasks/${s.id}" class="${s.status === 'DONE' ? 'is-done' : ''}">${esc(s.title)}</a><span class="muted">${esc(s.assignee || '')}</span></li>`).join('')}</ul>` : ''}
      ${editor || x.assignee_id === u.id ? act('subtasks', `<label class="sr-only" for="sub-title">New subtask</label><input name="title" id="sub-title" required maxlength="200" placeholder="Add a subtask">
        ${rank(u) >= RANK.TEAM_LEAD ? `<label class="sr-only" for="sub-assignee">Assignee</label><select name="assignee_id" id="sub-assignee">${userOptions(u, x.assignee_id, 'Unassigned')}</select>` : ''}<button class="ws-btn ws-btn-ghost" type="submit">Add</button>`, '', ' class="ws-inline ws-add"') : ''}</section>`}

    <section class="ws-card" id="activity"><h2>Activity</h2>
      ${comments.length ? `<ol class="ws-thread">${comments.map((c) => `<li class="k-${c.kind.toLowerCase()}${c.user_id !== u.id && c.id > seenBefore ? ' is-new' : ''}"><span class="ws-av sm">${esc(initials(c.name))}</span><div>
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
      ${moves.length && x.kind !== 'UPLOAD' ? act('status', `<label>Move to<select name="status" id="status">${options(moves, '')}</select></label><button class="ws-btn ws-btn-ghost" type="submit">Update status</button>`, '', ' class="ws-form ws-move"') : ''}
      ${canStepBack(u, x) ? act('back', '<button class="ws-btn ws-btn-ghost" type="submit">↩ Step back</button><small class="muted">Pressed by mistake? This moves it back one step.</small>', '', ' class="ws-form ws-move"') : ''}
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
    const changed = [f.title !== x.title && 'title', f.description !== x.description && 'details', f.due_date !== x.due_date && 'due date', f.priority !== x.priority && 'priority'].filter(Boolean);
    if (changed.length) {
      run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', x.id, req.user.id, `Updated the ${changed.join(', ')}.`);
      // The newly assigned person already got "assigned you"; everyone else hears what changed.
      involved(x).forEach((id) => { if (!(f.assignee_id !== x.assignee_id && id === f.assignee_id)) notify(req, id, `${req.user.name} updated “${f.title}” (${changed.join(', ')})`, `/team/tasks/${x.id}#activity`); });
    }
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
    if (x.kind === 'UPLOAD' && s === 'REVIEW' && !x.video_url) return fail(req, res, 400, 'Open the upload task and add the video link first.');
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
    back(res, ret(req, `/team/tasks/${x.id}`), 'approved');
  });

  app.post('/team/tasks/:id/revision', auth, loadTask, (req, res) => {
    const x = req.task; const note = t(req.body.note, 2000);
    if (!canApprove(req.user, x)) return fail(req, res, 403, 'You cannot review this task.');
    if (!note) return fail(req, res, 400, 'Explain what needs to change.');
    tx(() => {
      run('INSERT INTO comments (task_id, user_id, body, kind) VALUES (?,?,?,?)', x.id, req.user.id, note, 'REVISION');
      setStatus(req, x, 'REVISION');
    });
    back(res, ret(req, `/team/tasks/${x.id}`), 'revision');
  });

  app.post('/team/tasks/:id/comments', auth, loadTask, (req, res) => {
    const x = req.task; const body = t(req.body.body, 4000);
    if (!body) return back(res, `/team/tasks/${x.id}`);
    run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', x.id, req.user.id, body);
    run("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?", x.id);
    involved(x).forEach((id) => notify(req, id, `${req.user.name} commented on “${x.title}”: ${body.length > 80 ? body.slice(0, 80) + '…' : body}`, `/team/tasks/${x.id}#activity`));
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

  app.get('/team/projects', auth, need((u) => hasModule(u, 'projects')), (req, res) => {
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
  app.get('/team/employees', auth, need((u) => hasModule(u, 'employees')), (req, res) => {
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
  <fieldset class="ws-fieldset"><legend>What this person can open</legend>
    <input type="hidden" name="modules_set" value="1">
    <div class="ws-checkgrid">${MODULES.map(([k, l]) => `<label class="ws-check-row"><input type="checkbox" name="modules" value="${k}"${(parseModules(r) || defaultModules(r)).includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
    <small>Dashboard and notifications are always there. Managers and admins open everything. Anyone given a daily upload schedule gets Video uploads automatically.</small></fieldset>
  ${FINGERPRINT ? `<label>Fingerprint machine ID<input name="device_pin" id="device_pin" inputmode="numeric" maxlength="20" value="${esc(r.device_pin || '')}" placeholder="e.g. 7">
    <small>The user number this person has on the fingerprint machine. Their punches are matched to them by it.</small></label>` : ''}
  ${r.id ? `<label class="ws-check-row"><input type="checkbox" name="active" id="active" value="1"${r.active ? ' checked' : ''}> Active (can sign in)</label>`
    : '<label>Temporary password<input type="text" name="password" id="password" required minlength="10" autocomplete="off"><small>Share it with the employee privately. They must change it when they first sign in.</small></label>'}
  ${req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : ''}
  <div class="ws-actions"><button class="ws-btn" type="submit">${submit}</button><a class="ws-btn ws-btn-ghost" href="/team/employees">Cancel</a></div></form>`;
  const readEmp = (req) => {
    const b = req.body;
    const f = { name: t(b.name, 120), email: t(b.email, 160).toLowerCase(), phone: t(b.phone, 40), position: t(b.position, 120), department: t(b.department, 120),
      joined_on: isDate(b.joined_on) ? b.joined_on : '', role: pick(assignableRoles(req.user), b.role, 'EMPLOYEE'),
      // Only a form that showed the checkboxes sets access; otherwise the role's defaults stay.
      modules: b.modules_set === '1' ? JSON.stringify([].concat(b.modules || []).filter((k) => MODULES.some((m) => m[0] === k))) : null,
      device_pin: FINGERPRINT ? t(b.device_pin, 20).replace(/\D/g, '') : null };
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
    send(req, res, 'Add employee', `${head('Add employee', `The employee ID will be ${esc(nextEmpId())}.`)}<div class="ws-card ws-narrow">${empForm(req,
      { name: t(req.query.name, 120), email: t(req.query.email, 160), phone: t(req.query.phone, 40), position: t(req.query.position, 120) }, '/team/employees', 'Add employee')}</div>`, { active: '/team/employees' }));

  app.post('/team/employees', auth, need(isAdmin), (req, res) => {
    const [f, e] = readEmp(req); const pw = String(req.body.password || '');
    const err = (m) => back(res, '/team/employees/new?e=' + encodeURIComponent(m));
    if (e) return err(e);
    if (pwProblem(pw)) return err(pwProblem(pw));
    if (one('SELECT 1 FROM users WHERE email = ?', f.email)) return err('An employee with this email already exists.');
    if (f.device_pin && one('SELECT 1 FROM users WHERE device_pin = ?', f.device_pin)) return err('Another employee already has this fingerprint machine ID.');
    if (f.device_pin === null) f.device_pin = '';
    const empId = nextEmpId();
    const r = run('INSERT INTO users (emp_id, name, email, phone, position, department, role, password_hash, must_change_pw, joined_on, modules, device_pin) VALUES (?,?,?,?,?,?,?,?,1,?,?,?)',
      empId, f.name, f.email, f.phone, f.position, f.department, f.role, hashPw(pw), f.joined_on, f.modules, f.device_pin);
    if (f.device_pin) applyPunches();
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
    if (f.device_pin && one('SELECT 1 FROM users WHERE device_pin = ? AND id != ?', f.device_pin, r.id)) return err('Another employee already has this fingerprint machine ID.');
    if (f.device_pin === null) f.device_pin = r.device_pin;
    run('UPDATE users SET name = ?, email = ?, phone = ?, position = ?, department = ?, role = ?, joined_on = ?, active = ?, modules = ?, device_pin = ? WHERE id = ?',
      f.name, f.email, f.phone, f.position, f.department, f.role, f.joined_on, active, f.modules, f.device_pin, r.id);
    if (f.device_pin !== r.device_pin) applyPunches();
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

  // ================================================================ VIDEO UPLOADS
  //
  // Channels and pages are kept here with their links. A daily schedule per
  // channel makes that day's upload tasks on its own, for one person. An
  // upload moves in three steps - To upload, Uploaded (with the video's
  // link), Checked - and any step can be undone with Step back.

  const PLATFORMS = [['FACEBOOK', 'Facebook page'], ['YOUTUBE', 'YouTube channel'], ['TIKTOK', 'TikTok'], ['INSTAGRAM', 'Instagram'], ['OTHER', 'Other']];
  const DAYS = [['6', 'Sat'], ['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri']];
  const cleanUrl = (v) => { const s = t(v, 500); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };
  const weekday = (d) => String(new Date(d + 'T00:00:00Z').getUTCDay());
  const ret = (req, d) => { const b = String((req.body && req.body._back) || ''); return b.startsWith('/team/') ? safeNext(b) : d; };
  const UPLOAD_STEP = { TODO: 'To upload', IN_PROGRESS: 'To upload', REVISION: 'Upload again', REVIEW: 'Uploaded · to check', DONE: 'Checked' };
  const uploadChip = (s) => chip('st', s, UPLOAD_STEP[s] || s);
  const PREV = { DONE: 'REVIEW', REVIEW: 'TODO', REVISION: 'REVIEW', IN_PROGRESS: 'TODO' };
  const canStepBack = (u, x) => Boolean(PREV[x.status]) && (['DONE', 'REVISION'].includes(x.status)
    ? canApprove(u, x) : canEditTask(u, x) || x.assignee_id === u.id || canApprove(u, x));

  /** Makes the day's upload tasks. Safe to run any number of times: a unique
   *  index on (schedule, day, slot) keeps exactly one task per slot. */
  function runSchedules(day = today()) {
    const rows = all('SELECT s.*, c.name AS channel FROM schedules s JOIN channels c ON c.id = s.channel_id WHERE s.active = 1 AND c.active = 1');
    let made = 0;
    for (const s of rows) {
      if (!String(s.days).includes(weekday(day))) continue;
      const n = Math.min(Math.max(s.per_day, 1), 20);
      for (let slot = 1; slot <= n; slot++) {
        const title = `${s.title || 'Upload video'} — ${s.channel}${n > 1 ? ` (${slot}/${n})` : ''}`;
        const r = run(`INSERT OR IGNORE INTO tasks (kind, channel_id, schedule_id, slot, title, description, priority, assignee_id, created_by, due_date)
          VALUES ('UPLOAD',?,?,?,?,?,?,?,?,?)`, s.channel_id, s.id, slot, title, s.description, s.priority, s.assignee_id, s.created_by, day);
        if (r.changes) {
          made++;
          if (s.assignee_id) run('INSERT INTO notifications (user_id, text, link) VALUES (?,?,?)', s.assignee_id, `Today’s upload: ${title}`, `/team/tasks/${r.lastInsertRowid}`);
        }
      }
    }
    return made;
  }
  try { runSchedules(); } catch (e) { console.error('[schedules]', e.message); }
  setInterval(() => { try { runSchedules(); } catch (e) { console.error('[schedules]', e.message); } }, 10 * 60 * 1000).unref();

  const stepOf = (s) => (s === 'DONE' ? 3 : s === 'REVIEW' ? 2 : 1);
  const steps = (s) => `<ol class="ws-steps" aria-label="Upload steps">${['To upload', 'Uploaded', 'Checked'].map((l, i) =>
    `<li class="${stepOf(s) > i + 1 || s === 'DONE' ? 'is-done' : stepOf(s) === i + 1 ? 'is-now' : ''}">${l}</li>`).join('')}</ol>`;
  const channelLink = (x) => (x.channel_url ? `<a href="${esc(x.channel_url)}" target="_blank" rel="noopener">${esc(x.channel || 'Open')} ↗</a>` : esc(x.channel || '—'));

  /** The upload box on an upload task's own page. */
  function uploadPanel(req, x) {
    const u = req.user;
    const doer = x.assignee_id === u.id || canEditTask(u, x);
    const open = ['TODO', 'IN_PROGRESS', 'REVISION'].includes(x.status);
    return `<section class="ws-card ws-upload">
      <div class="ws-card-head"><h2>Video upload</h2>${uploadChip(x.status)}</div>
      ${steps(x.status)}
      <p class="ws-kv"><span>Channel / page</span><strong>${channelLink(x)}</strong></p>
      ${x.video_url ? `<p class="ws-kv"><span>Uploaded video</span><strong><a href="${esc(x.video_url)}" target="_blank" rel="noopener">Open video ↗</a></strong></p>` : ''}
      ${x.uploaded_at ? `<p class="ws-kv"><span>Uploaded at</span><strong>${esc(fmtWhen(x.uploaded_at))}</strong></p>` : ''}
      ${open && doer ? `<form method="post" action="/team/tasks/${x.id}/uploaded" class="ws-form ws-move">${csrfField(req)}
        <label>Link to the uploaded video<input type="url" name="video_url" id="video_url" required placeholder="https://" value="${esc(x.video_url)}"></label>
        <button class="ws-btn" type="submit">Mark as uploaded</button></form>` : ''}
    </section>`;
  }

  /** The dashboard card: today's uploads at a glance. */
  function uploadsToday(u) {
    const d = today();
    try { runSchedules(d); } catch (e) { /* the page still loads */ }
    const mine = seesAll(u) ? '' : 'AND t.assignee_id = ?';
    const rows = all(`SELECT t.status FROM tasks t WHERE t.kind = 'UPLOAD' AND t.due_date = ? ${mine}`, d, ...(seesAll(u) ? [] : [u.id]));
    if (!rows.length) return '';
    const up = rows.filter((r) => ['REVIEW', 'DONE'].includes(r.status)).length;
    const ok = rows.filter((r) => r.status === 'DONE').length;
    return `<section class="ws-card ws-up-strip"><div><h2>Today’s video uploads</h2>
      <p class="muted">${up} of ${rows.length} uploaded · ${ok} checked</p></div>
      <div class="ws-bar" role="img" aria-label="${up} of ${rows.length} uploaded"><i style="width:${Math.round((up / rows.length) * 100)}%"></i></div>
      <a class="ws-btn" href="/team/uploads">${seesAll(u) ? 'Check uploads' : 'Open my uploads'}</a></section>`;
  }

  app.get('/team/uploads', auth, need((u) => hasModule(u, 'uploads')), (req, res) => {
    const u = req.user; const d = today();
    const day = isDate(req.query.day) ? req.query.day : d;
    if (day === d) runSchedules(d);
    const everyone = seesAll(u);
    const rows = all(`SELECT t.*, a.name AS assignee, ch.name AS channel, ch.url AS channel_url, ch.platform FROM tasks t
      LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN channels ch ON ch.id = t.channel_id
      WHERE t.kind = 'UPLOAD' AND t.due_date = ? ${everyone ? '' : 'AND (t.assignee_id = ? OR t.created_by = ?)'}
      ORDER BY ch.name, t.slot, t.id`, day, ...(everyone ? [] : [u.id, u.id]));
    const late = all(`SELECT t.id, t.title, t.due_date, a.name AS assignee FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.kind = 'UPLOAD' AND t.status NOT IN ('DONE') AND t.due_date < ? ${everyone ? '' : 'AND t.assignee_id = ?'} ORDER BY t.due_date DESC LIMIT 30`, day, ...(everyone ? [] : [u.id]));
    const here = `/team/uploads${day !== d ? '?day=' + day : ''}`;
    const backField = `<input type="hidden" name="_back" value="${esc(here)}">`;
    const form = (x, path, body, attrs = '') => `<form method="post" action="/team/tasks/${x.id}/${path}"${attrs}>${csrfField(req)}${backField}${body}</form>`;
    const up = rows.filter((r) => ['REVIEW', 'DONE'].includes(r.status)).length;
    const ok = rows.filter((r) => r.status === 'DONE').length;

    const actions = (x) => {
      const out = [];
      const doer = x.assignee_id === u.id || canEditTask(u, x);
      if (['TODO', 'IN_PROGRESS', 'REVISION'].includes(x.status) && doer) {
        out.push(form(x, 'uploaded', `<label class="sr-only" for="v${x.id}">Video link</label><input type="url" name="video_url" id="v${x.id}" required placeholder="Paste the video link" value="${esc(x.video_url)}"><button class="ws-btn" type="submit">Uploaded</button>`, ' class="ws-inline"'));
      }
      if (x.status === 'REVIEW' && canApprove(u, x)) {
        out.push(form(x, 'approve', '<button class="ws-btn ws-btn-ok" type="submit">✓ Checked</button>'));
        out.push(form(x, 'revision', `<label class="sr-only" for="n${x.id}">What is wrong</label><input name="note" id="n${x.id}" required maxlength="500" placeholder="What is wrong?"><button class="ws-btn ws-btn-warn" type="submit">Not OK</button>`, ' class="ws-inline"'));
      }
      if (canStepBack(u, x)) out.push(form(x, 'back', '<button class="ws-link-btn ws-back" type="submit" title="Move back one step">↩ Step back</button>'));
      return out.join('');
    };

    send(req, res, 'Video uploads', `${head('Video uploads', `${esc(fmtDay(day))} · ${up} of ${rows.length} uploaded · ${ok} checked`,
      `<form method="get" class="ws-inline"><label class="sr-only" for="day">Date</label><input type="date" name="day" id="day" value="${day}" max="${d}"><button class="ws-btn ws-btn-ghost" type="submit">Show</button></form>
       ${everyone ? '<a class="ws-btn" href="/team/uploads/setup">Channels &amp; schedule</a>' : ''}`)}
${rows.length ? `<div class="ws-up-list">${rows.map((x) => `
  <article class="ws-card ws-up ws-up-${x.status.toLowerCase()}">
    <div class="ws-up-main">
      <p class="ws-up-ch">${channelLink(x)}<span class="muted"> · ${esc(label(PLATFORMS, x.platform) || '')}</span></p>
      <h2><a href="/team/tasks/${x.id}">${esc(x.title)}</a></h2>
      <p class="ws-meta" style="justify-content:flex-start">${uploadChip(x.status)}<span>${esc(x.assignee || 'Unassigned')}</span>
        ${x.video_url ? `<a href="${esc(x.video_url)}" target="_blank" rel="noopener">Open video ↗</a>` : ''}${x.uploaded_at ? `<span>${esc(fmtTime(x.uploaded_at))}</span>` : ''}</p>
      ${steps(x.status)}
    </div>
    <div class="ws-up-act">${actions(x)}</div>
  </article>`).join('')}</div>`
  : `<div class="ws-card ws-empty"><h2>No uploads for this day</h2><p class="muted">${everyone ? 'Add a channel and a daily schedule under <a href="/team/uploads/setup">Channels &amp; schedule</a>, and the tasks appear here every day on their own.' : 'When the admin gives you daily upload work, it appears here every day.'}</p></div>`}
${late.length ? `<section class="ws-card"><h2>Still not checked from earlier days</h2><ul class="ws-list">${late.map((x) => `<li><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong><span class="muted">${esc(x.assignee || '')}</span></a><span class="ws-meta">${due(x.due_date)}</span></li>`).join('')}</ul></section>` : ''}`, { active: '/team/uploads' });
  });

  app.post('/team/tasks/:id/uploaded', auth, loadTask, (req, res) => {
    const x = req.task; const u = req.user;
    if (x.kind !== 'UPLOAD') return fail(req, res, 400, 'This is not an upload task.');
    if (!(x.assignee_id === u.id || canEditTask(u, x))) return fail(req, res, 403, 'Only the person doing this upload can mark it.');
    const url = cleanUrl(req.body.video_url);
    if (!url) return fail(req, res, 400, 'Paste the full link to the uploaded video (starting with https://).');
    run("UPDATE tasks SET video_url = ?, uploaded_at = datetime('now'), status = 'REVIEW', approved_by = NULL, approved_at = NULL, updated_at = datetime('now') WHERE id = ?", url, x.id);
    audit(req, 'video_uploaded', 'task', x.id, url);
    new Set([x.created_by, leadOf(x)]).forEach((id) => notify(req, id, `${u.name} uploaded “${x.title}”. Check it.`, `/team/tasks/${x.id}`));
    back(res, ret(req, `/team/tasks/${x.id}`), 'uploaded');
  });

  app.post('/team/tasks/:id/back', auth, loadTask, (req, res) => {
    const x = req.task;
    if (!canStepBack(req.user, x)) return fail(req, res, 403, 'You cannot move this task back.');
    let to = PREV[x.status];
    if (x.kind !== 'UPLOAD' && x.status === 'REVIEW') to = 'IN_PROGRESS';
    run("UPDATE tasks SET status = ?, approved_by = NULL, approved_at = NULL, updated_at = datetime('now') WHERE id = ?", to, x.id);
    audit(req, 'task_step_back', 'task', x.id, `${x.status} → ${to}`);
    if (x.assignee_id) notify(req, x.assignee_id, `${req.user.name} moved “${x.title}” back to ${x.kind === 'UPLOAD' ? UPLOAD_STEP[to] : label(STATUS, to)}`, `/team/tasks/${x.id}`);
    back(res, ret(req, `/team/tasks/${x.id}`), 'stepback');
  });

  // ---- channels and schedules (managers and above)
  app.get('/team/uploads/setup', auth, need(seesAll, 'Only managers and above can set up channels.'), (req, res) => {
    const channels = all('SELECT c.*, (SELECT COUNT(*) FROM schedules s WHERE s.channel_id = c.id AND s.active = 1) AS sched FROM channels c ORDER BY c.active DESC, c.name');
    const sched = all(`SELECT s.*, c.name AS channel, a.name AS assignee FROM schedules s JOIN channels c ON c.id = s.channel_id
      LEFT JOIN users a ON a.id = s.assignee_id ORDER BY s.active DESC, c.name`);
    const dayChecks = (val, prefix) => `<div class="ws-days">${DAYS.map(([k, l]) => `<label class="ws-check-row"><input type="checkbox" name="days" value="${k}"${String(val).includes(k) ? ' checked' : ''} id="${prefix}-d${k}"> ${l}</label>`).join('')}</div>`;
    const dayText = (v) => (String(v).length === 7 ? 'Every day' : DAYS.filter(([k]) => String(v).includes(k)).map((x) => x[1]).join(', ') || 'No days');
    const e = req.query.e ? `<p class="ws-err" role="alert">${esc(t(req.query.e, 200))}</p>` : '';

    send(req, res, 'Channels & schedule', `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/uploads">Video uploads</a></nav>
${head('Channels & schedule', 'Keep every page and channel here with its link, then say who uploads to it and on which days. The tasks are created every morning on their own.')}
${e}
<section class="ws-card"><div class="ws-card-head"><h2>Channels and pages</h2></div>
  ${channels.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Name</th><th>Where</th><th>Link</th><th>Schedules</th><th>Status</th><th></th></tr></thead><tbody>
  ${channels.map((c) => `<tr class="${c.active ? '' : 'is-off'}"><td><strong>${esc(c.name)}</strong>${c.notes ? `<br><span class="muted">${esc(c.notes)}</span>` : ''}</td><td>${esc(label(PLATFORMS, c.platform))}</td>
    <td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td><td>${c.sched}</td><td>${c.active ? '<span class="chip st-done">Active</span>' : '<span class="chip st-todo">Paused</span>'}</td>
    <td><a href="/team/uploads/channels/${c.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No channels yet. Add the first one below.</p>'}
  <form method="post" action="/team/uploads/channels" class="ws-form ws-move">${csrfField(req)}
    <h3 class="ws-h3">Add a channel or page</h3>
    <div class="ws-row"><label>Name<input name="name" id="ch-name" required maxlength="120" placeholder="e.g. MONOHA Facebook page"></label>
      <label>Where<select name="platform" id="ch-platform">${options(PLATFORMS, 'FACEBOOK')}</select></label></div>
    <label>Link<input type="url" name="url" id="ch-url" required placeholder="https://www.facebook.com/…"></label>
    <label>Notes (optional)<input name="notes" id="ch-notes" maxlength="300" placeholder="e.g. upload by 8 pm, use the brand intro"></label>
    <div class="ws-actions"><button class="ws-btn" type="submit">Add channel</button></div></form>
</section>

<section class="ws-card"><div class="ws-card-head"><h2>Daily upload schedule</h2></div>
  ${sched.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Channel</th><th>Who uploads</th><th>Days</th><th>Per day</th><th>Status</th><th></th></tr></thead><tbody>
  ${sched.map((s) => `<tr class="${s.active ? '' : 'is-off'}"><td><strong>${esc(s.channel)}</strong><br><span class="muted">${esc(s.title || 'Upload video')}</span></td><td>${esc(s.assignee || 'Nobody')}</td>
    <td>${esc(dayText(s.days))}</td><td class="num">${s.per_day}</td><td>${s.active ? '<span class="chip st-done">On</span>' : '<span class="chip st-todo">Off</span>'}</td>
    <td><a href="/team/uploads/schedules/${s.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No schedule yet.</p>'}
  ${channels.some((c) => c.active) ? `<form method="post" action="/team/uploads/schedules" class="ws-form ws-move">${csrfField(req)}
    <h3 class="ws-h3">Add a daily upload</h3>
    <div class="ws-row"><label>Channel<select name="channel_id" id="sc-channel">${options(channels.filter((c) => c.active).map((c) => [c.id, c.name]), '')}</select></label>
      <label>Who uploads<select name="assignee_id" id="sc-assignee">${userOptions(req.user, '', '')}</select></label></div>
    <div class="ws-row"><label>Task name<input name="title" id="sc-title" maxlength="120" value="Upload video"></label>
      <label>Videos per day<input type="number" name="per_day" id="sc-per" min="1" max="20" value="1"></label>
      <label>Priority<select name="priority" id="sc-prio">${options(PRIORITY, 'MEDIUM')}</select></label></div>
    <fieldset class="ws-fieldset"><legend>On which days</legend>${dayChecks('0123456', 'new')}</fieldset>
    <label>Instructions (optional)<textarea name="description" id="sc-desc" rows="3" maxlength="2000" placeholder="What to upload, caption style, deadline…"></textarea></label>
    <div class="ws-actions"><button class="ws-btn" type="submit">Add schedule</button></div></form>` : ''}
</section>`, { active: '/team/uploads' });
  });

  const readChannel = (b) => ({ name: t(b.name, 120), platform: pick(PLATFORMS, b.platform, 'OTHER'), url: cleanUrl(b.url), notes: t(b.notes, 300) });
  app.post('/team/uploads/channels', auth, need(seesAll), (req, res) => {
    const c = readChannel(req.body);
    if (!c.name || !c.url) return back(res, '/team/uploads/setup?e=' + encodeURIComponent('Give the channel a name and its full link (https://…).'));
    const r = run('INSERT INTO channels (name, platform, url, notes) VALUES (?,?,?,?)', c.name, c.platform, c.url, c.notes);
    audit(req, 'channel_created', 'channel', Number(r.lastInsertRowid), c.name);
    back(res, '/team/uploads/setup', 'created');
  });
  app.get('/team/uploads/channels/:id', auth, need(seesAll), (req, res) => {
    const c = int(req.params.id) && one('SELECT * FROM channels WHERE id = ?', int(req.params.id));
    if (!c) return fail(req, res, 404, 'Channel not found.');
    send(req, res, c.name, `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/uploads/setup">Channels &amp; schedule</a></nav>${head(c.name)}
<div class="ws-card ws-narrow"><form method="post" action="/team/uploads/channels/${c.id}" class="ws-form">${csrfField(req)}
  <div class="ws-row"><label>Name<input name="name" id="name" required maxlength="120" value="${esc(c.name)}"></label>
    <label>Where<select name="platform" id="platform">${options(PLATFORMS, c.platform)}</select></label></div>
  <label>Link<input type="url" name="url" id="url" required value="${esc(c.url)}"></label>
  <label>Notes<input name="notes" id="notes" maxlength="300" value="${esc(c.notes)}"></label>
  <label class="ws-check-row"><input type="checkbox" name="active" id="active" value="1"${c.active ? ' checked' : ''}> Active (paused channels make no new tasks)</label>
  <div class="ws-actions"><button class="ws-btn" type="submit">Save</button><a class="ws-btn ws-btn-ghost" href="/team/uploads/setup">Cancel</a></div></form></div>`, { active: '/team/uploads' });
  });
  app.post('/team/uploads/channels/:id', auth, need(seesAll), (req, res) => {
    const id = int(req.params.id); const c = readChannel(req.body);
    if (!id || !c.name || !c.url) return back(res, '/team/uploads/setup?e=' + encodeURIComponent('Give the channel a name and its full link.'));
    run('UPDATE channels SET name = ?, platform = ?, url = ?, notes = ?, active = ? WHERE id = ?', c.name, c.platform, c.url, c.notes, req.body.active === '1' ? 1 : 0, id);
    audit(req, 'channel_updated', 'channel', id, c.name);
    back(res, '/team/uploads/setup', 'saved');
  });

  const readSchedule = (req) => {
    const b = req.body;
    const channel = int(b.channel_id) && one('SELECT id FROM channels WHERE id = ?', int(b.channel_id));
    let assignee = int(b.assignee_id);
    if (assignee && !one('SELECT 1 FROM users WHERE id = ? AND active = 1', assignee)) assignee = null;
    const days = [...new Set([].concat(b.days || []).filter((d) => /^[0-6]$/.test(d)))].sort().join('');
    return { channel_id: channel ? channel.id : null, assignee_id: assignee, title: t(b.title, 120) || 'Upload video', description: t(b.description, 2000),
      days, per_day: Math.min(Math.max(int(b.per_day) || 1, 1), 20), priority: pick(PRIORITY, b.priority, 'MEDIUM') };
  };
  app.post('/team/uploads/schedules', auth, need(seesAll), (req, res) => {
    const s = readSchedule(req);
    if (!s.channel_id || !s.assignee_id || !s.days) return back(res, '/team/uploads/setup?e=' + encodeURIComponent('Choose a channel, who uploads, and at least one day.'));
    const r = run('INSERT INTO schedules (channel_id, assignee_id, title, description, days, per_day, priority, created_by) VALUES (?,?,?,?,?,?,?,?)',
      s.channel_id, s.assignee_id, s.title, s.description, s.days, s.per_day, s.priority, req.user.id);
    audit(req, 'schedule_created', 'schedule', Number(r.lastInsertRowid), `channel ${s.channel_id} → user ${s.assignee_id}`);
    runSchedules();
    back(res, '/team/uploads/setup', 'created');
  });
  app.get('/team/uploads/schedules/:id', auth, need(seesAll), (req, res) => {
    const s = int(req.params.id) && one('SELECT * FROM schedules WHERE id = ?', int(req.params.id));
    if (!s) return fail(req, res, 404, 'Schedule not found.');
    const channels = all('SELECT id, name FROM channels ORDER BY name');
    send(req, res, 'Edit schedule', `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/uploads/setup">Channels &amp; schedule</a></nav>${head('Edit schedule', 'Changes apply from the next day’s tasks. Today’s tasks stay as they are.')}
<div class="ws-card ws-narrow"><form method="post" action="/team/uploads/schedules/${s.id}" class="ws-form">${csrfField(req)}
  <div class="ws-row"><label>Channel<select name="channel_id" id="channel_id">${options(channels.map((c) => [c.id, c.name]), s.channel_id)}</select></label>
    <label>Who uploads<select name="assignee_id" id="assignee_id">${userOptions(req.user, s.assignee_id, '')}</select></label></div>
  <div class="ws-row"><label>Task name<input name="title" id="title" maxlength="120" value="${esc(s.title)}"></label>
    <label>Videos per day<input type="number" name="per_day" id="per_day" min="1" max="20" value="${s.per_day}"></label>
    <label>Priority<select name="priority" id="priority">${options(PRIORITY, s.priority)}</select></label></div>
  <fieldset class="ws-fieldset"><legend>On which days</legend><div class="ws-days">${DAYS.map(([k, l]) => `<label class="ws-check-row"><input type="checkbox" name="days" value="${k}"${String(s.days).includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div></fieldset>
  <label>Instructions<textarea name="description" id="description" rows="3" maxlength="2000">${esc(s.description)}</textarea></label>
  <label class="ws-check-row"><input type="checkbox" name="active" id="active" value="1"${s.active ? ' checked' : ''}> On (makes tasks every scheduled day)</label>
  <div class="ws-actions"><button class="ws-btn" type="submit">Save</button><a class="ws-btn ws-btn-ghost" href="/team/uploads/setup">Cancel</a></div></form>
  <form method="post" action="/team/uploads/schedules/${s.id}/delete" class="ws-move" data-confirm="Delete this schedule? Tasks already made stay.">${csrfField(req)}<button class="ws-btn ws-btn-danger" type="submit">Delete schedule</button></form></div>`, { active: '/team/uploads' });
  });
  app.post('/team/uploads/schedules/:id', auth, need(seesAll), (req, res) => {
    const id = int(req.params.id); const s = readSchedule(req);
    if (!id || !s.channel_id || !s.assignee_id || !s.days) return back(res, `/team/uploads/setup?e=${encodeURIComponent('Choose a channel, who uploads, and at least one day.')}`);
    run('UPDATE schedules SET channel_id = ?, assignee_id = ?, title = ?, description = ?, days = ?, per_day = ?, priority = ?, active = ? WHERE id = ?',
      s.channel_id, s.assignee_id, s.title, s.description, s.days, s.per_day, s.priority, req.body.active === '1' ? 1 : 0, id);
    audit(req, 'schedule_updated', 'schedule', id, `channel ${s.channel_id} → user ${s.assignee_id}`);
    runSchedules();
    back(res, '/team/uploads/setup', 'saved');
  });
  app.post('/team/uploads/schedules/:id/delete', auth, need(seesAll), (req, res) => {
    const id = int(req.params.id);
    run('DELETE FROM schedules WHERE id = ?', id);
    audit(req, 'schedule_deleted', 'schedule', id);
    back(res, '/team/uploads/setup', 'deleted');
  });

  // ================================================================ FINGERPRINT ATTENDANCE
  //
  // The machine (ZKTeco and other "ADMS / Push" devices) sends every punch to
  // this server over HTTP on its own: /iclock/cdata. A machine is listed the
  // moment it first calls in, and its punches count only once an admin has
  // approved its serial number. Punches are matched to employees by the user
  // number on the machine (Fingerprint machine ID on their profile). The
  // first punch of the day is In, the last is Out. Nobody types a time in.

  /** Links punches from approved machines to employees and rebuilds those
   *  days' attendance. A day an admin corrected by hand is left alone. */
  function applyPunches(sinceDay = '') {
    tx(() => {
      run(`UPDATE punches SET user_id = (SELECT id FROM users WHERE users.device_pin = punches.pin AND users.device_pin != '' LIMIT 1)
        WHERE day >= ? AND device_serial IN (SELECT serial FROM devices WHERE approved = 1)`, sinceDay);
      const groups = all(`SELECT user_id, day, MIN(at) AS first, MAX(at) AS last, COUNT(*) AS n FROM punches
        WHERE user_id IS NOT NULL AND day >= ? AND device_serial IN (SELECT serial FROM devices WHERE approved = 1) GROUP BY user_id, day`, sinceDay);
      for (const g of groups) {
        const a = one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', g.user_id, g.day);
        if (a && a.source === 'ADMIN') continue;
        const out = g.n > 1 ? g.last : null;
        if (a) run("UPDATE attendance SET check_in = ?, check_out = ?, source = 'DEVICE' WHERE id = ?", g.first, out, a.id);
        else run("INSERT INTO attendance (user_id, day, check_in, check_out, source) VALUES (?,?,?,?,'DEVICE')", g.user_id, g.day, g.first, out);
      }
    });
  }

  const seen = (sn) => {
    run("INSERT INTO devices (serial, last_seen) VALUES (?, datetime('now')) ON CONFLICT(serial) DO UPDATE SET last_seen = datetime('now')", sn);
    return one('SELECT * FROM devices WHERE serial = ?', sn);
  };
  const serialOf = (req) => t(req.query.SN, 40).replace(/[^\w.-]/g, '');
  app.use('/iclock', (req, res, next) => (FINGERPRINT ? next() : res.status(404).type('text/plain').send('Not found')));
  app.use('/iclock', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, express.text({ type: '*/*', limit: '5mb' }));
  app.get('/iclock/cdata', (req, res) => {
    const sn = serialOf(req);
    if (!sn) return res.status(400).type('text/plain').send('ERROR');
    seen(sn);
    res.type('text/plain').send([`GET OPTION FROM: ${sn}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30',
      'Delay=10', 'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'TimeZone=6', 'Realtime=1', 'Encrypt=None', ''].join('\n'));
  });
  app.post('/iclock/cdata', (req, res) => {
    const sn = serialOf(req);
    if (!sn) return res.status(400).type('text/plain').send('ERROR');
    const device = seen(sn);
    if (String(req.query.table || '').toUpperCase() !== 'ATTLOG') return res.type('text/plain').send('OK');
    let n = 0; let first = '';
    for (const line of String(req.body || '').split(/\r?\n/)) {
      const [pin, when] = line.split('\t');
      const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(when || '').trim());
      const p = String(pin || '').trim().replace(/\D/g, '');
      if (!p || !m) continue;
      // The machine keeps Bangladesh time.
      run('INSERT OR IGNORE INTO punches (device_serial, pin, day, at) VALUES (?,?,?,?)', sn, p, m[1], new Date(`${m[1]}T${m[2]}+06:00`).toISOString());
      if (!first || m[1] < first) first = m[1];
      n++;
    }
    if (n && device.approved) applyPunches(first);
    res.type('text/plain').send('OK: ' + n);
  });
  app.get('/iclock/getrequest', (req, res) => { const sn = serialOf(req); if (sn) seen(sn); res.type('text/plain').send('OK'); });
  app.post('/iclock/devicecmd', (req, res) => res.type('text/plain').send('OK'));

  app.get('/team/attendance/devices', auth, need((u) => FINGERPRINT && isAdmin(u)), (req, res) => {
    const devices = all('SELECT d.*, (SELECT COUNT(*) FROM punches p WHERE p.device_serial = d.serial) AS punches FROM devices d ORDER BY d.approved DESC, d.created_at DESC');
    const loose = all(`SELECT pin, COUNT(*) AS n, MAX(at) AS last FROM punches WHERE user_id IS NULL
      AND device_serial IN (SELECT serial FROM devices WHERE approved = 1) GROUP BY pin ORDER BY last DESC LIMIT 50`);
    const linked = all("SELECT name, emp_id, device_pin FROM users WHERE device_pin != '' ORDER BY CAST(device_pin AS INTEGER)");
    const host = req.headers.host || 'monohasourcing.international';
    send(req, res, 'Fingerprint machines', `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/attendance">Attendance</a></nav>
${head('Fingerprint machines', 'Attendance comes straight from the machine. Employees cannot type their own time.')}
<section class="ws-card"><h2>How attendance is recorded</h2>
  <form method="post" action="/team/attendance/mode" class="ws-form">${csrfField(req)}
    <label class="ws-check-row"><input type="radio" name="mode" value="DEVICE"${deviceMode() ? ' checked' : ''}> <strong>Fingerprint machine only</strong> — the Check in button is removed</label>
    <label class="ws-check-row"><input type="radio" name="mode" value="MANUAL"${deviceMode() ? '' : ' checked'}> Check in / out button in the Workspace (until the machine is installed)</label>
    <div class="ws-actions"><button class="ws-btn" type="submit">Save</button></div></form></section>

<section class="ws-card"><h2>Machines</h2>
  ${devices.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Serial number</th><th>Name</th><th>Status</th><th>Last contact</th><th>Punches</th><th></th></tr></thead><tbody>
  ${devices.map((d) => `<tr><td class="num"><strong>${esc(d.serial)}</strong></td><td>${esc(d.name || '—')}</td>
    <td>${d.approved ? '<span class="chip st-done">Approved</span>' : '<span class="chip st-revision">Waiting for approval</span>'}</td>
    <td>${d.last_seen ? esc(fmtWhen(d.last_seen)) : '—'}</td><td class="num">${d.punches}</td>
    <td><form method="post" action="/team/attendance/devices/${d.id}" class="ws-inline">${csrfField(req)}
      <label class="sr-only" for="dn${d.id}">Name</label><input name="name" id="dn${d.id}" value="${esc(d.name)}" placeholder="e.g. Office door" maxlength="60">
      <button class="ws-btn ws-btn-ghost" name="action" value="save" type="submit">Save</button>
      ${d.approved ? '<button class="ws-btn ws-btn-danger" name="action" value="block" type="submit">Block</button>' : '<button class="ws-btn" name="action" value="approve" type="submit">Approve</button>'}</form></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">No machine has contacted the server yet. Follow the setup steps below; the machine appears here by its serial number as soon as it connects.</p>'}
</section>

${loose.length ? `<section class="ws-card"><h2>Machine users not linked to an employee</h2>
  <p class="muted">Open the employee’s profile and enter this number as their Fingerprint machine ID. Their earlier punches are counted as soon as you save.</p>
  <div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Machine user number</th><th>Punches</th><th>Last punch</th></tr></thead><tbody>
  ${loose.map((l) => `<tr><td class="num"><strong>${esc(l.pin)}</strong></td><td class="num">${l.n}</td><td>${esc(fmtWhen(l.last))}</td></tr>`).join('')}</tbody></table></div></section>` : ''}

<div class="ws-cols">
<section class="ws-card"><h2>Linked employees</h2>
  ${linked.length ? `<ul class="ws-list">${linked.map((l) => `<li><span><strong>${esc(l.name)}</strong> <span class="muted">${esc(l.emp_id)}</span></span><span class="ws-meta">Machine ID ${esc(l.device_pin)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody yet. Set each employee’s Fingerprint machine ID on their profile.</p>'}
</section>
<section class="ws-card"><h2>Setting up the machine</h2>
  <ol class="ws-howto">
    <li>Connect the machine to the office internet (LAN cable or Wi-Fi).</li>
    <li>On the machine: <strong>Menu → COMM. → Cloud Server Setting</strong> (on some models <em>ADMS</em>).</li>
    <li>Server address: <code>${esc(host)}</code> · Port: <code>80</code> · turn <strong>Enable domain name</strong> on, and HTTPS off unless the model supports it.</li>
    <li>Add every employee on the machine and register their fingerprint. Note each person’s <strong>user number</strong>.</li>
    <li>Wait a minute: the machine appears above by its serial number. Press <strong>Approve</strong>.</li>
    <li>Enter each user number as the employee’s <strong>Fingerprint machine ID</strong> here, then choose <strong>Fingerprint machine only</strong> above.</li>
  </ol>
  <p class="muted small">The machine’s own clock must be set to Bangladesh time.</p>
</section>
</div>`, { active: '/team/attendance' });
  });

  app.post('/team/attendance/mode', auth, need((u) => FINGERPRINT && isAdmin(u)), (req, res) => {
    const mode = req.body.mode === 'DEVICE' ? 'DEVICE' : 'MANUAL';
    setSetting('attendance_mode', mode);
    audit(req, 'attendance_mode', 'settings', null, mode);
    back(res, '/team/attendance/devices', 'saved');
  });
  app.post('/team/attendance/devices/:id', auth, need((u) => FINGERPRINT && isAdmin(u)), (req, res) => {
    const d = int(req.params.id) && one('SELECT * FROM devices WHERE id = ?', int(req.params.id));
    if (!d) return fail(req, res, 404, 'Machine not found.');
    const action = String(req.body.action || 'save');
    run('UPDATE devices SET name = ? WHERE id = ?', t(req.body.name, 60), d.id);
    if (action === 'approve' || action === 'block') {
      run('UPDATE devices SET approved = ? WHERE id = ?', action === 'approve' ? 1 : 0, d.id);
      if (action === 'approve') { applyPunches(); if (!deviceMode() && !setting('attendance_mode')) setSetting('attendance_mode', 'DEVICE'); }
    }
    audit(req, 'device_' + action, 'device', d.id, d.serial);
    back(res, '/team/attendance/devices', 'saved');
  });

  // An admin correction for one person and one day (a missed punch, a
  // machine fault). Recorded as such, and never overwritten by the machine.
  app.get('/team/attendance/fix', auth, need(isAdmin), (req, res) => {
    const p = int(req.query.user) && one('SELECT id, name, emp_id FROM users WHERE id = ?', int(req.query.user));
    const day = isDate(req.query.day) ? req.query.day : today();
    if (!p) return fail(req, res, 404, 'Employee not found.');
    const a = one('SELECT * FROM attendance WHERE user_id = ? AND day = ?', p.id, day) || {};
    const punches = all('SELECT at FROM punches WHERE user_id = ? AND day = ? ORDER BY at', p.id, day);
    const hm = (s) => (s ? fmtTime(s) : '');
    send(req, res, 'Correct attendance', `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/attendance?day=${day}">Attendance</a></nav>
${head(`Correct attendance · ${p.name}`, `${esc(p.emp_id)} · ${esc(fmtDay(day))}`)}
<div class="ws-card ws-narrow">
  ${punches.length ? `<p class="muted">Machine punches this day: ${punches.map((x) => esc(fmtTime(x.at))).join(', ')}</p>` : '<p class="muted">No machine punches this day.</p>'}
  <form method="post" action="/team/attendance/fix" class="ws-form">${csrfField(req)}<input type="hidden" name="user" value="${p.id}"><input type="hidden" name="day" value="${day}">
  <div class="ws-row"><label>In<input type="time" name="in" id="in" value="${hm(a.check_in)}"></label><label>Out<input type="time" name="out" id="out" value="${hm(a.check_out)}"></label></div>
  <label>Reason<input name="note" id="note" required maxlength="200" placeholder="e.g. machine was off, missed punch"></label>
  <div class="ws-actions"><button class="ws-btn" type="submit">Save correction</button></div></form></div>`, { active: '/team/attendance' });
  });
  app.post('/team/attendance/fix', auth, need(isAdmin), (req, res) => {
    const uid = int(req.body.user); const day = isDate(req.body.day) ? req.body.day : '';
    const tm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? new Date(`${day}T${v}:00+06:00`).toISOString() : null);
    const note = t(req.body.note, 200);
    if (!uid || !day || !note) return fail(req, res, 400, 'Choose the times and give a reason.');
    const a = one('SELECT id FROM attendance WHERE user_id = ? AND day = ?', uid, day);
    if (a) run("UPDATE attendance SET check_in = ?, check_out = ?, source = 'ADMIN', note = ? WHERE id = ?", tm(req.body.in), tm(req.body.out), note, a.id);
    else run("INSERT INTO attendance (user_id, day, check_in, check_out, source, note) VALUES (?,?,?,?,'ADMIN',?)", uid, day, tm(req.body.in), tm(req.body.out), note);
    audit(req, 'attendance_fixed', 'user', uid, `${day} ${req.body.in || '-'}–${req.body.out || '-'}: ${note}`);
    back(res, `/team/attendance?day=${day}`, 'fixed');
  });

  // ================================================================ ANNOUNCEMENTS
  // Managers and above post; everyone reads them on the dashboard and is
  // notified. Pinned ones stay at the top.
  function dashAnnouncements() {
    const list = all('SELECT a.*, u.name FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.pinned DESC, a.id DESC LIMIT 3');
    if (!list.length) return '';
    return `<section class="ws-card ws-ann-strip"><div class="ws-card-head"><h2>Announcements</h2><a href="/team/announcements">All announcements</a></div>
      ${list.map((a) => `<article class="ws-ann${a.pinned ? ' is-pinned' : ''}"><strong>${a.pinned ? '📌 ' : ''}${esc(a.title)}</strong>${a.body ? `<p>${nl(a.body.length > 220 ? a.body.slice(0, 220) + '…' : a.body)}</p>` : ''}<small>${esc(a.name || '')} · ${esc(fmtWhen(a.created_at))}</small></article>`).join('')}</section>`;
  }
  app.get('/team/announcements', auth, (req, res) => {
    const u = req.user;
    const list = all('SELECT a.*, u.name FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.pinned DESC, a.id DESC LIMIT 100');
    send(req, res, 'Announcements', `${head('Announcements', 'News, rules and reminders for the whole team.')}
${seesAll(u) ? `<section class="ws-card ws-narrow"><h2>Post an announcement</h2><form method="post" action="/team/announcements" class="ws-form">${csrfField(req)}
  <label>Title<input name="title" id="an-title" required maxlength="160"></label>
  <label>Message<textarea name="body" id="an-body" rows="4" maxlength="4000"></textarea></label>
  <label class="ws-check-row"><input type="checkbox" name="pinned" id="an-pin" value="1"> Pin it to the top</label>
  <div class="ws-actions"><button class="ws-btn" type="submit">Post to everyone</button></div></form></section>` : ''}
${list.length ? list.map((a) => `<article class="ws-card ws-ann${a.pinned ? ' is-pinned' : ''}">
  <div class="ws-card-head"><h2>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h2>${seesAll(u) ? `<div class="ws-actions">
    <form method="post" action="/team/announcements/${a.id}/pin">${csrfField(req)}<button class="ws-link-btn" style="color:var(--royal)" type="submit">${a.pinned ? 'Unpin' : 'Pin'}</button></form>
    <form method="post" action="/team/announcements/${a.id}/delete" data-confirm="Delete this announcement?">${csrfField(req)}<button class="ws-link-btn" type="submit">Delete</button></form></div>` : ''}</div>
  ${a.body ? `<p class="ws-prose">${nl(a.body)}</p>` : ''}<p class="muted small" style="margin:8px 0 0">${esc(a.name || '')} · ${esc(fmtWhen(a.created_at))}</p></article>`).join('')
  : '<div class="ws-card ws-empty"><h2>No announcements yet</h2></div>'}`, { active: '/team/announcements' });
  });
  app.post('/team/announcements', auth, need(seesAll), (req, res) => {
    const title = t(req.body.title, 160); const body = t(req.body.body, 4000);
    if (!title) return back(res, '/team/announcements');
    const r = run('INSERT INTO announcements (title, body, pinned, created_by) VALUES (?,?,?,?)', title, body, req.body.pinned === '1' ? 1 : 0, req.user.id);
    for (const p of all('SELECT id FROM users WHERE active = 1')) notify(req, p.id, `Announcement: ${title}`, '/team/announcements');
    audit(req, 'announcement_posted', 'announcement', Number(r.lastInsertRowid), title);
    back(res, '/team/announcements', 'posted');
  });
  app.post('/team/announcements/:id/pin', auth, need(seesAll), (req, res) => {
    run('UPDATE announcements SET pinned = 1 - pinned WHERE id = ?', int(req.params.id));
    back(res, '/team/announcements', 'saved');
  });
  app.post('/team/announcements/:id/delete', auth, need(seesAll), (req, res) => {
    run('DELETE FROM announcements WHERE id = ?', int(req.params.id));
    audit(req, 'announcement_deleted', 'announcement', int(req.params.id));
    back(res, '/team/announcements', 'deleted');
  });

  // ================================================================ CALENDAR
  // One month, Saturday first. Holidays, meetings and events (added by
  // managers), plus task, upload and project deadlines from the Workspace.
  const EVENT_KINDS = [['EVENT', 'Event'], ['MEETING', 'Meeting'], ['HOLIDAY', 'Holiday'], ['DEADLINE', 'Deadline']];
  app.get('/team/calendar', auth, (req, res) => {
    const u = req.user; const d = today();
    const m = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? req.query.m : d.slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const first = `${m}-01`; const days = new Date(Date.UTC(y, mo, 0)).getUTCDate(); const last = `${m}-${String(days).padStart(2, '0')}`;
    const shift = (k) => { const x = new Date(Date.UTC(y, mo - 1 + k, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
    const events = all('SELECT * FROM events WHERE day BETWEEN ? AND ? ORDER BY day, time', first, last);
    const everyone = seesAll(u);
    const tasks = hasModule(u, 'tasks') ? all(`SELECT t.id, t.title, t.due_date, t.status FROM tasks t WHERE t.parent_id IS NULL AND t.kind != 'UPLOAD'
      AND t.due_date BETWEEN ? AND ? ${everyone ? '' : 'AND t.assignee_id = ?'} ORDER BY t.due_date`, first, last, ...(everyone ? [] : [u.id])) : [];
    const ups = hasModule(u, 'uploads') ? all(`SELECT due_date, COUNT(*) AS n, SUM(status = 'DONE') AS ok, SUM(status IN ('REVIEW','DONE')) AS up FROM tasks
      WHERE kind = 'UPLOAD' AND due_date BETWEEN ? AND ? ${everyone ? '' : 'AND assignee_id = ?'} GROUP BY due_date`, first, last, ...(everyone ? [] : [u.id])) : [];
    const projects = hasModule(u, 'projects') ? all("SELECT id, name, due_date FROM projects WHERE due_date BETWEEN ? AND ? AND status != 'COMPLETED'", first, last) : [];
    const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 1) % 7; // Saturday = 0
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell is-blank" aria-hidden="true"></div>');
    for (let i = 1; i <= days; i++) {
      const day = `${m}-${String(i).padStart(2, '0')}`;
      const ev = events.filter((e) => e.day === day);
      const tk = tasks.filter((x) => x.due_date === day);
      const up = ups.find((x) => x.due_date === day);
      const pj = projects.filter((x) => x.due_date === day);
      const holiday = ev.some((e) => e.kind === 'HOLIDAY');
      const items = [
        ...ev.map((e) => `<li class="cal-ev k-${e.kind.toLowerCase()}" title="${esc(e.notes)}">${e.time ? `<b>${esc(e.time)}</b> ` : ''}${esc(e.title)}${everyone ? `<form method="post" action="/team/calendar/events/${e.id}/delete" data-confirm="Delete this event?">${csrfField(req)}<input type="hidden" name="m" value="${m}"><button class="cal-x" type="submit" aria-label="Delete ${esc(e.title)}">×</button></form>` : ''}</li>`),
        ...pj.map((p) => `<li class="cal-ev k-deadline"><a href="/team/projects/${p.id}">Project due: ${esc(p.name)}</a></li>`),
        ...tk.slice(0, 3).map((x) => `<li class="cal-task${x.status === 'DONE' ? ' is-done' : ''}"><a href="/team/tasks/${x.id}">${esc(x.title)}</a></li>`),
        tk.length > 3 ? `<li class="cal-more"><a href="/team/tasks?who=${everyone ? 'all' : 'me'}">+${tk.length - 3} more tasks</a></li>` : '',
        up ? `<li class="cal-up"><a href="/team/uploads?day=${day}">🎬 ${up.up}/${up.n} uploaded${up.ok ? ` · ${up.ok} checked` : ''}</a></li>` : '',
      ].join('');
      cells.push(`<div class="cal-cell${day === d ? ' is-today' : ''}${holiday ? ' is-holiday' : ''}"><span class="cal-n"><span class="cal-dow">${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][(lead + i - 1) % 7]}, </span>${i}</span>${items ? `<ul>${items}</ul>` : ''}</div>`);
    }
    const monthName = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    send(req, res, 'Calendar', `${head(monthName, 'Holidays, meetings and every deadline in one place.', `<div class="ws-seg"><a href="?m=${shift(-1)}">‹ Previous</a><a href="?m=${d.slice(0, 7)}">Today</a><a href="?m=${shift(1)}">Next ›</a></div>`)}
<div class="cal" role="grid" aria-label="${esc(monthName)}">${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((x) => `<div class="cal-head">${x}</div>`).join('')}${cells.join('')}</div>
${everyone ? `<section class="ws-card ws-narrow"><h2>Add to the calendar</h2><form method="post" action="/team/calendar/events" class="ws-form">${csrfField(req)}
  <div class="ws-row"><label>Title<input name="title" id="ev-title" required maxlength="160" placeholder="e.g. Weekly meeting, Eid holiday"></label>
    <label>Type<select name="kind" id="ev-kind">${options(EVENT_KINDS, 'EVENT')}</select></label></div>
  <div class="ws-row"><label>Date<input type="date" name="day" id="ev-day" required value="${m === d.slice(0, 7) ? d : first}"></label>
    <label>Time (optional)<input type="time" name="time" id="ev-time"></label></div>
  <label>Notes (optional)<input name="notes" id="ev-notes" maxlength="300"></label>
  <label class="ws-check-row"><input type="checkbox" name="notify" id="ev-notify" value="1"> Tell everyone</label>
  <div class="ws-actions"><button class="ws-btn" type="submit">Add</button></div></form></section>` : ''}`, { active: '/team/calendar' });
  });
  app.post('/team/calendar/events', auth, need(seesAll), (req, res) => {
    const title = t(req.body.title, 160); const day = isDate(req.body.day) ? req.body.day : '';
    if (!title || !day) return back(res, '/team/calendar');
    const time = /^\d{2}:\d{2}$/.test(String(req.body.time || '')) ? req.body.time : '';
    const kind = pick(EVENT_KINDS, req.body.kind, 'EVENT');
    const r = run('INSERT INTO events (title, day, time, kind, notes, created_by) VALUES (?,?,?,?,?,?)', title, day, time, kind, t(req.body.notes, 300), req.user.id);
    if (req.body.notify === '1') for (const p of all('SELECT id FROM users WHERE active = 1')) notify(req, p.id, `${label(EVENT_KINDS, kind)} on ${fmtDay(day)}${time ? ' at ' + time : ''}: ${title}`, `/team/calendar?m=${day.slice(0, 7)}`);
    audit(req, 'event_added', 'event', Number(r.lastInsertRowid), `${day} ${title}`);
    back(res, `/team/calendar?m=${day.slice(0, 7)}`, 'created');
  });
  app.post('/team/calendar/events/:id/delete', auth, need(seesAll), (req, res) => {
    run('DELETE FROM events WHERE id = ?', int(req.params.id));
    audit(req, 'event_deleted', 'event', int(req.params.id));
    const m = /^\d{4}-\d{2}$/.test(String(req.body.m || '')) ? req.body.m : '';
    back(res, '/team/calendar' + (m ? '?m=' + m : ''), 'deleted');
  });

  // ================================================================ INBOX (website messages and job applications)
  // Everything the website's forms receive, with a follow-up stage and a note
  // for each. The messages themselves stay where the website saves them.
  const INQUIRY_FILE = path.join(DATA_DIR, 'inquiries.json');
  const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
  const STAGES = {
    career: [['NEW', 'New'], ['SHORTLISTED', 'Shortlisted'], ['INTERVIEW', 'Interview'], ['HIRED', 'Hired'], ['REJECTED', 'Not selected']],
    request: [['NEW', 'New'], ['CONTACTED', 'Contacted'], ['QUOTED', 'Quoted'], ['WON', 'Won'], ['CLOSED', 'Closed']],
    contact: [['NEW', 'New'], ['REPLIED', 'Replied'], ['CLOSED', 'Closed']],
  };
  const TABS = [['career', 'Job applications'], ['request', 'Service requests'], ['contact', 'Contact messages']];
  const inquiries = () => { try { const d = JSON.parse(fs.readFileSync(INQUIRY_FILE, 'utf8')); return Array.isArray(d.inquiries) ? d.inquiries : []; } catch (e) { return []; } };
  const stageOf = (id) => one('SELECT * FROM inbox_status WHERE inquiry_id = ?', id) || { stage: 'NEW', note: '' };
  const stageChip = (kind, s) => chip('stg', s, label(STAGES[kind] || STAGES.contact, s));
  const waLink = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 10 ? `https://wa.me/${d.startsWith('0') ? '88' + d : d}` : ''; };

  app.get('/team/inbox', auth, need((u) => hasModule(u, 'inbox')), (req, res) => {
    const tab = TABS.some((x) => x[0] === req.query.tab) ? req.query.tab : 'career';
    const stage = t(req.query.stage, 20);
    const all_ = inquiries();
    const statuses = new Map(all('SELECT inquiry_id, stage FROM inbox_status').map((r) => [r.inquiry_id, r.stage]));
    const counts = Object.fromEntries(TABS.map(([k]) => [k, all_.filter((x) => x.kind === k && (statuses.get(x.id) || 'NEW') === 'NEW').length]));
    const rows = all_.filter((x) => x.kind === tab).filter((x) => !stage || (statuses.get(x.id) || 'NEW') === stage);
    send(req, res, 'Inbox', `${head('Inbox', 'Everything sent through the website’s forms, with where each one stands.')}
<div class="ws-seg ws-tabs" role="tablist">${TABS.map(([k, l]) => `<a href="?tab=${k}"${k === tab ? ' aria-current="page"' : ''}>${l}${counts[k] ? ` <b class="ws-dot">${counts[k]}</b>` : ''}</a>`).join('')}</div>
<div class="ws-seg">${[['', 'All'], ...STAGES[tab]].map(([k, l]) => `<a href="?tab=${tab}${k ? '&stage=' + k : ''}"${k === stage ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div>
${rows.length ? `<div class="ws-table-wrap ws-card flush"><table class="ws-table"><thead><tr><th>Received</th><th>Name</th><th>${tab === 'career' ? 'Applying for' : tab === 'request' ? 'Service' : 'Subject'}</th><th>Contact</th><th>Stage</th></tr></thead><tbody>
${rows.map((x) => `<tr><td class="num">${esc(fmtWhen(x.at))}</td><td><a href="/team/inbox/${esc(x.id)}"><strong>${esc(x.name)}</strong></a>${x.company ? `<br><span class="muted">${esc(x.company)}</span>` : ''}</td>
<td>${esc(tab === 'career' ? x.position || 'General application' : tab === 'request' ? x.service : x.subject || (x.message || '').slice(0, 60))}</td>
<td>${esc(x.email)}${x.phone ? `<br><span class="muted">${esc(x.phone)}</span>` : ''}</td><td>${stageChip(tab, statuses.get(x.id) || 'NEW')}</td></tr>`).join('')}
</tbody></table></div>` : `<div class="ws-card ws-empty"><h2>Nothing here</h2><p class="muted">New ${tab === 'career' ? 'applications from the Careers page' : 'messages from the website'} appear here as soon as they are sent.</p></div>`}`, { active: '/team/inbox' });
  });

  app.get('/team/inbox/:id', auth, need((u) => hasModule(u, 'inbox')), (req, res) => {
    const x = inquiries().find((q) => q.id === req.params.id);
    if (!x) return fail(req, res, 404, 'Message not found.');
    const st = stageOf(x.id);
    const stages = STAGES[x.kind] || STAGES.contact;
    const f = (k, l) => (x[k] ? `<p class="ws-kv"><span>${l}</span><strong>${/^https?:\/\//.test(x[k]) ? `<a href="${esc(x[k])}" target="_blank" rel="noopener">${esc(x[k])}</a>` : esc(x[k])}</strong></p>` : '');
    const wa = waLink(x.phone);
    const hire = x.kind === 'career' && isAdmin(req.user)
      ? `<a class="ws-btn ws-btn-ghost" href="/team/employees/new?${new URLSearchParams({ name: x.name, email: x.email, phone: x.phone || '', position: x.position || '' })}">Add as employee</a>` : '';
    send(req, res, x.name, `<nav class="ws-crumbs" aria-label="Breadcrumb"><a href="/team/inbox?tab=${esc(x.kind)}">Inbox</a></nav>
${head(x.name, `${esc(label(TABS, x.kind))} · ${esc(fmtWhen(x.at))} · ${stageChip(x.kind, st.stage)}`,
  `<a class="ws-btn ws-btn-ghost" href="mailto:${esc(x.email)}">Email</a>${wa ? `<a class="ws-btn ws-btn-ghost" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${hire}`)}
<div class="ws-detail"><div class="ws-detail-main">
  <section class="ws-card">${f('email', 'Email')}${f('phone', 'Phone')}${f('company', 'Company')}${f('country', 'Country')}${f('position', 'Applying for')}${f('occupation', 'Occupation')}${f('area', 'Area')}
    ${f('facebook', 'Facebook')}${f('linkedin', 'LinkedIn')}${f('service', 'Service')}${f('requirementType', 'Requirement type')}${f('budget', 'Budget')}${f('timeline', 'Timeline')}${f('subject', 'Subject')}</section>
  ${x.requirement || x.message ? `<section class="ws-card"><h2>${x.kind === 'career' ? 'About them' : 'Message'}</h2><p class="ws-prose">${nl(x.requirement || x.message)}</p></section>` : ''}
</div><aside class="ws-detail-side">
  ${['cv', 'photo', 'attachment'].some((k) => x[k]) ? `<section class="ws-card"><h2>Files</h2><ul class="ws-files">${['cv', 'photo', 'attachment'].filter((k) => x[k]).map((k) => `<li><a href="/team/inbox/${esc(x.id)}/file/${k}">${{ cv: 'CV (PDF)', photo: 'Photo', attachment: 'Attachment' }[k]}</a></li>`).join('')}</ul></section>` : ''}
  <section class="ws-card"><h2>Follow-up</h2><form method="post" action="/team/inbox/${esc(x.id)}" class="ws-form">${csrfField(req)}
    <label>Stage<select name="stage" id="stage">${options(stages, st.stage)}</select></label>
    <label>Note (only the team sees it)<textarea name="note" id="note" rows="4" maxlength="2000">${esc(st.note)}</textarea></label>
    <button class="ws-btn" type="submit">Save</button></form>
    ${st.updated_at ? `<p class="muted small" style="margin:8px 0 0">Last updated ${esc(fmtWhen(st.updated_at))}</p>` : ''}</section>
</aside></div>`, { active: '/team/inbox' });
  });
  app.post('/team/inbox/:id', auth, need((u) => hasModule(u, 'inbox')), (req, res) => {
    const x = inquiries().find((q) => q.id === req.params.id);
    if (!x) return fail(req, res, 404, 'Message not found.');
    const stage = pick(STAGES[x.kind] || STAGES.contact, req.body.stage, 'NEW');
    run(`INSERT INTO inbox_status (inquiry_id, stage, note, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))
      ON CONFLICT(inquiry_id) DO UPDATE SET stage = excluded.stage, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      x.id, stage, t(req.body.note, 2000), req.user.id);
    audit(req, 'inbox_stage', 'inquiry', null, `${x.id} → ${stage}`);
    back(res, `/team/inbox/${encodeURIComponent(x.id)}`, 'saved');
  });
  app.get('/team/inbox/:id/file/:key', auth, need((u) => hasModule(u, 'inbox')), (req, res) => {
    const x = inquiries().find((q) => q.id === req.params.id);
    const key = ['cv', 'photo', 'attachment'].includes(req.params.key) ? req.params.key : '';
    const stored = x && key && x[key] ? path.basename(String(x[key])) : '';
    const p = stored && path.join(ATTACH_DIR, stored);
    if (!p || !fs.existsSync(p)) return fail(req, res, 404, 'File not found.');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.download(p, stored.replace(/^INQ-[A-Z0-9]+-\w+-/, ''), { headers: { 'Content-Type': 'application/octet-stream' } });
  });

  // ================================================================ REPORTS
  // Per person, for any date range: tasks, uploads and attendance. Each
  // table downloads as a CSV that opens in Excel.
  const minutesOf = (iso) => { const p = fmtTime(iso).split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  function reportData(from, to) {
    const people = all('SELECT id, name, emp_id FROM users WHERE active = 1 ORDER BY name');
    const now = today();
    const tasks = people.map((p) => {
      const r = one(`SELECT SUM(status = 'DONE' AND substr(approved_at, 1, 10) BETWEEN ? AND ?) AS done,
        SUM(status != 'DONE') AS open, SUM(status != 'DONE' AND due_date != '' AND due_date < ?) AS late
        FROM tasks WHERE assignee_id = ? AND kind != 'UPLOAD' AND parent_id IS NULL`, from, to, now, p.id);
      return { ...p, done: r.done || 0, open: r.open || 0, late: r.late || 0 };
    }).filter((x) => x.done || x.open);
    const uploads = people.map((p) => {
      const r = one(`SELECT COUNT(*) AS n, SUM(status IN ('REVIEW','DONE')) AS up, SUM(status = 'DONE') AS ok,
        SUM(status NOT IN ('REVIEW','DONE') AND due_date < ?) AS missed FROM tasks WHERE kind = 'UPLOAD' AND assignee_id = ? AND due_date BETWEEN ? AND ?`, now, p.id, from, to);
      return { ...p, n: r.n || 0, up: r.up || 0, ok: r.ok || 0, missed: r.missed || 0 };
    }).filter((x) => x.n);
    const attendance = people.map((p) => {
      const rows = all('SELECT check_in, check_out FROM attendance WHERE user_id = ? AND day BETWEEN ? AND ? AND check_in IS NOT NULL', p.id, from, to);
      const ins = rows.map((r) => minutesOf(r.check_in));
      const hrs = rows.filter((r) => r.check_out).reduce((s, r) => s + (toDate(r.check_out) - toDate(r.check_in)) / 36e5, 0);
      return { ...p, days: rows.length, avgIn: ins.length ? hhmm(ins.reduce((a, b) => a + b, 0) / ins.length) : '', hours: hrs.toFixed(1) };
    });
    return { tasks, uploads, attendance };
  }
  const rangeOf = (q) => {
    const d = today();
    const to = isDate(q.to) ? q.to : d;
    const from = isDate(q.from) ? q.from : `${d.slice(0, 7)}-01`;
    return from <= to ? [from, to] : [to, from];
  };
  app.get('/team/reports', auth, need((u) => hasModule(u, 'reports')), (req, res) => {
    const [from, to] = rangeOf(req.query);
    const r = reportData(from, to);
    const qs = `from=${from}&to=${to}`;
    const table = (title, type, headRow, rows, empty) => `<section class="ws-card"><div class="ws-card-head"><h2>${title}</h2><a href="/team/reports.csv?type=${type}&${qs}">Download CSV</a></div>
      ${rows.length ? `<div class="ws-table-wrap"><table class="ws-table"><thead><tr>${headRow.map((h, i) => `<th${i > 1 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<p class="muted">${empty}</p>`}</section>`;
    const n = (v, cls = '') => `<td class="num${cls}">${v}</td>`;
    send(req, res, 'Reports', `${head('Reports', `${esc(fmtDay(from))} – ${esc(fmtDay(to))}`, `<form method="get" class="ws-inline">
  <label class="sr-only" for="from">From</label><input type="date" name="from" id="from" value="${from}"><label class="sr-only" for="to">To</label><input type="date" name="to" id="to" value="${to}">
  <button class="ws-btn ws-btn-ghost" type="submit">Show</button></form>`)}
${table('Video uploads', 'uploads', ['Employee', 'ID', 'Due', 'Uploaded', 'Checked', 'Missed'], r.uploads.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.emp_id)}</td>${n(x.n)}${n(x.up)}${n(x.ok)}${n(x.missed, x.missed ? ' is-bad' : '')}</tr>`), 'No upload tasks in this period.')}
${table('Tasks', 'tasks', ['Employee', 'ID', 'Done in period', 'Open now', 'Overdue now'], r.tasks.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.emp_id)}</td>${n(x.done)}${n(x.open)}${n(x.late, x.late ? ' is-bad' : '')}</tr>`), 'No tasks in this period.')}
${table('Attendance', 'attendance', ['Employee', 'ID', 'Days present', 'Average in', 'Hours'], r.attendance.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.emp_id)}</td>${n(x.days)}${n(x.avgIn || '—')}${n(x.hours)}</tr>`), 'Nobody yet.')}`, { active: '/team/reports' });
  });
  app.get('/team/reports.csv', auth, need((u) => hasModule(u, 'reports')), (req, res) => {
    const [from, to] = rangeOf(req.query);
    const r = reportData(from, to);
    const type = ['tasks', 'uploads', 'attendance'].includes(req.query.type) ? req.query.type : 'uploads';
    const cols = { uploads: [['name', 'Employee'], ['emp_id', 'ID'], ['n', 'Due'], ['up', 'Uploaded'], ['ok', 'Checked'], ['missed', 'Missed']],
      tasks: [['name', 'Employee'], ['emp_id', 'ID'], ['done', 'Done in period'], ['open', 'Open now'], ['late', 'Overdue now']],
      attendance: [['name', 'Employee'], ['emp_id', 'ID'], ['days', 'Days present'], ['avgIn', 'Average in'], ['hours', 'Hours']] }[type];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const csv = '\uFEFF' + [cols.map((c) => c[1]).join(','), ...r[type].map((x) => cols.map((c) => cell(x[c[0]])).join(','))].join('\r\n');
    audit(req, 'report_downloaded', 'report', null, `${type} ${from}–${to}`);
    res.set('Content-Disposition', `attachment; filename="monoha-${type}-${from}-to-${to}.csv"`).type('text/csv').send(csv);
  });

  // ================================================================ SEARCH
  app.get('/team/search', auth, (req, res) => {
    const u = req.user; const q = t(req.query.q, 80);
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const sections = [];
    if (q.length >= 2) {
      if (hasModule(u, 'tasks') || hasModule(u, 'uploads')) {
        const rows = q2(`${TASK_SELECT} WHERE (t.title LIKE $q OR t.description LIKE $q) ${seesAll(u) ? '' : 'AND ' + VISIBLE} ORDER BY t.id DESC LIMIT 20`, seesAll(u) ? { $q: like } : { $q: like, $me: u.id });
        sections.push(['Tasks', rows.map((x) => `<li><a href="/team/tasks/${x.id}"><strong>${esc(x.title)}</strong><span class="muted">${esc(x.project || x.channel || '')} · ${esc(x.assignee || 'Unassigned')}</span></a><span class="ws-meta">${statusChip(x.status)}</span></li>`)]);
      }
      if (hasModule(u, 'projects')) {
        const rows = all(`SELECT id, name, status FROM projects WHERE (name LIKE ? OR description LIKE ?) ${seesAll(u) ? '' : 'AND (lead_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?))'} LIMIT 10`, like, like, ...(seesAll(u) ? [] : [u.id, u.id]));
        sections.push(['Projects', rows.map((p) => `<li><a href="/team/projects/${p.id}"><strong>${esc(p.name)}</strong></a><span class="ws-meta">${chip('ps', p.status, label(PSTATUS, p.status))}</span></li>`)]);
      }
      if (hasModule(u, 'employees')) {
        const rows = all('SELECT id, name, emp_id, position, email FROM users WHERE active = 1 AND (name LIKE ? OR emp_id LIKE ? OR email LIKE ? OR position LIKE ? OR phone LIKE ?) LIMIT 10', like, like, like, like, like);
        sections.push(['People', rows.map((p) => `<li><span><strong>${esc(p.name)}</strong> <span class="muted">${esc(p.emp_id)} · ${esc(p.position)}</span></span><span class="ws-meta"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></span></li>`)]);
      }
      if (hasModule(u, 'inbox')) {
        const ql = q.toLowerCase();
        const rows = inquiries().filter((x) => [x.name, x.email, x.phone, x.company, x.position, x.service, x.id].some((v) => String(v || '').toLowerCase().includes(ql))).slice(0, 10);
        sections.push(['Inbox', rows.map((x) => `<li><a href="/team/inbox/${esc(x.id)}"><strong>${esc(x.name)}</strong><span class="muted">${esc(label(TABS, x.kind))} · ${esc(x.position || x.service || x.email)}</span></a><span class="ws-meta">${esc(fmtWhen(x.at))}</span></li>`)]);
      }
      const ann = all('SELECT id, title FROM announcements WHERE title LIKE ? OR body LIKE ? ORDER BY id DESC LIMIT 5', like, like);
      sections.push(['Announcements', ann.map((a) => `<li><a href="/team/announcements"><strong>${esc(a.title)}</strong></a></li>`)]);
    }
    const found = sections.filter(([, r]) => r.length);
    send(req, res, 'Search', `${head(q ? `Search: ${q}` : 'Search')}
<form method="get" class="ws-filters" role="search"><label class="grow"><span>Search everything</span><input type="search" name="q" id="q" value="${esc(q)}" placeholder="Task, person, applicant, phone number…" autofocus></label><button class="ws-btn" type="submit">Search</button></form>
${q.length < 2 ? '<p class="muted">Type at least two letters.</p>' : found.length ? found.map(([title, rows]) => `<section class="ws-card"><h2>${title}</h2><ul class="ws-list">${rows.join('')}</ul></section>`).join('') : '<div class="ws-card ws-empty"><h2>Nothing found</h2></div>'}`, {});
  });

  // ================================================================ WEBSITE
  // The public site's Team, Partners, Programs and CEO profile are edited in
  // /admin. An admin signed in here goes straight in.
  app.get('/team/website', auth, need(isAdmin), (req, res) => {
    if (!app.locals.grantAdmin) return fail(req, res, 404, 'The website admin is switched off. Set ADMIN_PASSWORD and SESSION_SECRET in Coolify.');
    app.locals.grantAdmin(req, res);
    audit(req, 'website_admin_opened');
    res.redirect(303, '/admin');
  });

  app.all('/team/*', auth, (req, res) => fail(req, res, 404, 'Page not found.'));
};
