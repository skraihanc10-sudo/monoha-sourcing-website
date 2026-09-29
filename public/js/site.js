// Menu, header state, scroll reveal, the hero globe, and the enquiry forms.
(function () {
  document.documentElement.classList.add('js');

  // ------------------------------------------------------------ menu
  const btn = document.getElementById('menu-btn');
  if (btn) {
    const set = (open) => {
      document.body.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    btn.addEventListener('click', () => set(!document.body.classList.contains('menu-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
    // A link to a section of the current page does not reload it, so close the menu ourselves.
    const nav = document.getElementById('nav');
    if (nav) nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  }

  // ------------------------------------------------------------ dropdowns
  // Hover opens them on desktop (CSS); the chevron button opens them by click, tap or keyboard,
  // and in the mobile menu they work as accordions.
  const items = document.querySelectorAll('.nav-item');
  const openItem = (it, open) => {
    it.classList.toggle('is-open', open);
    it.querySelector('.nav-toggle').setAttribute('aria-expanded', String(open));
  };
  const mobile = () => document.body.classList.contains('menu-open');
  items.forEach((it) => {
    const t = it.querySelector('.nav-toggle');
    t.addEventListener('click', () => {
      const open = !it.classList.contains('is-open');
      items.forEach((o) => { if (o !== it && !mobile()) openItem(o, false); });
      openItem(it, open);
    });
    it.addEventListener('focusout', (e) => { if (!mobile() && !it.contains(e.relatedTarget)) openItem(it, false); });
    it.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && it.classList.contains('is-open')) { e.stopPropagation(); openItem(it, false); t.focus(); }
    });
  });
  document.addEventListener('click', (e) => { if (!mobile() && !e.target.closest('.nav-item')) items.forEach((o) => openItem(o, false)); });

  // ------------------------------------------------------------ section menu
  const sub = document.querySelector('.subnav');
  if (sub && 'IntersectionObserver' in window) {
    const links = [...sub.querySelectorAll('a')];
    const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
    const ul = sub.querySelector('ul');
    const mark = (a) => {
      links.forEach((l) => l.classList.toggle('is-active', l === a));
      if (a && ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) mark(byId.get(en.target.id)); });
    }, { rootMargin: '-35% 0px -60% 0px' });
    byId.forEach((a, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  // ------------------------------------------------------------ copy link
  document.querySelectorAll('.copy-link').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = 'Link copied'; } catch (e) { /* ignore */ }
  }));

  // ------------------------------------------------------------ header
  const header = document.getElementById('header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ------------------------------------------------------------ reveal
  // Only what starts below the fold fades in; anything already on screen
  // stays visible, so the first frame is never empty.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el, i) => {
      if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add('is-in'); return; }
      el.style.transitionDelay = (i % 3) * 80 + 'ms';
      io.observe(el);
    });
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
  }

  // ------------------------------------------------------------ globe
  // A dotted world turning slowly: land picked out from rough continent
  // shapes, two thin orbits, and routes from Dhaka to trading hubs with a
  // pulse travelling along each one.
  const cv = document.getElementById('globe');
  if (cv && cv.getContext) {
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = 560, C = S / 2, R = 190;
    cv.width = S * dpr; cv.height = S * dpr; ctx.scale(dpr, dpr);
    const rad = Math.PI / 180;

    // [lat, lon, latRadius, lonRadius] — coarse, but reads as a world map.
    const LAND = [[50, -102, 20, 36], [64, -150, 8, 18], [18, -95, 9, 12], [-14, -60, 20, 15], [-38, -67, 12, 7],
      [73, -40, 8, 14], [52, 12, 11, 20], [63, 20, 7, 12], [8, 18, 22, 20], [-18, 26, 16, 12], [27, 46, 10, 13],
      [55, 90, 16, 50], [35, 105, 13, 22], [21, 78, 10, 8], [10, 104, 8, 10], [-3, 118, 6, 16], [36, 138, 6, 4], [-25, 134, 11, 17]];
    const isLand = (la, lo) => LAND.some(([a, b, ra, rb]) => {
      let d = lo - b; if (d > 180) d -= 360; if (d < -180) d += 360;
      return ((la - a) / ra) ** 2 + (d / rb) ** 2 <= 1;
    });
    const dots = [];
    for (let la = -78; la <= 80; la += 3.4) {
      const n = Math.max(8, Math.round(106 * Math.cos(la * rad)));
      for (let k = 0; k < n; k++) {
        const lo = -180 + (k / n) * 360;
        const land = isLand(la, lo);
        if (land || k % 3 === 0) dots.push([la * rad, lo * rad, land]);
      }
    }
    const hubs = [[23.8, 90.4], [31.2, 121.5], [25.2, 55.3], [51.5, -0.1], [1.35, 103.8], [40.7, -74], [22.3, 114.2]]
      .map(([a, b]) => [a * rad, b * rad]);
    const tilt = -0.38;
    const proj = (lat, lon, rot, r = R) => {
      const x = Math.cos(lat) * Math.sin(lon + rot);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.cos(lon + rot);
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [C + x * r, C - y2 * r, z2];
    };
    // A great-circle route between two points, lifted off the surface.
    const route = (a, b) => {
      const v = (p) => [Math.cos(p[0]) * Math.cos(p[1]), Math.cos(p[0]) * Math.sin(p[1]), Math.sin(p[0])];
      const A = v(a), B = v(b);
      const out = [];
      for (let t = 0; t <= 1.0001; t += 1 / 40) {
        const m = A.map((c, i) => c * (1 - t) + B[i] * t);
        const l = Math.hypot(...m);
        out.push([Math.asin(m[2] / l), Math.atan2(m[1], m[0]), 1 + Math.sin(Math.PI * t) * 0.16]);
      }
      return out;
    };
    const routes = hubs.slice(1).map((h) => route(hubs[0], h));
    const ring = (rx, ry, ang, rot, phase) => {
      // Orbit: an ellipse around the globe, split into front and back halves.
      const pts = [];
      for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.04) {
        const x = Math.cos(t + phase) * rx, y = Math.sin(t + phase) * ry;
        pts.push([C + x * Math.cos(ang) - y * Math.sin(ang), C + x * Math.sin(ang) + y * Math.cos(ang), Math.sin(t + phase)]);
      }
      return pts;
    };

    let rot = -1.35, tick = 0;
    const draw = () => {
      ctx.clearRect(0, 0, S, S);
      // glow and body
      const glow = ctx.createRadialGradient(C, C, R * 0.6, C, C, R * 1.45);
      glow.addColorStop(0, 'rgba(0,191,239,.16)'); glow.addColorStop(1, 'rgba(0,191,239,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(C, C, R * 1.45, 0, Math.PI * 2); ctx.fill();
      const body = ctx.createRadialGradient(C - R * 0.35, C - R * 0.4, R * 0.1, C, C, R);
      body.addColorStop(0, '#FFFFFF'); body.addColorStop(0.55, '#EAF3FF'); body.addColorStop(1, '#C9DBF7');
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fill();

      // back orbit halves
      const orbits = [ring(R * 1.32, R * 0.34, -0.42, rot, 0), ring(R * 1.22, R * 0.26, 0.5, rot, 1.2)];
      ctx.lineWidth = 1;
      for (const o of orbits) {
        ctx.strokeStyle = 'rgba(20,85,217,.14)'; ctx.beginPath();
        o.forEach((p, k) => (p[2] < 0 ? (k && o[k - 1][2] < 0 ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])) : null)); ctx.stroke();
      }

      // contour lines
      ctx.strokeStyle = 'rgba(20,85,217,.10)'; ctx.lineWidth = 0.8;
      for (let lo = 0; lo < 360; lo += 30) {
        ctx.beginPath(); let on = false;
        for (let la = -90; la <= 90; la += 4) { const [x, y, z] = proj(la * rad, lo * rad, rot); if (z < 0) { on = false; continue; } on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; }
        ctx.stroke();
      }
      for (let la = -60; la <= 60; la += 30) {
        ctx.beginPath(); let on = false;
        for (let lo = 0; lo <= 360; lo += 4) { const [x, y, z] = proj(la * rad, lo * rad, rot); if (z < 0) { on = false; continue; } on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; }
        ctx.stroke();
      }

      // dots
      for (const [la, lo, land] of dots) {
        const [x, y, z] = proj(la, lo, rot);
        if (z < 0.02) continue;
        ctx.fillStyle = land ? `rgba(7,26,65,${0.25 + z * 0.6})` : `rgba(20,85,217,${0.08 + z * 0.14})`;
        ctx.beginPath(); ctx.arc(x, y, land ? 0.9 + z * 1.1 : 0.7 + z * 0.5, 0, Math.PI * 2); ctx.fill();
      }

      // routes with travelling pulses
      routes.forEach((seg, i) => {
        const pts = seg.map(([la, lo, lift]) => proj(la, lo, rot, R * lift));
        if (pts.every((p) => p[2] < -0.1)) return;
        ctx.strokeStyle = 'rgba(0,191,239,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); let on = false;
        pts.forEach((p) => { if (p[2] < -0.1) { on = false; return; } on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; });
        ctx.stroke();
        const t = ((tick * 0.006 + i * 0.17) % 1);
        const p = pts[Math.round(t * (pts.length - 1))];
        if (p[2] > -0.1) {
          ctx.fillStyle = 'rgba(0,191,239,.25)'; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#00BFEF'; ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2); ctx.fill();
        }
      });

      // hubs
      hubs.forEach(([la, lo], i) => {
        const [x, y, z] = proj(la, lo, rot);
        if (z < 0) return;
        ctx.fillStyle = '#071A41'; ctx.beginPath(); ctx.arc(x, y, i ? 4 : 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = i ? 'rgba(0,191,239,.9)' : '#1455D9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, i ? 8 : 11, 0, Math.PI * 2); ctx.stroke();
      });

      // front orbit halves with a satellite dot
      for (const o of orbits) {
        ctx.strokeStyle = 'rgba(20,85,217,.35)'; ctx.lineWidth = 1.1; ctx.beginPath();
        o.forEach((p, k) => (p[2] >= 0 ? (k && o[k - 1][2] >= 0 ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])) : null)); ctx.stroke();
      }
      const sat = orbits[0][Math.floor((tick * 0.25) % orbits[0].length)];
      if (sat) { ctx.fillStyle = sat[2] >= 0 ? '#1455D9' : 'rgba(20,85,217,.3)'; ctx.beginPath(); ctx.arc(sat[0], sat[1], 3.5, 0, Math.PI * 2); ctx.fill(); }

      if (!still) { rot += 0.0018; tick++; requestAnimationFrame(draw); }
    };
    draw();
  }

  // ------------------------------------------------------------ solutions
  // Editorial rows on desktop (always open), expandable cards on phones.
  const solx = document.querySelectorAll('details.solx');
  if (solx.length) {
    const wide = window.matchMedia('(min-width: 901px)');
    const sync = () => solx.forEach((d) => { if (wide.matches) d.open = true; });
    sync(); wide.addEventListener('change', sync);
    solx.forEach((d) => d.querySelector('summary').addEventListener('click', (e) => { if (wide.matches) e.preventDefault(); }));
    const openTarget = () => {
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target && target.matches('details.solx')) target.open = true;
    };
    openTarget(); window.addEventListener('hashchange', openTarget);
  }

  // ------------------------------------------------------------ footer
  // Link columns are always open on wider screens and collapse on phones.
  const fcols = document.querySelectorAll('details.fcol');
  if (fcols.length) {
    const wideF = window.matchMedia('(min-width: 701px)');
    const syncF = () => fcols.forEach((d) => { d.open = wideF.matches; });
    syncF(); wideF.addEventListener('change', syncF);
    fcols.forEach((d) => d.querySelector('summary').addEventListener('click', (e) => { if (wideF.matches) e.preventDefault(); }));
  }

  // ------------------------------------------------------------ forms
  document.querySelectorAll('form[data-kind]').forEach((form) => {
    const status = form.querySelector('.form-status');
    const done = form.nextElementSibling;
    const say = (msg, bad) => { status.textContent = msg; status.classList.toggle('is-error', !!bad); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
      const missing = Array.from(form.querySelectorAll('[required]')).find((el) => !el.value.trim());
      const email = form.querySelector('input[type=email]');
      if (!missing && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) { email.setAttribute('aria-invalid', 'true'); say('Please enter a valid email address.', true); email.focus(); return; }
      const req = form.querySelector('#requirement');
      if (!missing && req && req.value.trim().length < 20) { req.setAttribute('aria-invalid', 'true'); say('Please describe your requirement in at least 20 characters.', true); req.focus(); return; }
      if (missing) missing.setAttribute('aria-invalid', 'true');
      if (missing) { say('Please fill in: ' + missing.closest('.field').querySelector('label').textContent.replace('*', '').trim(), true); missing.focus(); return; }

      const data = { kind: form.dataset.kind };
      new FormData(form).forEach((v, k) => { if (typeof v === 'string') data[k] = v; });

      const file = form.querySelector('input[type=file]');
      if (file && file.files[0]) {
        const f = file.files[0];
        if (f.size > 5 * 1024 * 1024) { say('The attachment is larger than 5 MB.', true); return; }
        data.attachment = { name: f.name, data: await new Promise((res) => {
          const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f);
        }) };
      }

      const button = form.querySelector('button[type=submit]');
      button.disabled = true; say('Sending…');
      try {
        const r = await fetch('/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
        form.hidden = true; done.hidden = false; done.scrollIntoView({ block: 'center' }); done.focus({ preventScroll: true });
      } catch (err) {
        say(err.message, true);
      } finally { button.disabled = false; }
    });
  });
})();
