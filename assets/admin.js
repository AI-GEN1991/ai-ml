/* 10-Minute Worksheets | Binary Star | (c) Ashwini Kumar Mathur
   Class dashboard. Only the course admin's Google account can read every student's
   record (enforced by the Firestore rules); anyone else sees a polite "not allowed". */
(function () {
  'use strict';

  // Refuse to run inside another site's frame (clickjacking).
  if (window.top !== window.self) {
    try { window.top.location = window.location.href; } catch (e) { document.documentElement.style.display = 'none'; }
    return;
  }
  function readConfig() {
    try { return JSON.parse(document.getElementById('site-config').textContent); } catch (e) { return {}; }
  }
  var SITE = readConfig();
  var CFG = SITE.firebase && SITE.firebase.apiKey ? SITE.firebase : null;
  var SDK = SITE.firebaseSdk || 'https://www.gstatic.com/firebasejs/10.12.2/';
  var COURSE = SITE.course || [];
  var IDS = {}; COURSE.forEach(function (w) { IDS[w.id] = w; });
  var VIDEO = {}; COURSE.forEach(function (w) { w.videos.forEach(function (v) { if (!VIDEO[v.id]) VIDEO[v.id] = { title: v.title, ws: w }; }); });
  var N = COURSE.length;
  var DAY = 864e5;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function when(ts) { return ts && ts.toDate ? ts.toDate() : null; }
  function ago(d) {
    if (!d) return '—';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var fb = null, user = null, students = [], stats = {}, msgs = [], q = '';

  /* ---------- gate ---------- */
  function gate(state, text) {
    var show = state !== 'in';
    document.body.classList.toggle('gated', show);
    $('gate').hidden = !show;
    $('adm').hidden = show;
    var b = $('gate-signin');
    b.hidden = state === 'denied';
    b.disabled = state === 'loading';
    b.querySelector('span').textContent = state === 'loading' ? 'Loading…' : 'Sign in with Google';
    $('gate-out').hidden = state !== 'denied';
    $('gate-lede').textContent = text || '';
    var dragon = $('gate').querySelector('.bit');
    dragon.classList.remove('mood-idle', 'mood-sad');
    dragon.classList.add(state === 'denied' ? 'mood-sad' : 'mood-idle');
    if (state === 'denied') $('gate-say').textContent = 'Oops, this corner is for the teacher only.';
  }

  function init() {
    if (!CFG) { gate('denied', 'Firebase is not configured for this site.'); return; }
    gate('loading');
    Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')])
      .then(function (m) {
        var app = m[0].initializeApp(CFG);
        fb = { a: m[1], f: m[2], auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
        fb.a.onAuthStateChanged(fb.auth, function (u) {
          user = u;
          renderAuth();
          if (!u) { gate('out', ''); return; }
          load();
        });
      })
      .catch(function () { gate('denied', 'Could not reach Firebase. Check your connection and reload.'); });
  }

  function signIn() {
    var provider = new fb.a.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    fb.a.signInWithPopup(fb.auth, provider).catch(function (err) {
      if (err && err.code === 'auth/popup-blocked') fb.a.signInWithRedirect(fb.auth, provider);
    });
  }

  function renderAuth() {
    $('auth').innerHTML = user
      ? '<span class="adm-who">' + esc(user.email || '') + '</span><button type="button" class="menu-out adm-out" id="signout">Sign out</button>'
      : '';
  }

  /* ---------- data ---------- */
  function load() {
    $('adm-updated').textContent = 'Loading…';
    var F = fb.f;
    Promise.all([F.getDocs(F.collection(fb.db, 'users')), F.getDocs(F.collection(fb.db, 'stats')),
                 F.getDocs(F.query(F.collection(fb.db, 'feedback'), F.orderBy('at', 'desc'), F.limit(200)))])
      .then(function (r) {
        students = [];
        r[0].forEach(function (d) {
          var v = d.data(), doneIds = Object.keys(v.done || {}).filter(function (k) { return IDS[k]; });
          var last = null;
          doneIds.forEach(function (k) { var t = when(v.done[k]); if (t && (!last || t > last)) last = t; });
          students.push({
            uid: d.id, name: v.name || '(no name)', email: v.email || '', photo: v.photo || '',
            done: v.done || {}, doneIds: doneIds, n: doneIds.length, lastDone: last,
            seen: when(v.lastSeen), created: when(v.created),
            likes: Object.keys(v.reacts || {}).filter(function (k) { return k.indexOf('v_') === 0; }).length,
            sub: !!(v.reacts && v.reacts.channel)
          });
        });
        students.sort(function (a, b) { return b.n - a.n || (b.seen || 0) - (a.seen || 0); });
        stats = {};
        r[1].forEach(function (d) { stats[d.id] = d.data(); });
        msgs = [];
        r[2].forEach(function (d) { var v = d.data(); v.id = d.id; msgs.push(v); });
        gate('in');
        render();
      })
      .catch(function (e) {
        if (e && e.code === 'permission-denied') {
          gate('denied', 'You are signed in as ' + (user.email || 'this account') + ', which is not the course admin account.');
        } else {
          gate('denied', 'Could not load the class data. Check your connection and reload.');
        }
      });
  }

  /* ---------- render ---------- */
  function kpi(value, label, hint) {
    return '<div class="kpi px-box"><span class="kpi-v">' + esc(value) + '</span><span class="kpi-l">' + esc(label) + '</span>' +
      (hint ? '<span class="kpi-h">' + esc(hint) + '</span>' : '') + '</div>';
  }

  function render() {
    var S = students.length;
    var weekAgo = Date.now() - 7 * DAY;
    var active = students.filter(function (s) { return s.seen && s.seen.getTime() >= weekAgo; }).length;
    var started = students.filter(function (s) { return s.n > 0; }).length;
    var finished = students.filter(function (s) { return s.n >= N; }).length;
    var ticks = students.reduce(function (a, s) { return a + s.n; }, 0);
    var weekTicks = 0;
    students.forEach(function (s) { s.doneIds.forEach(function (k) { var t = when(s.done[k]); if (t && t.getTime() >= weekAgo) weekTicks++; }); });
    var likes = 0, subs = (stats.channel && stats.channel.subs) || 0;
    Object.keys(stats).forEach(function (k) { if (k.indexOf('v_') === 0) likes += Math.max(0, stats[k].likes || 0); });

    $('adm-updated').textContent = 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
      ' · ' + N + ' worksheets in the course';
    var d = document.querySelector('.adm-bit .bit');
    d.classList.remove('mood-idle'); d.classList.add(weekTicks ? 'mood-fire' : 'mood-happy');
    setTimeout(function () { d.classList.remove('mood-fire', 'mood-happy'); d.classList.add('mood-happy'); }, 2000);
    $('adm-say').textContent = S
      ? S + (S === 1 ? ' student' : ' students') + ', ' + weekTicks + ' worksheet' + (weekTicks === 1 ? '' : 's') + ' smashed this week!'
      : 'No students yet. Share the site link!';

    $('kpis').innerHTML =
      kpi(S, 'Students signed in', started + ' started') +
      kpi(active, 'Active this week', S ? Math.round(100 * active / S) + '% of class' : '') +
      kpi(finished, 'Finished all ' + N, S ? Math.round(100 * finished / S) + '% of class' : '') +
      kpi(S ? (ticks / S).toFixed(1) : '0', 'Avg. worksheets done', ticks + ' ticks in total') +
      kpi(likes, 'Lecture likes', subs + ' subscribed');

    // completion by worksheet
    var max = Math.max(1, S);
    $('by-ws').innerHTML = COURSE.map(function (w) {
      var c = students.filter(function (s) { return s.done[w.id]; }).length;
      var pct = Math.round(100 * c / max);
      var lk = w.videos.reduce(function (a, v) { return a + Math.max(0, (stats['v_' + v.id] || {}).likes || 0); }, 0);
      return '<li><span class="wb-no">' + esc(w.no) + '</span><span class="wb-t">' + esc(w.title) + '</span>' +
        '<span class="wb-bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="wb-c"><strong>' + c + '</strong>/' + S + (lk ? ' <span class="wb-lk">❤ ' + lk + '</span>' : '') + '</span></li>';
    }).join('');

    renderStudents();

    // messages from the Contact page
    $('msgs').innerHTML = msgs.length ? msgs.map(function (m) {
      var subj = encodeURIComponent('Re: your ' + (m.topic || 'message').toLowerCase() + ' on ' + document.title.split('|').pop().trim());
      return '<li class="msg"><div class="msg-top"><span class="px-chip">' + esc(m.topic) + '</span>' +
        '<strong>' + esc(m.name || '(no name)') + '</strong>' +
        '<a href="mailto:' + encodeURIComponent(m.email || '') + '?subject=' + subj + '">' + esc(m.email || '') + '</a>' +
        '<span class="msg-when">' + ago(when(m.at)) + '</span></div>' +
        '<p class="msg-body">' + esc(m.message) + '</p></li>';
    }).join('') : '<li class="adm-sub">No messages yet.</li>';

    // reactions
    var vids = Object.keys(stats).filter(function (k) { return k.indexOf('v_') === 0 && (stats[k].likes || 0) > 0; })
      .map(function (k) { var id = k.slice(2), v = VIDEO[id]; return { likes: stats[k].likes, title: v ? v.title : id, ws: v ? v.ws.no + ' ' + v.ws.title : '' }; })
      .sort(function (a, b) { return b.likes - a.likes; });
    $('reactions').innerHTML = '<div class="react-sum"><span class="px-chip">🔔 ' + subs + ' subscribed on this site</span>' +
      '<span class="px-chip">❤ ' + likes + ' likes in total</span></div>' +
      (vids.length ? '<ol class="react-list">' + vids.map(function (v) {
        return '<li><span class="rl-n">❤ ' + v.likes + '</span><span class="rl-t">' + esc(v.title) + '<small>' + esc(v.ws) + '</small></span></li>';
      }).join('') + '</ol>' : '<p class="adm-sub">No likes yet.</p>');
  }

  function renderStudents() {
    var list = students.filter(function (s) { return !q || (s.name + ' ' + s.email).toLowerCase().indexOf(q) !== -1; });
    var head = '<thead><tr><th>Student</th><th>Progress</th><th>Last finished</th><th>Last active</th><th>Likes</th></tr></thead>';
    if (!list.length) { $('students').innerHTML = head + '<tbody><tr><td colspan="5" class="empty-row">' + (students.length ? 'No match.' : 'No students yet.') + '</td></tr></tbody>'; return; }
    $('students').innerHTML = head + '<tbody>' + list.map(function (s) {
      var pct = Math.round(100 * s.n / Math.max(1, N));
      var initial = esc((s.name || s.email || '?').trim()[0].toUpperCase());
      var av = s.photo ? '<img src="' + esc(s.photo) + '" alt="" referrerpolicy="no-referrer">' : '<span>' + initial + '</span>';
      var lastWs = null;
      s.doneIds.forEach(function (k) { var t = when(s.done[k]); if (t && s.lastDone && t.getTime() === s.lastDone.getTime()) lastWs = IDS[k]; });
      return '<tr>' +
        '<td><div class="st"><span class="st-av">' + av + '</span><span><strong>' + esc(s.name) + '</strong><small>' + esc(s.email) + '</small></span></div></td>' +
        '<td><div class="st-prog"><span class="st-bar' + (s.n >= N ? ' full' : '') + '"><span style="width:' + pct + '%"></span></span><span class="st-n">' + s.n + '/' + N + '</span></div></td>' +
        '<td>' + (lastWs ? esc(lastWs.no + ' ' + lastWs.title) + '<small>' + ago(s.lastDone) + '</small>' : '—') + '</td>' +
        '<td>' + ago(s.seen) + '</td>' +
        '<td>' + s.likes + (s.sub ? ' <span title="Tapped Subscribe">🔔</span>' : '') + '</td>' +
        '</tr>';
    }).join('') + '</tbody>';
  }

  function csv() {
    var rowsOut = [['Name', 'Email', 'Worksheets done', 'Out of', 'Done (course numbers)', 'Last active', 'Likes', 'Subscribed']];
    students.forEach(function (s) {
      var nos = COURSE.filter(function (w) { return s.done[w.id]; }).map(function (w) { return w.no; }).join(' ');
      rowsOut.push([s.name, s.email, s.n, N, nos, s.seen ? s.seen.toISOString() : '', s.likes, s.sub ? 'yes' : 'no']);
    });
    var text = rowsOut.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        if (/^[=+\-@\t\r]/.test(c)) c = "'" + c;          // stop names like =HYPERLINK(...) running as formulas
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'class-progress-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#gate-signin')) signIn();
    else if (t.closest('#signout') || t.closest('#gate-out')) fb.a.signOut(fb.auth);
    else if (t.closest('#adm-refresh')) load();
    else if (t.closest('#adm-csv')) csv();
  });
  $('adm-q').addEventListener('input', function () { q = this.value.toLowerCase().trim(); renderStudents(); });

  init();
})();
