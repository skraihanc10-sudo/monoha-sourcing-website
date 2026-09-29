// MONOHA Workspace: board drag and drop, file upload, confirmations.
(function () {
  var meta = document.querySelector('meta[name=csrf]');
  var csrf = meta ? meta.content : '';

  // Ask before destructive form posts (data-confirm on the form).
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  }, true);

  // ---- board
  var drag = null;
  function counts() {
    document.querySelectorAll('.kb-col').forEach(function (col) {
      col.querySelector('.kb-count').textContent = col.querySelectorAll('.kb-card').length;
    });
  }
  document.querySelectorAll('.kb-card[draggable=true]').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      drag = card; card.classList.add('is-drag');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', function () { card.classList.remove('is-drag'); });
  });
  document.querySelectorAll('.kb-col').forEach(function (col) {
    var list = col.querySelector('.kb-list');
    col.addEventListener('dragover', function (e) { if (drag) { e.preventDefault(); col.classList.add('is-over'); } });
    col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('is-over');
      var card = drag; drag = null;
      if (!card || card.parentNode === list) return;
      var from = card.parentNode;
      list.prepend(card); counts();
      fetch('/team/tasks/' + card.dataset.id + '/status', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ status: col.dataset.status, _csrf: csrf }),
      }).then(function (r) {
        return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not move the task.'); });
      }).catch(function (err) {
        from.prepend(card); counts();
        window.alert(err.message || 'Could not move the task.');
      });
    });
  });

  // ---- file upload (sent as the raw file body)
  var up = document.getElementById('upload-form');
  if (up) up.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = up.querySelector('input[type=file]');
    var msg = up.querySelector('.ws-err');
    var btn = up.querySelector('button');
    var f = input.files[0];
    if (!f) { msg.textContent = 'Choose a file first.'; return; }
    if (f.size > 10 * 1024 * 1024) { msg.textContent = 'This file is larger than 10 MB.'; return; }
    msg.textContent = ''; btn.disabled = true; btn.textContent = 'Uploading…';
    fetch(up.getAttribute('action'), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name), 'X-CSRF': csrf, Accept: 'application/json' },
      body: f,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Upload failed. Try again.'); location.reload(); });
    }).catch(function (err) {
      msg.textContent = err.message; btn.disabled = false; btn.textContent = 'Upload';
    });
  });
})();
