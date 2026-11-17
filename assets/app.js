/* 10-Minute Worksheets | Binary Star | (c) Ashwini Kumar Mathur
   Search, inline YouTube player, worksheet viewer and a personal "done" checklist.
   With Firebase configured (window.SITE.firebase), students sign in with Google and
   their checklist is saved to their account; without it, it stays in this browser. */
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
  var CHANNEL = SITE.channel || 'https://www.youtube.com/';
  var GC = SITE.goatcounter || '';

  var rows = [].slice.call(document.querySelectorAll('.ws:not(.soon)'));   // worksheets that exist
  var topics = [].slice.call(document.querySelectorAll('.ws'));            // includes "coming soon"
  var TOTAL = rows.length;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var cloud = !!CFG;
  var fb = null;              // { a: auth module, f: firestore module, auth, db }
  var user = null;
  var ready = !cloud;         // false until we know who is signed in
  var done = cloud ? {} : lsGet('bs-done', {});   // worksheet id -> true
  var filter = 'all';
  var note = '';              // short message shown under the progress bar
  var authKey = null;         // what the sign-in area currently shows

  function track(name, title) {
    if (!GC || !window.goatcounter || !window.goatcounter.count) return;
    try { window.goatcounter.count({ path: name, title: title, event: true }); } catch (e) {}
  }

  /* ================= Google sign-in and saved progress ================= */
  function userRef() { return fb.f.doc(fb.db, 'users', user.uid); }

  function cloudInit() {
    Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')])
      .then(function (m) {
        var app = m[0].initializeApp(CFG);
        fb = { a: m[1], f: m[2], auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
        fb.a.onAuthStateChanged(fb.auth, onUser);
      })
      .catch(function () {                         // sign-in service unreachable: work offline
        cloud = false; ready = true; done = lsGet('bs-done', {});
        note = 'Sign-in is unavailable right now, so your ticks are kept in this browser.';
        render();
      });
  }

  function onUser(u) {
    user = u; done = {}; note = '';
    if (!u) { reacts = {}; repaintPlayers(); ready = true; render(); return; }
    ready = false; render();
    fb.f.getDoc(userRef()).then(function (snap) {
      var data = snap.exists() ? snap.data() : {};
      Object.keys(data.done || {}).forEach(function (k) { done[k] = true; });
      reacts = {}; Object.keys(data.reacts || {}).forEach(function (k) { reacts[k] = true; });
      repaintPlayers();
      var p = { name: u.displayName || '', email: u.email || '', photo: u.photoURL || '', lastSeen: fb.f.serverTimestamp() };
      if (!snap.exists()) p.created = fb.f.serverTimestamp();
      fb.f.setDoc(userRef(), p, { merge: true }).catch(function () {});
      ready = true; render();
      setTimeout(function () { whenIdle(greet); }, 600);
    }).catch(function () {
      ready = true; note = 'Could not load your progress. Check your connection and reload.'; render();
    });
  }

  function signIn() {
    if (!fb) return;
    var provider = new fb.a.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    fb.a.signInWithPopup(fb.auth, provider).catch(function (err) {
      var c = (err && err.code) || '';
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') {
        fb.a.signInWithRedirect(fb.auth, provider);
      } else if (c !== 'auth/popup-closed-by-user' && c !== 'auth/cancelled-popup-request') {
        note = 'Sign-in did not complete. Please try again.'; render();
      }
    });
  }
  function signOut() { closeMenu(); if (fb) fb.a.signOut(fb.auth); }

  function setDone(id, on) {
    if (on) done[id] = true; else delete done[id];
    if (cloud && user && fb) {
      var d = { done: {} };
      d.done[id] = on ? fb.f.serverTimestamp() : fb.f.deleteField();
      fb.f.setDoc(userRef(), d, { merge: true }).catch(function () {
        note = 'Could not save just now. Check your connection and try again.'; render();
        buddy('Oh no, that did not save. Try again?', 'sad');
      });
    } else if (!cloud) {
      lsSet('bs-done', done);
    }
    if (on) track('done-' + id, 'Done: ' + id);
    render();
    if (on) cheerDone(id); else if (rowBuddy && rowBuddy.parentNode && rowBuddy.parentNode.id === id) clearRowBuddy();
  }
  function toggleDone(id) {
    if (cloud && !user) { signIn(); return; }      // the checklist belongs to a Google account
    if (!ready) return;
    setDone(id, !done[id]);
  }

  /* ================= sign-in area (top right) ================= */
  var G_LOGO = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';

  function avatar(u, cls) {
    var initial = esc(((u.displayName || u.email || '?').trim()[0] || '?').toUpperCase());
    return u.photoURL
      ? '<img class="' + cls + '" src="' + esc(u.photoURL) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="' + cls + ' initial">' + initial + '</span>';
  }
  // Only a convenience link: the dashboard data itself is protected by the database rules.
  function isTeacher() { return !!(user && user.email === ['ashmathur91', 'gmail.com'].join('@')); }
  function renderAuth() {
    var key = !cloud ? 'off' : !fb ? 'wait' : user ? 'in:' + user.uid : 'out';
    if (key === authKey) return;
    authKey = key;
    var box = $('auth');
    if (key === 'off' || key === 'wait') { box.innerHTML = ''; return; }
    if (!user) {
      box.innerHTML = '<button type="button" class="signin" id="signin">' + G_LOGO + '<span>Sign in</span></button>';
      return;
    }
    box.innerHTML =
      '<button type="button" class="me" id="me" aria-haspopup="true" aria-expanded="false" aria-label="Account: ' + esc(user.displayName || user.email || '') + '">' +
        avatar(user, 'av') + '</button>' +
      '<div class="menu" id="menu" hidden>' +
        '<div class="menu-who">' + avatar(user, 'av av-lg') +
          '<div><strong>' + esc(user.displayName || 'Signed in') + '</strong><span>' + esc(user.email || '') + '</span></div></div>' +
        (isTeacher() ? '<a class="menu-out menu-dash" href="admin.html">Class dashboard</a>' : '') +
        '<button type="button" class="menu-out" id="signout">Sign out</button>' +
      '</div>';
  }
  function closeMenu() {
    var m = $('menu'), b = $('me');
    if (m && !m.hidden) { m.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); }
  }
  function toggleMenu() {
    var m = $('menu'), b = $('me');
    if (!m) return;
    m.hidden = !m.hidden;
    b.setAttribute('aria-expanded', m.hidden ? 'false' : 'true');
  }

  /* ================= sign-in gate: students sign in before they start ================= */
  var gateShown = null, puffTimer = null;
  function renderGate() {
    var gate = $('gate');
    if (!gate) return;
    var show = cloud && !user;
    document.body.classList.toggle('gated', show);
    gate.hidden = !show;
    var b = $('gate-signin');
    b.disabled = !fb;
    b.querySelector('span').textContent = fb ? 'Sign in with Google' : 'Loading…';
    if (show && fb && gateShown !== true) { b.focus(); }
    if (show && !puffTimer && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      puffTimer = setInterval(function () {
        var d = gate.querySelector('.bit');
        if (gate.hidden || !d) return;
        d.classList.remove('mood-idle'); d.classList.add('mood-fire');
        setTimeout(function () { d.classList.remove('mood-fire'); d.classList.add('mood-idle'); }, 1500);
      }, 6500);
    }
    if (!show && puffTimer) { clearInterval(puffTimer); puffTimer = null; }
    gateShown = show;
  }

  /* ================= dragons: Ember (green) and Pip (baby, sky blue) =================
     Only one dragon is on screen at a time, and none appear while the student is scrolling. */
  var MOODS = ['mood-idle', 'mood-happy', 'mood-fire', 'mood-wow', 'mood-sad'];
  var lastScroll = 0, idleTimer = null;
  window.addEventListener('scroll', function () {
    lastScroll = performance.now();
    if (flyer) flyer.classList.add('tucked');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (flyer) flyer.classList.remove('tucked'); }, 1600);
  }, { passive: true });
  function isIdle() { return performance.now() - lastScroll > 1400; }
  function whenIdle(fn) { (function wait() { if (isIdle()) fn(); else setTimeout(wait, 400); })(); }
  function setMood(sp, mood, extra) {
    MOODS.forEach(function (m) { sp.classList.remove(m); });
    void sp.getBoundingClientRect();
    sp.classList.add('mood-' + mood);
    if (extra) sp.classList.add(extra);
  }
  function cheerMood(sp, extra) {             // happy always starts with a little fire
    setMood(sp, 'fire', extra);
    clearTimeout(sp._t);
    sp._t = setTimeout(function () { setMood(sp, 'happy', extra); }, 1300);
  }
  function emberArt() { return $('buddy') && $('buddy').querySelector('.bit'); }
  function pipArt() { var t = $('pip-art'); return t && t.content && t.content.firstElementChild; }
  function stageClear(keep) {
    var b = $('buddy');
    if (keep !== 'buddy' && b && !b.hidden) { clearTimeout(buddyTimer); b.hidden = true; b.classList.remove('in', 'out'); }
    if (keep !== 'row') clearRowBuddy();
    if (keep !== 'thanks' && thanks) { thanks.remove(); thanks = null; }
    if (keep !== 'flyer' && flyer) { cancelAnimationFrame(flyRaf); flyRaf = 0; flyer.remove(); flyer = null; }
  }

  /* Ember pops up in the corner for short messages (or speaks from the video perch) */
  var buddyTimer = null;
  function buddy(text, mood) {
    if (perch) { perchSay(text, mood); return; }
    var box = $('buddy');
    if (!box) return;
    stageClear('buddy');
    $('buddy-say').textContent = text;
    var bit = box.querySelector('.bit');
    if (mood === 'happy' || mood === 'fire') cheerMood(bit); else setMood(bit, mood || 'idle');
    box.hidden = false;
    box.classList.remove('out'); void box.offsetWidth; box.classList.add('in');
    clearTimeout(buddyTimer);
    buddyTimer = setTimeout(function () {
      box.classList.remove('in'); box.classList.add('out');
      buddyTimer = setTimeout(function () { box.hidden = true; box.classList.remove('out'); }, 300);
    }, mood === 'fire' ? 3800 : 3200);
  }
  function firstName() { return user && user.displayName ? user.displayName.split(' ')[0] : ''; }
  function nextUp() {
    for (var i = 0; i < rows.length; i++) if (!done[rows[i].id]) return rows[i];
    return null;
  }
  function greet() {
    if (!viewer.hidden) { setTimeout(function () { whenIdle(greet); }, 1500); return; }   // wait until the worksheet is closed
    var n = Object.keys(done).filter(function (k) { return $(k); }).length, nx = nextUp(), who = firstName();
    if (!n) buddy('Welcome' + (who ? ', ' + who : '') + '! Start with ' + (nx ? num(nx) + ' ' + title(nx) : 'any worksheet') + '.', 'wow');
    else if (!nx) buddy('All ' + TOTAL + ' done' + (who ? ', ' + who : '') + '. Legend!', 'fire');
    else buddy('Welcome back' + (who ? ', ' + who : '') + '! ' + n + ' done, ' + (TOTAL - n) + ' to go.', 'happy');
  }
  /* A small Ember pops up on the row that was just ticked: fire, then happy, then
     points to the next worksheet with a button that jumps there. */
  var rowBuddy = null, rowTimers = [];
  function clearRowBuddy() {
    rowTimers.forEach(clearTimeout); rowTimers = [];
    if (rowBuddy) { rowBuddy.remove(); rowBuddy = null; }
  }
  function cheerDone(id) {
    var li = $(id);
    if (!li) return;
    var n = rows.filter(function (x) { return done[x.id]; }).length;
    var mod = li.closest('.module');
    var modDone = mod && [].every.call(mod.querySelectorAll('.ws:not(.soon)'), function (x) { return done[x.id]; });
    var nx = nextUp();
    var line = n === TOTAL ? 'All ' + TOTAL + ' done. You are on fire!'
      : modDone ? 'Module complete!'
      : ['Fired up!', 'Boom! Nice work.', 'One more down!', 'Brain +10!'][n % 4];

    var nextBtn = nx ? '<button type="button" class="row-next" data-next="' + nx.id + '">Next: ' + esc(num(nx)) + ' ' + esc(title(nx)) + ' \u2192</button>' : '';
    if (perch) { perchSay(line + ' ' + n + '/' + TOTAL, 'happy', 7000, nextBtn); return; }
    stageClear('row');
    flyHideUntil = performance.now() + 8000;
    setTimeout(render, 8100);
    var art = pipArt();
    if (!art) return;
    var box = document.createElement('div');
    box.className = 'row-buddy';
    box.setAttribute('role', 'status');
    var sprite = art.cloneNode(true);
    sprite.setAttribute('class', 'bit bit-sm pip');
    cheerMood(sprite);
    var bubble = document.createElement('div');
    bubble.className = 'px-bubble row-say';
    bubble.innerHTML = '<span>' + esc(line) + ' ' + n + '/' + TOTAL + '</span>' +
      (nx ? '<button type="button" class="row-next" data-next="' + nx.id + '">Next: ' + esc(num(nx)) + ' ' + esc(title(nx)) + ' →</button>' : '');
    box.appendChild(bubble);
    box.appendChild(sprite);
    li.appendChild(box);
    rowBuddy = box;
    rowTimers.push(setTimeout(function () { box.classList.add('out'); }, 7400));
    rowTimers.push(setTimeout(clearRowBuddy, 7800));
    if (false) buddy(n === TOTAL ? 'ALL ' + TOTAL + ' DONE! Legend!' : 'Module complete! ' + mod.querySelector('h2').textContent + ' is yours.', 'fire');
  }

  /* ================= flying Ember: wanders the right side while you are part-way through ================= */
  var flyer = null, flyPos = null, flyGoal = null, flyRaf = 0, flyNext = 0, flyTipAt = 0, flyHideUntil = 0;
  var TIPS = ['Read page 1 first, then race page 2!', 'Ten minutes. You got this.', 'Stuck? Watch the lecture first.',
              'Check answers at the bottom of page 2.', 'Tick it off when you finish!'];
  var calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function flyerWanted() {
    if (!(!cloud || (user && ready))) return false;
    var n = rows.filter(function (li) { return done[li.id]; }).length;
    var b = $('buddy');
    return n > 0 && n < TOTAL && viewer.hidden && !document.body.classList.contains('gated')
      && !perch && !rowBuddy && !thanks && (!b || b.hidden);
  }
  function makeFlyer() {
    var art = pipArt();
    if (!art) return null;
    var f = document.createElement('div');
    f.className = 'flyer';
    f.innerHTML = '<div class="px-bubble fly-say" hidden></div><button type="button" class="fly-btn" aria-label="' + esc(SITE.buddy || 'Pip') + ': show my progress"></button>';
    var sprite = art.cloneNode(true);
    sprite.setAttribute('class', 'bit bit-sm pip mood-idle fly-flap');
    f.querySelector('.fly-btn').appendChild(sprite);
    document.body.appendChild(f);
    return f;
  }
  function flyArea() {
    var w = window.innerWidth, h = window.innerHeight;
    var minX = Math.max(8, Math.min(w - 200, (w + 1040) / 2 - 20)), maxX = w - 64;   // right gutter when there is one
    if (maxX - minX < 60) minX = Math.max(8, w - 140);
    return { minX: minX, maxX: maxX, minY: 70, maxY: h - 130 };
  }
  function pickGoal() {
    var a = flyArea();
    flyGoal = { x: a.minX + Math.random() * (a.maxX - a.minX), y: a.minY + Math.random() * Math.max(10, a.maxY - a.minY) };
    flyNext = performance.now() + 4500 + Math.random() * 3500;
  }
  function flyStep(t) {
    flyRaf = 0;
    if (!flyer) return;
    if (t > flyNext) pickGoal();
    flyPos.x += (flyGoal.x - flyPos.x) * 0.007;
    flyPos.y += (flyGoal.y - flyPos.y) * 0.007;
    var bob = Math.sin(t / 650) * 3;
    flyer.style.transform = 'translate(' + flyPos.x.toFixed(1) + 'px,' + (flyPos.y + bob).toFixed(1) + 'px)';
    flyer.classList.toggle('to-left', flyGoal.x < flyPos.x - 4);
    if (t > flyTipAt && isIdle()) { flySay(TIPS[Math.floor(Math.random() * TIPS.length)], false); flyTipAt = t + 28000 + Math.random() * 15000; }
    flyRaf = requestAnimationFrame(flyStep);
  }
  var sayTimer = null;
  function flySay(text, withNext) {
    if (!flyer) return;
    var b = flyer.querySelector('.fly-say'), nx = nextUp();
    b.innerHTML = '<span>' + esc(text) + '</span>' + (withNext && nx
      ? '<button type="button" class="row-next" data-next="' + nx.id + '">Next: ' + esc(num(nx)) + ' ' + esc(title(nx)) + ' →</button>' : '');
    b.hidden = false;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { b.hidden = true; }, withNext ? 6000 : 3800);
  }
  function updateFlyer() {
    var want = flyerWanted() && performance.now() > flyHideUntil;
    if (want && !flyer) {
      flyer = makeFlyer();
      if (!flyer) return;
      var a = flyArea();
      flyPos = { x: a.maxX, y: a.maxY };
      pickGoal();
      flyTipAt = performance.now() + 9000;
      if (calm) { flyer.classList.add('calm'); flyer.style.transform = 'translate(' + a.maxX + 'px,' + a.maxY + 'px)'; }
      else flyRaf = requestAnimationFrame(flyStep);
    } else if (!want && flyer) {
      cancelAnimationFrame(flyRaf); flyRaf = 0;
      flyer.remove(); flyer = null;
    }
  }
  function poke() {
    var n = rows.filter(function (li) { return done[li.id]; }).length;
    var sp = flyer.querySelector('.bit');
    cheerMood(sp, 'fly-flap');
    sp.classList.add('pip');
    flySay(n + ' of ' + TOTAL + ' done. Keep going!', true);
  }
  window.addEventListener('resize', function () { if (flyer) pickGoal(); });

  /* ================= rendering ================= */
  var q = $('q');
  function title(li) { return li.querySelector('h3').textContent; }
  function openModuleOf(el) {
    var m = el && el.closest('.module');
    if (m && !m.open) { m.open = true; m.removeAttribute('data-auto'); }
  }
  function num(li) { return li.querySelector('.ws-no').textContent; }

  function render() {
    var tracking = !cloud || (!!user && ready);
    var terms = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var shown = 0, nDone = 0, next = null;
    var narrowed = terms.length > 0 || (tracking && filter !== 'all');

    rows.forEach(function (li) {
      var isDone = tracking && !!done[li.id];
      if (isDone) nDone++; else if (!next) next = li;
      li.classList.toggle('is-done', isDone);
      var b = li.querySelector('.done');
      b.setAttribute('aria-pressed', isDone ? 'true' : 'false');
      b.setAttribute('aria-label', (isDone ? 'Done: ' : 'Mark done: ') + title(li));
      b.querySelector('.t').textContent = isDone ? 'Done' : 'Mark done';
    });
    topics.forEach(function (li) {
      var soon = li.classList.contains('soon');
      var ok = terms.every(function (t) { return li.getAttribute('data-search').indexOf(t) !== -1; });
      if (tracking && filter !== 'all') ok = ok && !soon && (filter === 'done') === li.classList.contains('is-done');
      li.hidden = !ok;
      if (ok) shown++;
    });
    [].forEach.call(document.querySelectorAll('.module'), function (m) {
      var mine = m.querySelector('.module-mine');
      var d = m.querySelectorAll('.ws.is-done').length;
      if (mine) mine.textContent = tracking && d ? ' · ' + d + ' done by you' : '';
      m.hidden = !m.querySelector('.ws:not([hidden])');
      // while searching or filtering, open the modules that have matches; close them again afterwards
      if (narrowed && !m.hidden && !m.open) { m.open = true; m.setAttribute('data-auto', ''); }
      else if (!narrowed && m.hasAttribute('data-auto')) { m.open = false; m.removeAttribute('data-auto'); }
    });
    $('empty').hidden = shown !== 0;
    $('empty').textContent = filter === 'done' && !terms.length ? 'Nothing ticked off yet. Mark a worksheet done when you finish it.'
      : filter === 'todo' && !terms.length ? 'All done. Well played!' : 'No worksheet matches that search.';

    // progress panel: ring, greeting, Continue button
    var text = $('progress-text'), pct = tracking ? Math.round(100 * nDone / TOTAL) : 0;
    $('progress').classList.toggle('is-out', !tracking);
    $('ring-fg').style.strokeDashoffset = (100.53 * (1 - pct / 100)).toFixed(2);   // 2*pi*16
    $('ring-pct').textContent = pct + '%';
    var first = user && user.displayName ? esc(user.displayName.split(' ')[0]) : '';
    $('dash-title').innerHTML = !tracking ? 'Short Practice Sprints'
      : nDone === 0 ? (first ? 'Welcome, ' + first : 'Welcome') : nDone === TOTAL ? 'All done' + (first ? ', ' + first : '') + '!'
      : (first ? 'Keep going, ' + first : 'Keep going');
    var go = $('continue');
    if (!ready) {
      text.textContent = 'Loading your progress…'; go.hidden = true;
    } else if (!tracking) {
      text.textContent = 'Sign in to save your progress.'; go.hidden = true;
    } else {
      text.innerHTML = '<strong>' + nDone + '</strong> of ' + TOTAL + ' worksheets done' +
        (nDone && nDone < TOTAL ? ' · ' + (TOTAL - nDone) + ' to go' : '');
      if (next) {
        go.hidden = false;
        go.setAttribute('data-next', next.id);
        go.innerHTML = (nDone ? 'Continue' : 'Start') + ': <span>' + esc(num(next)) + ' ' + esc(title(next)) + '</span> →';
      } else go.hidden = true;
    }
    // module cards: how much of each module is done
    [].forEach.call(document.querySelectorAll('.modcard'), function (c) {
      var m = $(c.getAttribute('data-mod'));
      var all = m ? m.querySelectorAll('.ws:not(.soon)').length : 0, d = m ? m.querySelectorAll('.ws.is-done').length : 0;
      c.querySelector('.mc-bar i').style.width = (all ? Math.round(100 * d / all) : 0) + '%';
      c.querySelector('.mc-count').textContent = tracking ? d + ' / ' + all + ' done' : all + ' worksheets';
      c.classList.toggle('complete', tracking && all > 0 && d === all);
    });
    $('progress-note').textContent = note ? note
      : !cloud ? 'Your ticks are saved in this browser on this device.'
      : user ? 'Saved to your Google account (' + (user.email || '') + '), on every device you sign in.'
      : '';
    [].forEach.call(document.querySelectorAll('#seg button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-f') === filter ? 'true' : 'false');
    });

    renderAuth();
    renderGate();
    updateFlyer();

    var vd = $('viewer-done');
    if (vd && viewerId) {
      var on = tracking && !!done[viewerId];
      vd.setAttribute('aria-pressed', on ? 'true' : 'false');
      vd.querySelector('.t').textContent = on ? 'Done' : 'Mark done';
    }
  }
  q.addEventListener('input', render);

  /* ================= Ember perches on the video panel while a lecture is open ================= */
  var perch = null;
  function makePerch(li, p) {
    removePerch();
    var art = emberArt();
    if (!art) return;
    stageClear(null);
    var el = document.createElement('div');
    el.className = 'perch';
    el.innerHTML = '<div class="px-bubble perch-say" role="status" hidden></div>';
    var sp = art.cloneNode(true);
    sp.setAttribute('class', 'bit bit-sm mood-idle');
    el.appendChild(sp);
    p.classList.add('has-perch');
    p.appendChild(el);
    perch = { el: el, li: li, sp: sp, say: el.querySelector('.perch-say'), timer: null, state: -1 };
    perchSay("I'll wait here. Enjoy the lecture!", 'idle', 3200);
  }
  function removePerch() {
    if (!perch) return;
    clearTimeout(perch.timer); clearTimeout(perch.sp._t);
    perch.el.remove(); perch = null;
    setTimeout(render, 50);
  }
  function perchSay(text, mood, ms, extra) {
    if (!perch) return;
    perch.say.innerHTML = '<span>' + esc(text) + '</span>' + (extra || '');
    perch.say.hidden = false;
    if (mood === 'happy' || mood === 'fire') cheerMood(perch.sp); else setMood(perch.sp, mood || 'idle');
    clearTimeout(perch.timer);
    perch.timer = setTimeout(function () {
      if (!perch) return;
      perch.say.hidden = true;
      setMood(perch.sp, 'idle');
    }, ms || 3200);
  }
  function lectureEnded() {
    var li = perch.li;
    if (done[li.id]) perchSay('Lecture done! You already finished this one.', 'happy', 8000);
    else perchSay('Lecture done! Now try the worksheet.', 'happy', 14000,
      '<button type="button" class="row-next" data-open="' + li.id + '">Open worksheet \u2192</button>');
  }
  // The YouTube embed reports its state by postMessage once we say we are listening (enablejsapi=1).
  window.addEventListener('message', function (e) {
    if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || !perch) return;
    var d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
    if (!d) return;
    var st = d.event === 'onStateChange' ? d.info
      : (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number' ? d.info.playerState : null);
    if (st === null || st === perch.state) return;
    var fr = perch.li.querySelector('iframe');
    if (!fr || fr.contentWindow !== e.source) return;
    perch.state = st;
    if (st === 1) { perch.say.hidden = true; setMood(perch.sp, 'idle'); }
    if (st === 0) lectureEnded();
  });
  function listenTo(iframe) {
    var tries = 0, iv = setInterval(function () {
      try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'ws', channel: 'widget' }), 'https://www.youtube-nocookie.com'); } catch (e) {}
      if (++tries > 10 || !iframe.isConnected) clearInterval(iv);
    }, 700);
  }

  /* ================= inline video player ================= */
  function closePlayer(li) {
    if (perch && perch.li === li) removePerch();
    var p = li.querySelector('.player');
    if (p) p.remove();
    var b = li.querySelector('.watch');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function show(li, vids, i) {
    var p = li.querySelector('.player'), v = vids[i];
    // No autoplay: YouTube counts a view when the viewer presses play themselves.
    p.querySelector('.frame').innerHTML =
      '<iframe src="https://www.youtube-nocookie.com/embed/' + v.id + '?rel=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '" title="' + esc(v.title) + '" ' +
      'loading="lazy" allowfullscreen allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
      'referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    var fr = p.querySelector('iframe');
    fr.addEventListener('load', function () { listenTo(fr); });
    if (perch) perch.state = -1;
    p.querySelector('.player-foot strong').textContent = v.title;
    p.querySelector('.yt-like').setAttribute('data-vid', v.id);
    p.querySelector('.yt-comment').setAttribute('data-vid', v.id);
    var cp = p.querySelector('.cmt');
    if (cp) loadComments(p);
    loadTotals(['v_' + v.id, 'channel']);
    paintReactions(p);
    [].forEach.call(p.querySelectorAll('.player-tabs button'), function (t, k) {
      t.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
  }
  function openPlayer(li, btn) {
    rows.forEach(function (o) { if (o !== li) closePlayer(o); });
    var vids = btn.getAttribute('data-videos').split('|').map(function (s) {
      var k = s.indexOf('~');
      return { id: s.slice(0, k), title: s.slice(k + 1) };
    });
    var p = document.createElement('div');
    p.className = 'player';
    var tabs = vids.length < 2 ? '' : '<div class="player-tabs" role="tablist">' + vids.map(function (v, i) {
      return '<button type="button" role="tab" data-i="' + i + '">Lecture ' + (i + 1) + '</button>';
    }).join('') + '</div>';
    // Like and Subscribe stay on this page: they toggle and celebrate, nothing opens YouTube.
    p.innerHTML = tabs + '<div class="frame"></div>' +
      '<div class="player-foot"><strong></strong>' +
        '<span class="yt-links">' +
          '<button type="button" class="yt-like" aria-pressed="false">' +
            '<svg class="ic-heart" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true"><path class="h-fill" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/><path class="h-line" d="M1 0h2v1H1zM4 0h2v1H4zM0 1h1v2H0zM6 1h1v2H6zM3 1h1v1H3zM1 3h1v1H1zM5 3h1v1H5zM2 4h1v1H2zM4 4h1v1H4zM3 5h1v1H3z"/></svg>' +
            '<span class="t">Like</span><span class="n"></span></button>' +
          '<button type="button" class="yt-sub" aria-pressed="false" title="Get updates on this site (separate from YouTube)">' +
            '<svg class="ic-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>' +
            '<span class="t">Subscribe</span></button>' +
          '<button type="button" class="yt-comment" aria-expanded="false">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-4 4v-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
            '<span class="t">Comment</span><span class="n"></span></button>' +
          '<button type="button" class="yt-full" title="Watch the lecture full screen">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span class="t">Full screen</span></button>' +
        '</span></div>';
    li.appendChild(p);
    p.addEventListener('click', function (e) {
      var t = e.target.closest('.player-tabs button');
      if (t) show(li, vids, +t.getAttribute('data-i'));
    });
    btn.setAttribute('aria-expanded', 'true');
    show(li, vids, 0);
    makePerch(li, p);
    track('video-' + li.id, 'Video: ' + title(li));
  }

  /* ================= Comments on each lecture (kept on this site) =================
     comments/{id}: { vid, uid, name, text, at }. Signed-in students read and post;
     authors (and the teacher) can delete. Rendered with esc() only. */
  // Full screen: the video frame fills the screen (Esc or the player's own button exits)
  function goFullscreen(p) {
    var frame = p && p.querySelector('.frame'), ifr = frame && frame.querySelector('iframe');
    var el = frame || ifr;
    if (!el) return;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) { req.call(el); track('fullscreen', 'Video full screen'); }
    else if (ifr && ifr.webkitEnterFullscreen) ifr.webkitEnterFullscreen();     // older iPhone Safari
  }
  function toggleComments(p) {
    var btn = p.querySelector('.yt-comment'), panel = p.querySelector('.cmt');
    if (panel) { panel.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    if (cloud && !user) { signIn(); return; }
    panel = document.createElement('div');
    panel.className = 'cmt';
    panel.innerHTML = '<form class="cmt-form"><label class="sr" for="cmt-text">Write a comment</label>' +
      '<textarea id="cmt-text" maxlength="500" rows="2" placeholder="Ask a question or share what helped..."></textarea>' +
      '<div class="cmt-row"><span class="cmt-count">0 / 500</span><button class="btn btn-solid cmt-post" type="submit">Post</button></div></form>' +
      '<p class="cmt-status" role="status"></p><ol class="cmt-list" aria-live="polite"><li class="cmt-empty">Loading comments…</li></ol>';
    p.appendChild(panel);
    btn.setAttribute('aria-expanded', 'true');
    var ta = panel.querySelector('textarea');
    ta.addEventListener('input', function () { panel.querySelector('.cmt-count').textContent = ta.value.length + ' / 500'; });
    panel.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); postComment(p); });
    ta.focus();
    loadComments(p);
  }
  function when(ts) { return ts && ts.toDate ? ts.toDate() : null; }
  function ago(d) {
    if (!d) return 'just now';
    var sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    if (sec < 86400 * 30) return Math.floor(sec / 86400) + ' d ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function loadComments(p) {
    var panel = p.querySelector('.cmt'), vid = p.querySelector('.yt-comment').getAttribute('data-vid');
    if (!panel || !fb) return;
    var F = fb.f;
    F.getDocs(F.query(F.collection(fb.db, 'comments'), F.where('vid', '==', vid), F.limit(200))).then(function (snap) {
      var list = [];
      snap.forEach(function (d) { var v = d.data(); v.id = d.id; list.push(v); });
      list.sort(function (a, b) { return (when(b.at) || new Date()) - (when(a.at) || new Date()); });
      renderComments(p, list);
    }).catch(function () {
      panel.querySelector('.cmt-list').innerHTML = '<li class="cmt-empty">Comments could not be loaded right now.</li>';
    });
  }
  function renderComments(p, list) {
    var panel = p.querySelector('.cmt'); if (!panel) return;
    p.querySelector('.yt-comment .n').textContent = list.length ? String(list.length) : '';
    panel.querySelector('.cmt-list').innerHTML = list.length ? list.map(function (c) {
      var mine = user && c.uid === user.uid;
      return '<li class="cmt-item"><div class="cmt-head"><strong>' + esc(c.name || 'Student') + '</strong>' +
        '<span class="cmt-when">' + ago(when(c.at)) + '</span>' +
        (mine || isTeacher() ? '<button type="button" class="cmt-del" data-id="' + esc(c.id) + '">Delete</button>' : '') +
        '</div><p class="cmt-text">' + esc(c.text) + '</p></li>';
    }).join('') : '<li class="cmt-empty">No comments yet. Be the first to ask or share!</li>';
  }
  function postComment(p) {
    var panel = p.querySelector('.cmt'), ta = panel.querySelector('textarea'), status = panel.querySelector('.cmt-status');
    var text = ta.value.trim(), vid = p.querySelector('.yt-comment').getAttribute('data-vid');
    if (!text) { status.textContent = 'Write something first.'; ta.focus(); return; }
    if (!fb || !user) { signIn(); return; }
    var btn = panel.querySelector('.cmt-post'); btn.disabled = true; status.textContent = 'Posting…';
    fb.f.addDoc(fb.f.collection(fb.db, 'comments'), {
      vid: vid, uid: user.uid, name: (user.displayName || '').slice(0, 120), text: text.slice(0, 500), at: fb.f.serverTimestamp()
    }).then(function () {
      ta.value = ''; panel.querySelector('.cmt-count').textContent = '0 / 500'; status.textContent = '';
      if (perch) perchSay('Thanks for sharing!', 'happy', 2600);
      track('comment', 'Comment posted');
      loadComments(p);
    }).catch(function () { status.textContent = 'That did not post. Please try again.'; })
      .then(function () { btn.disabled = false; });
  }
  function deleteComment(btn) {
    var p = btn.closest('.player');
    if (!fb || !window.confirm('Delete this comment?')) return;
    fb.f.deleteDoc(fb.f.doc(fb.db, 'comments', btn.getAttribute('data-id')))
      .then(function () { loadComments(p); })
      .catch(function () { p.querySelector('.cmt-status').textContent = 'Could not delete that comment.'; });
  }

  /* ================= Like / Subscribe: on-page reactions with a little celebration =================
     Signed-in students: each like / subscribe is saved on their account (users/{uid}.reacts) and
     added to a public total (stats/v_<videoId>.likes, stats/channel.subs) in one batch, so the
     Firestore rules can check nobody counts twice. Without Firebase they stay in this browser. */
  var reacts = cloud ? {} : lsGet('bs-reacts', {});   // 'v_<videoId>' or 'channel' -> true
  var totals = {};                                    // same keys -> public count
  var asked = {};                                     // stats docs already fetched
  function likeKey(btn) { return 'v_' + btn.getAttribute('data-vid'); }
  function paintReactions(p) {
    var lk = p.querySelector('.yt-like'), sb = p.querySelector('.yt-sub');
    var k = likeKey(lk), on = !!reacts[k], sub = !!reacts.channel;
    lk.setAttribute('aria-pressed', on ? 'true' : 'false');
    lk.querySelector('.t').textContent = on ? 'Liked' : 'Like';
    lk.querySelector('.n').textContent = totals[k] > 0 ? String(totals[k]) : '';
    sb.setAttribute('aria-pressed', sub ? 'true' : 'false');
    sb.querySelector('.t').textContent = sub ? 'Subscribed' : 'Subscribe';
  }
  function repaintPlayers() { [].forEach.call(document.querySelectorAll('.player'), paintReactions); }
  function loadTotals(keys) {
    if (!fb) return;
    keys.forEach(function (k) {
      if (asked[k]) return;
      asked[k] = true;
      fb.f.getDoc(fb.f.doc(fb.db, 'stats', k)).then(function (snap) {
        var v = snap.exists() ? snap.data() : {};
        totals[k] = Math.max(0, (k === 'channel' ? v.subs : v.likes) || 0);
        repaintPlayers();
      }).catch(function () { asked[k] = false; });
    });
  }
  /* ---- pixel particles with simple physics: launch velocity, gravity, air drag, spin ---- */
  var SPR = {
    heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
    spark: ['..X..', '..X..', 'XXWXX', '..X..', '..X..'],
    dot:   ['XX', 'XX'],
    star:  ['.X.', 'XWX', '.X.']
  };
  function sprite(rows, color) {
    var h = rows.length, w = rows[0].length, r = '';
    rows.forEach(function (line, y) {
      for (var x = 0; x < w; x++) {
        var c = line[x];
        if (c !== '.') r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + (c === 'W' ? '#fff' : color) + '"/>';
      }
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + (w * 3) + '" height="' + (h * 3) + '" shape-rendering="crispEdges">' + r + '</svg>';
  }
  var PALETTE = {
    like: [['heart', '#e8452c'], ['heart', '#ff6b81'], ['heart', '#c23a33'], ['spark', '#ffd23f'], ['star', '#ffffff'], ['dot', '#ff9f1c']],
    sub:  [['spark', '#4285F4'], ['spark', '#EA4335'], ['spark', '#FBBC05'], ['spark', '#34A853'], ['star', '#ffd23f'], ['dot', '#4285F4']]
  };
  var calmFx = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function burst(btn, kind) {
    var r = btn.getBoundingClientRect(), ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    var layer = document.createElement('div');
    layer.className = 'pfx';
    document.body.appendChild(layer);
    var parts = [], N = calmFx ? 0 : 14, pal = PALETTE[kind];
    for (var i = 0; i < N; i++) {
      var pick = pal[i % pal.length], el = document.createElement('i');
      el.innerHTML = sprite(SPR[pick[0]], pick[1]);
      layer.appendChild(el);
      var ang = -Math.PI / 2 + (Math.random() - .5) * 1.9, sp = 3.4 + Math.random() * 3.4;
      parts.push({ el: el, x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: 0,
                   vr: (Math.random() - .5) * 7, life: 0, max: 85 + Math.random() * 40, s: .6 + Math.random() * .45 });
    }
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    var last = performance.now();
    function tick(now) {
      var dt = Math.min(2.5, (now - last) / 16.67); last = now;
      var alive = 0;
      parts.forEach(function (p) {
        if (p.life > p.max) { p.el.style.opacity = 0; return; }
        alive++;
        p.vy += 0.13 * dt;                  // gentle gravity
        p.vx *= Math.pow(0.985, dt);        // air drag
        p.vy *= Math.pow(0.99, dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life += dt;
        var k = p.life / p.max, fade = k < .7 ? 1 : 1 - (k - .7) / .3;
        p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' +
          p.rot.toFixed(0) + 'deg) scale(' + p.s.toFixed(2) + ')';
        p.el.style.opacity = fade.toFixed(2);
      });
      if (alive) requestAnimationFrame(tick); else layer.remove();
    }
    if (N) requestAnimationFrame(tick); else setTimeout(function () { layer.remove(); }, 50);
  }

  /* ---- Ember flies in from the corner on an arc, lands by the button, thanks you, flies off ---- */
  var thanks = null;
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function bez(a, c, b, t) { var u = 1 - t; return u * u * a + 2 * u * t * c + t * t * b; }
  function emberThanks(btn, text) {
    var art = $('buddy') && $('buddy').querySelector('.bit');
    if (!art) return;
    if (thanks) { thanks.remove(); thanks = null; }
    flyHideUntil = performance.now() + 4200; render();
    setTimeout(render, 4300);
    var box = document.createElement('div');
    box.className = 'thanks';
    box.setAttribute('role', 'status');
    var sp = art.cloneNode(true);
    sp.setAttribute('class', 'bit bit-sm mood-happy fly-flap');
    box.innerHTML = '<div class="px-bubble thanks-say" hidden></div>';
    box.appendChild(sp);
    document.body.appendChild(box);
    thanks = box;
    var r = btn.getBoundingClientRect();
    var land = { x: Math.max(8, Math.min(window.innerWidth - 60, r.left + r.width / 2 - 24)), y: r.bottom + 6 };
    var from = { x: window.innerWidth - 60, y: window.innerHeight - 70 };
    var ctrl = { x: (from.x + land.x) / 2 + 60, y: Math.min(from.y, land.y) - 170 };
    function place(x, y, tilt) {
      box.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + tilt.toFixed(1) + 'deg)';
    }
    function fly(a, c, b, ms, done) {
      var t0 = performance.now(), px = a.x;
      (function step(now) {
        if (thanks !== box) return;
        var t = Math.min(1, (now - t0) / ms), e = ease(t);
        var x = bez(a.x, c.x, b.x, e), y = bez(a.y, c.y, b.y, e);
        var tilt = Math.max(-18, Math.min(18, (x - px) * 2.2));   // lean into the motion
        box.classList.toggle('to-left', x < px - .3);
        px = x;
        place(x, y, t < 1 ? tilt : 0);
        if (t < 1) requestAnimationFrame(step); else done();
      })(t0);
    }
    var say = box.querySelector('.thanks-say');
    if (calmFx) {
      place(land.x, land.y, 0); say.textContent = text; say.hidden = false;
      setTimeout(function () { if (thanks === box) { box.remove(); thanks = null; } }, 2200);
      return;
    }
    place(from.x, from.y, 0);
    fly(from, ctrl, land, 1600, function () {
      box.classList.add('land');                       // squash and stretch on touchdown
      cheerMood(sp);
      say.textContent = text; say.hidden = false;
      setTimeout(function () {
        if (thanks !== box) return;
        say.hidden = true; box.classList.remove('land');
        sp.setAttribute('class', 'bit bit-sm mood-happy fly-flap');
        var out = { x: window.innerWidth + 40, y: window.innerHeight + 40 };
        fly(land, { x: land.x + 160, y: land.y + 40 }, out, 1500, function () {
          if (thanks === box) { box.remove(); thanks = null; }
        });
      }, 1900);
    });
  }
  function react(btn) {
    if (cloud && !user) { signIn(); return; }          // a like counts once per Google account
    if (!ready) return;
    var isLike = btn.classList.contains('yt-like');
    var k = isLike ? likeKey(btn) : 'channel', on = !reacts[k];
    if (on) reacts[k] = true; else delete reacts[k];
    totals[k] = Math.max(0, (totals[k] || 0) + (on ? 1 : -1));
    if (cloud && fb) {
      var batch = fb.f.writeBatch(fb.db), mine = { reacts: {}, lastReact: k }, stat = {};
      mine.reacts[k] = on ? fb.f.serverTimestamp() : fb.f.deleteField();
      stat[isLike ? 'likes' : 'subs'] = fb.f.increment(on ? 1 : -1);
      batch.set(userRef(), mine, { merge: true });
      batch.set(fb.f.doc(fb.db, 'stats', k), stat, { merge: true });
      batch.commit().catch(function () {                // undo on screen if it was not saved
        if (on) delete reacts[k]; else reacts[k] = true;
        totals[k] = Math.max(0, (totals[k] || 0) + (on ? -1 : 1));
        note = 'Could not save that just now. Please try again.';
        render(); repaintPlayers();
      });
    } else {
      lsSet('bs-reacts', reacts);
    }
    if (on) {
      burst(btn, isLike ? 'like' : 'sub');
      if (perch) perchSay(isLike ? 'Thank you!' : 'Welcome to the crew!', 'happy', 2800);
      else emberThanks(btn, isLike ? 'Thank you!' : 'Welcome to the crew!');
    }
    repaintPlayers();
  }

  /* ================= clicks ================= */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest('#auth')) closeMenu();
    var w = t.closest('.watch');
    if (w) {
      e.preventDefault();
      var li = w.closest('.ws');
      if (w.getAttribute('aria-expanded') === 'true') closePlayer(li); else openPlayer(li, w);
      return;
    }
    var o = t.closest('.ws .open');
    if (o && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      location.hash = 'view-' + o.closest('.ws').id;          // the hash opens the viewer (Back closes it)
      return;
    }
    if (t.closest('#pbook-open')) { location.hash = 'view-practice'; return; }
    var mc = t.closest('.modcard');
    if (mc) { var mod = $(mc.getAttribute('data-mod')); if (mod) { mod.open = true; mod.removeAttribute('data-auto'); } }
    var fs = t.closest('.yt-full');
    if (fs) { goFullscreen(fs.closest('.player')); return; }
    var cb = t.closest('.yt-comment');
    if (cb) { toggleComments(cb.closest('.player')); return; }
    var del = t.closest('.cmt-del');
    if (del) { deleteComment(del); return; }
    if (t.closest('.fly-btn')) { poke(); return; }
    var ow = t.closest('[data-open]');
    if (ow) { location.hash = 'view-' + ow.getAttribute('data-open'); if (perch) perch.say.hidden = true; return; }
    var y = t.closest('.yt-like, .yt-sub');
    if (y) { react(y); return; }
    var d = t.closest('.ws .done');
    if (d) { toggleDone(d.closest('.ws').id); return; }
    var f = t.closest('#seg button');
    if (f) { filter = f.getAttribute('data-f'); render(); return; }
    var n = t.closest('[data-next]');
    if (n) {
      e.preventDefault();
      if (n.classList.contains('row-next')) clearRowBuddy();
      if (filter === 'done') { filter = 'all'; render(); }
      var target = $(n.getAttribute('data-next'));
      openModuleOf(target);
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
      setTimeout(function () { target.classList.remove('flash'); }, 1600);
      return;
    }
    if (t.closest('#signin') || t.closest('#signin2') || t.closest('#gate-signin')) { signIn(); return; }
    if (t.closest('#me')) { toggleMenu(); return; }
    if (t.closest('#signout')) { signOut(); return; }
    if (t.closest('#viewer-done') && viewerId) { toggleDone(viewerId); return; }
    if (t.closest('#viewer-close')) {
      history.replaceState(null, '', location.pathname + location.search);
      closeViewer();
    }
  });

  /* ================= worksheet viewer: view-only page images (no PDF is published) ================= */
  var viewer = $('viewer'), pages = $('viewer-pages');
  var lastFocus = null, viewerId = null;

  function viewerNote(text) { pages.innerHTML = '<p class="viewer-note">' + esc(text) + '</p>'; }

  function openViewer(li) {
    pages.style.removeProperty('--page-ratio');
    var list = (li.querySelector('.open').getAttribute('data-pages') || '').split('|').filter(Boolean);
    openPages(list, num(li) + '  ' + title(li), li.id, li.querySelector('.open').getAttribute('data-pdf'));
  }
  function openBook() {
    var b = $('pbook-open');
    if (b && b.getAttribute('data-ratio')) pages.style.setProperty('--page-ratio', b.getAttribute('data-ratio'));
    openPages((b && b.getAttribute('data-pages') || '').split('|').filter(Boolean), (b && b.getAttribute('data-heading')) || 'Practice Book: all practice sets, module by module', null,
      b && b.getAttribute('data-pdf'));
  }
  function openPages(list, heading, id, pdf) {
    var dl = $('viewer-dl');
    if (dl) { dl.hidden = !pdf; if (pdf) { dl.href = pdf; dl.setAttribute('download', pdf.split('/').pop()); } }
    viewerId = id;
    lastFocus = document.activeElement;
    $('viewer-title').textContent = heading;
    $('viewer-done').hidden = !id;                       // the book has no single "done" tick
    viewer.hidden = false;
    document.body.classList.add('viewing');
    $('viewer-close').focus();
    track(id ? 'pdf-' + id : 'practice-book', heading);
    render();
    if (!list.length) { viewerNote('This could not be shown. Please try again later.'); return; }
    pages.innerHTML = list.map(function (src, i) {
      // background images (not <img>) so there is no "Save image" target or drag-out
      return '<div class="sheet-page" role="img" aria-label="Page ' + (i + 1) + ' of ' + list.length + '"' +
        (i > 3 ? ' data-src="' + src.replace(/[^\w\/.\-]/g, '') + '"' : ' style="background-image:url(\'' + src.replace(/[^\w\/.\-]/g, '') + '\')"') + '></div>';
    }).join('');
    pages.scrollTop = 0;
    lazyPages();
  }
  // long documents: load page images as they scroll into view
  var pageObs = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target, src = el.getAttribute('data-src');
      if (src) { el.style.backgroundImage = "url('" + src + "')"; el.removeAttribute('data-src'); }
      pageObs.unobserve(el);
    });
  }, { root: null, rootMargin: '800px 0px' }) : null;
  function lazyPages() {
    [].forEach.call(pages.querySelectorAll('.sheet-page[data-src]'), function (el) {
      if (pageObs) pageObs.observe(el);
      else { el.style.backgroundImage = "url('" + el.getAttribute('data-src') + "')"; el.removeAttribute('data-src'); }
    });
  }
  function closeViewer() {
    viewerId = null;
    viewer.hidden = true;
    pages.innerHTML = '';
    document.body.classList.remove('viewing');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    render();
  }
  function route() {
    if (location.hash === '#view-practice') { openBook(); return; }
    var m = /^#view-([a-z]\d+)$/.exec(location.hash);
    var li = m && $(m[1]);
    if (li && li.querySelector('.open')) openViewer(li); else if (!viewer.hidden) closeViewer();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('menu') && !$('menu').hidden) { closeMenu(); $('me').focus(); }
    else if (!viewer.hidden) $('viewer-close').click();
  });

  render();
  route();
  if (cloud) cloudInit();
})();
