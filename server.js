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

// Admin-managed records. These live only in DATA_DIR and are never seeded
// or overwritten by a deploy: partners, programs and the CEO profile.
const STORE = {
  partners: path.join(DATA_DIR, 'partners.json'),
  programs: path.join(DATA_DIR, 'programs.json'),
  leadership: path.join(DATA_DIR, 'leadership.json'),
};
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DEFAULT_CEO = {
  name: 'Mohammad Raihanul Islam', position: 'Founder & CEO', photo: '', bio: '', socials: [],
  message: 'At MONOHA SOURCING INTERNATIONAL, we believe that every requirement represents an opportunity — an opportunity to create value, build meaningful connections and provide practical solutions. Our goal is to provide reliable sourcing, supply, business and digital support to help businesses and organizations move forward. We remain committed to professional execution, clear communication and long-term collaboration.',
};
const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
const storeItems = (k) => readJSON(STORE[k], { items: [] }).items || [];
const leadership = () => {
  const d = readJSON(STORE.leadership, {});
  const out = { ...DEFAULT_CEO };
  for (const k of Object.keys(DEFAULT_CEO)) if (d[k] && (!Array.isArray(d[k]) || d[k].length)) out[k] = d[k];
  return out;
};
const activePartners = () => storeItems('partners').filter((x) => x.active).sort(byOrder);
const publishedPrograms = () => storeItems('programs').filter((x) => x.published)
  .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || byOrder(a, b) || String(b.startDate).localeCompare(String(a.startDate)));

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
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  play: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  building: '<path d="M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  article: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  megaphone: '<path d="M3 10v4h4l8 4V6L7 10zM18 9a4 4 0 010 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6-8 11-8 11z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const icon = (name) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;

// The seven service pages, named the way visitors look for them. Shared by the menu and footer.
// [slug, label, description, icon]
const SERVICE_MENU = [
  ['business-sourcing', 'Sourcing & Supply', 'Supplier, product and material sourcing and supply', 'box'],
  ['business-solutions', 'Business Solutions', 'Coordination, operations and requirement management', 'briefcase'],
  ['digital-online-solutions', 'Digital & Online', 'Websites and online business solutions', 'monitor'],
  ['content-creative', 'Content & Creative', 'Content, editing and creative production', 'play'],
  ['marketing-growth', 'Marketing & Growth', 'Promotion, social media and audience support', 'megaphone'],
  ['seo-digital-visibility', 'SEO & Visibility', 'Search visibility and content optimization', 'search'],
  ['partnerships-development', 'Projects & Partnerships', 'Institutional, NGO and development project support', 'handshake'],
];
// [href, label, dropdown items [href, label, note?, icon?], dropdown footer link]
const NAV = [
  ['/', 'Home'],
  ['/about', 'About', [
    ['/about', 'About MONOHA', 'Who we are and how we work', 'building'],
    ['/about#ceo-message', 'CEO Message', 'A word from our founder', 'user'],
    ['/partners', 'Our Partners', 'Organizations we work with', 'handshake'],
    ['/programs', 'Programs', 'Programs and project initiatives', 'calendar'],
  ]],
  ['/services', 'Services', SERVICE_MENU.map(([s, l, d, i]) => [`/services/${s}`, l, d, i]), ['/request-service', 'Request a service']],
  ['/solutions', 'Solutions', [
    ['/solutions#for-businesses', 'For Businesses', 'Coordination, operations and growth', 'briefcase'],
    ['/solutions#for-brands', 'For Brands', 'Content, presence and campaigns', 'star'],
    ['/solutions#for-sourcing-requirements', 'For Sourcing Requirements', 'Suppliers, products and materials', 'box'],
    ['/solutions#for-growing-businesses', 'For Growing Businesses', 'Support that scales with you', 'trend'],
    ['/solutions#for-ngos-and-development-organizations', 'For NGOs & Development Organizations', 'Supply, coordination and project support', 'heart'],
    ['/solutions#for-institutions-and-project-partners', 'For Institutions & Project Partners', 'Work within a defined project scope', 'building'],
  ], ['/solutions', 'All solutions']],
  ['/process', 'Our Process'],
  ['/work', 'Our Work'],
  ['/insights', 'Insights', [
    ['/insights', 'Articles', 'Everything we have published', 'article'],
    ['/insights?category=Sourcing', 'Sourcing Insights', 'Suppliers, products and supply', 'box'],
    ['/insights?category=Business', 'Business Insights', 'Operations and coordination', 'briefcase'],
    ['/insights?category=Digital', 'Digital Insights', 'Websites and online presence', 'monitor'],
    ['/insights?category=Marketing%20%26%20SEO', 'Marketing & SEO', 'Promotion and search visibility', 'search'],
    ['/insights?category=Company%20Updates', 'Company Updates', 'News from MONOHA', 'megaphone'],
  ]],
  ['/careers', 'Careers'],
  ['/contact', 'Contact'],
];
const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';

// A sticky in-page section menu for long pages.
const subnav = (label, items) => `<nav class="subnav" aria-label="${esc(label)}"><div class="wrap"><ul>${items.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join('')}</ul></div></nav>`;

// Office address as lines, and a maps link that skips the floor number.
const addressHtml = (c) => (c.addressLines || [c.address]).map(esc).join('<br>');
const mapUrl = (c) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.mapQuery || c.address);

function layout(req, { title, fullTitle: fixedTitle, description, body, active, jsonld = '', ogType = 'website', noindex = false }) {
  const site = content('site');
  const services = (content('services').services || []);
  const c = site.contact || {};
  const s = site.social || {};
  const fullTitle = fixedTitle || (title ? `${title} | ${site.name}` : `${site.name} — Sourcing, Supply & Business Solutions`);
  const desc = description || site.intro;
  const url = SITE_URL + req.path;
  const here = active || req.path;
  const isActive = (href) => (href === '/' ? here === '/' : here.startsWith(href));

  const navLinks = NAV.map(([href, label, menu, foot]) => {
    const on = isActive(href);
    const link = `<a class="nav-link${on ? ' is-active' : ''}" href="${href}"${req.path === href ? ' aria-current="page"' : ''}>${label}</a>`;
    if (!menu) return link;
    const id = 'menu-' + label.toLowerCase();
    return `<div class="nav-item">${link}<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="${id}"><span class="sr-only">${label} menu</span>${CHEVRON}</button>
      <div class="nav-menu${menu.length > 6 ? ' is-wide' : ''}" id="${id}">${menu.map(([h, l, d, ic]) => `<a href="${h}">${ic ? `<span class="nm-ico">${icon(ic)}</span>` : ''}<span class="nm-t"><strong>${esc(l)}</strong>${d ? `<small>${esc(d)}</small>` : ''}</span><svg class="nm-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3l3 3-3 3"/></svg></a>`).join('')}
        ${foot ? `<a class="nav-menu-foot" href="${foot[0]}">${foot[1]} ${icon('arrow')}</a>` : ''}</div></div>`;
  }).join('');

  const socials = [['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['youtube', 'YouTube']]
    .filter(([k]) => s[k]).map(([k, l]) => `<a href="${esc(s[k])}" rel="noopener" target="_blank">${l}</a>`).join('');

  const contactLines = [
    c.email && `<li>${icon('mail')}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`,
    c.address && `<li>${icon('pin')}<span>${addressHtml(c)}</span></li>`,
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
<link rel="stylesheet" href="/css/site.css?v=11">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: SITE_URL, description: site.description,
    logo: SITE_URL + '/images/logo.png', ...(c.email ? { email: c.email } : {}), ...(c.phone ? { telephone: c.phone } : {}),
    ...(c.addressLines ? { address: { '@type': 'PostalAddress', streetAddress: c.addressLines.slice(0, 2).join(', '), addressLocality: c.addressLines[2], addressRegion: "Cox's Bazar", addressCountry: 'BD' } } : {}),
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
      <div class="nav-cta-mobile"><a href="/contact" class="btn btn-primary">Get in Touch ${icon('arrow')}</a><a href="/request-service" class="btn btn-outline">Request a Service</a></div>
    </nav>
    <a href="/contact" class="btn btn-primary header-cta">Get in Touch</a>
    <button class="menu-btn" id="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer-brandrow">
    <div class="footer-brand">
      <a href="/" class="footer-logo" aria-label="${esc(site.name)} — home"><img src="/images/logo.png" alt="" width="84" height="56" loading="lazy"></a>
      <div><p class="footer-name">${esc(site.name)}</p>
      <p class="footer-tag">Sourcing • Supply • Business Solutions • Digital Support</p>
      <p class="footer-desc">We connect business requirements with practical sourcing, supply, business and digital solutions for businesses, brands and organizations.</p>
      ${socials ? `<div class="socials">${socials}</div>` : ''}</div>
    </div>
    ${contactLines ? `<div class="footer-contact"><p class="footer-h">Contact</p><ul class="contact-list">${contactLines}<li>${icon('web')}<a href="https://monohasourcing.international">monohasourcing.international</a></li></ul></div>` : ''}
  </div>
  <div class="wrap footer-top">
    ${[
    ['Quick Links', [['/about', 'About'], ['/services', 'Services'], ['/solutions', 'Solutions'], ['/process', 'Our Process'], ['/work', 'Our Work'], ['/insights', 'Insights'], ['/careers', 'Careers'], ['/contact', 'Contact']]],
    ['Services', SERVICE_MENU.map(([sl, l]) => [`/services/${sl}`, l])],
    ['Solutions', NAV.find((n) => n[0] === '/solutions')[2].map(([h, l]) => [h, l])],
    ['Resources', [['/insights', 'Insights'], ['/insights', 'Articles'], ['/faq', 'FAQ'], ['/request-service', 'Request a Service'], ['/partners', 'Our Partners'], ['/programs', 'Programs']]],
    ['Legal', [['/privacy-policy', 'Privacy Policy'], ['/terms', 'Terms &amp; Conditions'], ['/cookie-policy', 'Cookie Policy']]],
  ].map(([h, links]) => `<details class="fcol" open><summary><h3>${h}</h3>${CHEVRON}</summary><div class="fcol-links">${links.map(([u, l]) => `<a href="${u}">${l.includes('&amp;') ? l : esc(l)}</a>`).join('')}</div></details>`).join('')}
  </div>
  <div class="wrap footer-base">
    <span>&copy; ${new Date().getFullYear()} MONOHA SOURCING INTERNATIONAL. All rights reserved.</span>
    <span class="footer-motto">More than sourcing. More than digital.</span>
  </div>
</footer>
<script src="/js/site.js?v=11" defer></script>
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
function pageHero({ eyebrow, title, lead, crumbs = [], artKind, artHtml = '', actions = '', cls = '' }) {
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
    ${artHtml || artKind ? `<div class="phero-art">${artHtml || art(artKind)}</div>` : ''}
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

const SOL_ICONS = ['briefcase', 'box', 'clipboard', 'globe', 'network', 'globe', 'handshake', 'clipboard'];
const solutionRows = (sol) => `<div class="sol-list">${sol.map((x, i) => `
  <a class="sol reveal" href="/solutions#${esc(slugify(x.title))}">
    <span class="sol-mark">${icon(SOL_ICONS[i % SOL_ICONS.length])}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p><span class="sol-go">${icon('arrow')}</span>
  </a>`).join('')}</div>`;

// The seven steps as one line of words, for places that only need the shape.
const chain = (steps) => `<ol class="chain">${steps.map((s, i) => `<li><span>${pad2(i)}</span>${esc(s)}</li>`).join('')}</ol>`;

// Request-form option each service page preselects.
const SERVICE_OPTION = { 'business-sourcing': 'Sourcing & Supply', 'business-solutions': 'Business Solutions', 'digital-online-solutions': 'Website & Digital', 'content-creative': 'Content & Creative', 'marketing-growth': 'Marketing & Promotion', 'seo-digital-visibility': 'SEO', 'partnerships-development': 'Project Support' };
// Options for a select; a preset value that is not in the list (an old link, a job title) is kept as its own option.
const options = (list, selected) => {
  const pre = selected && !list.includes(selected) ? `<option selected>${esc(selected)}</option>` : '';
  return pre + list.map((o) => `<option${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('');
};

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
      <p class="eyebrow">${esc(site.identity || '')}</p>
      <p class="hero-brand">MONOHA SOURCING INTERNATIONAL</p>
      <h1>Connecting business requirements <span class="hl">with practical solutions</span></h1>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions"><a href="/services" class="btn btn-primary">Explore Our Services ${icon('arrow')}</a><a href="/contact" class="btn btn-outline">Get in Touch</a></div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <canvas id="globe" width="560" height="560"></canvas>
      <span class="globe-tag t1"><i></i>Global sourcing &amp; supply</span>
      <span class="globe-tag t2"><i></i>Business &amp; digital support</span>
    </div>
  </div>
</section>
<section class="trust" aria-label="How we work"><div class="wrap"><ul>${(site.trust || []).map((t) => `<li>${icon('check')}${esc(t)}</li>`).join('')}</ul></div></section>

${section(`${headSplit('What We Do', 'Many requirements.<br>One professional partner.', 'From sourcing and business coordination to digital presence, content, marketing, SEO and project support, MONOHA brings practical capabilities together around the requirements of each organization.')}
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
// The About hero drawing: a globe with sourcing points feeding one requirement.
const ABOUT_NET_SVG = (() => {
  const chip = (x, y, t, hot) => {
    const w = Math.round(t.length * 7.6 + 26);
    return `<g><rect x="${x - w / 2}" y="${y - 13}" width="${w}" height="26" rx="6" fill="#0D2656" stroke="${hot ? '#00BFEF' : '#fff'}" stroke-opacity="${hot ? '.9' : '.28'}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10.5" letter-spacing="1.6" fill="${hot ? '#00BFEF' : '#fff'}" ${ART_FONT}>${t}</text></g>`;
  };
  const pts = [[122, 134], [318, 120], [100, 250], [338, 258]];
  const arcs = pts.map(([x, y]) => `<path d="M${x} ${y} Q ${Math.round((x + 220) / 2)} ${Math.round((y + 200) / 2 - 42)} 220 200"/>`).join('');
  return `<svg class="ab-net" viewBox="0 0 440 400" aria-hidden="true" focusable="false">
<g fill="none" stroke="#fff" stroke-opacity=".12"><circle cx="220" cy="200" r="150"/><ellipse cx="220" cy="200" rx="60" ry="150"/><ellipse cx="220" cy="200" rx="115" ry="150"/><ellipse cx="220" cy="200" rx="150" ry="54"/><path d="M70 200h300"/></g>
<g fill="none" stroke="#00BFEF" stroke-opacity=".35" stroke-width="1.5">${arcs}</g>
<g class="ab-flow" fill="none" stroke="#00BFEF" stroke-width="2" stroke-dasharray="6 16">${arcs}</g>
${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#fff" stroke-opacity=".25"/><circle cx="${x}" cy="${y}" r="5.5" fill="#fff"/>`).join('')}
<circle cx="220" cy="200" r="32" fill="#00BFEF" fill-opacity=".14"/><circle cx="220" cy="200" r="15" fill="#00BFEF"/>
${chip(220, 36, 'GLOBAL')}${chip(116, 100, 'SOURCING')}${chip(326, 86, 'SUPPLY')}${chip(100, 286, 'BUSINESS')}${chip(336, 294, 'CONNECTION')}${chip(220, 250, 'REQUIREMENT', true)}
</svg>`;
})();
// Line ends for the 3×3 "one requirement, the right expertise" hub.
const HUB_ENDS = [[16.7, 16.7], [50, 16.7], [83.3, 16.7], [16.7, 50], [83.3, 50], [16.7, 83.3], [50, 83.3], [83.3, 83.3]];

pages['/about'] = (req) => {
  const site = content('site');
  const a = site.about || {};
  const ceo = leadership();
  const chips = ['Sourcing', 'Supply', 'Business Solutions', 'Digital Support', 'Partnerships'];
  return layout(req, { title: 'About', fullTitle: 'About MONOHA Sourcing International | Sourcing, Supply & Business Solutions', description: 'Learn about MONOHA SOURCING INTERNATIONAL and our approach to sourcing, supplier coordination, supply, business solutions, digital support and project-based collaboration.', body: `
${pageHero({ eyebrow: 'About MONOHA', title: a.heroTitle, lead: a.heroLead, crumbs: [['/about', 'About']], artHtml: ABOUT_NET_SVG + `<ul class="ahero-chips">${chips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, cls: 'ahero',
    actions: `<a href="/services" class="btn btn-light">Explore Our Services ${icon('arrow')}</a><a href="#ceo-message" class="btn btn-ghost-light">Message from our CEO</a>` })}
${subnav('About sections', [['who-we-are', 'Who We Are'], ['how-we-work', 'How We Work'], ['capabilities', 'Core Capabilities'], ['values', 'Values'], ['ceo-message', 'CEO Message']])}

${section(`<div class="ab-who">
  <div class="reveal"><p class="eyebrow">Who we are</p><h2>More Than Sourcing.<br>More Than Digital.</h2></div>
  <div class="ab-who-copy reveal">${(a.whoParas || []).map((p, i) => `<p${i === 0 ? ' class="ab-lede"' : i === 2 ? ' class="ab-close"' : ''}>${esc(p)}</p>`).join('')}</div>
</div>
<ul class="ab-pillars reveal" aria-label="Company identity">${(site.identity || '').split('•').map((t, i) => `<li><span>${pad2(i)}</span>${esc(t.trim())}</li>`).join('')}</ul>`, '', 'who-we-are')}

${section(`${headSplit('How we work', 'Seven steps, whatever the requirement.', 'The same sequence applies to sourcing, business, digital and project work, so every client knows what happens next.')}
<ol class="hw-steps">${(a.howSteps || []).map((x, i) => `<li class="reveal"><span class="hw-no">${pad2(i)}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></li>`).join('')}</ol>`, 'soft', 'how-we-work')}

${section(`${headSplit('Core capabilities', 'Six areas of work, one partner.', 'Capabilities are brought together around each requirement rather than sold as fixed packages.')}
<div class="cap6">${(a.capabilities || []).map((x, i) => `
  <a class="cap6-card reveal" href="${esc(x.href)}">
    <span class="cap6-top"><span class="cap6-ico">${icon(x.icon)}</span><span class="cap6-no">${pad2(i)}</span></span>
    <h3>${esc(x.title)}</h3><p>${esc(x.text)}</p>
    <ul>${(x.items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <span class="link-arrow">Explore ${icon('arrow')}</span>
  </a>`).join('')}</div>`, '', 'capabilities')}

${section(`${headSplit('Values', 'How we work with every client.', 'Working principles, without exaggerated claims.')}
<div class="values">${(a.values || []).map((x) => `<div class="value reveal"><span class="value-ico">${icon('check')}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`).join('')}</div>`, 'dark', 'values')}

${ceoSection(ceo)}

${ctaBand({ eyebrow: 'Next step', title: "Have a Requirement? Let's Discuss It.", text: 'Tell us what you need. Our team will review the requirement and identify the appropriate way to support you.' })}` });
};

// The CEO block: a portrait card on the left, the message on the right.
function ceoSection(p) {
  const initials = String(p.name || 'M').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase();
  const social = (p.socials || []).filter((x) => /^https?:\/\//.test(x.url || ''));
  return section(`<div class="ceo">
  <figure class="ceo-card reveal">
    <div class="ceo-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="ceo-mono" aria-hidden="true">${esc(initials)}</span>`}</div>
    <figcaption><strong>${esc(p.name)}</strong><span>${esc(p.position)}</span><em>MONOHA SOURCING INTERNATIONAL</em>
      ${social.length ? `<span class="ceo-social">${social.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || 'Profile')}</a>`).join('')}</span>` : ''}</figcaption>
  </figure>
  <div class="ceo-body reveal">
    <p class="eyebrow">Message from our CEO</p>
    <svg class="ceo-quote" viewBox="0 0 48 36" aria-hidden="true"><path d="M0 36V20C0 8 7 1 19 0v7c-6 1-9 5-9 11h9v18zm29 0V20c0-12 7-19 19-20v7c-6 1-9 5-9 11h9v18z"/></svg>
    <blockquote>${String(p.message || '').split(/\n{2,}/).map((t) => `<p>${esc(t.trim())}</p>`).join('')}</blockquote>
    ${p.bio ? `<p class="ceo-bio">${esc(p.bio)}</p>` : ''}
    <p class="ceo-sign"><strong>${esc(p.name)}</strong><span>${esc(p.position)}, MONOHA SOURCING INTERNATIONAL</span></p>
  </div>
</div>`, 'ceo-sec', 'ceo-message');
}

// ---------------------------------------------------------------- services
// Visitor intentions, each routed to the service or form that handles it.
const INTENTS = [
  ['I need a supplier.', '/services/business-sourcing', 'Sourcing & Supply'],
  ['I need a product or material sourced.', '/services/business-sourcing', 'Sourcing & Supply'],
  ['I need business or operational support.', '/services/business-solutions', 'Business Solutions'],
  ['I need a website.', '/services/digital-online-solutions', 'Digital & Online'],
  ['I need content or creative work.', '/services/content-creative', 'Content & Creative'],
  ['I need marketing or promotion.', '/services/marketing-growth', 'Marketing & Growth'],
  ['I need SEO.', '/services/seo-digital-visibility', 'SEO & Visibility'],
  ['I need project or institutional support.', '/services/partnerships-development', 'Projects & Partnerships'],
  ['I want to discuss a partnership.', '/request-service?service=Project%20Support&type=Partnership', 'Request a Service'],
  ['I simply want to talk.', '/contact', 'Get in Touch'],
];
pages['/services'] = (req) => {
  const services = content('services').services || [];
  return layout(req, { title: 'Services', description: 'MONOHA SOURCING INTERNATIONAL services: international sourcing and business solutions, website development, content creation, digital marketing, SEO services, and NGO, institutional and partnership project support.', body: `
${pageHero({ eyebrow: 'Services', title: 'Capabilities built around real business requirements.', lead: 'Seven capability areas, each handled by people with the relevant expertise. Choose the one closest to your need, or describe your requirement and we will identify what it needs.', crumbs: [['/services', 'Services']], artKind: 'services' })}

${section(`${headSplit('Where to start', 'What do you need?', 'Choose the statement closest to your requirement. Each one leads to the service that handles it.')}
<ul class="intents">${INTENTS.map(([t, h, l]) => `<li><a href="${h}"><span>${esc(t)}</span><em>${esc(l)}</em>${icon('arrow')}</a></li>`).join('')}</ul>`, 'tight intents-sec')}

${section(`<div class="svc-list">${services.map((x, i) => `
  <article class="svc-row reveal" id="${esc(x.slug)}">
    <span class="svc-row-no">${pad2(i)}</span>
    <div class="svc-row-main"><h2><a href="/services/${esc(x.slug)}">${esc(x.title)}</a></h2><p>${esc(x.summary)}</p>${x.for ? `<p class="svc-row-for"><span class="mini-label">Who it is for</span>${esc(x.for)}</p>` : ''}</div>
    <div class="svc-row-areas"><p class="mini-label">Key areas</p><ul class="pills">${(x.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
    <a class="btn btn-outline svc-row-go" href="/services/${esc(x.slug)}" aria-label="Explore ${esc(x.title)}">Explore ${icon('arrow')}</a>
  </article>`).join('')}</div>`)}

${section(`${headSplit('One process', 'Every requirement runs the same seven steps.', 'Whether it is a website, a campaign or a supply requirement, the work is understood, researched, planned, built or sourced, coordinated, reviewed and supported.')}
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
    actions: `<a href="/request-service?service=${encodeURIComponent(SERVICE_OPTION[x.slug] || 'Other')}${x.slug === 'partnerships-development' ? '&amp;type=Partnership' : ''}" class="btn btn-light">Request this service ${icon('arrow')}</a>` })}

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
  return layout(req, { title: 'Solutions', description: 'Solutions for businesses, brands, growing businesses, sourcing requirements, NGOs and development organizations, institutions and project partners, from MONOHA SOURCING INTERNATIONAL.', body: `
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
  return layout(req, { title: 'Our Process', description: 'The seven-step process MONOHA SOURCING INTERNATIONAL uses on websites, content, marketing, SEO, sourcing and project work, and what you hear from us at each step.', body: `
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
  const w = content('work');
  const cats = w.categories || [];
  const pick = cats.includes(req.query.category) ? req.query.category : '';
  const projects = (w.projects || []).filter((p) => !pick || p.category === pick);
  return layout(req, { title: pick ? `${pick} Work` : 'Our Work', description: pick ? `${pick} projects and case studies from MONOHA SOURCING INTERNATIONAL, published only with permission and verified results.` : 'Selected work and case studies from MONOHA SOURCING INTERNATIONAL, published only with permission and verified results.', body: `
${pageHero({ eyebrow: 'Our Work', title: 'Selected Work', lead: 'Projects and case studies will be presented here as they become available for public presentation.', crumbs: [['/work', 'Our Work']], artKind: 'work' })}

${section(`<nav class="chips work-chips" aria-label="Work categories"><a href="/work"${!pick ? ' class="is-active" aria-current="page"' : ''}>All</a>${cats.map((k) => `<a href="/work?category=${encodeURIComponent(k)}"${pick === k ? ' class="is-active" aria-current="page"' : ''}>${esc(k)}</a>`).join('')}</nav>`, 'tight chips-sec')}

${projects.length ? section(projects.map((p) => `<article class="case reveal">
    <div class="case-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : coverArt({ slug: p.slug || p.name, category: p.industry || '' })}</div>
    <div class="case-body"><p class="mini-label">${esc(p.category || 'Project')}</p><h2>${esc(p.name)}</h2>${p.industry ? `<p class="case-ind"><span>Industry</span>${esc(p.industry)}</p>` : ''}
      <dl>${CASE_FIELDS.filter(([, k]) => p[k]).map(([l, k]) => `<div><dt>${l}</dt><dd>${esc(p[k])}</dd></div>`).join('')}</dl></div></article>`).join(''))
    : pick ? section(`<div class="empty-state work-empty reveal"><p class="mini-label">${esc(pick)}</p><h2>No published ${esc(pick)} projects yet.</h2>
    <p>Projects appear here only once the client has approved publication and the outcome can be verified.</p>
    <div class="hero-actions"><a href="/request-service" class="btn btn-primary">Discuss a requirement ${icon('arrow')}</a><a href="/work" class="btn btn-outline">All work</a></div></div>`)
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

// ---------------------------------------------------------------- partners
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
pages['/partners'] = (req) => {
  const list = activePartners();
  return layout(req, { title: 'Our Partners', description: 'Organizations, institutions, suppliers and development partners MONOHA SOURCING INTERNATIONAL collaborates with across sourcing, supply, digital and project-based initiatives.', active: '/about', body: `
${pageHero({ eyebrow: 'Our Partners', title: 'Working together across sourcing, supply and projects.', lead: 'We collaborate with organizations, institutions, suppliers, development partners and other stakeholders across sourcing, supply, digital and project-based initiatives.', crumbs: [['/about', 'About'], ['/partners', 'Our Partners']], artKind: 'about' })}
${section(list.length ? `<div class="partners">${list.map((x) => {
    const url = safeUrl(x.website);
    return `<article class="partner reveal">
    <div class="partner-logo">${x.logo ? `<img src="${esc(x.logo)}" alt="${esc(x.name)} logo" loading="lazy">` : `<span aria-hidden="true">${esc(String(x.name).slice(0, 1))}</span>`}</div>
    ${x.category ? `<p class="partner-cat">${esc(x.category)}</p>` : ''}<h2>${esc(x.name)}</h2>
    ${x.description ? `<p>${esc(x.description)}</p>` : ''}
    ${x.project ? `<p class="partner-proj"><span class="mini-label">Project</span>${esc(x.project)}</p>` : ''}
    ${url ? `<a class="link-arrow" href="${esc(url)}" target="_blank" rel="noopener">Visit Website ${icon('arrow')}</a>` : ''}
  </article>`;
  }).join('')}</div>`
    : `<div class="empty-state"><span class="empty-ico">${icon('handshake')}</span><h2>Partner profiles coming soon</h2><p>Details of the organizations we work with will be published here. To discuss a collaboration, get in touch.</p><div class="empty-actions"><a href="/contact" class="btn btn-primary">Contact Us ${icon('arrow')}</a></div></div>`, 'partners-sec')}
${ctaBand({ eyebrow: 'Partnerships', title: 'Interested in working together?', text: 'Tell us about your organization and the collaboration you have in mind.', actions: `<a href="/request-service?service=Project%20Support&amp;type=Partnership" class="btn btn-light">Discuss a Partnership ${icon('arrow')}</a><a href="/contact" class="btn btn-ghost-light">Get in Touch</a>` })}` });
};

// ---------------------------------------------------------------- programs
const fmtRange = (a, b) => [a, b].filter(Boolean).map(fmtDate).join(' – ');
const programCard = (x) => `<a class="prog reveal" href="/programs/${esc(x.slug)}">
  <div class="prog-cover">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : `<span aria-hidden="true">${icon('calendar')}</span>`}${x.status ? `<em class="prog-status">${esc(x.status)}</em>` : ''}</div>
  <div class="prog-body">${x.category ? `<p class="prog-cat">${esc(x.category)}</p>` : ''}<h2>${esc(x.title)}</h2>${x.summary ? `<p>${esc(x.summary)}</p>` : ''}
  <p class="prog-meta">${x.startDate ? `<span>${icon('calendar')}${fmtRange(x.startDate, x.endDate)}</span>` : ''}${x.location ? `<span>${icon('pin')}${esc(x.location)}</span>` : ''}</p>
  <span class="link-arrow">View program ${icon('arrow')}</span></div></a>`;
pages['/programs'] = (req) => {
  const list = publishedPrograms();
  return layout(req, { title: 'Programs', description: 'Programs and project initiatives from MONOHA SOURCING INTERNATIONAL.', active: '/about', body: `
${pageHero({ eyebrow: 'Programs', title: 'Programs & project initiatives.', lead: 'Programs and project-based initiatives MONOHA is running or supporting.', crumbs: [['/about', 'About'], ['/programs', 'Programs']], artKind: 'work' })}
${section(list.length ? `<div class="progs">${list.map(programCard).join('')}</div>`
    : `<div class="empty-state"><span class="empty-ico">${icon('calendar')}</span><h2>Programs Coming Soon</h2><p>We are preparing details of our upcoming programs and project initiatives. Please check back soon or explore our services and get in touch.</p><div class="empty-actions"><a href="/services" class="btn btn-primary">Explore Our Services ${icon('arrow')}</a><a href="/contact" class="btn btn-outline">Contact Us</a></div></div>`, 'progs-sec')}
${ctaBand()}` });
};
function programPage(req, res) {
  const x = publishedPrograms().find((p) => p.slug === req.params.slug);
  if (!x) return notFound(req, res);
  const link = safeUrl(x.link);
  res.send(layout(req, { title: x.title, description: x.summary || x.title, active: '/about', body: `
${pageHero({ eyebrow: x.category || 'Program', title: x.title, lead: x.summary, crumbs: [['/programs', 'Programs'], [`/programs/${x.slug}`, x.title]], cls: 'phero-plain' })}
${section(`<div class="detail">
  <div class="prose">${x.cover ? `<img class="prog-hero-img" src="${esc(x.cover)}" alt="">` : ''}${String(x.description || '').split(/\n{2,}/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('')}</div>
  <aside class="detail-aside"><dl class="facts">${x.status ? `<dt>Status</dt><dd>${esc(x.status)}</dd>` : ''}${x.startDate ? `<dt>Dates</dt><dd>${fmtRange(x.startDate, x.endDate)}</dd>` : ''}${x.location ? `<dt>Location</dt><dd>${esc(x.location)}</dd>` : ''}${x.category ? `<dt>Category</dt><dd>${esc(x.category)}</dd>` : ''}</dl>
    ${link ? `<a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener">More information ${icon('arrow')}</a>` : ''}<a class="link-arrow" href="/programs">All programs ${icon('arrow')}</a></aside>
</div>`)}
${ctaBand()}` }));
}

// ---------------------------------------------------------------- insights
pages['/insights'] = (req) => {
  const articles = sortedArticles();
  const INSIGHT_CATS = content('insights').categories || [];
  // "Marketing & SEO" in the menu is a group of two categories.
  const GROUPS = { 'Marketing & SEO': ['Marketing', 'SEO'] };
  const pick = INSIGHT_CATS.includes(req.query.category) || GROUPS[req.query.category] ? req.query.category : '';
  const inPick = (c) => (GROUPS[pick] ? GROUPS[pick].includes(c) : c === pick);
  const list = pick ? articles.filter((a) => inPick(a.category)) : articles;
  return layout(req, { title: pick ? `${pick} Insights` : 'Insights', description: 'Notes, perspectives and practical knowledge on business, sourcing, digital, marketing, technology and operations from MONOHA SOURCING INTERNATIONAL.', body: `
${pageHero({ eyebrow: 'Insights', title: 'Notes, perspectives and practical knowledge.', lead: 'Plain, practical writing on business, sourcing, digital work and operations from the Monoha team.', crumbs: [['/insights', 'Insights']], artKind: 'insights' })}
${section(`<nav class="chips" aria-label="Categories"><a href="/insights"${!pick ? ' class="is-active" aria-current="page"' : ''}>All</a>${INSIGHT_CATS.map((c) => `<a href="/insights?category=${encodeURIComponent(c)}"${pick && inPick(c) ? ' class="is-active"' : ''}${pick === c ? ' aria-current="page"' : ''}>${esc(c)}</a>`).join('')}</nav>
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

${subnav('Careers sections', [['why-work-with-us', 'Why MONOHA'], ['work-environment', 'Work With Us'], ['openings', 'Open Positions'], ['application-process', 'Application Process'], ...(faqs.length ? [['careers-faq', 'FAQ']] : [])])}

${section(`${headSplit('Why work with us', 'Practical work, clearly organised.', 'What working here involves. We only describe what is true today.')}${plainCards(c.why || [])}`, '', 'why-work-with-us')}

${section(`<div class="env">
  <div class="reveal"><p class="eyebrow">Work environment</p><h2>Ownership, direct communication, follow-through.</h2></div>
  <div class="reveal"><p class="lead">${esc(c.environment)}</p>${ticks(c.environmentPoints)}</div>
</div>`, 'dark', 'work-environment')}

${section(`<div class="split">
  <div class="reveal"><p class="eyebrow">Learning &amp; development</p><h2>Learn the work by doing the work.</h2><p class="lead">${esc(c.learning)}</p></div>
  <div class="card reveal"><h3>Internships</h3><p>${esc(c.internship)}</p></div>
</div>`, 'soft')}

${section(`${headSplit('Current opportunities', open.length ? `${open.length} open position${open.length > 1 ? 's' : ''}` : 'No open positions right now', open.length ? 'Select a role for details and how to apply.' : 'Open positions will appear here when available. You can still send your CV; we keep it on file and contact you if a suitable role opens.')}
  ${open.length ? `<div class="jobs">${open.map((j) => `<a class="job reveal" href="/careers/${esc(j.slug)}"><div><h3>${esc(j.title)}</h3><p>${esc(j.type)} · ${esc(j.location)}</p></div><span class="link-arrow">View role ${icon('arrow')}</span></a>`).join('')}</div>`
    : `<div class="empty-state left"><a href="/contact?subject=${encodeURIComponent('CV submission')}" class="btn btn-primary">Send your CV ${icon('arrow')}</a></div>`}`, '', 'openings')}

${section(`${headSplit('How recruitment works', 'Four steps, clearly communicated.', 'Sending an application does not guarantee an interview or employment.')}
  <ol class="rsteps">${(c.process || []).map((p, i) => `<li class="reveal"><span>${pad2(i)}</span><h3>${esc(p.title || p)}</h3>${p.text ? `<p>${esc(p.text)}</p>` : ''}</li>`).join('')}</ol>`, 'soft', 'application-process')}

${faqs.length ? section(`<div class="faq-split"><div><p class="eyebrow">FAQ</p><h2>Careers questions</h2></div>${faqList(faqs)}</div>`, '', 'careers-faq') + faqLd(faqs) : ''}

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
  service: ['Sourcing & Supply', 'Supplier Sourcing', 'Business Solutions', 'Website & Digital', 'Content & Creative', 'Social Media', 'Marketing & Promotion', 'SEO', 'Project Support', 'NGO / Development Project', 'Institutional Support', 'Other'],
  requirementType: ['New Project', 'Ongoing Support', 'Sourcing Requirement', 'Business Inquiry', 'Partnership', 'Project Collaboration', 'Other'],
  subject: ['General Inquiry', 'Sourcing Requirement', 'Supplier / Supply Inquiry', 'Business Solution', 'Digital / Website', 'Content / Marketing', 'SEO', 'Project / Partnership', 'NGO / Development', 'Other'],
  budget: ['Not sure yet', 'Under USD 1,000', 'USD 1,000 – 5,000', 'USD 5,000 – 20,000', 'Over USD 20,000', 'Prefer to discuss'],
  timeline: ['As soon as possible', 'Within 1 month', '1 – 3 months', 'More than 3 months', 'Flexible'],
};
function formFields(kind, q) {
  const f = (id, label, type = 'text', req = false, extra = '') => `
    <div class="field"><label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <input id="${id}" name="${id}" type="${type}"${req ? ' required aria-required="true"' : ''}${extra}></div>`;
  const sel = (id, label, opts, req = false, hint = '') => `
    <div class="field"><label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}${hint ? ` <span class="opt">${hint}</span>` : ''}</label>
    <select id="${id}" name="${id}"${req ? ' required aria-required="true"' : ''}>${id === 'subject' ? '' : '<option value="">Choose one</option>'}${opts}</select></div>`;
  const pick = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  const list = (k, v) => options(SELECTS[k], pick(v));
  if (kind === 'contact') return `
    <div class="row">${f('name', 'Full name', 'text', true, ' autocomplete="name" maxlength="120" placeholder="Your name"')}${f('company', 'Company name', 'text', false, ' autocomplete="organization" maxlength="160" placeholder="Optional"')}</div>
    <div class="row">${f('email', 'Email address', 'email', true, ' autocomplete="email" maxlength="160" placeholder="you@company.com"')}${f('phone', 'Phone', 'tel', false, ' autocomplete="tel" maxlength="40" placeholder="Include country code"')}</div>
    <div class="row">${sel('subject', 'Subject', list('subject', q.subject || 'General Inquiry'))}${sel('requirementType', 'Requirement type', list('requirementType', q.type), false, 'optional')}</div>
    <div class="field"><label for="message">Message <span class="req" aria-hidden="true">*</span></label><textarea id="message" name="message" rows="6" required aria-required="true" maxlength="4000" placeholder="How can we help?"></textarea></div>
    <div class="field"><label for="attachment">Attachment <span class="opt">optional · PDF, image or document, up to 5 MB</span></label><input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"></div>`;
  return `
    <fieldset><legend>About you</legend>
    <div class="row">${f('name', 'Full name', 'text', true, ' autocomplete="name" maxlength="120"')}${f('company', 'Company name', 'text', false, ' autocomplete="organization" maxlength="160"')}</div>
    <div class="row">${f('email', 'Email', 'email', true, ' autocomplete="email" maxlength="160"')}${f('phone', 'Phone', 'tel', false, ' autocomplete="tel" maxlength="40"')}</div>
    ${f('country', 'Country', 'text', false, ' autocomplete="country-name" maxlength="80"')}</fieldset>
    <fieldset><legend>Your requirement</legend>
    <div class="row">${sel('service', 'Service required', list('service', q.service), true)}${sel('requirementType', 'Requirement type', list('requirementType', q.type))}</div>
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
  <div class="form-foot"><p class="form-note">Fields marked <span class="req">*</span> are required. We use your details only to reply. <a href="/privacy-policy">Privacy Policy</a></p>
  <button type="submit" class="btn btn-primary">${kind === 'contact' ? 'Send Message' : 'Send Request'} ${icon('arrow')}</button></div>
  <p class="form-status" role="status" aria-live="polite"></p>
</form>
<div class="form-done" hidden tabindex="-1"><span class="done-icon">${icon('check')}</span><h2>Thank you.</h2><p>${kind === 'contact' ? 'Our team will review your message and contact you.' : 'Our team will review your requirement and contact you.'}</p></div>`;

// ---------------------------------------------------------------- contact
pages['/contact'] = (req) => {
  const c = content('site').contact || {};
  const rows = [
    ['mail', 'Email', c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email).replace('@', '@<wbr>')}</a>`],
    ['phone', 'Phone', c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`],
    ['pin', 'Office', c.address && `<address>${addressHtml(c)}</address>`],
    ['web', 'Website', '<a href="https://monohasourcing.international">monohasourcing.international</a>'],
  ].filter((r) => r[2]);
  return layout(req, { title: 'Contact', description: "Contact MONOHA SOURCING INTERNATIONAL in Cox's Bazar, Bangladesh about sourcing, supply, business solutions and digital support requirements.", body: `
${pageHero({ eyebrow: 'Contact MONOHA', title: 'Get in touch with our team.', lead: 'Whether you are looking for a sourcing partner, supplier support, business solution, digital service or project collaboration, tell us what you need and our team will review it.', crumbs: [['/contact', 'Contact']], artKind: 'contact', cls: 'phero-contact' })}
${section(`<div class="contact-main">
  <aside class="contact-info">
    <p class="eyebrow">Contact</p><h2>Let's discuss your requirement.</h2>
    <p class="lead">Send us a message and our team will reply by email. For a detailed brief, use the Request a Service form.</p>
    <ul class="cinfo">${rows.map(([i, l, v]) => `<li><span class="cinfo-ico">${icon(i)}</span><div><p class="mini-label">${l}</p>${v}</div></li>`).join('')}</ul>
    ${c.address ? `<div class="map-card">
      <iframe title="Map showing the MONOHA office in Cox's Bazar" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(c.mapQuery || c.address)}&output=embed"></iframe>
      <a class="map-open" href="${esc(mapUrl(c))}" target="_blank" rel="noopener">Open in Maps ${icon('arrow')}</a>
    </div>` : ''}
  </aside>
  <div class="form-card contact-form">
    <h2>Send us a message</h2>
    <p class="contact-form-lead">Our team reads every message and replies by email.</p>
    ${inquiryForm('contact', req.query)}
    <p class="contact-alt">Have a specific requirement? <a href="/request-service" class="link-arrow">Request a Service ${icon('arrow')}</a></p>
  </div>
</div>`, 'contact-sec')}` });
};

// ---------------------------------------------------------------- request
pages['/request-service'] = (req) => layout(req, { title: 'Request a Service', description: 'Tell MONOHA SOURCING INTERNATIONAL what you need. Send any business, sourcing, digital or online requirement and our team will review it and contact you.', body: `
${pageHero({ eyebrow: 'Request a Service', title: 'Tell Us What You Need', lead: 'For a specific requirement or project: sourcing and supply, business solutions, digital, content, marketing, SEO, project support or a partnership. Sending a request does not commit you to anything.', crumbs: [['/request-service', 'Request a Service']], artKind: 'request' })}
${section(`<div class="request-grid">
  <div class="form-card">${inquiryForm('request', req.query)}</div>
  <aside class="request-aside">
    <div><p class="mini-label">What happens next</p><ol class="next-steps"><li><b>We review</b>Our team reads your requirement and checks it fits our services.</li><li><b>We reply</b>We contact you by email or phone, usually with a few clarifying questions.</li><li><b>We agree scope</b>If we can help, we agree the work in writing before anything starts.</li></ol></div>
    <div class="tips"><p class="mini-label">A useful request includes</p>${ticks(['What you need and what it is for', 'Scope, standard or quantity', 'When you need it', 'Reference files, links or examples'])}</div>
    <div class="aside-note"><p class="mini-label">Partnership or project collaboration?</p><p>Choose <b>Partnership</b> or <b>Project Collaboration</b> as the requirement type.</p></div>
    <div class="aside-note"><p class="mini-label">Just want to talk?</p><p>For a general question, <a href="/contact">get in touch</a> instead.</p></div>
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
// Images uploaded through the admin (partner logos, program covers, CEO photo).
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h', dotfiles: 'deny' }));

// Remove trailing slashes so each page has one address.
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    return res.redirect(301, req.path.slice(0, -1) + req.originalUrl.slice(req.path.length));
  }
  next();
});

for (const [p, fn] of Object.entries(pages)) app.get(p, (req, res) => res.send(fn(req)));
app.get('/request', (req, res) => res.redirect(301, '/request-service' + req.originalUrl.slice(req.path.length)));
const OLD_SERVICES = { 'international-sourcing': 'business-sourcing', 'product-supplier-sourcing': 'business-sourcing', 'business-coordination': 'business-solutions', 'sourcing-support': 'business-sourcing', 'international-business-support': 'business-solutions', 'professional-websites': 'digital-online-solutions', 'social-digital-presence': 'content-creative' };
app.get('/services/:slug', (req, res, next) => (OLD_SERVICES[req.params.slug] ? res.redirect(301, '/services/' + OLD_SERVICES[req.params.slug]) : next()), servicePage);
app.get('/insights/:slug', articlePage);
app.get('/careers/:slug', jobPage);
app.get('/programs/:slug', programPage);
require('./admin')(app, { STORE, UPLOAD_DIR, DATA_DIR, readJSON, esc, slugify, leadership, DEFAULT_CEO, notFound });

app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = [...Object.keys(pages),
    ...(content('services').services || []).map((x) => '/services/' + x.slug),
    ...(content('insights').articles || []).map((x) => '/insights/' + x.slug),
    ...(content('careers').jobs || []).filter((j) => j.open).map((x) => '/careers/' + x.slug),
    ...publishedPrograms().map((x) => '/programs/' + x.slug)];
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
