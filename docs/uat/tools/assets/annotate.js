/* UAT annotator — injected into the app under test by the bookmarklet.
 *
 * Runs on someone else's page, so it must not disturb it: no globals beyond
 * window.__uatAnnotate, no styles that leak (everything lives in a shadow root),
 * and every listener is removed on close.
 *
 * Talks back to the helper it was loaded from. The helper's origin is baked in
 * by the bookmarklet as window.__uatHelper before this file loads.
 */
(function () {
  'use strict';

  if (window.__uatAnnotate) { window.__uatAnnotate.open(); return; }

  var HELPER = (window.__uatHelper || '').replace(/\/$/, '');
  var SEV = [['', '— how much does it bother you? —'], ['cosmetic', 'Cosmetic — it just looks off'],
             ['annoying', 'Annoying — it works but it bugs me'],
             ['blocker', 'Blocks me — I could not carry on']];

  var pins = [], host = null, root = null, layer = null, listEl = null, headEl = null;
  var testId = '', testTitle = '', tests = [], consoleErrors = [], placing = true, cleanup = [];

  /* ------------------------------------------------------------- utilities */

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.setAttribute('style', css);
    if (text != null) e.textContent = text;
    return e;
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanup.push(function () { target.removeEventListener(type, fn, opts); });
  }
  function req(path, body) {
    return fetch(HELPER + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      mode: 'cors'
    }).then(function (r) { return r.json(); });
  }

  /* Describe whatever sits under a pin, so a developer can find it in the code. */
  function describe(x, y) {
    var node = document.elementFromPoint(x - window.scrollX, y - window.scrollY);
    if (!node || node === document.body || node === document.documentElement) return null;
    var parts = [], label = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    var n = node, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      var seg = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(seg + '#' + n.id); break; }
      if (n.className && typeof n.className === 'string') {
        var cls = n.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) seg += '.' + cls;
      }
      parts.unshift(seg);
      n = n.parentElement;
      depth++;
    }
    return { selector: parts.join(' > '), tag: node.tagName.toLowerCase(), text: label };
  }

  /* ------------------------------------------------------------- the layer */

  var CSS = [
    ':host{all:initial}',
    '.wrap{position:fixed;inset:0;z-index:2147483647;pointer-events:none;',
    '  font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#14181f}',
    '.wrap.placing{pointer-events:auto;cursor:crosshair}',
    '.bar{position:fixed;top:0;left:0;right:0;pointer-events:auto;display:flex;gap:10px;align-items:center;',
    '  flex-wrap:wrap;padding:8px 14px;background:#14181f;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35)}',
    '.bar b{font-weight:650}',
    '.bar .sp{flex:1}',
    '.bar select,.bar button{font:inherit;border-radius:7px;border:1px solid #4a5261;padding:5px 11px;',
    '  background:#23282f;color:#fff;cursor:pointer}',
    '.bar button.go{background:#2563eb;border-color:transparent;font-weight:650}',
    '.bar button.go:disabled{opacity:.45;cursor:not-allowed}',
    '.bar .hint{opacity:.75;font-size:13px}',
    '.pin{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;',
    '  background:#c02626;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;',
    '  justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);pointer-events:auto;cursor:pointer}',
    '.side{position:fixed;top:52px;right:14px;width:310px;max-height:calc(100vh - 70px);overflow-y:auto;',
    '  pointer-events:auto;background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);padding:12px}',
    '.side h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#757e8e}',
    '.item{border-top:1px solid #e8ebef;padding:9px 0}',
    '.item:first-of-type{border-top:0}',
    '.item .n{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#c02626;color:#fff;',
    '  font-size:12px;font-weight:700;align-items:center;justify-content:center;margin-right:6px}',
    '.item textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;border:1px solid #d8dce3;',
    '  border-radius:7px;padding:6px 8px;min-height:52px;resize:vertical;margin-top:5px}',
    '.item .el{font:11px ui-monospace,Consolas,monospace;color:#757e8e;word-break:break-all;margin-top:4px}',
    '.item .rm{float:right;border:0;background:none;color:#c02626;cursor:pointer;font-size:12px}',
    '.empty{color:#757e8e;font-size:13px}',
    '.modal{position:fixed;inset:0;background:rgba(10,12,16,.75);pointer-events:auto;display:flex;',
    '  align-items:center;justify-content:center;padding:24px}',
    '.card{background:#fff;border-radius:12px;padding:20px;max-width:900px;max-height:90vh;overflow:auto;text-align:center}',
    '.card h2{margin:0 0 6px;font-size:18px}',
    '.card p{margin:0 0 14px;color:#4a5261}',
    '.card img{max-width:100%;border:1px solid #d8dce3;border-radius:8px}',
    '.card .row{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}',
    '.card button{font:inherit;font-weight:600;border-radius:8px;padding:9px 16px;cursor:pointer;',
    '  border:1px solid #d8dce3;background:#f0f2f5}',
    '.card button.go{background:#2563eb;color:#fff;border-color:transparent}',
    '.card code{display:block;background:#f0f2f5;border-radius:7px;padding:10px;margin:10px 0;',
    '  font:13px ui-monospace,Consolas,monospace;text-align:left}'
  ].join('');

  function build() {
    host = document.createElement('div');
    host.setAttribute('data-uat-annotator', '');
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    layer = el('div', null);
    layer.className = 'wrap placing';
    root.appendChild(layer);

    headEl = el('div');
    headEl.className = 'bar';
    layer.appendChild(headEl);

    var side = el('div');
    side.className = 'side';
    side.appendChild(el('h3', null, 'Your notes on this screen'));
    listEl = el('div');
    side.appendChild(listEl);
    layer.appendChild(side);

    document.documentElement.appendChild(host);
    on(layer, 'click', onPlace);
    on(window, 'keydown', function (e) { if (e.key === 'Escape') close(); });
    renderBar();
    renderList();
  }

  function renderBar() {
    headEl.textContent = '';
    headEl.appendChild(el('b', null, '✎ UAT'));
    var pick = el('select');
    tests.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.id + '  ' + t.title;
      if (t.id === testId) o.selected = true;
      pick.appendChild(o);
    });
    if (!tests.length) {
      var o = document.createElement('option');
      o.textContent = testId ? testId : 'no test selected';
      pick.appendChild(o);
    }
    pick.addEventListener('change', function () {
      testId = pick.value;
      var hit = tests.filter(function (t) { return t.id === testId; })[0];
      testTitle = hit ? hit.title : '';
    });
    headEl.appendChild(el('span', null, 'attaching to'));
    headEl.appendChild(pick);
    headEl.appendChild(el('span', 'opacity:.75;font-size:13px', 'click anything on the page to drop a numbered pin'));
    headEl.appendChild(el('span', 'flex:1'));
    var done = el('button', null, 'Done — send to checklist');
    done.className = 'go';
    done.disabled = true;
    done.addEventListener('click', finish);
    headEl.__done = done;
    headEl.appendChild(done);
    var cancel = el('button', null, 'Cancel');
    cancel.addEventListener('click', close);
    headEl.appendChild(cancel);
  }

  function onPlace(e) {
    if (!placing) return;
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] === headEl || (path[i].className === 'side')) return;   // clicks on our own UI
    }
    if (e.target !== layer && e.target.className !== 'wrap placing') {
      // a click that landed on our own chrome
      if (e.target.className && String(e.target.className).indexOf('pin') === 0) return;
    }
    var x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    layer.style.pointerEvents = 'none';
    var about = describe(x, y);
    layer.style.pointerEvents = '';
    addPin(x, y, about);
    e.preventDefault();
    e.stopPropagation();
  }

  function addPin(x, y, about) {
    var pin = { n: pins.length + 1, x: x, y: y, comment: '', about: about };
    pins.push(pin);
    var dot = el('div', 'left:' + x + 'px;top:' + y + 'px', String(pin.n));
    dot.className = 'pin';
    pin._dot = dot;
    layer.appendChild(dot);
    renderList();
    var ta = listEl.querySelector('textarea[data-n="' + pin.n + '"]');
    if (ta) ta.focus();
  }

  function renderList() {
    listEl.textContent = '';
    if (!pins.length) {
      listEl.appendChild(el('p', null, 'No pins yet. Click the part of the page you want to comment on.'))
        .className = 'empty';
      syncDone();
      return;
    }
    pins.forEach(function (p) {
      var item = el('div');
      item.className = 'item';
      var rm = el('button', null, 'remove');
      rm.className = 'rm';
      rm.addEventListener('click', function () {
        if (p._dot) p._dot.remove();
        pins = pins.filter(function (q) { return q !== p; });
        pins.forEach(function (q, i) { q.n = i + 1; if (q._dot) q._dot.textContent = String(q.n); });
        renderList();
      });
      item.appendChild(rm);
      var head = el('div');
      head.appendChild(el('span', null, String(p.n))).className = 'n';
      head.appendChild(el('span', null, p.about ? p.about.tag : 'on the page'));
      item.appendChild(head);
      var ta = el('textarea');
      ta.setAttribute('data-n', String(p.n));
      ta.placeholder = 'What is wrong here?';
      ta.value = p.comment;
      ta.addEventListener('input', function () { p.comment = ta.value; syncDone(); });
      item.appendChild(ta);
      if (p.about && p.about.selector) {
        item.appendChild(el('div', null, p.about.selector
          + (p.about.text ? '  “' + p.about.text + '”' : ''))).className = 'el';
      }
      listEl.appendChild(item);
    });
    syncDone();
  }

  function syncDone() {
    var ok = pins.length > 0 && pins.every(function (p) { return p.comment.trim().length > 0; });
    if (headEl.__done) {
      headEl.__done.disabled = !ok;
      headEl.__done.title = ok ? '' : 'Every pin needs a comment before this can be sent';
    }
  }

  /* ----------------------------------------------------------- the capture */

  function withHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = HELPER + '/vendor/html2canvas.min.js';
      s.onload = function () { resolve(window.html2canvas || null); };
      s.onerror = function () { resolve(null); };          // blocked by the page's CSP
      document.head.appendChild(s);
      setTimeout(function () { if (!window.html2canvas) resolve(null); }, 8000);
    });
  }

  /* Draw the pins as real elements in the page before capturing, so html2canvas
     renders them in the same coordinate space as everything else. Burning them
     into the canvas afterwards cannot survive its scaling. */
  function withPinMarkers(fn) {
    var marks = pins.map(function (p) {
      var d = document.createElement('div');
      d.setAttribute('data-uat-pin', '');
      d.textContent = String(p.n);
      d.style.cssText = 'position:absolute;left:' + (p.x - 13) + 'px;top:' + (p.y - 13) + 'px;'
        + 'width:26px;height:26px;border-radius:50%;background:#c02626;color:#fff;'
        + 'font:700 14px/26px system-ui,sans-serif;text-align:center;z-index:2147483646;'
        + 'box-shadow:0 2px 6px rgba(0,0,0,.4)';
      document.body.appendChild(d);
      return d;
    });
    var undo = function () { marks.forEach(function (d) { d.remove(); }); };
    try {
      return fn().then(function (v) { undo(); return v; }, function (e) { undo(); throw e; });
    } catch (e) {
      undo();
      throw e;
    }
  }

  function capture() {
    return withHtml2Canvas().then(function (h2c) {
      if (!h2c) return null;
      host.style.display = 'none';                          // never photograph our own UI
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      return withPinMarkers(function () {
        return h2c(document.documentElement, {
          useCORS: true, logging: false, backgroundColor: '#ffffff',
          x: window.scrollX, y: window.scrollY,
          width: vw, height: vh,
          windowWidth: vw, windowHeight: vh,     // without these the page re-lays-out at a wrong width
          scale: 1
        });
      }).then(function (canvas) {
        host.style.display = '';
        return canvas.toDataURL('image/png');
      }).catch(function () { host.style.display = ''; return null; });
    });
  }

  /* --------------------------------------------------------------- sending */

  function payload(image) {
    return {
      test: testId,
      url: location.href,
      viewport: window.innerWidth + '×' + window.innerHeight,
      browser: navigator.userAgent,
      consoleErrors: consoleErrors.slice(0, 5),
      image: image || '',
      pins: pins.map(function (p) {
        return {
          n: p.n, comment: p.comment.trim(), x: Math.round(p.x), y: Math.round(p.y),
          selector: p.about ? p.about.selector : '', tag: p.about ? p.about.tag : '',
          text: p.about ? p.about.text : ''
        };
      })
    };
  }

  /* fetch first; if the page's connect-src blocks it, hand the payload to a
     popup instead — a navigation is not governed by connect-src. */
  function send(data) {
    return req('/api/annotate', data).then(function (r) {
      if (!r || !r.ok) throw new Error(r && r.error || 'rejected');
      return 'sent';
    }).catch(function () {
      var w = window.open('', 'uat_annotate', 'width=460,height=280');
      if (!w) return 'popup-blocked';
      var f = w.document.createElement('form');
      f.method = 'POST';
      f.action = HELPER + '/receive';
      var i = w.document.createElement('input');
      i.type = 'hidden';
      i.name = 'payload';
      i.value = JSON.stringify(data);
      f.appendChild(i);
      w.document.body.appendChild(f);
      f.submit();
      return 'sent-via-popup';
    });
  }

  function finish() {
    headEl.__done.disabled = true;
    headEl.__done.textContent = 'Capturing…';
    capture().then(function (image) {
      var data = payload(image);
      if (!image) return confirmNoImage(data);
      preview(image, data);
    });
  }

  function modal(kids) {
    var m = el('div');
    m.className = 'modal';
    var card = el('div');
    card.className = 'card';
    kids.forEach(function (k) { card.appendChild(k); });
    m.appendChild(card);
    layer.appendChild(m);
    return m;
  }

  function preview(image, data) {
    var img = document.createElement('img');
    img.src = image;
    var row = el('div');
    row.className = 'row';
    var yes = el('button', null, 'Yes — send it');
    yes.className = 'go';
    var no = el('button', null, "No, it's wrong");
    row.appendChild(yes);
    row.appendChild(no);
    var m = modal([
      el('h2', null, 'Does this look like what you saw?'),
      el('p', null, 'This picture is rebuilt from the page rather than photographed, so it is '
        + 'occasionally wrong — especially with charts, video, or images from other sites.'),
      img, row
    ]);
    yes.addEventListener('click', function () {
      m.remove();
      sending(data);
    });
    no.addEventListener('click', function () {
      m.remove();
      data.image = '';
      data.captureRejected = true;
      confirmNoImage(data);
    });
  }

  function confirmNoImage(data) {
    var row = el('div');
    row.className = 'row';
    var go = el('button', null, 'Send my notes without a picture');
    go.className = 'go';
    var back = el('button', null, 'Back to the page');
    row.appendChild(go);
    row.appendChild(back);
    var m = modal([
      el('h2', null, data.captureRejected ? 'No problem — your notes are safe'
        : 'The picture could not be made'),
      el('p', null, 'Your comments will still be sent and attached to test ' + data.test + '. '
        + 'For a picture that is definitely right: press the PrintScreen key (or Cmd+Shift+4 on a Mac), '
        + 'then go to the checklist and press Ctrl+V inside this test.'),
      row
    ]);
    go.addEventListener('click', function () { m.remove(); sending(data); });
    back.addEventListener('click', function () {
      m.remove();
      headEl.__done.textContent = 'Done — send to checklist';
      syncDone();
    });
  }

  function sending(data) {
    var m = modal([el('h2', null, 'Sending…')]);
    send(data).then(function (how) {
      m.remove();
      var row = el('div');
      row.className = 'row';
      var shut = el('button', null, 'Close this and go back');
      shut.className = 'go';
      row.appendChild(shut);
      var kids = [
        el('h2', null, 'Saved to test ' + data.test),
        el('p', null, how === 'popup-blocked'
          ? 'Your browser blocked the window needed to send this. Allow pop-ups for this page and press Done again.'
          : data.pins.length + ' note' + (data.pins.length === 1 ? '' : 's')
            + (data.image ? ' and a picture were' : ' were') + ' sent to the checklist. '
            + 'Switch back to the checklist tab to see them.'),
        row
      ];
      var done = modal(kids);
      shut.addEventListener('click', function () { done.remove(); close(); });
    });
  }

  /* ----------------------------------------------------------- lifecycle */

  function close() {
    cleanup.forEach(function (fn) { fn(); });
    cleanup = [];
    if (host && host.parentNode) host.parentNode.removeChild(host);
    window.__uatAnnotate = null;
  }

  function start() {
    on(window, 'error', function (e) {
      consoleErrors.push(String(e.message || e.type) + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
    });
    req('/api/current-test').then(function (r) {
      testId = (r && r.test) || '';
      testTitle = (r && r.title) || '';
      tests = (r && r.tests) || [];
      build();
    }).catch(function () {
      // the helper is unreachable — say so plainly rather than half-working
      alert('The UAT helper is not running at ' + HELPER + '.\n\n'
        + 'Start it in a terminal, then click the bookmarklet again.');
    });
  }

  window.__uatAnnotate = { open: function () { if (!host) start(); }, close: close };
  start();
})();
