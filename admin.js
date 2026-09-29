// Admin for the records that change without a deploy: partners, programs
// and the CEO profile. Stored as JSON in DATA_DIR, images in DATA_DIR/uploads.
//
// The admin is switched off unless both ADMIN_PASSWORD and SESSION_SECRET
// are set (Coolify environment variables — never in the repository).
// Sessions are an HMAC-signed, httpOnly, SameSite=Strict cookie; every
// write also checks the Origin header, and failed logins are rate limited.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE = 'monoha_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_IMAGE = 2 * 1024 * 1024;

module.exports = function mountAdmin(app, { STORE, UPLOAD_DIR, readJSON, esc, slugify, leadership, notFound }) {
  const enabled = Boolean(ADMIN_PASSWORD && SESSION_SECRET);
  const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
  const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  const readCookie = (req) => {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
  };
  const authed = (req) => {
    const [ts, mac] = readCookie(req).split('.');
    return Boolean(ts && mac && same(mac, sign(ts)) && Date.now() - Number(ts) < SESSION_MS);
  };
  const setCookie = (req, res, value, maxAge) => res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
  // Writes must come from this site's own pages.
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    if (!o) return false;
    try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
  };

  const noStore = (req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' }); next(); };
  app.use('/admin', noStore);

  if (!enabled) {
    app.all(['/admin', '/admin/*'], (req, res) => res.status(404).type('text/plain').send('Not found'));
    return;
  }

  const fails = new Map();
  const json = express.json({ limit: '4mb' });
  const guard = (req, res, next) => {
    if (!authed(req)) return res.status(401).json({ error: 'Please sign in again.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Request blocked.' });
    next();
  };

  app.get('/admin', (req, res) => res.type('html').send(page(authed(req))));
  app.get('/admin/app.js', (req, res) => res.type('application/javascript').send(CLIENT));

  app.post('/admin/login', json, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Request blocked.' });
    const ip = req.ip; const now = Date.now();
    const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    if (list.length >= 5) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (!same(String((req.body || {}).password || ''), ADMIN_PASSWORD)) {
      list.push(now); fails.set(ip, list);
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    fails.delete(ip);
    const ts = String(now);
    setCookie(req, res, `${ts}.${sign(ts)}`, SESSION_MS / 1000);
    res.json({ ok: true });
  });
  app.post('/admin/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });

  // ---- data
  const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const url = (v) => { const s = t(v, 500); return /^https?:\/\//i.test(s) ? s : ''; };
  const img = (v) => { const s = t(v, 300); return /^\/uploads\/[\w.-]+$/.test(s) ? s : ''; };
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const CLEAN = {
    partners: (b) => ({ name: t(b.name, 120), logo: img(b.logo), description: t(b.description, 600), website: url(b.website), category: t(b.category, 80), project: t(b.project, 600), order: Number(b.order) || 0, active: Boolean(b.active) }),
    programs: (b) => ({ title: t(b.title, 160), cover: img(b.cover), summary: t(b.summary, 400), description: t(b.description, 8000), category: t(b.category, 80), startDate: date(b.startDate), endDate: date(b.endDate), location: t(b.location, 160),
      status: ['Upcoming', 'Ongoing', 'Completed'].includes(b.status) ? b.status : '', link: url(b.link), featured: Boolean(b.featured), published: Boolean(b.published), order: Number(b.order) || 0 }),
  };
  const load = (k) => readJSON(STORE[k], { items: [] });
  const save = (k, d) => { fs.mkdirSync(path.dirname(STORE[k]), { recursive: true }); const tmp = STORE[k] + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, STORE[k]); };

  app.get('/admin/api/data', guard, (req, res) => res.json({ partners: load('partners').items || [], programs: load('programs').items || [], leadership: leadership() }));

  app.post('/admin/api/:kind', guard, json, (req, res, next) => {
    const k = req.params.kind;
    if (!CLEAN[k]) return next();
    const rec = CLEAN[k](req.body || {});
    if (!(rec.name || rec.title)) return res.status(400).json({ error: k === 'partners' ? 'Partner name is required.' : 'Program title is required.' });
    const d = load(k); d.items = d.items || [];
    const id = t((req.body || {}).id, 40);
    const i = id ? d.items.findIndex((x) => x.id === id) : -1;
    if (id && i < 0) return res.status(404).json({ error: 'That record no longer exists.' });
    if (k === 'programs') {
      const base = slugify(rec.title) || 'program';
      let slug = base; let n = 2;
      while (d.items.some((x, j) => j !== i && x.slug === slug)) slug = `${base}-${n++}`;
      rec.slug = slug;
    }
    if (i >= 0) d.items[i] = { ...d.items[i], ...rec, updated: new Date().toISOString() };
    else d.items.push({ id: crypto.randomBytes(6).toString('hex'), ...rec, created: new Date().toISOString() });
    save(k, d);
    res.json({ ok: true, items: d.items });
  });

  app.delete('/admin/api/:kind/:id', guard, (req, res, next) => {
    const k = req.params.kind;
    if (!CLEAN[k]) return next();
    const d = load(k);
    d.items = (d.items || []).filter((x) => x.id !== req.params.id);
    save(k, d);
    res.json({ ok: true, items: d.items });
  });

  app.put('/admin/api/leadership', guard, json, (req, res) => {
    const b = req.body || {};
    const rec = { name: t(b.name, 120), position: t(b.position, 120), photo: img(b.photo), message: t(b.message, 4000), bio: t(b.bio, 2000),
      socials: (Array.isArray(b.socials) ? b.socials : []).slice(0, 6).map((x) => ({ label: t(x.label, 40), url: url(x.url) })).filter((x) => x.url) };
    save('leadership', rec);
    res.json({ ok: true, leadership: leadership() });
  });

  // Images only, checked by their first bytes rather than the file name.
  app.post('/admin/api/upload', guard, json, (req, res) => {
    const buf = Buffer.from(String((req.body || {}).data || ''), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'No file received.' });
    if (buf.length > MAX_IMAGE) return res.status(400).json({ error: 'Images must be 2 MB or smaller.' });
    const ext = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpg'
        : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : '';
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG or WebP image.' });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ ok: true, url: '/uploads/' + name });
  });

  function page(signedIn) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>MONOHA Admin</title><link rel="icon" href="/images/logo.png">
<style>${CSS}</style></head><body>
<header class="ad-top"><a href="/" class="ad-brand"><img src="/images/logo.png" alt="" width="40" height="27"><span>MONOHA <b>Admin</b></span></a>${signedIn ? '<button type="button" id="logout" class="ad-btn ghost">Sign out</button>' : ''}</header>
<main class="ad-main" id="app" data-signed="${signedIn ? '1' : ''}">${signedIn ? '<p>Loading…</p>' : `
<form class="ad-login" id="login"><h1>Sign in</h1><label for="password">Admin password</label><input id="password" type="password" autocomplete="current-password" required><button class="ad-btn" type="submit">Sign in</button><p class="ad-err" role="alert"></p></form>`}</main>
<script src="/admin/app.js"></script></body></html>`;
  }
  void esc; void notFound;
};

const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,sans-serif;background:#F5F9FF;color:#071A41}
.ad-top{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#071A41;color:#fff}
.ad-brand{display:flex;gap:10px;align-items:center;color:#fff;text-decoration:none}.ad-brand img{background:#fff;border-radius:6px;padding:2px}
.ad-main{max-width:1100px;margin:0 auto;padding:24px 16px 60px}
.ad-login{max-width:360px;margin:60px auto;background:#fff;padding:28px;border-radius:14px;border:1px solid #E3EAF5;display:grid;gap:10px}
.ad-tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}.ad-tabs button{border:1px solid #E3EAF5;background:#fff;padding:9px 16px;border-radius:999px;cursor:pointer;font:inherit}
.ad-tabs button[aria-selected=true]{background:#071A41;color:#fff;border-color:#071A41}
.ad-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px}@media(max-width:820px){.ad-grid{grid-template-columns:1fr}}
.ad-card{background:#fff;border:1px solid #E3EAF5;border-radius:14px;padding:20px}
.ad-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.ad-list li{display:flex;gap:10px;align-items:center;border:1px solid #E3EAF5;border-radius:10px;padding:10px}
.ad-list img{width:44px;height:44px;object-fit:contain;border-radius:6px;background:#F5F9FF}.ad-list .grow{flex:1;min-width:0}.ad-list small{display:block;color:#5B6B88}
.ad-pill{font-size:12px;padding:2px 8px;border-radius:999px;background:#E8F7EE;color:#146C3A}.ad-pill.off{background:#F1F3F7;color:#5B6B88}
form.ad-form{display:grid;gap:12px}label{font-weight:600;font-size:13px}input,textarea,select{width:100%;font:inherit;padding:9px 11px;border:1px solid #CBD5E6;border-radius:8px;background:#fff}
textarea{min-height:90px}.ad-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:520px){.ad-row{grid-template-columns:1fr}}
.ad-check{display:flex;gap:8px;align-items:center;font-weight:500}.ad-check input{width:auto}
.ad-btn{background:#1455D9;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}.ad-btn.ghost{background:transparent;border:1px solid currentColor;color:inherit}
.ad-btn.danger{background:#fff;color:#B42318;border:1px solid #F1C4C0}.ad-btn.sm{padding:6px 10px;font-size:13px}
.ad-err{color:#B42318;margin:0;min-height:1.2em}.ad-ok{color:#146C3A;margin:0;min-height:1.2em}.ad-prev{max-width:160px;max-height:100px;display:block;margin-top:6px;border-radius:6px}
.ad-actions{display:flex;gap:8px;flex-wrap:wrap}h1,h2{margin:0 0 12px}.muted{color:#5B6B88}
:focus-visible{outline:2px solid #00BFEF;outline-offset:2px}`;

// The admin page's script: plain DOM, no build step.
const CLIENT = `(function(){
var app=document.getElementById('app');
function post(u,body,method){return fetch(u,{method:method||'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Something went wrong.');return j;});});}
function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var login=document.getElementById('login');
if(login){login.addEventListener('submit',function(e){e.preventDefault();post('/admin/login',{password:document.getElementById('password').value}).then(function(){location.reload();}).catch(function(err){login.querySelector('.ad-err').textContent=err.message;});});return;}
document.getElementById('logout').addEventListener('click',function(){post('/admin/logout').then(function(){location.reload();});});
var D={partners:[],programs:[],leadership:{}},tab='partners',edit=null;
var F={
 partners:[['name','Partner name','text',1],['logo','Logo','image'],['category','Category'],['website','Website URL','url'],['description','Short description','area'],['project','Project description (optional)','area'],['order','Display order','number'],['active','Active (shown on the site)','check']],
 programs:[['title','Title','text',1],['cover','Landscape cover image','image'],['category','Category'],['status','Status','select',0,['','Upcoming','Ongoing','Completed']],['startDate','Start date','date'],['endDate','End date','date'],['location','Location'],['link','External link','url'],['summary','Short description','area'],['description','Full description (blank line = new paragraph)','area'],['order','Display order','number'],['featured','Featured','check'],['published','Published (shown on the site)','check']]
};
function field(f,v){var id='f-'+f[0],t=f[2]||'text';
 if(t==='check')return '<label class="ad-check"><input type="checkbox" id="'+id+'" name="'+f[0]+'"'+(v?' checked':'')+'>'+h(f[1])+'</label>';
 if(t==='area')return '<div><label for="'+id+'">'+h(f[1])+'</label><textarea id="'+id+'" name="'+f[0]+'">'+h(v)+'</textarea></div>';
 if(t==='select')return '<div><label for="'+id+'">'+h(f[1])+'</label><select id="'+id+'" name="'+f[0]+'">'+f[4].map(function(o){return '<option'+(o===v?' selected':'')+' value="'+h(o)+'">'+(o||'—')+'</option>';}).join('')+'</select></div>';
 if(t==='image')return '<div><label for="'+id+'-file">'+h(f[1])+' <span class="muted">PNG, JPG or WebP, up to 2 MB</span></label><input type="hidden" name="'+f[0]+'" value="'+h(v)+'"><input type="file" id="'+id+'-file" accept="image/png,image/jpeg,image/webp" data-for="'+f[0]+'">'+(v?'<img class="ad-prev" src="'+h(v)+'" alt=""><button type="button" class="ad-btn sm ghost" data-clear="'+f[0]+'">Remove image</button>':'')+'</div>';
 return '<div><label for="'+id+'">'+h(f[1])+'</label><input id="'+id+'" name="'+f[0]+'" type="'+t+'" value="'+h(v)+'"'+(f[3]?' required':'')+'></div>';}
function render(){
 var tabs='<div class="ad-tabs" role="tablist">'+[['partners','Partners'],['programs','Programs'],['leadership','CEO profile']].map(function(x){return '<button type="button" role="tab" data-tab="'+x[0]+'" aria-selected="'+(tab===x[0])+'">'+x[1]+'</button>';}).join('')+'</div>';
 if(tab==='leadership'){var L=D.leadership,so=(L.socials||[]).concat([{},{},{}]).slice(0,3);
  app.innerHTML=tabs+'<div class="ad-card"><h2>CEO profile</h2><form class="ad-form" id="form">'+field(['name','Name','text',1],L.name)+field(['position','Position'],L.position)+field(['photo','Photo','image'],L.photo)+field(['message','Message','area'],L.message)+field(['bio','Short bio (optional)','area'],L.bio)
  +'<p class="muted" style="margin:0">Social links (optional)</p>'+so.map(function(s,i){return '<div class="ad-row"><input aria-label="Social label '+(i+1)+'" name="sl'+i+'" placeholder="LinkedIn" value="'+h(s.label)+'"><input aria-label="Social URL '+(i+1)+'" name="su'+i+'" type="url" placeholder="https://" value="'+h(s.url)+'"></div>';}).join('')
  +'<div class="ad-actions"><button class="ad-btn" type="submit">Save profile</button></div><p class="ad-err" role="alert"></p><p class="ad-ok" role="status"></p></form></div>';
  return bind();}
 var items=D[tab].slice().sort(function(a,b){return (a.order||0)-(b.order||0);}),cur=edit?D[tab].filter(function(x){return x.id===edit;})[0]||{}:{},isP=tab==='partners';
 var list=items.length?'<ul class="ad-list">'+items.map(function(x){var on=isP?x.active:x.published,img=isP?x.logo:x.cover;return '<li>'+(img?'<img src="'+h(img)+'" alt="">':'')+'<div class="grow"><strong>'+h(x.name||x.title)+'</strong><small>'+h(x.category||'')+' · order '+(x.order||0)+'</small></div><span class="ad-pill'+(on?'':' off')+'">'+(on?(isP?'Active':'Published'):(isP?'Inactive':'Draft'))+'</span><button type="button" class="ad-btn sm ghost" data-toggle="'+x.id+'">'+(on?(isP?'Deactivate':'Unpublish'):(isP?'Activate':'Publish'))+'</button><button type="button" class="ad-btn sm ghost" data-edit="'+x.id+'">Edit</button><button type="button" class="ad-btn sm danger" data-del="'+x.id+'">Delete</button></li>';}).join('')+'</ul>':'<p class="muted">Nothing added yet.</p>';
 app.innerHTML=tabs+'<div class="ad-grid"><div class="ad-card"><h2>'+(isP?'Partners':'Programs')+'</h2>'+list+'</div><div class="ad-card"><h2>'+(edit?'Edit':'Add')+' '+(isP?'partner':'program')+'</h2><form class="ad-form" id="form">'+F[tab].map(function(f){return field(f,cur[f[0]]);}).join('')+'<div class="ad-actions"><button class="ad-btn" type="submit">'+(edit?'Save changes':'Add')+'</button>'+(edit?'<button type="button" class="ad-btn ghost" id="cancel">Cancel</button>':'')+'</div><p class="ad-err" role="alert"></p><p class="ad-ok" role="status"></p></form></div></div>';
 bind();}
function collect(form){var o={};Array.prototype.forEach.call(form.elements,function(el){if(!el.name||el.type==='file')return;o[el.name]=el.type==='checkbox'?el.checked:el.value;});return o;}
function bind(){
 app.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){tab=b.dataset.tab;edit=null;render();};});
 app.querySelectorAll('[data-edit]').forEach(function(b){b.onclick=function(){edit=b.dataset.edit;render();document.getElementById('form').scrollIntoView({behavior:'smooth'});};});
 app.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!confirm('Delete this record? This cannot be undone.'))return;post('/admin/api/'+tab+'/'+b.dataset.del,null,'DELETE').then(function(j){D[tab]=j.items;if(edit===b.dataset.del)edit=null;render();}).catch(function(e){alert(e.message);});};});
 app.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=function(){var x=D[tab].filter(function(r){return r.id===b.dataset.toggle;})[0],k=tab==='partners'?'active':'published',body=Object.assign({},x);body[k]=!x[k];post('/admin/api/'+tab,body).then(function(j){D[tab]=j.items;render();}).catch(function(e){alert(e.message);});};});
 var form=document.getElementById('form'),err=form.querySelector('.ad-err'),ok=form.querySelector('.ad-ok'),c=document.getElementById('cancel');
 if(c)c.onclick=function(){edit=null;render();};
 form.querySelectorAll('[data-clear]').forEach(function(b){b.onclick=function(){form.elements[b.dataset.clear].value='';var p=b.previousElementSibling;if(p)p.remove();b.remove();};});
 form.querySelectorAll('input[type=file]').forEach(function(inp){inp.onchange=function(){var f=inp.files[0];if(!f)return;if(f.size>2097152){err.textContent='Images must be 2 MB or smaller.';inp.value='';return;}
  var r=new FileReader();r.onload=function(){err.textContent='';ok.textContent='Uploading…';post('/admin/api/upload',{data:String(r.result).split(',')[1]}).then(function(j){form.elements[inp.dataset.for].value=j.url;ok.textContent='Image uploaded. Save to apply.';var p=inp.parentNode.querySelector('.ad-prev');if(!p){p=document.createElement('img');p.className='ad-prev';p.alt='';inp.after(p);}p.src=j.url;}).catch(function(e){ok.textContent='';err.textContent=e.message;inp.value='';});};r.readAsDataURL(f);};});
 form.onsubmit=function(e){e.preventDefault();err.textContent='';ok.textContent='';var o=collect(form);
  if(tab==='leadership'){o.socials=[0,1,2].map(function(i){return {label:o['sl'+i],url:o['su'+i]};});post('/admin/api/leadership',o,'PUT').then(function(j){D.leadership=j.leadership;render();document.querySelector('.ad-ok').textContent='Saved.';}).catch(function(x){err.textContent=x.message;});return;}
  if(edit)o.id=edit;post('/admin/api/'+tab,o).then(function(j){D[tab]=j.items;edit=null;render();document.querySelector('.ad-ok').textContent='Saved.';}).catch(function(x){err.textContent=x.message;});};}
fetch('/admin/api/data',{credentials:'same-origin'}).then(function(r){if(r.status===401){location.reload();throw 0;}return r.json();}).then(function(j){D=j;render();}).catch(function(e){if(e)app.textContent='Could not load data.';});
})();`;
