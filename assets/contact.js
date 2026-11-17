/* 10-Minute Worksheets | Binary Star | (c) Ashwini Kumar Mathur
   Contact page: a signed-in student writes a message; it is saved for the teacher
   (shown on the class dashboard) and can also be sent as an email. */
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
  // Assembled here so the address is not sitting in the page source for scrapers.
  var TO = ['ashmathur91', 'gmail.com'].join('@');
  var MAX = 2000;

  function $(id) { return document.getElementById(id); }
  var fb = null, user = null, sending = false, lastTopic = '', lastText = '';
  var form = $('contact-form'), msg = $('msg'), status = $('status');
  var dragon = document.querySelector('.contact-hero .bit');

  function mood(m) {
    dragon.classList.remove('mood-idle', 'mood-happy', 'mood-fire', 'mood-wow', 'mood-sad');
    void dragon.getBoundingClientRect();
    dragon.classList.add('mood-' + m);
  }
  function say(t) { $('contact-say').textContent = t; }
  function mailto(subject, body) {
    return 'mailto:' + TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  $('mail-direct').href = mailto('Short Practice Sprints', '');

  /* ---------- gate ---------- */
  function renderGate() {
    var show = !!CFG && !user;
    document.body.classList.toggle('gated', show);
    $('gate').hidden = !show;
    var b = $('gate-signin');
    b.disabled = !fb;
    b.querySelector('span').textContent = fb ? 'Sign in with Google' : 'Loading…';
    $('auth').innerHTML = user ? '<button type="button" class="menu-out adm-out" id="signout">Sign out</button>' : '';
  }

  function init() {
    if (!CFG) { renderGate(); return; }
    renderGate();
    Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')])
      .then(function (m) {
        var app = m[0].initializeApp(CFG);
        fb = { a: m[1], f: m[2], auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
        fb.a.onAuthStateChanged(fb.auth, function (u) { user = u; renderGate(); });
      })
      .catch(function () { status.textContent = 'Could not connect. You can still email using the link below.'; mood('sad'); });
  }
  function signIn() {
    var provider = new fb.a.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    fb.a.signInWithPopup(fb.auth, provider).catch(function (err) {
      if (err && err.code === 'auth/popup-blocked') fb.a.signInWithRedirect(fb.auth, provider);
    });
  }

  /* ---------- form ---------- */
  msg.addEventListener('input', function () {
    $('count').textContent = msg.value.length + ' / ' + MAX;
    if (msg.value.trim().length > 2 && dragon.classList.contains('mood-idle')) mood('happy');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    var text = msg.value.trim();
    var topic = (form.querySelector('input[name=topic]:checked') || {}).value || 'Feedback';
    if (text.length < 3) { status.textContent = 'Please write a little more.'; mood('wow'); msg.focus(); return; }
    if (!user || !fb) { signIn(); return; }
    sending = true;
    $('send').disabled = true;
    status.textContent = 'Sending…';
    fb.f.addDoc(fb.f.collection(fb.db, 'feedback'), {
      uid: user.uid, name: (user.displayName || '').slice(0, 120), email: user.email || '',
      topic: topic, message: text.slice(0, MAX), at: fb.f.serverTimestamp()
    }).then(function () {
      lastTopic = topic; lastText = text;
      form.hidden = true;
      $('done').hidden = false;
      $('mail-copy').href = mailto(topic + ' from ' + (user.displayName || 'a student'), text);
      status.textContent = '';
      say('Message received. You are awesome!');
      mood('fire');
    }).catch(function () {
      status.textContent = 'That did not send. Check your connection and try again, or use the email link below.';
      say('Oh no, my wings got tangled.');
      mood('sad');
    }).then(function () { sending = false; $('send').disabled = false; });
  });

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#gate-signin')) signIn();
    else if (t.closest('#signout')) fb.a.signOut(fb.auth);
    else if (t.closest('#again')) {
      msg.value = ''; $('count').textContent = '0 / ' + MAX;
      $('done').hidden = true; form.hidden = false;
      say('What else is on your mind?'); mood('idle'); msg.focus();
    }
  });

  init();
})();
