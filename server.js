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
// Mail goes out through the domain mailbox (Hostinger SMTP by default).
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.hostinger.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// ---------------------------------------------------------------- content
fs.mkdirSync(CONTENT_DIR, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'content'))) {
  const target = path.join(CONTENT_DIR, f);
  const seed = path.join(ROOT, 'content', f);
  // Refresh the volume copy when the seed file carries a newer _rev.
  const rev = (file) => { try { return Number(JSON.parse(fs.readFileSync(file, 'utf8'))._rev) || 0; } catch (e) { return 0; } };
  if (!fs.existsSync(target) || rev(seed) > rev(target)) fs.copyFileSync(seed, target);
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
  ].filter(Boolean).join('');

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
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE_URL}/images/logo.png">
<meta name="theme-color" content="#071A41">
<link rel="icon" href="/images/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css?v=3">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: SITE_URL, description: site.description,
    logo: SITE_URL + '/images/logo.png', ...(c.email ? { email: c.email } : {}), ...(c.phone ? { telephone: c.phone } : {}),
  }).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="header" id="header">
  <div class="wrap header-row">
    <a href="/" class="brand" aria-label="${esc(site.name)} — home">
      <img src="/images/logo.png" alt="" width="54" height="36">
      <span class="brand-text"><strong>MONOHA</strong><small>Sourcing International</small></span>
    </a>
    <nav class="nav" id="nav" aria-label="Main">${navLinks}
      <a href="/contact" class="btn btn-primary nav-cta-mobile">Get in Touch</a>
    </nav>
    <a href="/contact" class="btn btn-primary header-cta">Get in Touch</a>
    <button class="menu-btn" id="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer-top">
    <div class="footer-about">
      <a href="/" class="brand brand-light"><img src="/images/logo.png" alt="" width="58" height="40">
        <span class="brand-text"><strong>MONOHA</strong><small>Sourcing International</small></span></a>
      <p>${esc(site.description)}</p>
      ${contactLines ? `<ul class="contact-list">${contactLines}</ul>` : ''}
      ${socials ? `<div class="socials">${socials}</div>` : ''}
    </div>
    <div><h3>Company</h3><a href="/about">About</a><a href="/process">Our Process</a><a href="/work">Our Work</a><a href="/careers">Careers</a><a href="/contact">Contact</a></div>
    <div><h3>Services</h3>${services.slice(0, 5).map((x) => `<a href="/services/${esc(x.slug)}">${esc(x.title)}</a>`).join('')}</div>
    <div><h3>Solutions</h3>${(site.solutions || []).map((x) => `<a href="/solutions#${esc(slugify(x.title))}">${esc(x.title)}</a>`).join('')}</div>
    <div><h3>Resources</h3><a href="/insights">Insights</a><a href="/faq">FAQ</a><a href="/request">Request a Service</a></div>
    <div><h3>Legal</h3><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/cookie-policy">Cookie Policy</a></div>
  </div>
  <div class="wrap footer-base">
    <span><strong>MONOHA SOURCING INTERNATIONAL</strong> &nbsp;&copy; ${new Date().getFullYear()}. All rights reserved.</span>
    <a href="https://monohasourcing.international">monohasourcing.international</a>
  </div>
</footer>
<script src="/js/site.js?v=3" defer></script>
</body>
</html>`;
}

const slugify = (t) => String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
// Eyebrow and headline on the left, the explanation on the right.
const headSplit = (eyebrow, titleHtml, lead) =>
  `<div class="sec-split"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${titleHtml}</h2></div>${lead ? `<p class="lead">${esc(lead)}</p>` : '<span></span>'}</div>`;

const serviceCard = (x, i) => `
<a class="svc reveal" href="/services/${esc(x.slug)}">
  <span class="svc-no">${String(i + 1).padStart(2, '0')}</span>
  <h3>${esc(x.title)}</h3>
  <p>${esc(x.summary)}</p>
  <span class="link-arrow">Explore ${icon('arrow')}</span>
</a>`;
const serviceGrid = (list) => `<div class="svc-grid">${list.map(serviceCard).join('')}</div>`;

// Values and reasons: a titled line of text under a thin rule, not a card.
const plainCards = (items) =>
  `<div class="facets">${items.map((i) => `<div class="facet reveal"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>`;

const processSteps = (steps) => `<ol class="timeline">${steps.map((p, i) => `
  <li class="reveal"><span class="dot">${String(i + 1).padStart(2, '0')}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}</ol>`;

const faqList = (faqs) => `<div class="faq">${faqs.map((f) => `
  <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;

// Articles without a cover photo get drawn artwork: a network of points
// seeded from the slug, so each one differs but stays on-brand.
function coverArt(a) {
  if (a.cover) return `<div class="cover-art"><img src="${esc(a.cover)}" alt="" loading="lazy"><span class="cat">${esc(a.category)}</span></div>`;
  let seed = 0;
  for (const ch of String(a.slug)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pts = Array.from({ length: 9 }, () => [60 + rnd() * 500, 40 + rnd() * 260].map(Math.round));
  const lines = pts.slice(1).map((pt, i) => {
    const q = pts[Math.floor(rnd() * (i + 1))];
    return `<path d="M${q[0]} ${q[1]} Q ${Math.round((q[0] + pt[0]) / 2)} ${Math.min(q[1], pt[1]) - 60} ${pt[0]} ${pt[1]}"/>`;
  }).join('');
  const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i ? 3.5 : 6}" fill="${i ? '#fff' : '#00BFEF'}"/>`).join('');
  return `<div class="cover-art"><svg viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g fill="none" stroke="#fff" stroke-opacity=".08"><circle cx="470" cy="80" r="220"/><circle cx="470" cy="80" r="150"/><circle cx="470" cy="80" r="80"/></g>
    <g fill="none" stroke="#00BFEF" stroke-opacity=".6" stroke-width="1.4">${lines}</g>${dots}</svg><span class="cat">${esc(a.category)}</span></div>`;
}

const articleCard = (a) => `
<a class="article-card reveal" href="/insights/${esc(a.slug)}">
  ${coverArt(a)}
  <div class="article-body"><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p>
  <span class="meta">${fmtDate(a.date)}</span></div>
</a>`;
const featureCard = (a) => `
<a class="feature reveal" href="/insights/${esc(a.slug)}">
  ${coverArt(a)}
  <div class="feature-body"><span class="tag">Featured · ${esc(a.category)}</span><h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p>
  <span class="meta">${fmtDate(a.date)}</span><span class="link-arrow">Read article ${icon('arrow')}</span></div>
</a>`;

function fmtDate(d) {
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Faint orbits and connections behind the closing call to action.
const NET_SVG = `<svg class="net" viewBox="0 0 720 720" aria-hidden="true">
  <g fill="none" stroke="#fff" stroke-opacity=".1"><circle cx="360" cy="360" r="300"/><ellipse cx="360" cy="360" rx="300" ry="110"/><ellipse cx="360" cy="360" rx="110" ry="300"/><ellipse cx="360" cy="360" rx="300" ry="210"/></g>
  <g fill="none" stroke="#00BFEF" stroke-opacity=".45" stroke-width="1.5"><path d="M160 250 Q 300 120 470 210"/><path d="M470 210 Q 560 330 520 480"/><path d="M160 250 Q 200 430 330 520"/><path d="M330 520 Q 430 580 520 480"/></g>
  <g fill="#00BFEF"><circle cx="160" cy="250" r="6"/><circle cx="470" cy="210" r="6"/><circle cx="520" cy="480" r="6"/><circle cx="330" cy="520" r="6"/></g></svg>`;

const ctaBand = () => `
<section class="cta">
  ${NET_SVG}
  <div class="wrap reveal">
    <p class="eyebrow">Start a conversation</p>
    <h2>Let's build the right sourcing solution for your business.</h2>
    <p>Tell us what you need and our team will review your requirement.</p>
    <div class="cta-actions"><a href="/contact" class="btn btn-light">Get in Touch ${icon('arrow')}</a><a href="/request" class="btn btn-ghost-light">Request a Service</a></div>
  </div>
</section>`;

const SOL_ICONS = ['briefcase', 'box', 'clipboard', 'globe', 'network'];
const solutionRows = (sol) => `<div class="sol-list">${sol.map((x, i) => `
  <a class="sol reveal" id="${esc(slugify(x.title))}" href="/request?subject=${encodeURIComponent(x.title)}">
    <span class="sol-mark">${icon(SOL_ICONS[i % SOL_ICONS.length])}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p><span class="sol-go">${icon('arrow')}</span>
  </a>`).join('')}</div>`;

const serviceOptions = (selected) => (content('services').services || [])
  .map((x) => `<option${x.title === selected ? ' selected' : ''}>${esc(x.title)}</option>`).join('') + '<option>Other</option>';

// ---------------------------------------------------------------- pages
const pages = {};

// The home page's "what we do" diagram: one brief, several supplier
// options, one coordinated delivery.
const FLOW_SVG = `<svg viewBox="0 0 520 330" role="img" aria-label="One brief goes to several supplier options and comes back as one coordinated delivery">
  <defs><linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="#1455D9"/><stop offset="1" stop-color="#00BFEF"/></linearGradient></defs>
  <g fill="none" stroke="url(#fl)" stroke-width="2">
    <path d="M96 165 C 150 165 150 70 208 70"/><path d="M96 165 H 208"/><path d="M96 165 C 150 165 150 260 208 260"/>
    <path d="M312 70 C 370 70 370 165 416 165"/><path d="M312 165 H 416"/><path d="M312 260 C 370 260 370 165 416 165"/></g>
  <g font-family="Plus Jakarta Sans, Segoe UI, sans-serif" font-weight="700" text-anchor="middle">
    <rect x="12" y="135" width="84" height="60" rx="12" fill="#fff"/><text x="54" y="159" font-size="9.5" fill="#64748B" letter-spacing="1.5">YOUR</text><text x="54" y="178" font-size="14" fill="#071A41">Brief</text>
    <g fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".25"><rect x="208" y="44" width="104" height="52" rx="12"/><rect x="208" y="139" width="104" height="52" rx="12"/><rect x="208" y="234" width="104" height="52" rx="12"/></g>
    <g fill="#fff" font-size="12.5"><text x="260" y="75">Option A</text><text x="260" y="170">Option B</text><text x="260" y="265">Option C</text></g>
    <circle cx="462" cy="165" r="46" fill="#00BFEF"/><text x="462" y="160" font-size="9.5" fill="#071A41" letter-spacing="1.5">COORDINATED</text><text x="462" y="179" font-size="14" fill="#071A41">Delivery</text>
  </g></svg>`;

pages['/'] = (req) => {
  const site = content('site');
  const services = content('services').services || [];
  const articles = (content('insights').articles || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
  const faqs = (content('faq').faqs || []).slice(0, 5);
  const clients = site.clients || [];
  const testimonials = site.testimonials || [];
  return layout(req, { description: site.intro, body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Sourcing &amp; Business Solutions</p>
      <p class="hero-brand">MONOHA SOURCING INTERNATIONAL</p>
      <h1>Connecting global opportunities <span class="hl">through reliable sourcing &amp; business solutions</span></h1>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions"><a href="/services" class="btn btn-primary">Explore Our Services ${icon('arrow')}</a><a href="/contact" class="btn btn-outline">Get in Touch</a></div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <canvas id="globe" width="560" height="560"></canvas>
      <span class="globe-tag t1"><i></i>Global sourcing</span>
      <span class="globe-tag t2"><i></i>Coordinated delivery</span>
    </div>
  </div>
</section>
<section class="trust" aria-label="How we work"><div class="wrap"><ul>${(site.trust || []).map((t) => `<li>${icon('check')}${esc(t)}</li>`).join('')}</ul></div></section>

${section(`${headSplit('What We Do', 'Practical sourcing.<br>Handled professionally.', site.description)}
  <div class="wwd">
    <div class="wwd-copy reveal">
      <p>You bring the requirement. We find and compare suitable suppliers and partners, coordinate everyone involved, and follow the work through to delivery, with one point of contact from start to finish.</p>
      <ul><li>Sourcing<span>Products, suppliers, partners</span></li><li>Coordination<span>Communication across parties</span></li><li>Follow-through<span>Checked against your brief</span></li></ul>
    </div>
    <div class="flow-panel reveal">${FLOW_SVG}<div class="flow-caption"><span>One brief</span><b>Compared options</b><span>One result</span></div></div>
  </div>`)}

${section(`${headSplit('Services', 'How we support your business', 'Every service runs through the same structured process, so the standard holds whatever you need.')}
  ${serviceGrid(services)}`, 'soft')}

${section(`<div class="why">
  <div class="why-head reveal"><p class="eyebrow">Why Monoha</p><h2>Why businesses choose a structured approach</h2>
    <p class="lead">Informal sourcing costs time and money. A clear process keeps the requirement, the people and the deadline in view.</p>
    <a href="/about" class="btn btn-ghost-light">About Monoha ${icon('arrow')}</a></div>
  <div class="why-list">${(site.why || []).map((w) => `<div class="why-item reveal"><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></div>`).join('')}</div>
</div>`, 'dark')}

${section(`${headSplit('Our Process', 'How we work', 'Every requirement moves through the same seven steps, so you always know what happens next.')}
  ${processSteps(site.process || [])}`)}

${section(`${headSplit('Solutions', 'Solutions built around your requirements', 'The process stays the same. How we apply it depends on who you are and what you need.')}
  ${solutionRows(site.solutions || [])}`, 'gradient')}

${clients.length ? section(`${heading('Trusted By', 'Our partners', '', true)}<div class="logos">${clients.map((l) => `<img src="${esc(l.logo)}" alt="${esc(l.name)}">`).join('')}</div>`) : ''}

${testimonials.length ? section(`${heading('Testimonials', 'What clients say', '', true)}<div class="grid grid-3">${testimonials.map((t) => `<figure class="card quote"><blockquote>“${esc(t.quote)}”</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.company ? `<span>${esc(t.company)}</span>` : ''}</figcaption></figure>`).join('')}</div>`) : ''}

${articles.length ? section(`${headSplit('Insights', 'Notes on sourcing and business', '')}
  ${featureCard(articles[0])}${articles.length > 1 ? `<div class="grid grid-3">${articles.slice(1).map(articleCard).join('')}</div>` : ''}`) : ''}

${section(`<div class="faq-split"><div class="reveal"><p class="eyebrow">FAQ</p><h2>Common questions</h2><p class="lead">Short answers to what people ask before getting in touch.</p><a href="/faq" class="btn btn-outline">All questions ${icon('arrow')}</a></div>${faqList(faqs)}</div>`, 'soft')}

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
${section(`${heading('Our Values', 'What we hold ourselves to', '', true)}${plainCards(a.values || [])}`, 'soft')}
${section(`${heading('How We Work', 'A structured process', 'Every requirement moves through the same seven steps.')}${processSteps(content('site').process || [])}`)}
${section(`<div class="commit"><p class="eyebrow">Our Commitment</p><h2>${esc(a.commitment)}</h2></div>`, 'soft')}
${leaders.length ? section(`${heading('Leadership', 'The people behind Monoha', '', true)}<div class="grid grid-3">${leaders.map((l) => `<div class="card leader">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : ''}<h3>${esc(l.name)}</h3><p>${esc(l.role)}</p></div>`).join('')}</div>`) : ''}
${ctaBand()}` });
};

pages['/services'] = (req) => layout(req, { title: 'Services', body: `
${pageHead('Services', 'What we do', content('site').description)}
${section(serviceGrid(content('services').services || []))}
${ctaBand()}` });

pages['/solutions'] = (req) => {
  const site = content('site');
  return layout(req, { title: 'Solutions', body: `
${pageHead('Solutions', 'Solutions built around your requirements', 'Whoever you are, the process stays structured and the communication stays clear. Choose the one closest to you to start a request.')}
${section(solutionRows(site.solutions || []))}
${ctaBand()}` });
};

pages['/process'] = (req) => layout(req, { title: 'Our Process', body: `
${pageHead('Our Process', 'From requirement to delivery', 'Seven steps, the same every time, so you always know where your requirement stands.')}
${section(processSteps(content('site').process || []))}
${ctaBand()}` });

pages['/work'] = (req) => {
  const projects = content('work').projects || [];
  const rows = [['Challenge', 'challenge'], ['Approach', 'approach'], ['Outcome', 'outcome']];
  return layout(req, { title: 'Our Work', body: `
${pageHead('Our Work', projects.length ? 'Selected work' : 'Case studies, published with permission', projects.length ? 'Projects we can share publicly, with results we can verify.' : 'We publish a project only with our client’s permission and only with results we can verify.')}
${projects.length ? section(projects.map((p) => `<article class="case reveal"><div class="case-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}</div>
    <div class="case-body">${p.industry ? `<span class="tag">${esc(p.industry)}</span>` : ''}<h2>${esc(p.name)}</h2><dl>${rows.filter(([, k]) => p[k]).map(([l, k]) => `<div><dt>${l}</dt><dd>${esc(p[k])}</dd></div>`).join('')}</dl></div></article>`).join(''))
    : section(`<div class="work-ready">
  <div class="reveal"><p class="eyebrow">Coming soon</p><h2>Selected work will appear here</h2>
    <p class="lead">Case studies will be added as projects become available for public presentation. Each will set out the industry, the challenge, our approach and the verified outcome.</p>
    <div class="hero-actions"><a href="/request" class="btn btn-primary">Start a project ${icon('arrow')}</a><a href="/process" class="btn btn-outline">See how we work</a></div></div>
  <div class="case-frame reveal" aria-hidden="true"><span class="case-label">Case study</span>
    <div class="case-ghost"><div class="cover"></div><dl><dt>Industry</dt><dd></dd><dt>Challenge</dt><dd class="w2"></dd><dt>Approach</dt><dd></dd><dt>Outcome</dt><dd class="w3"></dd></dl></div>
  </div></div>`)}
${ctaBand()}` });
};

pages['/insights'] = (req) => {
  const articles = (content('insights').articles || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cats = ['Sourcing', 'Business', 'International Trade', 'Market Insights', 'Operations', 'Company Updates'];
  const pick = req.query.category;
  const list = pick ? articles.filter((a) => a.category === pick) : articles;
  return layout(req, { title: 'Insights', body: `
${pageHead('Insights', 'Sourcing and business insights', 'Practical notes on sourcing, trade and operations from the Monoha team.')}
${section(`<nav class="chips" aria-label="Categories"><a href="/insights"${!pick ? ' class="is-active"' : ''}>All</a>${cats.map((c) => `<a href="/insights?category=${encodeURIComponent(c)}"${pick === c ? ' class="is-active"' : ''}>${esc(c)}</a>`).join('')}</nav>
  ${list.length ? featureCard(list[0]) + (list.length > 1 ? `<div class="grid grid-3">${list.slice(1).map(articleCard).join('')}</div>` : '') : '<p class="empty">No articles in this category yet.</p>'}`)}
${ctaBand()}` });
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
${related.length ? section(`${heading('Related', 'More insights')}<div class="grid grid-3">${related.map(articleCard).join('')}</div>`, 'soft') : ''}` }));
}

function servicePage(req, res) {
  const x = (content('services').services || []).find((s) => s.slug === req.params.slug);
  if (!x) return notFound(req, res);
  res.send(layout(req, { title: x.title, description: x.summary, active: '/services', body: `
${pageHead('Service', x.title, x.summary)}
${section(`<div class="split">
  <div class="prose">${(x.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}
    <a href="/request?service=${encodeURIComponent(x.title)}" class="btn btn-primary">Request this service</a></div>
  <div class="card detail-aside"><h3>What it includes</h3><ul class="ticks">${(x.points || []).map((p) => `<li>${icon('check')}${esc(p)}</li>`).join('')}</ul></div>
</div>`)}
${section(`${heading('How we work', 'Our process')}${processSteps(content('site').process || [])}`, 'soft')}
${ctaBand()}` }));
}

pages['/faq'] = (req) => layout(req, { title: 'FAQ', body: `
${pageHead('FAQ', 'Frequently asked questions', '')}
${section(`<div class="faq-split"><div><p class="eyebrow">Answers</p><h2>Before you get in touch</h2><p class="lead">Can't find what you need? <a href="/contact">Ask us directly</a>.</p></div>${faqList(content('faq').faqs || [])}</div>`)}
${ctaBand()}` });

pages['/careers'] = (req) => {
  const c = content('careers');
  const open = (c.jobs || []).filter((j) => j.open);
  return layout(req, { title: 'Careers', body: `
${pageHead('Careers', 'Build your career with Monoha', c.culture)}
${section(`${heading('Why work with us', 'What you can expect', '', true)}${plainCards(c.why || [])}`)}
${section(`${heading('Open positions', open.length ? 'Current openings' : 'No openings right now', open.length ? '' : 'We are not hiring for a specific role at the moment. You can still send your CV and we will keep it on file.')}
  ${open.length ? `<div class="jobs">${open.map((j) => `<a class="card job" href="/careers/${esc(j.slug)}"><div><h3>${esc(j.title)}</h3><p>${esc(j.type)} · ${esc(j.location)}</p></div><span class="more">View role ${icon('arrow')}</span></a>`).join('')}</div>` : '<a href="/contact?subject=Job%20application" class="btn btn-primary">Send your CV</a>'}`, 'soft')}
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
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!transport) transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return transport;
}
async function sendMail(to, subject, html, attachments) {
  const t = mailer();
  if (!t) { console.warn(`[mail] SMTP is not configured — would have sent "${subject}" to ${to}`); return; }
  try { await t.sendMail({ from: `MONOHA SOURCING INTERNATIONAL <${SMTP_USER}>`, to, subject, html, attachments }); }
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
  const to = [SMTP_USER, site.contact && site.contact.email].filter(Boolean);
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
