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

function layout(req, { title, description, body, active, jsonld = '', ogType = 'website', noindex = false }) {
  const site = content('site');
  const services = (content('services').services || []);
  const c = site.contact || {};
  const s = site.social || {};
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} — Business, Digital & Sourcing Solutions`;
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
${noindex ? '<meta name="robots" content="noindex">' : ''}<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE_URL}/images/logo.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE_URL}/images/logo.png">
<meta name="theme-color" content="#071A41">
<link rel="icon" href="/images/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css?v=6">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: SITE_URL, description: site.description,
    logo: SITE_URL + '/images/logo.png', ...(c.email ? { email: c.email } : {}), ...(c.phone ? { telephone: c.phone } : {}),
  }).replace(/</g, '\\u003c')}</script>
${jsonld}
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
    <div><h3>Resources</h3><a href="/insights">Insights</a><a href="/faq">FAQ</a><a href="/request-service">Request a Service</a></div>
    <div><h3>Legal</h3><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/cookie-policy">Cookie Policy</a></div>
  </div>
  <div class="wrap footer-base">
    <span><strong>MONOHA SOURCING INTERNATIONAL</strong> &nbsp;&copy; ${new Date().getFullYear()}. All rights reserved.</span>
    <a href="https://monohasourcing.international">monohasourcing.international</a>
  </div>
</footer>
<script src="/js/site.js?v=6" defer></script>
</body>
</html>`;
}

const slugify = (t) => String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o }).replace(/</g, '\\u003c')}</script>`;
const pad2 = (i) => String(i + 1).padStart(2, '0');

// ---------------------------------------------------------------- hero art
// Each inner page gets its own small drawing in the network language of
// the home page: navy ground, faint orbits, cyan links, white nodes.
const ART_FONT = 'font-family="Plus Jakarta Sans, Segoe UI, sans-serif" font-weight="700"';
function art(kind) {
  const orbit = '<g fill="none" stroke="#fff" stroke-opacity=".09"><circle cx="210" cy="180" r="170"/><circle cx="210" cy="180" r="118"/><circle cx="210" cy="180" r="66"/></g>';
  const curve = ([x1, y1], [x2, y2], bend = 40) => `<path d="M${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - bend} ${x2} ${y2}"/>`;
  const node = ([x, y], r = 5, fill = '#fff') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  const links = (pairs, bend) => `<g fill="none" stroke="#00BFEF" stroke-opacity=".7" stroke-width="1.5">${pairs.map(([a, b]) => curve(a, b, bend)).join('')}</g>`;
  let g = '';
  if (kind === 'about') {
    const c = [210, 180];
    const ring = Array.from({ length: 6 }, (_, i) => [Math.round(210 + Math.cos(i * 1.047 - 1.57) * 118), Math.round(180 + Math.sin(i * 1.047 - 1.57) * 118)]);
    g = orbit + links(ring.map((p) => [c, p]), 0) + ring.map((p) => node(p, 6)).join('') + node(c, 26, '#00BFEF') + `<text x="210" y="187" text-anchor="middle" font-size="20" fill="#071A41" ${ART_FONT}>M</text>`;
  } else if (kind === 'services') {
    const pts = [[90, 110], [210, 80], [330, 110], [90, 250], [210, 280], [330, 250]];
    g = orbit + links([[pts[0], pts[1]], [pts[1], pts[2]], [pts[3], pts[4]], [pts[4], pts[5]], [pts[0], pts[3]], [pts[2], pts[5]], [pts[1], pts[4]]], 10)
      + pts.map((p, i) => `<g><circle cx="${p[0]}" cy="${p[1]}" r="22" fill="#0D2656" stroke="#fff" stroke-opacity=".3"/><text x="${p[0]}" y="${p[1] + 5}" text-anchor="middle" font-size="13" fill="#fff" ${ART_FONT}>${pad2(i)}</text></g>`).join('');
  } else if (kind === 'solutions') {
    const from = [70, 180];
    const to = [60, 120, 180, 240, 300].map((y) => [350, y]);
    g = orbit + `<g fill="none" stroke="#00BFEF" stroke-opacity=".7" stroke-width="1.5">${to.map(([x, y]) => `<path d="M70 180 C 200 180 220 ${y} ${x} ${y}"/>`).join('')}</g>`
      + node(from, 16, '#00BFEF') + to.map((p) => node(p, 7)).join('');
  } else if (kind === 'process') {
    const pts = Array.from({ length: 7 }, (_, i) => [40 + i * 57, Math.round(200 - Math.sin(i * 0.9) * 70)]);
    g = orbit + `<path d="M${pts.map((p) => p.join(' ')).join(' L')}" fill="none" stroke="#00BFEF" stroke-opacity=".7" stroke-width="1.5"/>`
      + pts.map((p, i) => `<g><circle cx="${p[0]}" cy="${p[1]}" r="16" fill="${i === 6 ? '#00BFEF' : '#0D2656'}" stroke="#fff" stroke-opacity=".35"/><text x="${p[0]}" y="${p[1] + 4}" text-anchor="middle" font-size="11" fill="${i === 6 ? '#071A41' : '#fff'}" ${ART_FONT}>${pad2(i)}</text></g>`).join('');
  } else if (kind === 'work') {
    g = orbit + '<g fill="#fff" fill-opacity=".05" stroke="#fff" stroke-opacity=".3" stroke-dasharray="5 6"><rect x="120" y="60" width="220" height="150" rx="14"/><rect x="95" y="95" width="220" height="150" rx="14"/></g>'
      + '<rect x="70" y="130" width="220" height="150" rx="14" fill="#0D2656" stroke="#00BFEF" stroke-opacity=".6"/><rect x="90" y="150" width="180" height="56" rx="8" fill="#1455D9" fill-opacity=".5"/>'
      + '<g fill="#fff" fill-opacity=".25"><rect x="90" y="222" width="120" height="8" rx="4"/><rect x="90" y="242" width="160" height="8" rx="4"/><rect x="90" y="262" width="90" height="8" rx="4"/></g>';
  } else if (kind === 'insights') {
    g = orbit + '<rect x="110" y="50" width="200" height="260" rx="14" fill="#0D2656" stroke="#fff" stroke-opacity=".25"/>'
      + '<g fill="#fff" fill-opacity=".22">' + [90, 110, 130, 170, 190, 210, 230, 250, 270].map((y, i) => `<rect x="134" y="${y}" width="${[150, 120, 90, 150, 140, 150, 110, 150, 80][i]}" height="${i < 3 ? 10 : 6}" rx="3"/>`).join('') + '</g>'
      + links([[[310, 90], [380, 150]], [[380, 150], [340, 260]]], 20) + node([310, 90], 6, '#00BFEF') + node([380, 150], 5) + node([340, 260], 5);
  } else if (kind === 'careers') {
    const pts = [[70, 290], [150, 230], [230, 170], [310, 110], [370, 60]];
    g = orbit + `<path d="M70 290 H150 V230 H230 V170 H310 V110 H370" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.5"/>`
      + links(pts.slice(1).map((p, i) => [pts[i], p]), 30) + pts.map((p, i) => node(p, i === 4 ? 10 : 6, i === 4 ? '#00BFEF' : '#fff')).join('');
  } else if (kind === 'contact') {
    g = orbit + '<g fill="none" stroke="#00BFEF" stroke-opacity=".5"><ellipse cx="210" cy="270" rx="90" ry="22"/><ellipse cx="210" cy="270" rx="46" ry="11"/></g>'
      + '<path d="M210 268 C 150 200 150 180 150 150 a60 60 0 0 1 120 0 c0 30 0 50 -60 118z" fill="#1455D9" stroke="#fff" stroke-opacity=".35"/><circle cx="210" cy="150" r="20" fill="#00BFEF"/>'
      + links([[[60, 110], [150, 150]], [[270, 150], [370, 90]]], 30) + node([60, 110], 5) + node([370, 90], 5);
  } else if (kind === 'request') {
    g = orbit + '<rect x="90" y="60" width="200" height="240" rx="16" fill="#0D2656" stroke="#fff" stroke-opacity=".25"/>'
      + [100, 150, 200].map((y) => `<rect x="112" y="${y}" width="156" height="30" rx="7" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".2"/>`).join('')
      + '<rect x="112" y="250" width="100" height="30" rx="7" fill="#00BFEF"/>' + links([[[290, 180], [370, 120]]], 20) + node([370, 120], 8, '#00BFEF');
  } else {
    g = orbit + links([[[80, 220], [210, 120]], [[210, 120], [340, 200]]], 40) + node([80, 220], 6) + node([210, 120], 9, '#00BFEF') + node([340, 200], 6);
  }
  return `<svg viewBox="0 0 420 360" aria-hidden="true" focusable="false">${g}</svg>`;
}

// ---------------------------------------------------------------- page hero
// The shared opening for every inner page: breadcrumb, eyebrow, title,
// lead, optional actions, and that page's drawing on the right.
function pageHero({ eyebrow, title, lead, crumbs = [], artKind, actions = '', cls = '' }) {
  const trail = [['/', 'Home'], ...crumbs];
  return `
<section class="phero ${cls}">
  <div class="wrap phero-grid">
    <div class="phero-copy">
      ${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail.map(([h, l], i) => (i === trail.length - 1
        ? `<li><span aria-current="page">${esc(l)}</span></li>` : `<li><a href="${h}">${esc(l)}</a></li>`)).join('')}</ol></nav>` : ''}
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1>${esc(title)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
      ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
    </div>
    ${artKind ? `<div class="phero-art">${art(artKind)}</div>` : ''}
  </div>
</section>
${crumbs.length ? ld({ '@type': 'BreadcrumbList', itemListElement: trail.map(([h, l], i) => ({ '@type': 'ListItem', position: i + 1, name: l, item: SITE_URL + (h === '/' ? '' : h) })) }) : ''}`;
}
// Kept for the few simple pages (404) that need no drawing.
const pageHead = (eyebrow, title, lead) => pageHero({ eyebrow, title, lead });

const section = (inner, cls = '', id = '') => `<section class="section ${cls}"${id ? ` id="${id}"` : ''}><div class="wrap">${inner}</div></section>`;
const heading = (eyebrow, title, lead, center) =>
  `<div class="sec-head${center ? ' center' : ''}"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;
// Eyebrow and headline on the left, the explanation on the right.
const headSplit = (eyebrow, titleHtml, lead) =>
  `<div class="sec-split"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${titleHtml}</h2></div>${lead ? `<p class="lead">${esc(lead)}</p>` : '<span></span>'}</div>`;

const serviceCard = (x, i) => `
<a class="svc reveal" href="/services/${esc(x.slug)}">
  <span class="svc-no">${pad2(i)}</span>
  <h3>${esc(x.title)}</h3>
  <p>${esc(x.summary)}</p>
  <span class="link-arrow">Explore ${icon('arrow')}</span>
</a>`;
const serviceGrid = (list) => `<div class="svc-grid">${list.map(serviceCard).join('')}</div>`;

// Values and reasons: a titled line of text under a thin rule, not a card.
const plainCards = (items) =>
  `<div class="facets">${items.map((i) => `<div class="facet reveal"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>`;

const processSteps = (steps) => `<ol class="timeline">${steps.map((p, i) => `
  <li class="reveal"><span class="dot">${pad2(i)}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}</ol>`;

const faqList = (faqs) => `<div class="faq">${faqs.map((f) => `
  <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;
const faqLd = (faqs) => (faqs.length ? ld({ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }) : '');

const ticks = (items) => `<ul class="ticks">${(items || []).map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>`;

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
  <div class="article-body"><span class="tag">${esc(a.category)}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p>
  <span class="meta"><time datetime="${esc(a.date)}">${fmtDate(a.date)}</time><span class="link-arrow">Read article ${icon('arrow')}</span></span></div>
</a>`;
const featureCard = (a) => `
<a class="feature reveal" href="/insights/${esc(a.slug)}">
  ${coverArt(a)}
  <div class="feature-body"><span class="tag">Featured · ${esc(a.category)}</span><h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p>
  <span class="meta"><time datetime="${esc(a.date)}">${fmtDate(a.date)}</time></span><span class="link-arrow">Read article ${icon('arrow')}</span></div>
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

const ctaBand = (o = {}) => `
<section class="cta">
  ${NET_SVG}
  <div class="wrap reveal">
    <p class="eyebrow">${esc(o.eyebrow || 'Start a conversation')}</p>
    <h2>${esc(o.title || "Let's find the right solution for your requirement.")}</h2>
    <p>${esc(o.text || 'Tell us what you need and our team will review your requirement.')}</p>
    <div class="cta-actions">${o.actions || `<a href="/contact" class="btn btn-light">Get in Touch ${icon('arrow')}</a><a href="/request-service" class="btn btn-ghost-light">Request a Service</a>`}</div>
  </div>
</section>`;
const requestCta = (title, text) => ctaBand({ eyebrow: 'Next step', title, text, actions: `<a href="/request-service" class="btn btn-light">Request a Service ${icon('arrow')}</a><a href="/contact" class="btn btn-ghost-light">Get in Touch</a>` });

const SOL_ICONS = ['briefcase', 'box', 'clipboard', 'globe', 'network'];
const solutionRows = (sol) => `<div class="sol-list">${sol.map((x, i) => `
  <a class="sol reveal" href="/solutions#${esc(slugify(x.title))}">
    <span class="sol-mark">${icon(SOL_ICONS[i % SOL_ICONS.length])}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p><span class="sol-go">${icon('arrow')}</span>
  </a>`).join('')}</div>`;

// The seven steps as one line of words, for places that only need the shape.
const chain = (steps) => `<ol class="chain">${steps.map((s, i) => `<li><span>${pad2(i)}</span>${esc(s)}</li>`).join('')}</ol>`;

const serviceOptions = (selected) => (content('services').services || [])
  .map((x) => `<option${x.title === selected ? ' selected' : ''}>${esc(x.title)}</option>`).join('') + `<option${/^other/i.test(selected || '') ? ' selected' : ''}>Other / Custom Requirement</option>`;

// ---------------------------------------------------------------- pages
const pages = {};

// The home page's "what we do" diagram: one brief, several supplier
// options, one coordinated delivery.
const FLOW_SVG = `<svg viewBox="0 0 520 330" role="img" aria-label="One requirement is matched with research, the right expertise and execution, and comes back as one delivered solution">
  <defs><linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="#1455D9"/><stop offset="1" stop-color="#00BFEF"/></linearGradient></defs>
  <g fill="none" stroke="url(#fl)" stroke-width="2">
    <path d="M96 165 C 150 165 150 70 208 70"/><path d="M96 165 H 208"/><path d="M96 165 C 150 165 150 260 208 260"/>
    <path d="M312 70 C 370 70 370 165 416 165"/><path d="M312 165 H 416"/><path d="M312 260 C 370 260 370 165 416 165"/></g>
  <g font-family="Plus Jakarta Sans, Segoe UI, sans-serif" font-weight="700" text-anchor="middle">
    <rect x="12" y="135" width="84" height="60" rx="12" fill="#fff"/><text x="54" y="159" font-size="9.5" fill="#64748B" letter-spacing="1.5">YOUR</text><text x="54" y="178" font-size="14" fill="#071A41">Need</text>
    <g fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".25"><rect x="208" y="44" width="104" height="52" rx="12"/><rect x="208" y="139" width="104" height="52" rx="12"/><rect x="208" y="234" width="104" height="52" rx="12"/></g>
    <g fill="#fff" font-size="12.5"><text x="260" y="75">Research</text><text x="260" y="170">Expertise</text><text x="260" y="265">Execution</text></g>
    <circle cx="462" cy="165" r="46" fill="#00BFEF"/><text x="462" y="160" font-size="9.5" fill="#071A41" letter-spacing="1.5">PRACTICAL</text><text x="462" y="179" font-size="14" fill="#071A41">Solution</text>
  </g></svg>`;

const sortedArticles = () => (content('insights').articles || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

pages['/'] = (req) => {
  const site = content('site');
  const services = content('services').services || [];
  const articles = sortedArticles().slice(0, 4);
  const faqs = (content('faq').faqs || []).slice(0, 5);
  const clients = site.clients || [];
  const testimonials = site.testimonials || [];
  return layout(req, { description: site.intro, jsonld: ld({ '@type': 'WebSite', name: site.name, url: SITE_URL }), body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Business, Digital &amp; Sourcing Solutions</p>
      <p class="hero-brand">MONOHA SOURCING INTERNATIONAL</p>
      <h1>Connecting business requirements <span class="hl">with practical solutions</span></h1>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions"><a href="/services" class="btn btn-primary">Explore Our Services ${icon('arrow')}</a><a href="/contact" class="btn btn-outline">Get in Touch</a></div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <canvas id="globe" width="560" height="560"></canvas>
      <span class="globe-tag t1"><i></i>Business &amp; sourcing</span>
      <span class="globe-tag t2"><i></i>Digital &amp; online</span>
    </div>
  </div>
</section>
<section class="trust" aria-label="How we work"><div class="wrap"><ul>${(site.trust || []).map((t) => `<li>${icon('check')}${esc(t)}</li>`).join('')}</ul></div></section>

${section(`${headSplit('What We Do', 'Many requirements.<br>One professional partner.', 'A business may need a supplier found, a website built and content produced, often at the same time. We understand each requirement and bring the right expertise to it.')}
  <div class="wwd">
    <div class="wwd-copy reveal">
      <ol class="areas">${(site.areas || []).map((x, i) => `<li><a href="${esc(x.href)}"><span class="areas-no">${pad2(i)}</span><span class="areas-t">${esc(x.title)}</span><span class="areas-d">${esc(x.text)}</span></a></li>`).join('')}</ol>
    </div>
    <div class="flow-panel reveal">${FLOW_SVG}<div class="flow-caption"><span>One requirement</span><b>The right expertise</b><span>One result</span></div></div>
  </div>`)}

${section(`${headSplit('Services', 'How we support your business', 'Broad areas of work rather than a fixed list, each run through the same structured process.')}
  ${serviceGrid(services)}`, 'soft')}

${section(`<div class="why">
  <div class="why-head reveal"><p class="eyebrow">Why Monoha</p><h2>Why businesses choose a structured approach</h2>
    <p class="lead">Different requirements need different skills. A clear process and the right people keep each one on track.</p>
    <a href="/about" class="btn btn-ghost-light">About Monoha ${icon('arrow')}</a></div>
  <div class="why-list">${(site.why || []).map((w) => `<div class="why-item reveal"><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></div>`).join('')}</div>
</div>`, 'dark')}

${section(`${headSplit('Our Process', 'How we work', 'Every requirement moves through the same seven steps, so you always know what happens next.')}
  ${processSteps(site.process || [])}
  <p class="center-link"><a href="/process" class="link-arrow">See each step in detail ${icon('arrow')}</a></p>`)}

${section(`${headSplit('Solutions', 'Solutions built around your requirements', 'The process stays the same. How we apply it depends on who you are and what you need.')}
  ${solutionRows(site.solutions || [])}`, 'gradient')}

${clients.length ? section(`${heading('Trusted By', 'Our partners', '', true)}<div class="logos">${clients.map((l) => `<img src="${esc(l.logo)}" alt="${esc(l.name)}" loading="lazy">`).join('')}</div>`) : ''}

${testimonials.length ? section(`${heading('Testimonials', 'What clients say', '', true)}<div class="grid grid-3">${testimonials.map((t) => `<figure class="card quote"><blockquote>“${esc(t.quote)}”</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.company ? `<span>${esc(t.company)}</span>` : ''}</figcaption></figure>`).join('')}</div>`) : ''}

${articles.length ? section(`${headSplit('Insights', 'Notes on business, sourcing and digital work', '')}
  ${featureCard(articles[0])}${articles.length > 1 ? `<div class="grid grid-3">${articles.slice(1).map(articleCard).join('')}</div>` : ''}
  <p class="center-link"><a href="/insights" class="link-arrow">All insights ${icon('arrow')}</a></p>`) : ''}

${section(`<div class="faq-split"><div class="reveal"><p class="eyebrow">FAQ</p><h2>Common questions</h2><p class="lead">Short answers to what people ask before getting in touch.</p><a href="/faq" class="btn btn-outline">All questions ${icon('arrow')}</a></div>${faqList(faqs)}</div>`, 'soft')}

${ctaBand()}` });
};

// ---------------------------------------------------------------- about
pages['/about'] = (req) => {
  const site = content('site');
  const a = site.about || {};
  const leaders = a.leadership || [];
  return layout(req, { title: 'About', description: 'Who MONOHA SOURCING INTERNATIONAL is: a business-focused organisation supporting companies with business, sourcing, digital and online requirements.', body: `
${pageHero({ eyebrow: 'About Monoha', title: 'Built around practical requirements and reliable execution.', lead: a.who, crumbs: [['/about', 'About']], artKind: 'about' })}

${section(`<div class="who">
  <div class="reveal"><p class="eyebrow">Who we are</p><h2>A business-focused organisation, built around the requirement.</h2></div>
  <div class="reveal"><p class="lead">${esc(a.story)}</p><p>${esc(a.whoMore)}</p>
    <dl class="glance"><div><dt>Company</dt><dd>${esc(site.name)}</dd></div><div><dt>Focus</dt><dd>Business, sourcing and digital solutions</dd></div><div><dt>Website</dt><dd>monohasourcing.international</dd></div></dl></div>
</div>`)}

${section(`${headSplit('Our Approach', 'From requirement to delivery, in order.', a.approach)}
  ${chain((site.process || []).map((p) => p.title))}`, 'dark')}

${section(`<div class="mv2">
  <div class="mv2-item reveal"><p class="eyebrow">Mission</p><p class="mv2-text">${esc(a.mission)}</p></div>
  <div class="mv2-item reveal"><p class="eyebrow">Vision</p><p class="mv2-text">${esc(a.vision)}</p></div>
</div>`, 'soft')}

${section(`${headSplit('Values', 'What we hold ourselves to', 'Six working principles. They describe how we intend to behave on every requirement, large or small.')}
  ${plainCards(a.values || [])}`)}

${section(`<div class="wwd">
  <div class="wwd-copy reveal"><p class="eyebrow">Specialist-led work</p><h2>${esc((site.expertise || {}).title)}</h2>
    <p>${esc((site.expertise || {}).text)}</p>
    <a href="/process" class="btn btn-outline">See how the work is run ${icon('arrow')}</a></div>
  <div class="expertise reveal" aria-label="Areas of expertise"><ul>${((site.expertise || {}).areas || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>Coordinated through one point of contact</p></div>
</div>`, 'soft')}

${leaders.length ? section(`${heading('Leadership', 'The people behind Monoha', '', true)}<div class="grid grid-3">${leaders.map((l) => `<div class="card leader">${l.photo ? `<img src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy">` : ''}<h3>${esc(l.name)}</h3><p>${esc(l.role)}</p></div>`).join('')}</div>`) : ''}

${requestCta('Have a business requirement?', 'Describe what you need. Our team will review it and reply with next steps.')}` });
};

// ---------------------------------------------------------------- services
pages['/services'] = (req) => {
  const services = content('services').services || [];
  return layout(req, { title: 'Services', description: 'How MONOHA SOURCING INTERNATIONAL supports businesses: business and sourcing, social and digital presence, websites, marketing and growth support, and requirement-based business solutions.', body: `
${pageHero({ eyebrow: 'Services', title: 'Capabilities built around real business requirements.', lead: 'Broad areas of work, not a fixed list. Choose the one closest to your need, or describe your requirement and we will identify what it needs.', crumbs: [['/services', 'Services']], artKind: 'services' })}

${section(`<div class="svc-list">${services.map((x, i) => `
  <article class="svc-row reveal" id="${esc(x.slug)}">
    <span class="svc-row-no">${pad2(i)}</span>
    <div class="svc-row-main"><h2><a href="/services/${esc(x.slug)}">${esc(x.title)}</a></h2><p>${esc(x.summary)}</p></div>
    <div class="svc-row-areas"><p class="mini-label">Capabilities may include</p><ul class="pills">${(x.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
    <a class="btn btn-outline svc-row-go" href="/services/${esc(x.slug)}" aria-label="Explore ${esc(x.title)}">Explore ${icon('arrow')}</a>
  </article>`).join('')}</div>`)}

${section(`${headSplit('One process', 'Every requirement runs the same seven steps.', 'Whatever the work, the requirement is written down, researched, planned, reviewed and supported after delivery.')}
  ${chain((content('site').process || []).map((p) => p.title))}
  <p class="center-link"><a href="/process" class="link-arrow link-light">How each step works ${icon('arrow')}</a></p>`, 'dark')}

${section(`<div class="longterm">
  <div class="reveal"><p class="eyebrow">Long-term support</p><h2>${esc((content('site').longTerm || {}).title)}</h2><p class="lead">${esc((content('site').longTerm || {}).text)}</p></div>
  <div class="reveal"><p class="mini-label">Ongoing work may include</p><ul class="pills">${((content('site').longTerm || {}).items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
</div>`, 'soft')}

${requestCta('Not sure which service fits?', 'Describe the requirement in your own words. We will review it and recommend the right starting point.')}` });
};

function servicePage(req, res) {
  const all = content('services').services || [];
  const i = all.findIndex((s) => s.slug === req.params.slug);
  if (i < 0) return notFound(req, res);
  const x = all[i];
  const others = all.filter((s) => s.slug !== x.slug);
  const faqs = x.faqs || [];
  res.send(layout(req, { title: x.title, description: x.summary, active: '/services', body: `
${pageHero({ eyebrow: `Service ${pad2(i)}`, title: x.title, lead: x.summary, crumbs: [['/services', 'Services'], [`/services/${x.slug}`, x.title]], artKind: 'services',
    actions: `<a href="/request-service?service=${encodeURIComponent(x.title)}" class="btn btn-light">Request this service ${icon('arrow')}</a>` })}

${section(`<div class="detail">
  <div class="reveal"><p class="eyebrow">What this service means</p><div class="prose">${(x.body || []).map((p, k) => `<p${k ? '' : ' class="prose-lead"'}>${esc(p)}</p>`).join('')}</div></div>
  <aside class="detail-aside reveal" aria-label="Capabilities"><p class="mini-label">Capabilities may include</p><ul class="pills">${(x.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></aside>
</div>`)}

${(x.audience || []).length ? section(`${headSplit('Who it is for', 'Is this the right service for you?', 'It usually suits one of these situations.')}
  <div class="aud">${x.audience.map((t, k) => `<div class="aud-item reveal"><span>${pad2(k)}</span><p>${esc(t)}</p></div>`).join('')}</div>`, 'soft') : ''}

${section(`<div class="handle">
  <div class="reveal"><p class="eyebrow">What we handle</p><h2>The work we take on</h2>${ticks(x.handle || x.points)}</div>
  <div class="approach reveal"><p class="eyebrow">Our approach</p><p class="approach-text">${esc(x.approach || '')}</p></div>
</div>`)}

${section(`${headSplit('Process', 'How this service runs', x.process === 'sourcing' ? 'Seven steps, adapted for sourcing and coordination work.' : 'The same seven steps as every Monoha requirement.')}${processSteps(content('site')[x.process === 'sourcing' ? 'sourcingProcess' : 'process'] || [])}`, 'soft')}

${(x.expect || []).length ? section(`<div class="expect reveal"><div><p class="eyebrow">What clients can expect</p><h2>What you get from us</h2><p class="lead">These describe how we work, not a guaranteed outcome. Results depend on the market and the requirement.</p></div>${ticks(x.expect)}</div>`) : ''}

${faqs.length ? section(`<div class="faq-split"><div><p class="eyebrow">FAQ</p><h2>Questions about ${esc(x.title)}</h2><p class="lead"><a href="/faq">See all FAQs</a></p></div>${faqList(faqs)}</div>`, 'soft') + faqLd(faqs) : ''}

${section(`<p class="mini-label">Other services</p><div class="other-svc">${others.map((o) => `<a href="/services/${esc(o.slug)}">${esc(o.title)} ${icon('arrow')}</a>`).join('')}</div>`, 'tight')}

${requestCta(`Request ${x.title}`, 'Tell us what you need. Our team will review the requirement and contact you.')}` }));
}

// ---------------------------------------------------------------- solutions
pages['/solutions'] = (req) => {
  const site = content('site');
  return layout(req, { title: 'Solutions', description: 'How MONOHA SOURCING INTERNATIONAL supports businesses, brands, digital presence, sourcing requirements, growing businesses and international partners.', body: `
${pageHero({ eyebrow: 'Solutions', title: 'Structured support for different business needs.', lead: 'The process stays the same. How we apply it depends on who you are and what you need. Find the description closest to you.', crumbs: [['/solutions', 'Solutions']], artKind: 'solutions' })}

${section(`<div class="solx-list">${(site.solutions || []).map((x, i) => `
  <details class="solx reveal" id="${esc(slugify(x.title))}">
    <summary><span class="solx-no">${pad2(i)}</span><span class="solx-mark">${icon(SOL_ICONS[i % SOL_ICONS.length])}</span><h2>${esc(x.title)}</h2><span class="solx-go">${icon('arrow')}</span></summary>
    <div class="solx-body">
      <div><p class="mini-label">Who it is for</p><p>${esc(x.who || x.text)}</p></div>
      <div><p class="mini-label">Typical requirement</p><p>${esc(x.need || '')}</p></div>
      <div><p class="mini-label">How Monoha supports it</p><p>${esc(x.support || '')}</p>
        <a class="link-arrow" href="/request-service?subject=${encodeURIComponent(x.title)}">Discuss your requirement ${icon('arrow')}</a></div>
    </div>
  </details>`).join('')}</div>`)}

${requestCta('Recognise your situation?', 'Tell us about your requirement and we will suggest how to approach it.')}` });
};

// ---------------------------------------------------------------- process
pages['/process'] = (req) => {
  const steps = content('site').process || [];
  return layout(req, { title: 'Our Process', description: 'The seven-step process MONOHA SOURCING INTERNATIONAL uses on every requirement, and what you hear from us at each step.', body: `
${pageHero({ eyebrow: 'Our Process', title: 'A clear process from requirement to delivery.', lead: 'Seven steps, the same every time, so you always know where your requirement stands and when you will hear from us.', crumbs: [['/process', 'Our Process']], artKind: 'process' })}

${section(`${headSplit('Overview', 'Seven steps at a glance', 'Each step has a purpose and a point where we report back to you.')}${processSteps(steps)}`)}

${section(`<div class="psteps">${steps.map((s, i) => `
  <article class="pstep reveal" id="step-${pad2(i)}">
    <div class="pstep-no" aria-hidden="true">${pad2(i)}</div>
    <div class="pstep-head"><p class="eyebrow">Step ${pad2(i)} of 07</p><h2>${esc(s.title)}</h2><p class="lead">${esc(s.text)}</p></div>
    <div class="pstep-cols">
      <div><p class="mini-label">What happens</p>${ticks(s.happens || [])}</div>
      <div class="pstep-comms"><p class="mini-label">Expected communication</p><p>${esc(s.comms || '')}</p></div>
    </div>
  </article>`).join('')}</div>`, 'soft')}

${requestCta('Start at step one.', 'Send us your requirement. Understanding it properly is where every project begins.')}` });
};

// ---------------------------------------------------------------- work
const CASE_FIELDS = [['Requirement', 'requirement'], ['Challenge', 'challenge'], ['Approach', 'approach'], ['Execution', 'execution'], ['Outcome', 'outcome']];
pages['/work'] = (req) => {
  const projects = content('work').projects || [];
  return layout(req, { title: 'Our Work', description: 'Selected work and case studies from MONOHA SOURCING INTERNATIONAL, published only with permission and verified results.', body: `
${pageHero({ eyebrow: 'Our Work', title: 'Selected Work', lead: 'Projects and case studies will be presented here as they become available for public presentation.', crumbs: [['/work', 'Our Work']], artKind: 'work' })}

${projects.length ? section(projects.map((p) => `<article class="case reveal">
    <div class="case-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : coverArt({ slug: p.slug || p.name, category: p.industry || '' })}</div>
    <div class="case-body"><p class="mini-label">${esc(p.category || 'Project')}</p><h2>${esc(p.name)}</h2>${p.industry ? `<p class="case-ind"><span>Industry</span>${esc(p.industry)}</p>` : ''}
      <dl>${CASE_FIELDS.filter(([, k]) => p[k]).map(([l, k]) => `<div><dt>${l}</dt><dd>${esc(p[k])}</dd></div>`).join('')}</dl></div></article>`).join(''))
    : section(`<div class="work-ready">
  <div class="reveal"><p class="eyebrow">Coming soon</p><h2>Case studies, published with permission.</h2>
    <p class="lead">We publish a project only when the client agrees and only with outcomes we can verify. Case studies will cover business, sourcing and digital work as they are cleared for publication.</p>
    <div class="hero-actions"><a href="/request-service" class="btn btn-primary">Start a project ${icon('arrow')}</a><a href="/process" class="btn btn-outline">See how we work</a></div></div>
  <div class="case-frame reveal" aria-hidden="true"><span class="case-label">Case study</span>
    <div class="case-ghost"><div class="cover"></div><dl><dt>Project</dt><dd></dd><dt>Industry</dt><dd class="w3"></dd><dt>Requirement</dt><dd class="w2"></dd><dt>Challenge</dt><dd></dd><dt>Approach</dt><dd class="w2"></dd><dt>Execution</dt><dd></dd><dt>Outcome</dt><dd class="w3"></dd></dl></div>
  </div></div>`)}

${section(`${headSplit('How we will present work', 'Every case study follows the same structure.', 'So you can compare projects and see exactly what was asked, what we did and what was verified.')}
  <ol class="case-struct">${[['Project', 'What the work was, named with permission.'], ['Industry', 'The sector the client works in.'], ['Requirement', 'What the client asked for.'], ['Challenge', 'What made it difficult.'], ['Approach', 'How we planned it.'], ['Execution', 'What we actually did.'], ['Outcome', 'Only results that can be verified.']]
    .map(([t, d], i) => `<li class="reveal"><span>${pad2(i)}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>`, 'soft')}

${ctaBand()}` });
};

// ---------------------------------------------------------------- insights
pages['/insights'] = (req) => {
  const articles = sortedArticles();
  const INSIGHT_CATS = content('insights').categories || [];
  const pick = INSIGHT_CATS.includes(req.query.category) ? req.query.category : '';
  const list = pick ? articles.filter((a) => a.category === pick) : articles;
  return layout(req, { title: pick ? `${pick} Insights` : 'Insights', description: 'Notes, perspectives and practical knowledge on business, sourcing, digital, marketing, technology and operations from MONOHA SOURCING INTERNATIONAL.', body: `
${pageHero({ eyebrow: 'Insights', title: 'Notes, perspectives and practical knowledge.', lead: 'Plain, practical writing on business, sourcing, digital work and operations from the Monoha team.', crumbs: [['/insights', 'Insights']], artKind: 'insights' })}
${section(`<nav class="chips" aria-label="Categories"><a href="/insights"${!pick ? ' class="is-active" aria-current="page"' : ''}>All</a>${INSIGHT_CATS.map((c) => `<a href="/insights?category=${encodeURIComponent(c)}"${pick === c ? ' class="is-active" aria-current="page"' : ''}>${esc(c)}</a>`).join('')}</nav>
  ${list.length ? featureCard(list[0]) + (list.length > 1 ? `<div class="grid grid-3">${list.slice(1).map(articleCard).join('')}</div>` : '')
    : `<div class="empty-state"><h2>Nothing in ${esc(pick)} yet</h2><p>New articles are added as they are written. <a href="/insights">See all insights</a>.</p></div>`}`)}
${ctaBand()}` });
};

function articlePage(req, res) {
  const articles = sortedArticles();
  const a = articles.find((x) => x.slug === req.params.slug);
  if (!a) return notFound(req, res);
  const body = (a.body || []).map((p) => (p.startsWith('## ') ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p)}</p>`)).join('');
  const url = `${SITE_URL}/insights/${a.slug}`;
  const related = articles.filter((x) => x.slug !== a.slug).sort((x, y) => (y.category === a.category) - (x.category === a.category)).slice(0, 3);
  const site = content('site');
  res.send(layout(req, { title: a.title, description: a.summary, active: '/insights', ogType: 'article',
    jsonld: ld({ '@type': 'Article', headline: a.title, description: a.summary, datePublished: a.date, dateModified: a.updated || a.date, mainEntityOfPage: url,
      author: { '@type': 'Organization', name: a.author || 'Monoha Team' }, publisher: { '@type': 'Organization', name: site.name, logo: { '@type': 'ImageObject', url: SITE_URL + '/images/logo.png' } }, ...(a.cover ? { image: SITE_URL + a.cover } : {}) }),
    body: `
<article class="article">
  ${pageHero({ eyebrow: a.category, title: a.title, crumbs: [['/insights', 'Insights'], [`/insights/${a.slug}`, a.title]], cls: 'phero-article' })}
  <div class="wrap article-wrap">
    <p class="article-meta"><span>${esc(a.author || 'Monoha Team')}</span><time datetime="${esc(a.date)}">${fmtDate(a.date)}</time><span>${esc(a.category)}</span></p>
    <div class="article-visual">${coverArt(a)}</div>
    <div class="prose article-text">${a.summary ? `<p class="prose-lead">${esc(a.summary)}</p>` : ''}${body}
      <div class="share"><span>Share</span>
        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">Facebook</a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a>
        <button type="button" class="copy-link" data-url="${esc(url)}">Copy link</button>
      </div>
    </div>
  </div>
</article>
${related.length ? section(`${headSplit('Related', 'More insights', '')}<div class="grid grid-3">${related.map(articleCard).join('')}</div>`, 'soft') : ''}
${ctaBand()}` }));
}

// ---------------------------------------------------------------- careers
pages['/careers'] = (req) => {
  const c = content('careers');
  const open = (c.jobs || []).filter((j) => j.open);
  const faqs = c.faqs || [];
  return layout(req, { title: 'Careers', description: 'Careers at MONOHA SOURCING INTERNATIONAL: how we work, how recruitment works, and current opportunities.', body: `
${pageHero({ eyebrow: 'Careers', title: 'Build Your Career With MONOHA', lead: c.intro, crumbs: [['/careers', 'Careers']], artKind: 'careers', actions: `<a href="#openings" class="btn btn-light">View Open Positions ${icon('arrow')}</a>` })}

${section(`${headSplit('Why work with us', 'Practical work, clearly organised.', 'What working here involves. We only describe what is true today.')}${plainCards(c.why || [])}`)}

${section(`<div class="env">
  <div class="reveal"><p class="eyebrow">Work environment</p><h2>Ownership, direct communication, follow-through.</h2></div>
  <div class="reveal"><p class="lead">${esc(c.environment)}</p>${ticks(c.environmentPoints)}</div>
</div>`, 'dark')}

${section(`<div class="split">
  <div class="reveal"><p class="eyebrow">Learning &amp; development</p><h2>Learn the work by doing the work.</h2><p class="lead">${esc(c.learning)}</p></div>
  <div class="card reveal"><h3>Internships</h3><p>${esc(c.internship)}</p></div>
</div>`, 'soft')}

${section(`${headSplit('Current opportunities', open.length ? `${open.length} open position${open.length > 1 ? 's' : ''}` : 'No open positions right now', open.length ? 'Select a role for details and how to apply.' : 'We are not hiring for a specific role at the moment. You can still send your CV; we keep it on file and contact you if a suitable role opens.')}
  ${open.length ? `<div class="jobs">${open.map((j) => `<a class="job reveal" href="/careers/${esc(j.slug)}"><div><h3>${esc(j.title)}</h3><p>${esc(j.type)} · ${esc(j.location)}</p></div><span class="link-arrow">View role ${icon('arrow')}</span></a>`).join('')}</div>`
    : `<div class="empty-state left"><a href="/contact?subject=${encodeURIComponent('CV submission')}" class="btn btn-primary">Send your CV ${icon('arrow')}</a></div>`}`, '', 'openings')}

${section(`${headSplit('How recruitment works', 'Four steps, clearly communicated.', 'Sending an application does not guarantee an interview or employment.')}
  <ol class="rsteps">${(c.process || []).map((p, i) => `<li class="reveal"><span>${pad2(i)}</span><h3>${esc(p.title || p)}</h3>${p.text ? `<p>${esc(p.text)}</p>` : ''}</li>`).join('')}</ol>`, 'soft')}

${faqs.length ? section(`<div class="faq-split"><div><p class="eyebrow">FAQ</p><h2>Careers questions</h2></div>${faqList(faqs)}</div>`) + faqLd(faqs) : ''}

${ctaBand({ eyebrow: 'Careers', title: 'Interested in working with Monoha?', text: 'See current openings, or send your CV for future roles.', actions: `<a href="#openings" class="btn btn-light">View Open Positions ${icon('arrow')}</a><a href="/contact?subject=${encodeURIComponent('CV submission')}" class="btn btn-ghost-light">Send your CV</a>` })}` });
};

function jobPage(req, res) {
  const j = (content('careers').jobs || []).find((x) => x.slug === req.params.slug);
  if (!j) return notFound(req, res);
  const list = (t, items) => (items && items.length ? `<h2>${t}</h2>${ticks(items)}` : '');
  res.send(layout(req, { title: j.title, description: j.about, active: '/careers', body: `
${pageHero({ eyebrow: j.open ? 'Open position' : 'Position closed', title: j.title, lead: j.about, crumbs: [['/careers', 'Careers'], [`/careers/${j.slug}`, j.title]] })}
${section(`<div class="detail">
  <div class="prose">${list('Responsibilities', j.responsibilities)}${list('Requirements', j.requirements)}<h2>How to apply</h2><p>${esc(j.apply)}</p>
    ${j.open ? `<a href="/contact?subject=${encodeURIComponent('Application: ' + j.title)}" class="btn btn-primary">Apply now</a>` : '<p class="muted">This position is not currently open.</p>'}</div>
  <aside class="detail-aside"><dl class="facts"><dt>Work type</dt><dd>${esc(j.type)}</dd><dt>Location</dt><dd>${esc(j.location)}</dd><dt>Compensation</dt><dd>${esc(j.compensation)}</dd></dl></aside>
</div>`)}` }));
}

// ---------------------------------------------------------------- forms
const SELECTS = {
  requirementType: ['A new project', 'Ongoing support', 'Research or advice', 'Sourcing requirement', 'Other / custom requirement'],
  budget: ['Not sure yet', 'Under USD 1,000', 'USD 1,000 – 5,000', 'USD 5,000 – 20,000', 'Over USD 20,000', 'Prefer to discuss'],
  timeline: ['As soon as possible', 'Within 1 month', '1 – 3 months', 'More than 3 months', 'Flexible'],
};
function formFields(kind, q) {
  const f = (id, label, type = 'text', req = false, extra = '') => `
    <div class="field"><label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <input id="${id}" name="${id}" type="${type}"${req ? ' required aria-required="true"' : ''}${extra}></div>`;
  const sel = (id, label, opts, req = false, hint = '') => `
    <div class="field"><label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}${hint ? ` <span class="opt">${hint}</span>` : ''}</label>
    <select id="${id}" name="${id}"${req ? ' required aria-required="true"' : ''}><option value="">Choose one</option>${opts}</select></div>`;
  const list = (k) => SELECTS[k].map((o) => `<option>${esc(o)}</option>`).join('');
  if (kind === 'contact') return `
    <div class="row">${f('name', 'Full name', 'text', true, ' autocomplete="name" maxlength="120"')}${f('company', 'Company name', 'text', false, ' autocomplete="organization" maxlength="160"')}</div>
    <div class="row">${f('email', 'Email', 'email', true, ' autocomplete="email" maxlength="160"')}${f('phone', 'Phone', 'tel', false, ' autocomplete="tel" maxlength="40"')}</div>
    ${f('subject', 'Subject', 'text', false, ` maxlength="200"${q.subject ? ` value="${esc(q.subject)}"` : ''}`)}
    <div class="field"><label for="message">Message <span class="req" aria-hidden="true">*</span></label><textarea id="message" name="message" rows="6" required aria-required="true" maxlength="4000"></textarea></div>`;
  return `
    <fieldset><legend>About you</legend>
    <div class="row">${f('name', 'Full name', 'text', true, ' autocomplete="name" maxlength="120"')}${f('company', 'Company name', 'text', false, ' autocomplete="organization" maxlength="160"')}</div>
    <div class="row">${f('email', 'Email', 'email', true, ' autocomplete="email" maxlength="160"')}${f('phone', 'Phone', 'tel', false, ' autocomplete="tel" maxlength="40"')}</div>
    ${f('country', 'Country', 'text', false, ' autocomplete="country-name" maxlength="80"')}</fieldset>
    <fieldset><legend>Your requirement</legend>
    <div class="row">${sel('service', 'Service required', serviceOptions(q.service), true)}${sel('requirementType', 'Requirement type', list('requirementType'))}</div>
    <div class="row">${sel('budget', 'Budget range', list('budget'), false, 'optional')}${sel('timeline', 'Timeline', list('timeline'), false, 'optional')}</div>
    <div class="field"><label for="requirement">Requirement details <span class="req" aria-hidden="true">*</span></label>
      <textarea id="requirement" name="requirement" rows="6" required aria-required="true" minlength="20" maxlength="4000" aria-describedby="requirement-hint" placeholder="What do you need, what should the result look like, and by when?">${q.subject ? esc(q.subject) + ': ' : ''}</textarea>
      <p class="hint" id="requirement-hint">At least 20 characters. Any requirement is welcome; scope, examples and dates help us reply usefully.</p></div>
    <div class="field"><label for="attachment">Attachment <span class="opt">optional · PDF, image or document, up to 5 MB</span></label><input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"></div></fieldset>`;
}

const inquiryForm = (kind, q) => `
<form class="form" data-kind="${kind}" novalidate>
  ${formFields(kind, q)}
  <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
  <input type="hidden" name="started" value="${Date.now()}">
  <p class="form-note">Fields marked <span class="req">*</span> are required. We use your details only to reply. <a href="/privacy-policy">Privacy Policy</a></p>
  <button type="submit" class="btn btn-primary">${kind === 'contact' ? 'Send Message' : 'Send Request'} ${icon('arrow')}</button>
  <p class="form-status" role="status" aria-live="polite"></p>
</form>
<div class="form-done" hidden tabindex="-1"><span class="done-icon">${icon('check')}</span><h2>Thank you.</h2><p>${kind === 'contact' ? 'Our team will review your message and contact you.' : 'Our team will review your requirement and contact you.'}</p></div>`;

// ---------------------------------------------------------------- contact
pages['/contact'] = (req) => {
  const c = content('site').contact || {};
  const rows = [['mail', 'Email', c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`], ['phone', 'Phone', c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`], ['pin', 'Office', c.address && esc(c.address)], ['clipboard', 'Business hours', c.hours && esc(c.hours)]]
    .filter((r) => r[2]);
  return layout(req, { title: 'Contact', description: 'Contact MONOHA SOURCING INTERNATIONAL. Send a message and our team will get back to you.', body: `
${pageHero({ eyebrow: 'Contact', title: "Let's start a conversation.", lead: 'Send us a message and our team will get back to you. For a specific requirement, the Request a Service form gives us more to work with.', crumbs: [['/contact', 'Contact']], artKind: 'contact' })}
${section(`<div class="contact-grid">
  <div class="contact-info">
    <h2>MONOHA SOURCING INTERNATIONAL</h2>
    ${rows.length ? `<ul class="contact-rows">${rows.map(([i, l, v]) => `<li>${icon(i)}<div><span>${l}</span>${v}</div></li>`).join('')}</ul>` : '<p class="muted">Use the form and we will reply by email.</p>'}
    <div class="contact-card"><p class="mini-label">Have a specific requirement?</p><p>The request form asks for the details we need to give you a useful first reply.</p><a href="/request-service" class="link-arrow">Request a Service ${icon('arrow')}</a></div>
  </div>
  <div class="form-card">${inquiryForm('contact', req.query)}</div>
</div>`)}
${c.address ? section(`<div class="map-block"><div><p class="eyebrow">Office location</p><h2>Find us</h2><p class="lead">${esc(c.address)}</p><a class="link-arrow" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">Open in Google Maps ${icon('arrow')}</a></div>
  <iframe title="Map showing our office" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(c.address)}&output=embed"></iframe></div>`, 'soft') : ''}` });
};

// ---------------------------------------------------------------- request
pages['/request-service'] = (req) => layout(req, { title: 'Request a Service', description: 'Tell MONOHA SOURCING INTERNATIONAL what you need. Send any business, sourcing, digital or online requirement and our team will review it and contact you.', body: `
${pageHero({ eyebrow: 'Request a Service', title: 'Tell Us What You Need', lead: 'Describe any business, sourcing, digital or online requirement. It does not need to fit a category, and sending a request does not commit you to anything.', crumbs: [['/request-service', 'Request a Service']], artKind: 'request' })}
${section(`<div class="request-grid">
  <div class="form-card">${inquiryForm('request', req.query)}</div>
  <aside class="request-aside">
    <div><p class="mini-label">What happens next</p><ol class="next-steps"><li><b>We review</b>Our team reads your requirement and checks it fits our services.</li><li><b>We reply</b>We contact you by email or phone, usually with a few clarifying questions.</li><li><b>We agree scope</b>If we can help, we agree the work in writing before anything starts.</li></ol></div>
    <div class="tips"><p class="mini-label">A useful request includes</p>${ticks(['What you need and what it is for', 'Scope, standard or quantity', 'When you need it', 'Reference files, links or examples'])}</div>
  </aside>
</div>`)}` });

// ---------------------------------------------------------------- faq
pages['/faq'] = (req) => {
  const f = content('faq');
  const faqs = f.faqs || [];
  const cats = (f.categories || []).filter((c) => faqs.some((q) => q.cat === c));
  return layout(req, { title: 'FAQ', description: 'Answers to common questions about MONOHA SOURCING INTERNATIONAL: our services, sourcing, process, communication and service requests.', jsonld: faqLd(faqs), body: `
${pageHero({ eyebrow: 'FAQ', title: 'Frequently asked questions', lead: 'Straight answers about what we do and how we work. Can’t find yours? Ask us directly.', crumbs: [['/faq', 'FAQ']], artKind: 'faq' })}
${section(`<div class="faq-page">
  <nav class="faq-nav" aria-label="FAQ categories"><p class="mini-label">Categories</p>${cats.map((c) => `<a href="#${slugify(c)}">${esc(c)}</a>`).join('')}<a href="/contact" class="btn btn-outline">Ask a question</a></nav>
  <div>${cats.map((c) => `<div class="faq-group" id="${slugify(c)}"><h2>${esc(c)}</h2>${faqList(faqs.filter((q) => q.cat === c))}</div>`).join('')}</div>
</div>`)}
${ctaBand()}` });
};

// ---------------------------------------------------------------- legal
const LEGAL_UPDATED = '29 September 2026';
const legal = {
  '/privacy-policy': ['Privacy Policy', 'How MONOHA SOURCING INTERNATIONAL collects and uses information submitted through this website.', [
    'This policy explains what information MONOHA SOURCING INTERNATIONAL collects through this website and how it is used.',
    '## What we collect', 'When you submit a form we receive what you enter: your name, company, contact details, country, requirement details and any file you attach. Our server also records standard technical logs, such as IP address and time of request, to keep the site secure.',
    '## How we use it', 'We use the information only to reply to your enquiry, to discuss and provide the service you ask about, and to protect the site from abuse. We do not sell your information and we do not use it for advertising.',
    '## Who can see it', 'Enquiries are stored on our server and sent to our company mailbox. They are available only to the people at Monoha who handle enquiries, and to service providers that host our website and email on our behalf.',
    '## How long we keep it', 'For as long as is needed to handle your enquiry and any work that follows, and as required by law. You can ask us to delete it sooner.',
    '## Your choices', 'You can ask us to see, correct or delete the information you sent us by contacting us through the Contact page.',
    '## Changes', 'If this policy changes, the updated version will be published on this page with a new date.']],
  '/terms': ['Terms & Conditions', 'The terms that apply to the use of the MONOHA SOURCING INTERNATIONAL website.', [
    'By using this website you agree to these terms. If you do not agree, please do not use the site.',
    '## Information on this site', 'We aim to keep the content accurate and current, but it is general information about our services and not a binding offer. Services are agreed separately in writing.',
    '## Enquiries and requests', 'Sending an enquiry or service request does not create a contract or any obligation on either side. Any engagement is confirmed separately and in writing.',
    '## No guarantees', 'Outcomes depend on markets, audiences, suppliers and the requirement itself. Nothing on this site guarantees sales, growth, search rankings or any other particular result.',
    '## Intellectual property', 'The MONOHA name, logo and the content of this site belong to MONOHA SOURCING INTERNATIONAL and may not be reused without permission.',
    '## Links to other sites', 'Links to other websites are provided for convenience. We are not responsible for their content.',
    '## Changes', 'We may update these terms. The current version is always on this page.']],
  '/cookie-policy': ['Cookie Policy', 'How the MONOHA SOURCING INTERNATIONAL website uses cookies and similar storage.', [
    'This website does not use advertising or tracking cookies, and it does not set cookies of its own.',
    '## What your browser stores', 'Your browser may cache the fonts, images and files it needs to show the site faster. This is standard browser behaviour and does not identify you.',
    '## Third parties', 'Fonts are served by Google Fonts. Share buttons open Facebook or LinkedIn only when you choose to click them; those sites apply their own cookie policies once you are there. If a map is shown on the Contact page, it is provided by Google Maps.',
    '## Changes', 'If we introduce cookies in future, this page will be updated before they are used.']],
};
for (const [p, [t, d, paras]] of Object.entries(legal)) {
  pages[p] = (req) => layout(req, { title: t, description: d, body: `
${pageHero({ eyebrow: 'Legal', title: t, lead: `Last updated ${LEGAL_UPDATED}`, crumbs: [[p, t]], cls: 'phero-plain' })}
${section(`<div class="legal">
  <nav class="legal-nav" aria-label="Legal pages"><p class="mini-label">Legal</p>${Object.entries(legal).map(([h, [n]]) => `<a href="${h}"${h === p ? ' aria-current="page"' : ''}>${esc(n)}</a>`).join('')}</nav>
  <div class="prose">${paras.map((x) => (x.startsWith('## ') ? `<h2>${esc(x.slice(3))}</h2>` : `<p>${esc(x)}</p>`)).join('')}</div>
</div>`)}` });
}

function notFound(req, res) {
  res.status(404).send(layout(req, { title: 'Page not found', description: 'The page you were looking for could not be found.', noindex: true, body: `
${pageHero({ eyebrow: 'Error 404', title: 'This page could not be found.', lead: 'The link may be out of date, or the page may have moved. These might help:', cls: 'phero-plain',
    actions: `<a href="/" class="btn btn-light">Back to home ${icon('arrow')}</a><a href="/services" class="btn btn-ghost-light">Services</a><a href="/contact" class="btn btn-ghost-light">Contact</a>` })}` }));
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
app.get('/request', (req, res) => res.redirect(301, '/request-service' + req.originalUrl.slice(req.path.length)));
const OLD_SERVICES = { 'international-sourcing': 'business-sourcing', 'product-supplier-sourcing': 'business-sourcing', 'business-coordination': 'business-sourcing', 'sourcing-support': 'business-sourcing', 'international-business-support': 'business-sourcing' };
app.get('/services/:slug', (req, res, next) => (OLD_SERVICES[req.params.slug] ? res.redirect(301, '/services/' + OLD_SERVICES[req.params.slug]) : next()), servicePage);
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
  // A human takes more than a few seconds to fill the form in.
  if (b.started && Date.now() - Number(b.started) < 3000) return res.json({ ok: true });

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
    requirementType: t(b.requirementType, 120), requirement: t(b.requirement, 4000), budget: t(b.budget, 200), timeline: t(b.timeline, 120), message: t(b.message, 4000),
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
  const rows = Object.entries({ Name: entry.name, Company: entry.company, Country: entry.country, Email: entry.email, Phone: entry.phone, Subject: entry.subject, Service: entry.service, Requirement: entry.requirement, 'Requirement type': entry.requirementType, 'Budget range': entry.budget, Timeline: entry.timeline, Message: entry.message })
    .filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5B6B88;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
  for (const addr of new Set(to)) {
    sendMail(addr, `${kind === 'request' ? 'Service request' : 'New inquiry'} from ${entry.name} (${entry.id})`,
      `<div style="font-family:Arial,sans-serif;color:#0A1A3F"><h2 style="margin:0 0 12px">${kind === 'request' ? 'New service request' : 'New website inquiry'}</h2><table style="font-size:14px;border-collapse:collapse">${rows}</table></div>`,
      attachment ? [attachment] : undefined);
  }
});

app.use(notFound);

app.listen(PORT, () => console.log(`MONOHA site on ${SITE_URL}`));
