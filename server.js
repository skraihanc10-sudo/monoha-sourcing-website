// MONOHA SOURCING INTERNATIONAL — public website.
//
// Same shape as the Cox's Dream Moment site: Express, content kept in JSON
// files, enquiries stored on disk and emailed through Gmail. Pages are
// rendered here from one layout, so every page is complete HTML for search
// engines and the header and footer are written once.
//
// Content lives in content/*.json. With DATA_DIR set (a mounted volume on
// the server), those files are copied there on first start and read from
// there after, so edits and enquiries survive a redeploy.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT) || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const INQUIRY_FILE = path.join(DATA_DIR, 'inquiries.json');
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

// ---------------------------------------------------------------- content
fs.mkdirSync(CONTENT_DIR, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'content'))) {
  const target = path.join(CONTENT_DIR, f);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(ROOT, 'content', f), target);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
const content = (name) => readJSON(path.join(CONTENT_DIR, name + '.json'), {});

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  handshake: '<path d="M8 12l3 3 5-5M3 12l4-4 5 2 5-2 4 4-9 8z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5L6.5 17M12 11.5l5.5 5.5"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>',
};
const icon = (name) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;

const NAV = [
  ['/', 'Home'], ['/about', 'About'], ['/services', 'Services'], ['/solutions', 'Solutions'],
  ['/process', 'Our Process'], ['/work', 'Our Work'], ['/insights', 'Insights'],
  ['/careers', 'Careers'], ['/contact', 'Contact'],
];

function layout(req, { title, description, body, active }) {
  const site = content('site');
  const services = (content('services').services || []);
  const c = site.contact || {};
  const s = site.social || {};
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} — Sourcing & Business Solutions`;
  const desc = description || site.intro;
  const url = SITE_URL + req.path;
  const here = active || req.path;
  const isActive = (href) => (href === '/' ? here === '/' : here.startsWith(href));

  const navLinks = NAV.map(([href, label]) =>
    `<a href="${href}"${isActive(href) ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`).join('');

  const socials = [['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['youtube', 'YouTube']]
    .filter(([k]) => s[k]).map(([k, l]) => `<a href="${esc(s[k])}" rel="noopener" target="_blank">${l}</a>`).join('');

  const contactLines = [
    c.address && `<li>${icon('pin')}<span>${esc(c.address)}</span></li>`,
    c.email && `<li>${icon('mail')}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`,
    c.phone && `<li>${icon('phone')}<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a></li>`,
  ].filter(Boolean).join('') || '<li><a href="/contact">Send us a message</a></li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE_URL}/images/logo.png">
<meta name="theme-color" content="#0A1A3F">
<link rel="icon" href="/images/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: SITE_URL,
    logo: SITE_URL + '/images/logo.png', ...(c.email ? { email: c.email } : {}), ...(c.phone ? { telephone: c.phone } : {}),
  }).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="header">
  <div class="wrap header-row">
    <a href="/" class="brand" aria-label="${esc(site.name)} — home">
      <img src="/images/logo.png" alt="" width="54" height="36">
      <span class="brand-text"><strong>MONOHA</strong><small>Sourcing International</small></span>
    </a>
    <nav class="nav" id="nav" aria-label="Main">${navLinks}
      <a href="/request" class="btn btn-primary nav-cta-mobile">Request a Service</a>
    </nav>
    <a href="/contact" class="btn btn-primary header-cta">Get in Touch</a>
    <button class="menu-btn" id="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer-grid">
    <div class="footer-about">
      <a href="/" class="brand brand-light"><img src="/images/logo.png" alt="" width="54" height="36">
        <span class="brand-text"><strong>MONOHA</strong><small>Sourcing International</small></span></a>
      <p>${esc(site.description)}</p>
      ${socials ? `<div class="socials">${socials}</div>` : ''}
    </div>
    <div><h3>Company</h3><a href="/about">About</a><a href="/work">Our Work</a><a href="/careers">Careers</a><a href="/contact">Contact</a></div>
    <div><h3>Services</h3>${services.slice(0, 4).map((x) => `<a href="/services/${esc(x.slug)}">${esc(x.title)}</a>`).join('')}<a href="/request">Request a Service</a></div>
    <div><h3>Resources</h3><a href="/insights">Insights</a><a href="/faq">FAQ</a><a href="/process">Our Process</a><a href="/solutions">Solutions</a></div>
    <div><h3>Contact</h3><ul class="contact-list">${contactLines}</ul></div>
  </div>
  <div class="wrap footer-base">
    <span>&copy; ${new Date().getFullYear()} ${esc(site.name)}</span>
    <span class="legal"><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/cookie-policy">Cookie Policy</a></span>
  </div>
</footer>
<script src="/js/site.js" defer></script>
</body>
</html>`;
}

const pageHead = (eyebrow, title, lead) => `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1>${esc(title)}</h1>
    ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
  </div>
</section>`;

const section = (inner, cls = '') => `<section class="section ${cls}"><div class="wrap">${inner}</div></section>`;
const heading = (eyebrow, title, lead, center) =>
  `<div class="sec-head${center ? ' center' : ''}"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;

const serviceCard = (x) => `
<a class="card service-card" href="/services/${esc(x.slug)}">
  <span class="card-icon">${icon(x.icon)}</span>
  <h3>${esc(x.title)}</h3>
  <p>${esc(x.summary)}</p>
  <span class="more">Learn more ${icon('arrow')}</span>
</a>`;

const plainCards = (items, cls = '') =>
  `<div class="grid grid-3 ${cls}">${items.map((i) => `<div class="card plain-card"><span class="tick">${icon('check')}</span><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>`;

const processSteps = (steps) => `<ol class="process">${steps.map((p, i) => `
  <li><span class="step-no">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div></li>`).join('')}</ol>`;

const faqList = (faqs) => `<div class="faq">${faqs.map((f) => `
  <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;

const articleCard = (a) => `
<a class="card article-card" href="/insights/${esc(a.slug)}">
  <div class="article-cover${a.cover ? '' : ' is-empty'}">${a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : '<img src="/images/logo.png" alt="" loading="lazy">'}</div>
  <div class="article-body"><span class="tag">${esc(a.category)}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p>
  <span class="meta">${fmtDate(a.date)} · <span class="more">Read more ${icon('arrow')}</span></span></div>
</a>`;

function fmtDate(d) {
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const ctaBand = () => section(`
  <div class="cta-band">
    <div><h2>Have a sourcing requirement?</h2><p>Tell us what you need. Our team reviews every request and replies.</p></div>
    <div class="cta-actions"><a href="/request" class="btn btn-light">Request a Service</a><a href="/contact" class="btn btn-ghost-light">Talk to Us</a></div>
  </div>`);

const serviceOptions = (selected) => (content('services').services || [])
  .map((x) => `<option${x.title === selected ? ' selected' : ''}>${esc(x.title)}</option>`).join('') + '<option>Other</option>';

// ---------------------------------------------------------------- pages
const pages = {};

pages['/'] = (req) => {
  const site = content('site');
  const services = content('services').services || [];
  const articles = (content('insights').articles || []).slice(0, 3);
  const faqs = (content('faq').faqs || []).slice(0, 4);
  const clients = site.clients || [];
  const testimonials = site.testimonials || [];
  return layout(req, { description: site.intro, body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Sourcing &amp; Business Solutions</p>
      <h1>MONOHA SOURCING <span>INTERNATIONAL</span></h1>
      <p class="hero-tag">${esc(site.tagline)}</p>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions"><a href="/services" class="btn btn-primary">Explore Our Services</a><a href="/contact" class="btn btn-outline">Talk to Us</a></div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <canvas id="globe" width="520" height="520"></canvas>
    </div>
  </div>
</section>
<section class="trust"><div class="wrap"><ul>${(site.trust || []).map((t) => `<li>${icon('check')}${esc(t)}</li>`).join('')}</ul></div></section>

${section(`${heading('What We Do', 'Practical sourcing, handled professionally', site.description)}
  <div class="grid grid-3">${services.map(serviceCard).join('')}</div>
  <p class="center-link"><a href="/services" class="btn btn-outline">View all services</a></p>`)}

${section(`${heading('Why Monoha', 'A partner you can rely on', '', true)}${plainCards(site.why || [])}`, 'tint')}

${section(`${heading('Our Process', 'Seven clear steps, every time', 'Every requirement moves through the same structured path, so you always know what happens next.')}
  ${processSteps(site.process || [])}`)}

${section(`${heading('Solutions', 'Built around who you are', '', true)}
  <div class="grid grid-4">${(site.solutions || []).map((x) => `<div class="card solution-card"><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`).join('')}</div>`, 'tint')}

${clients.length ? section(`${heading('Trusted By', 'Our partners', '', true)}<div class="logos">${clients.map((l) => `<img src="${esc(l.logo)}" alt="${esc(l.name)}">`).join('')}</div>`) : ''}

${testimonials.length ? section(`${heading('Testimonials', 'What clients say', '', true)}<div class="grid grid-3">${testimonials.map((t) => `<figure class="card quote"><blockquote>“${esc(t.quote)}”</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.company ? `<span>${esc(t.company)}</span>` : ''}</figcaption></figure>`).join('')}</div>`) : ''}

${articles.length ? section(`${heading('Insights', 'Notes on sourcing and business')}<div class="grid grid-3">${articles.map(articleCard).join('')}</div>`) : ''}

${section(`<div class="split"><div>${heading('FAQ', 'Common questions')}<a href="/faq" class="btn btn-outline">All questions</a></div>${faqList(faqs)}</div>`, 'tint')}

${ctaBand()}` });
};

pages['/about'] = (req) => {
  const a = content('site').about || {};
  const leaders = a.leadership || [];
  return layout(req, { title: 'About', description: a.who, body: `
${pageHead('About Monoha', 'Who we are', a.who)}
${section(`<div class="split">
  <div><h2>Our story</h2><p class="prose">${esc(a.story)}</p></div>
  <div class="mv">
    <div class="card mv-card"><p class="eyebrow">Mission</p><p>${esc(a.mission)}</p></div>
    <div class="card mv-card"><p class="eyebrow">Vision</p><p>${esc(a.vision)}</p></div>
  </div></div>`)}
${section(`${heading('Our Values', 'What we hold ourselves to', '', true)}${plainCards(a.values || [])}`, 'tint')}
${section(`${heading('How We Work', 'A structured process', 'Every requirement moves through the same seven steps.')}${processSteps(content('site').process || [])}`)}
${section(`<div class="commit"><p class="eyebrow">Our Commitment</p><h2>${esc(a.commitment)}</h2></div>`, 'tint')}
${leaders.length ? section(`${heading('Leadership', 'The people behind Monoha', '', true)}<div class="grid grid-3">${leaders.map((l) => `<div class="card leader">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : ''}<h3>${esc(l.name)}</h3><p>${esc(l.role)}</p></div>`).join('')}</div>`) : ''}
${ctaBand()}` });
};

pages['/services'] = (req) => layout(req, { title: 'Services', body: `
${pageHead('Services', 'What we do', content('site').description)}
${section(`<div class="grid grid-3">${(content('services').services || []).map(serviceCard).join('')}</div>`)}
${ctaBand()}` });

pages['/solutions'] = (req) => {
  const site = content('site');
  return layout(req, { title: 'Solutions', body: `
${pageHead('Solutions', 'Support shaped around you', 'Whoever you are, the process stays structured and the communication stays clear.')}
${section(`<div class="grid grid-2">${(site.solutions || []).map((x) => `<div class="card solution-card big"><h2>${esc(x.title)}</h2><p>${esc(x.text)}</p><a class="more" href="/request">Discuss your requirement ${icon('arrow')}</a></div>`).join('')}</div>`)}
${ctaBand()}` });
};

pages['/process'] = (req) => layout(req, { title: 'Our Process', body: `
${pageHead('Our Process', 'From requirement to delivery', 'Seven steps, the same every time, so you always know where your requirement stands.')}
${section(processSteps(content('site').process || []))}
${ctaBand()}` });

pages['/work'] = (req) => {
  const projects = content('work').projects || [];
  const rows = [['Industry', 'industry'], ['Requirement', 'requirement'], ['Our Role', 'role'], ['Solution', 'solution'], ['Outcome', 'outcome']];
  return layout(req, { title: 'Our Work', body: `
${pageHead('Our Work', projects.length ? 'Selected projects' : 'Our work is growing', projects.length ? '' : 'We publish projects here only with our clients’ permission and only with results we can verify. Case studies are on their way.')}
${projects.length ? section(`<div class="grid grid-2">${projects.map((p) => `<article class="card project"><h2>${esc(p.name)}</h2><dl>${rows.filter(([, k]) => p[k]).map(([l, k]) => `<dt>${l}</dt><dd>${esc(p[k])}</dd>`).join('')}</dl></article>`).join('')}</div>`)
      : section(`<div class="empty"><p>Want to be one of our first case studies?</p><a href="/request" class="btn btn-primary">Start a project</a></div>`)}
${ctaBand()}` });
};

pages['/insights'] = (req) => {
  const articles = (content('insights').articles || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cats = ['Sourcing Insights', 'Business Tips', 'Market Insights', 'Industry Updates', 'Company News'];
  const pick = req.query.category;
  const list = pick ? articles.filter((a) => a.category === pick) : articles;
  return layout(req, { title: 'Insights', body: `
${pageHead('Insights', 'Sourcing and business insights', 'Practical notes from our work.')}
${section(`<nav class="chips" aria-label="Categories"><a href="/insights"${!pick ? ' class="is-active"' : ''}>All</a>${cats.map((c) => `<a href="/insights?category=${encodeURIComponent(c)}"${pick === c ? ' class="is-active"' : ''}>${esc(c)}</a>`).join('')}</nav>
  ${list.length ? `<div class="grid grid-3">${list.map(articleCard).join('')}</div>` : '<p class="empty">No articles in this category yet.</p>'}`)}` });
};

function articlePage(req, res) {
  const articles = content('insights').articles || [];
  const a = articles.find((x) => x.slug === req.params.slug);
  if (!a) return notFound(req, res);
  const body = (a.body || []).map((p) => (p.startsWith('## ') ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p)}</p>`)).join('');
  const url = `${SITE_URL}/insights/${a.slug}`;
  const related = articles.filter((x) => x.slug !== a.slug).slice(0, 3);
  res.send(layout(req, { title: a.title, description: a.summary, active: '/insights', body: `
<article class="article">
  <header class="page-head"><div class="wrap narrow">
    <p class="eyebrow"><a href="/insights">Insights</a> · ${esc(a.category)}</p>
    <h1>${esc(a.title)}</h1>
    <p class="meta">${esc(a.author || 'Monoha Team')} · <time datetime="${esc(a.date)}">${fmtDate(a.date)}</time></p>
  </div></header>
  ${a.cover ? `<div class="wrap narrow"><img class="article-hero" src="${esc(a.cover)}" alt=""></div>` : ''}
  <div class="wrap narrow prose article-text">${body}
    <div class="share"><span>Share</span>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">Facebook</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a>
      <button type="button" class="copy-link" data-url="${esc(url)}">Copy link</button>
    </div>
  </div>
</article>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: a.title, datePublished: a.date, author: { '@type': 'Organization', name: a.author || 'Monoha Team' }, description: a.summary }).replace(/</g, '\\u003c')}</script>
${related.length ? section(`${heading('Related', 'More insights')}<div class="grid grid-3">${related.map(articleCard).join('')}</div>`, 'tint') : ''}` }));
}

function servicePage(req, res) {
  const x = (content('services').services || []).find((s) => s.slug === req.params.slug);
  if (!x) return notFound(req, res);
  res.send(layout(req, { title: x.title, description: x.summary, active: '/services', body: `
${pageHead('Service', x.title, x.summary)}
${section(`<div class="split">
  <div class="prose">${(x.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}
    <a href="/request?service=${encodeURIComponent(x.title)}" class="btn btn-primary">Request this service</a></div>
  <div class="card"><h3>What it includes</h3><ul class="ticks">${(x.points || []).map((p) => `<li>${icon('check')}${esc(p)}</li>`).join('')}</ul></div>
</div>`)}
${section(`${heading('How we work', 'Our process')}${processSteps(content('site').process || [])}`, 'tint')}` }));
}

pages['/faq'] = (req) => layout(req, { title: 'FAQ', body: `
${pageHead('FAQ', 'Frequently asked questions', '')}
${section(`<div class="narrow-block">${faqList(content('faq').faqs || [])}</div>`)}
${ctaBand()}` });

pages['/careers'] = (req) => {
  const c = content('careers');
  const open = (c.jobs || []).filter((j) => j.open);
  return layout(req, { title: 'Careers', body: `
${pageHead('Careers', 'Build your career with Monoha', c.culture)}
${section(`${heading('Why work with us', 'What you can expect', '', true)}${plainCards(c.why || [])}`)}
${section(`${heading('Open positions', open.length ? 'Current openings' : 'No openings right now', open.length ? '' : 'We are not hiring for a specific role at the moment. You can still send your CV and we will keep it on file.')}
  ${open.length ? `<div class="jobs">${open.map((j) => `<a class="card job" href="/careers/${esc(j.slug)}"><div><h3>${esc(j.title)}</h3><p>${esc(j.type)} · ${esc(j.location)}</p></div><span class="more">View role ${icon('arrow')}</span></a>`).join('')}</div>` : '<a href="/contact?subject=Job%20application" class="btn btn-primary">Send your CV</a>'}`, 'tint')}
${section(`<div class="split"><div>${heading('Internship', 'Learning with us', c.internship)}</div>
  <div>${heading('Application process', 'How hiring works')}<ol class="mini-steps">${(c.process || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div></div>`)}` });
};

function jobPage(req, res) {
  const j = (content('careers').jobs || []).find((x) => x.slug === req.params.slug);
  if (!j) return notFound(req, res);
  const list = (t, items) => items && items.length ? `<h2>${t}</h2><ul class="ticks">${items.map((i) => `<li>${icon('check')}${esc(i)}</li>`).join('')}</ul>` : '';
  res.send(layout(req, { title: j.title, description: j.about, active: '/careers', body: `
${pageHead(j.open ? 'Careers' : 'Careers · position closed', j.title, j.about)}
${section(`<div class="split">
  <div class="prose">${list('Responsibilities', j.responsibilities)}${list('Requirements', j.requirements)}<h2>How to apply</h2><p>${esc(j.apply)}</p>
    ${j.open ? `<a href="/contact?subject=${encodeURIComponent('Application: ' + j.title)}" class="btn btn-primary">Apply now</a>` : ''}</div>
  <div class="card"><dl class="facts"><dt>Work type</dt><dd>${esc(j.type)}</dd><dt>Location</dt><dd>${esc(j.location)}</dd><dt>Compensation</dt><dd>${esc(j.compensation)}</dd></dl></div>
</div>`)}` }));
}

function formFields(kind, q) {
  const f = (id, label, type = 'text', req = false, extra = '') => `
    <div class="field"><label for="${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
    <input id="${id}" name="${id}" type="${type}"${req ? ' required' : ''}${extra}></div>`;
  if (kind === 'contact') return `
    <div class="row">${f('name', 'Full name', 'text', true, ' autocomplete="name"')}${f('company', 'Company name', 'text', false, ' autocomplete="organization"')}</div>
    <div class="row">${f('email', 'Email', 'email', true, ' autocomplete="email"')}${f('phone', 'Phone', 'tel', false, ' autocomplete="tel"')}</div>
    <div class="row">${f('subject', 'Subject', 'text', false, q.subject ? ` value="${esc(q.subject)}"` : '')}
      <div class="field"><label for="service">Service interested in</label><select id="service" name="service"><option value="">Choose one</option>${serviceOptions(q.service)}</select></div></div>
    <div class="field"><label for="message">Message <span class="req">*</span></label><textarea id="message" name="message" rows="6" required></textarea></div>`;
  return `
    <div class="row">${f('name', 'Name', 'text', true, ' autocomplete="name"')}${f('company', 'Company', 'text', false, ' autocomplete="organization"')}</div>
    <div class="row">${f('country', 'Country', 'text', false, ' autocomplete="country-name"')}${f('email', 'Email', 'email', true, ' autocomplete="email"')}</div>
    <div class="row">${f('phone', 'Phone', 'tel', false, ' autocomplete="tel"')}
      <div class="field"><label for="service">Service <span class="req">*</span></label><select id="service" name="service" required><option value="">Choose one</option>${serviceOptions(q.service)}</select></div></div>
    <div class="field"><label for="requirement">Requirement <span class="req">*</span></label><textarea id="requirement" name="requirement" rows="4" required placeholder="What do you need, and by when?"></textarea></div>
    ${f('budget', 'Estimated quantity / budget <span class="opt">if relevant</span>')}
    <div class="field"><label for="message">Anything else</label><textarea id="message" name="message" rows="3"></textarea></div>
    <div class="field"><label for="attachment">Attachment <span class="opt">optional · PDF, image or document, up to 5 MB</span></label><input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"></div>`;
}

const inquiryForm = (kind, q) => `
<form class="card form" data-kind="${kind}" novalidate>
  ${formFields(kind, q)}
  <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit" class="btn btn-primary">${kind === 'contact' ? 'Submit Inquiry' : 'Send Request'}</button>
  <p class="form-status" role="status" aria-live="polite"></p>
</form>
<div class="card form-done" hidden><span class="done-icon">${icon('check')}</span><h2>Thank you.</h2><p>Our team will review your inquiry and contact you.</p></div>`;

pages['/contact'] = (req) => {
  const c = content('site').contact || {};
  const rows = [['pin', 'Office address', c.address], ['mail', 'Email', c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`], ['phone', 'Phone', c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`], ['web', 'Website', c.website && esc(c.website)]]
    .filter((r) => r[2]);
  return layout(req, { title: 'Contact', body: `
${pageHead('Contact', 'Talk to us', 'Send us a message and our team will get back to you.')}
${section(`<div class="split contact-split">
  <div><h2>MONOHA SOURCING INTERNATIONAL</h2>
    ${rows.length ? `<ul class="contact-rows">${rows.map(([i, l, v]) => `<li>${icon(i)}<div><span>${l}</span>${i === 'pin' ? esc(v) : v}</div></li>`).join('')}</ul>` : '<p class="muted">Use the form and we will reply by email.</p>'}
    <p class="muted">Have a specific requirement? <a href="/request">Request a service</a> instead.</p></div>
  <div>${inquiryForm('contact', req.query)}</div>
</div>`)}` });
};

pages['/request'] = (req) => layout(req, { title: 'Request a Service', body: `
${pageHead('Request a Service', 'Tell us about your requirement', 'The more detail you share, the more useful our first reply will be.')}
${section(`<div class="narrow-block">${inquiryForm('request', req.query)}</div>`)}` });

const legal = {
  '/privacy-policy': ['Privacy Policy', [
    'This policy explains what information MONOHA SOURCING INTERNATIONAL collects through this website and how it is used.',
    '## What we collect', 'When you submit a form we receive what you type: your name, company, contact details and message, and any file you attach.',
    '## How we use it', 'Only to answer your enquiry and to provide the service you ask about. We do not sell your information.',
    '## How long we keep it', 'For as long as is needed to handle your enquiry and any work that follows, and as required by law.',
    '## Your choices', 'You can ask us to see, correct or delete your information by contacting us.',
    '## Contact', 'Questions about this policy can be sent through the Contact page.']],
  '/terms': ['Terms & Conditions', [
    'By using this website you agree to these terms.',
    '## Information on this site', 'We keep the content accurate and current, but it is general information and not a binding offer. Services are agreed separately in writing.',
    '## Enquiries', 'Sending an enquiry does not create a contract. Any engagement is confirmed separately.',
    '## Intellectual property', 'The MONOHA name, logo and site content belong to MONOHA SOURCING INTERNATIONAL.',
    '## Changes', 'We may update these terms; the current version is always on this page.']],
  '/cookie-policy': ['Cookie Policy', [
    'This website does not use advertising or tracking cookies.',
    '## What is stored', 'Your browser may store the fonts and files it needs to show the site faster. The site itself sets no cookies.',
    '## Third parties', 'Fonts are served by Google Fonts. Share buttons open Facebook or LinkedIn only when you choose to click them.']],
};
for (const [p, [t, paras]] of Object.entries(legal)) {
  pages[p] = (req) => layout(req, { title: t, body: `
${pageHead('Legal', t, '')}
${section(`<div class="prose narrow-block">${paras.map((x) => (x.startsWith('## ') ? `<h2>${esc(x.slice(3))}</h2>` : `<p>${esc(x)}</p>`)).join('')}</div>`)}` });
}

function notFound(req, res) {
  res.status(404).send(layout(req, { title: 'Page not found', body: `
${pageHead('404', 'Page not found', 'The page you were looking for is not here.')}
${section('<a href="/" class="btn btn-primary">Back to home</a>')}` }));
}

// ---------------------------------------------------------------- mail
let transport = null;
function mailer() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transport) transport = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, '') } });
  return transport;
}
async function sendMail(to, subject, html, attachments) {
  const t = mailer();
  if (!t) { console.warn(`[mail] Gmail is not configured — would have sent "${subject}" to ${to}`); return; }
  try { await t.sendMail({ from: `MONOHA SOURCING INTERNATIONAL <${GMAIL_USER}>`, to, subject, html, attachments }); }
  catch (e) { console.error('[mail]', e.message); }
}

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));

// Remove trailing slashes so each page has one address.
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    return res.redirect(301, req.path.slice(0, -1) + req.originalUrl.slice(req.path.length));
  }
  next();
});

for (const [p, fn] of Object.entries(pages)) app.get(p, (req, res) => res.send(fn(req)));
app.get('/services/:slug', servicePage);
app.get('/insights/:slug', articlePage);
app.get('/careers/:slug', jobPage);

app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = [...Object.keys(pages),
    ...(content('services').services || []).map((x) => '/services/' + x.slug),
    ...(content('insights').articles || []).map((x) => '/insights/' + x.slug),
    ...(content('careers').jobs || []).filter((j) => j.open).map((x) => '/careers/' + x.slug)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE_URL}${u === '/' ? '' : u}</loc></url>`).join('')}</urlset>`);
});

// Enquiries: saved to disk first, then emailed. A small attachment rides
// along as base64 so the form needs no upload library.
const recent = new Map();
app.post('/api/inquiry', express.json({ limit: '8mb' }), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // bots fill the hidden field

  const ip = req.ip;
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'Too many messages. Please try again in a few minutes.' });

  const t = (v, n) => String(v || '').trim().slice(0, n);
  const kind = b.kind === 'request' ? 'request' : 'contact';
  const entry = {
    id: 'INQ-' + now.toString(36).toUpperCase(), kind, at: new Date(now).toISOString(),
    name: t(b.name, 120), company: t(b.company, 160), country: t(b.country, 80), email: t(b.email, 160),
    phone: t(b.phone, 40), subject: t(b.subject, 200), service: t(b.service, 120),
    requirement: t(b.requirement, 4000), budget: t(b.budget, 200), message: t(b.message, 4000),
  };
  if (!entry.name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (kind === 'contact' && !entry.message) return res.status(400).json({ error: 'Please write a message.' });
  if (kind === 'request' && (!entry.service || !entry.requirement)) return res.status(400).json({ error: 'Please choose a service and describe your requirement.' });

  let attachment = null;
  if (b.attachment && b.attachment.data) {
    const buf = Buffer.from(String(b.attachment.data), 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'The attachment is larger than 5 MB.' });
    const name = t(b.attachment.name, 120).replace(/[^\w.\- ]/g, '_') || 'attachment';
    const dir = path.join(DATA_DIR, 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${entry.id}-${name}`;
    fs.writeFileSync(path.join(dir, stored), buf);
    entry.attachment = stored;
    attachment = { filename: name, content: buf };
  }

  hits.push(now); recent.set(ip, hits);
  const store = readJSON(INQUIRY_FILE, { inquiries: [] });
  store.inquiries.unshift(entry);
  fs.writeFileSync(INQUIRY_FILE, JSON.stringify(store, null, 2));
  res.json({ ok: true, id: entry.id });

  const site = content('site');
  const to = [GMAIL_USER, site.contact && site.contact.email].filter(Boolean);
  const rows = Object.entries({ Name: entry.name, Company: entry.company, Country: entry.country, Email: entry.email, Phone: entry.phone, Subject: entry.subject, Service: entry.service, Requirement: entry.requirement, 'Quantity / budget': entry.budget, Message: entry.message })
    .filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5B6B88;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
  for (const addr of new Set(to)) {
    sendMail(addr, `${kind === 'request' ? 'Service request' : 'New inquiry'} from ${entry.name} (${entry.id})`,
      `<div style="font-family:Arial,sans-serif;color:#0A1A3F"><h2 style="margin:0 0 12px">${kind === 'request' ? 'New service request' : 'New website inquiry'}</h2><table style="font-size:14px;border-collapse:collapse">${rows}</table></div>`,
      attachment ? [attachment] : undefined);
  }
});

app.use(notFound);

app.listen(PORT, () => console.log(`MONOHA site on ${SITE_URL}`));
