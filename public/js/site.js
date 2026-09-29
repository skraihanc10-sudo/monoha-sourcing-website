// Menu, a gentle reveal, the hero globe, and the two enquiry forms.
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
  }

  // ------------------------------------------------------------ copy link
  document.querySelectorAll('.copy-link').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = 'Link copied'; } catch (e) { /* ignore */ }
  }));

  // ------------------------------------------------------------ globe
  // A dotted globe turning slowly, with arcs between points: the
  // "connecting markets" idea from the logo, drawn rather than photographed.
  const cv = document.getElementById('globe');
  if (cv && cv.getContext) {
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = 520;
    cv.width = S * dpr; cv.height = S * dpr; ctx.scale(dpr, dpr);
    const R = 200, C = S / 2;
    const pts = [];
    for (let lat = -80; lat <= 80; lat += 8) {
      const n = Math.max(6, Math.round(46 * Math.cos(lat * Math.PI / 180)));
      for (let i = 0; i < n; i++) pts.push([lat * Math.PI / 180, (i / n) * Math.PI * 2]);
    }
    const hubs = [[23.7, 90.4], [31.2, 121.5], [25.2, 55.3], [51.5, -0.1], [1.35, 103.8], [40.7, -74]]
      .map(([a, b]) => [a * Math.PI / 180, b * Math.PI / 180]);
    const tilt = -0.35;
    const proj = (lat, lon, rot) => {
      const x = Math.cos(lat) * Math.sin(lon + rot);
      let y = Math.sin(lat);
      let z = Math.cos(lat) * Math.cos(lon + rot);
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [C + x * R, C - y2 * R, z2];
    };
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rot = -1.2;
    const draw = () => {
      ctx.clearRect(0, 0, S, S);
      const g = ctx.createRadialGradient(C - 60, C - 70, 20, C, C, R + 30);
      g.addColorStop(0, 'rgba(25,184,240,.22)'); g.addColorStop(1, 'rgba(21,83,209,.04)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.fill();
      for (const [la, lo] of pts) {
        const [x, y, z] = proj(la, lo, rot);
        if (z < 0) continue;
        ctx.fillStyle = `rgba(21,83,209,${0.18 + z * 0.6})`;
        ctx.beginPath(); ctx.arc(x, y, 1.2 + z * 1.3, 0, Math.PI * 2); ctx.fill();
      }
      const home = hubs[0];
      for (let i = 1; i < hubs.length; i++) {
        const seg = [];
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const la = home[0] + (hubs[i][0] - home[0]) * t;
          const lo = home[1] + (hubs[i][1] - home[1]) * t;
          const p = proj(la, lo, rot); const lift = 1 + Math.sin(Math.PI * t) * 0.18;
          seg.push([C + (p[0] - C) * lift, C + (p[1] - C) * lift, p[2]]);
        }
        if (seg.every((p) => p[2] < 0)) continue;
        ctx.strokeStyle = 'rgba(25,184,240,.85)'; ctx.lineWidth = 1.6; ctx.beginPath();
        seg.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      }
      for (const [la, lo] of hubs) {
        const [x, y, z] = proj(la, lo, rot);
        if (z < 0) continue;
        ctx.fillStyle = '#0A1A3F'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#19B8F0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
      }
      if (!still) { rot += 0.0025; requestAnimationFrame(draw); }
    };
    draw();
  }

  // ------------------------------------------------------------ forms
  document.querySelectorAll('form[data-kind]').forEach((form) => {
    const status = form.querySelector('.form-status');
    const done = form.nextElementSibling;
    const say = (msg, bad) => { status.textContent = msg; status.classList.toggle('is-error', !!bad); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const missing = Array.from(form.querySelectorAll('[required]')).find((el) => !el.value.trim());
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
        form.hidden = true; done.hidden = false; done.scrollIntoView({ block: 'center' });
      } catch (err) {
        say(err.message, true);
      } finally { button.disabled = false; }
    });
  });
})();
