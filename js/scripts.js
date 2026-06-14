/* ===================================================================
   Forge — app logic
   90-day bodyweight challenge for up to 10 named users.
   Auth: Firebase magic-link (passwordless) email sign-in.
   Dashboard, exercise logging, best-effort Fridays, points & streaks
   are all rendered dynamically here so index.html stays untouched.
   =================================================================== */

(function () {
  'use strict';

  // ---- Developer mode ----------------------------------------------
  // When true, shows a subtle "Dev Login" button that bypasses the magic-link
  // flow and signs straight in as Mark. Set to false for production — never
  // remove this constant.
  const DEV_MODE = true;

  // ---- Constants ----------------------------------------------------
  var INVITE_CODE = 'FORGE2026';
  var MAX_USERS = 10;
  var EMAIL_STORAGE_KEY = 'forge:pendingEmail';

  var TOTAL_DAYS = 90;
  var TOTAL_WEEKS = 13;
  // Soft launch (train freely, no points) runs 16–21 June 2026.
  // Points/streaks begin Monday 22 June 2026 (POINTS_START).
  // The day counter's Day 1 is Tuesday 23 June 2026 (CHALLENGE_START);
  // so 22 June shows 0/90 while still earning points, Day 1 lands 23 June.
  var SOFT_START = new Date(2026, 5, 16);
  var POINTS_START = new Date(2026, 5, 22);
  var CHALLENGE_START = new Date(2026, 5, 23);

  // Exercise definitions with linear progression start/end points.
  var EXERCISES = {
    pressups: { key: 'pressups', name: 'Press-ups', kind: 'reps', start: 5, end: 50 },
    situps:   { key: 'situps',   name: 'Sit-ups',   kind: 'reps', start: 10, end: 100 },
    plank:    { key: 'plank',    name: 'Plank',     kind: 'time', start: 20, end: 180 },
    lunges:   { key: 'lunges',   name: 'Lunges',    kind: 'legs', start: 5, end: 20 }
  };
  var ORDER = ['pressups', 'situps', 'plank', 'lunges'];

  var MOODS = ['Crushed it', 'Felt good', 'Got through it', 'Struggled', 'Really tough'];

  // Bonus spin pool — core & balance moves, separate from the 4 daily exercises.
  var BONUS_EXERCISES = [
    { name: 'Dead Bug', target: 'Hold for 30 seconds' },
    { name: 'Bird Dog', target: '10 reps each side' },
    { name: 'Glute Bridge', target: '20 reps' },
    { name: 'Mountain Climbers', target: '30 seconds' },
    { name: 'Superman Hold', target: 'Hold for 30 seconds' },
    { name: 'Hollow Body Hold', target: 'Hold for 20 seconds' },
    { name: 'Single Leg Balance', target: '30 seconds each leg' },
    { name: 'Crab Reach', target: '10 reps each side' },
    { name: 'Flutter Kicks', target: '30 seconds' },
    { name: 'Bear Crawl', target: '10 steps forward, 10 steps back' }
  ];

  // Warm-up / cool-down routines keyed by weekday (0=Sun … 6=Sat). The moves
  // match the exercises active that day. Saturday (full rest) has none.
  var R = {
    armCircles:    { name: 'Arm circles', target: '10 reps' },
    shoulderRolls: { name: 'Shoulder rolls', target: '10 reps' },
    hipCircles:    { name: 'Hip circles', target: '10 reps' },
    legSwings:     { name: 'Leg swings', target: '10 reps each leg' },
    inchworm:      { name: 'Inchworm', target: '5 reps' },
    gluteBridge:   { name: 'Glute bridge', target: '10 reps' },
    catCow:        { name: 'Cat-cow', target: '10 reps' },
    chestStretch:  { name: 'Chest stretch', target: '30 sec' },
    childsPose:    { name: "Child's pose", target: '30 sec' },
    spinalTwist:   { name: 'Spinal twist', target: '30 sec each side' },
    hipFlexor:     { name: 'Hip flexor stretch', target: '30 sec each side' },
    quadStretch:   { name: 'Quad stretch', target: '30 sec each side' }
  };

  var SUN_MON = {
    warmup: [R.armCircles, R.shoulderRolls, R.inchworm, R.gluteBridge],
    cooldown: [R.chestStretch, R.childsPose, R.catCow, R.spinalTwist]
  };

  var ROUTINES = {
    0: SUN_MON, // Sunday — Press-ups, Sit-ups, Plank
    1: SUN_MON, // Monday — Press-ups, Sit-ups, Plank
    2: {        // Tuesday — Press-ups, Sit-ups, Lunges
      warmup: [R.armCircles, R.hipCircles, R.legSwings, R.inchworm],
      cooldown: [R.chestStretch, R.hipFlexor, R.quadStretch, R.spinalTwist]
    },
    3: {        // Wednesday — Sit-ups, Plank, Lunges
      warmup: [R.hipCircles, R.legSwings, R.gluteBridge, R.catCow],
      cooldown: [R.childsPose, R.hipFlexor, R.spinalTwist, R.quadStretch]
    },
    4: {        // Thursday — Press-ups, Plank, Lunges
      warmup: [R.armCircles, R.shoulderRolls, R.legSwings, R.inchworm],
      cooldown: [R.chestStretch, R.childsPose, R.hipFlexor, R.quadStretch]
    },
    5: {        // Friday — all four, best effort
      warmup: [R.armCircles, R.hipCircles, R.legSwings, R.inchworm, R.gluteBridge],
      cooldown: [R.chestStretch, R.childsPose, R.catCow, R.hipFlexor, R.quadStretch, R.spinalTwist]
    },
    6: null     // Saturday — full rest, no routine
  };

  // Photo avatars keyed by user name. Anyone not listed gets a CSS-generated
  // placeholder (orange circle with their initial).
  var AVATARS = {
    Mark: 'images/mark.png',
    Shelley: 'images/shelley.png',
    Liisa: 'images/liisa.png',
    Nikki: 'images/nikki.png',
    Andy: 'images/andy.png'
  };

  // The full team is always shown in the carousel, registered or not. Members
  // with a photo in AVATARS show it; the rest get an initial placeholder.
  var TEAM = ['Mark', 'Shelley', 'Hayley', 'Liisa', 'Nikki', 'Keith', 'Lou', 'Andy'];

  // Motivational quotes — a random one is shown on the login screen each load.
  var QUOTES = [
    "The only bad workout is the one that didn't happen.",
    'Push yourself because no one else is going to do it for you.',
    "Your body can stand almost anything. It's your mind you have to convince.",
    'Success starts with self-discipline.',
    'The pain you feel today will be the strength you feel tomorrow.',
    "Don't stop when it hurts. Stop when you're done.",
    'Wake up with determination. Go to bed with satisfaction.',
    'Do something today that your future self will thank you for.',
    'It never gets easier, you just get stronger.',
    'Believe in yourself and all that you are.',
    'Champions are made from something they have deep inside them — a desire, a dream, a vision.',
    "The harder you work for something, the greater you'll feel when you achieve it.",
    "Take care of your body. It's the only place you have to live.",
    'Strength does not come from the body. It comes from the will of the soul.',
    'Every rep, every set, every day — it all adds up.',
    'Small steps every day lead to big results.',
    "You don't have to be great to start, but you have to start to be great.",
    'Forge yourself. Day by day.',
    'The clock is ticking. Are you becoming the person you want to be?',
    'Iron sharpens iron. So one person sharpens another.'
  ];

  // ---- Firebase init ------------------------------------------------
  var firebaseConfig = {
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
    messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
    appId: FIREBASE_APP_ID
  };

  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db = firebase.firestore();

  // Keep the session across hard refreshes so a logged-in user lands straight
  // on the dashboard instead of re-triggering any auth flow.
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) {
    console.error('Failed to set auth persistence:', err);
  });

  var actionCodeSettings = {
    url: window.location.origin + '/forge-app/',
    handleCodeInApp: true
  };

  // ---- DOM references (login screens live in index.html) -----------
  var loginScreen = document.getElementById('login-screen');
  var registerScreen = document.getElementById('register-screen');
  var dashboardScreen = document.getElementById('dashboard-screen');

  var carousel = document.getElementById('carousel');
  var carouselPrev = document.getElementById('carousel-prev');
  var carouselNext = document.getElementById('carousel-next');
  var forgeBtn = document.getElementById('forge-btn');
  var devLoginBtn = document.getElementById('dev-login-btn');
  var loginMessage = document.getElementById('login-message');
  var loginJunk = document.getElementById('login-junk');

  var confirmScreen = document.getElementById('confirm-screen');
  var confirmEmail = document.getElementById('confirm-email');
  var confirmBtn = document.getElementById('confirm-btn');
  var confirmMessage = document.getElementById('confirm-message');

  var registerForm = document.getElementById('register-form');
  var registerBack = document.getElementById('register-back');
  var registerMessage = document.getElementById('register-message');
  var registerJunk = document.getElementById('register-junk');
  var regName = document.getElementById('reg-name');
  var regEmail = document.getElementById('reg-email');
  var regCode = document.getElementById('reg-code');

  // ---- State --------------------------------------------------------
  var users = [];           // registered users from Firestore
  var cards = [];           // carousel card elements (users + register)
  var currentIndex = 0;     // centred carousel card
  var touchStartX = null;   // swipe tracking
  var completingSignIn = false; // suppress login screen while a magic link completes

  var state = { user: null, logs: [] };

  // ===================================================================
  // Screen helpers
  // ===================================================================
  function showScreen(screen) {
    var all = document.querySelectorAll('.screen');
    Array.prototype.forEach.call(all, function (s) {
      s.classList.add('hidden');
    });
    screen.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function ensureScreen(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('main');
      el.id = id;
      el.className = 'screen hidden';
      document.body.appendChild(el);
    }
    return el;
  }

  function setMessage(el, text, isError) {
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ===================================================================
  // Date / progression / schedule maths
  // ===================================================================
  function atMidnight(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dateKey(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function parseKey(key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function daysBetween(a, b) {
    return Math.round((atMidnight(b) - atMidnight(a)) / 86400000);
  }

  function challengeDay(d) {
    return daysBetween(CHALLENGE_START, d) + 1;
  }

  function weekNumber(day) {
    return Math.ceil(day / 7);
  }

  // Smooth linear progression, clamped to the 90-day window.
  function targetFor(ex, day) {
    var d = Math.max(1, Math.min(TOTAL_DAYS, day));
    var val = ex.start + (ex.end - ex.start) * (d - 1) / (TOTAL_DAYS - 1);
    return Math.round(val);
  }

  function formatSeconds(total) {
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m === 0) return s + ' sec';
    if (s === 0) return m + ' min';
    return m + ' min ' + s + ' sec';
  }

  function formatTarget(ex, value) {
    if (ex.kind === 'time') return formatSeconds(value);
    if (ex.kind === 'legs') return value + ' each leg';
    return value + ' reps';
  }

  function unitLabel(ex) {
    if (ex.kind === 'time') return 'seconds held';
    if (ex.kind === 'legs') return 'reps each leg';
    return 'reps completed';
  }

  // Weekly rest-day rotation. getDay(): 0=Sun .. 6=Sat
  function scheduleFor(d) {
    switch (d.getDay()) {
      case 1: return { type: 'normal', rest: 'lunges',   active: ['pressups', 'situps', 'plank'] };
      case 2: return { type: 'normal', rest: 'plank',    active: ['pressups', 'situps', 'lunges'] };
      case 3: return { type: 'normal', rest: 'pressups', active: ['situps', 'plank', 'lunges'] };
      case 4: return { type: 'normal', rest: 'situps',   active: ['pressups', 'plank', 'lunges'] };
      case 5: return { type: 'besteffort', rest: null,   active: ['pressups', 'situps', 'plank', 'lunges'] };
      case 6: return { type: 'rest', rest: null,         active: [] };
      default: return { type: 'normal', rest: 'lunges',  active: ['pressups', 'situps', 'plank'] }; // Sunday
    }
  }

  function inSoftLaunch(d) {
    var m = atMidnight(d);
    return m >= SOFT_START && m < POINTS_START;
  }

  function pointsActive(d) {
    return atMidnight(d) >= POINTS_START;
  }

  // ===================================================================
  // Points & streak engine (recomputed deterministically from logs)
  // ===================================================================
  function logsByDate(logs) {
    var map = {};
    logs.forEach(function (l) {
      (map[l.date] = map[l.date] || []).push(l);
    });
    return map;
  }

  function dayCompleted(d, byDate) {
    var sched = scheduleFor(d);
    if (sched.active.length === 0) return true; // Saturday — nothing due
    var dayLogs = byDate[dateKey(d)] || [];
    var logged = dayLogs.filter(function (l) { return !l.bonusExercise; })
                        .map(function (l) { return l.exercise; });
    return sched.active.every(function (k) { return logged.indexOf(k) >= 0; });
  }

  function computeCurrentStreak(byDate) {
    var today = atMidnight(new Date());
    var d = new Date(today);
    var streak = 0;
    while (d >= POINTS_START) {
      var sched = scheduleFor(d);
      if (sched.active.length === 0) { d.setDate(d.getDate() - 1); continue; } // Saturday bridges
      if (dayCompleted(d, byDate)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else if (atMidnight(d).getTime() === today.getTime()) {
        d.setDate(d.getDate() - 1); // today still in progress — don't break
      } else {
        break;
      }
    }
    return streak;
  }

  function computeLongestStreak(byDate) {
    var today = atMidnight(new Date());
    var d = new Date(POINTS_START);
    var run = 0, best = 0;
    while (d <= today) {
      var sched = scheduleFor(d);
      if (sched.active.length === 0) { d.setDate(d.getDate() + 1); continue; }
      if (dayCompleted(d, byDate)) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
      d.setDate(d.getDate() + 1);
    }
    return best;
  }

  function computeStats(logs) {
    var byDate = logsByDate(logs);
    var points = 0;

    Object.keys(byDate).forEach(function (dk) {
      var d = parseKey(dk);
      if (!pointsActive(d)) return; // soft launch & pre-launch earn nothing

      var dayLogs = byDate[dk];
      var sched = scheduleFor(d);

      // Per-exercise points (bonus spin exercise = 20, otherwise 10).
      dayLogs.forEach(function (l) {
        points += l.bonusExercise ? 20 : 10;
      });

      // All exercises due today logged.
      if (sched.active.length) {
        var logged = dayLogs.filter(function (l) { return !l.bonusExercise; })
                            .map(function (l) { return l.exercise; });
        var allDue = sched.active.every(function (k) { return logged.indexOf(k) >= 0; });
        if (allDue) points += 25;

        if (sched.type === 'besteffort') {
          var allBest = sched.active.every(function (k) {
            return dayLogs.some(function (l) { return l.exercise === k && l.isBestEffort; });
          });
          if (allBest) points += 50;
        }
      }
    });

    var current = computeCurrentStreak(byDate);
    var longest = computeLongestStreak(byDate);
    if (longest >= 7) points += 100;
    if (longest >= 30) points += 500;

    return { totalPoints: points, currentStreak: current, longestStreak: longest };
  }

  // ===================================================================
  // Rolodex carousel — login screen
  // ===================================================================
  function renderCarousel() {
    carousel.innerHTML = '';
    cards = [];

    TEAM.forEach(function (name, i) {
      cards.push(buildCard(name, AVATARS[name] || null, i, false));
    });
    cards.push(buildCard('Register', null, TEAM.length, true));

    cards.forEach(function (card) { carousel.appendChild(card); });

    currentIndex = 0;
    layout();
    playEntryAnimation();
  }

  function buildCard(name, avatar, index, isRegister) {
    var card = document.createElement('div');
    card.className = 'ucard' + (isRegister ? ' ucard--register' : '');
    card.setAttribute('role', 'option');
    card.dataset.index = String(index);

    var inner = document.createElement('div');
    inner.className = 'ucard-inner';

    if (isRegister) {
      var plus = document.createElement('span');
      plus.className = 'ucard-avatar ucard-avatar--register';
      plus.textContent = '+';
      inner.appendChild(plus);
    } else if (avatar) {
      var img = document.createElement('img');
      img.className = 'ucard-avatar';
      img.src = avatar;
      img.alt = '';
      inner.appendChild(img);
    } else {
      var ph = document.createElement('span');
      ph.className = 'ucard-avatar ucard-avatar--placeholder';
      ph.textContent = name.charAt(0).toUpperCase();
      inner.appendChild(ph);
    }

    var label = document.createElement('span');
    label.className = 'ucard-name';
    label.textContent = name;
    inner.appendChild(label);

    card.appendChild(inner);
    card.addEventListener('click', function () { setIndex(index); });
    return card;
  }

  // Position every card relative to the centred currentIndex using the shortest
  // circular distance, so the carousel wraps seamlessly: the active card sits
  // centre/full-scale, neighbours compress and fade into the flanks, and cards
  // crossing the wrap point do so while hidden (opacity 0).
  function layout() {
    var n = cards.length;
    cards.forEach(function (card, i) {
      var off = ((i - currentIndex) % n + n) % n; // 0..n-1
      if (off > n / 2) off -= n;                   // shift far side to negatives
      var abs = Math.abs(off);
      var x, scale, opacity, z;
      if (off === 0) { x = 0; scale = 1; opacity = 1; z = 30; }
      else if (abs === 1) { x = off * 120; scale = 0.85; opacity = 0.5; z = 20; }
      else { x = (off > 0 ? 1 : -1) * 150; scale = 0.7; opacity = 0; z = 10; }

      card.style.transform = 'translate(-50%, -50%) translateX(' + x + 'px) scale(' + scale + ')';
      card.style.opacity = opacity;
      card.style.zIndex = z;
      card.classList.toggle('is-active', off === 0);
    });
  }

  function playEntryAnimation() {
    cards.forEach(function (card) {
      var inner = card.firstChild;
      var delay = Math.abs(Number(card.dataset.index) - currentIndex) * 150;
      inner.style.animation = 'none';
      // Force reflow so the animation restarts on every render.
      void inner.offsetWidth;
      inner.style.animation = 'cardIn 500ms ease-out both';
      inner.style.animationDelay = delay + 'ms';
    });
  }

  function setIndex(i) {
    var n = cards.length;
    currentIndex = ((i % n) + n) % n; // wrap around for infinite looping
    layout();
  }

  function carouselGo(delta) {
    setIndex(currentIndex + delta);
  }

  function isRegisterSelected() {
    return currentIndex === TEAM.length;
  }

  function onCarouselKey(e) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      carouselGo(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      carouselGo(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onForge();
    }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].clientX;
  }

  function onTouchEnd(e) {
    if (touchStartX === null) return;
    var delta = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) < 40) return;
    carouselGo(delta < 0 ? 1 : -1); // swipe left -> next, swipe right -> prev
  }

  // ===================================================================
  // Users / login
  // ===================================================================
  // Load registered users (used to decide registered vs. not, and by enterApp).
  // The carousel itself is the static TEAM list, so it does not depend on this.
  function loadUsers() {
    return db.collection('users').orderBy('createdAt', 'asc').limit(MAX_USERS).get()
      .then(function (snap) {
        users = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          users.push({ id: doc.id, name: data.name, email: data.email, avatar: data.avatar || null });
        });
      })
      .catch(function (err) {
        users = [];
        console.error('Failed to load users:', err);
      });
  }

  function registeredUser(name) {
    return users.filter(function (u) { return u.name === name; })[0] || null;
  }

  function openRegister(prefillName) {
    showScreen(registerScreen);
    setMessage(registerMessage, '');
    registerJunk.classList.add('hidden');
    registerForm.reset();
    regName.value = prefillName || '';
  }

  function onForge() {
    setMessage(loginMessage, '');
    loginJunk.classList.add('hidden');
    if (isRegisterSelected()) {
      openRegister('');
      return;
    }

    var name = TEAM[currentIndex];
    var existing = registeredUser(name);
    if (existing) {
      // Registered already — send a magic link to their saved email.
      sendMagicLink(existing.email)
        .then(function () {
          setMessage(loginMessage, 'Magic link sent to ' + existing.email + '. Check your inbox.');
          loginJunk.classList.remove('hidden');
        })
        .catch(function (err) { setMessage(loginMessage, friendlyError(err), true); });
    } else {
      // Not registered yet — open the form with their name pre-filled.
      openRegister(name);
    }
  }

  function sendMagicLink(email) {
    return auth.sendSignInLinkToEmail(email, actionCodeSettings).then(function () {
      window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
    });
  }

  function onRegisterSubmit(e) {
    e.preventDefault();
    setMessage(registerMessage, '');

    // First name only — take the first word if more is entered.
    var name = regName.value.trim().split(/\s+/)[0];
    var email = regEmail.value.trim().toLowerCase();
    var code = regCode.value.trim();

    if (!name || !email || !code) {
      setMessage(registerMessage, 'Please fill in every field.', true);
      return;
    }
    if (code !== INVITE_CODE) {
      setMessage(registerMessage, 'That invite code is not valid.', true);
      return;
    }
    if (users.length >= MAX_USERS) {
      setMessage(registerMessage, 'Forge is full — max 10 users.', true);
      return;
    }

    db.collection('users').add({
      name: name,
      email: email,
      avatar: null,
      totalPoints: 0,
      currentStreak: 0,
      longestStreak: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
      .then(function () { return sendMagicLink(email); })
      .then(function () {
        setMessage(registerMessage, 'Account created! A magic link is on its way to ' + email + '.');
        registerJunk.classList.remove('hidden');
        registerForm.reset();
      })
      .catch(function (err) { setMessage(registerMessage, friendlyError(err), true); });
  }

  function completeSignInIfPresent() {
    if (!auth.isSignInWithEmailLink(window.location.href)) return;
    completingSignIn = true; // keep the login carousel hidden while we finish
    var email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    if (email) {
      finishSignIn(email);
    } else {
      // No stored email (e.g. opened on another device): ask in-app, no prompt().
      showEmailConfirm('');
    }
  }

  function showEmailConfirm(errorText) {
    showScreen(confirmScreen);
    setMessage(confirmMessage, errorText || '', !!errorText);
  }

  function finishSignIn(email) {
    return auth.signInWithEmailLink(email, window.location.href)
      .then(function () {
        window.localStorage.removeItem(EMAIL_STORAGE_KEY);
        history.replaceState(null, '', window.location.origin + '/forge-app/');
        // onAuthStateChanged routes on to the dashboard.
      })
      .catch(function (err) {
        completingSignIn = false;
        showEmailConfirm(friendlyError(err));
      });
  }

  function onConfirmEmail() {
    var email = confirmEmail.value.trim().toLowerCase();
    if (!email) {
      setMessage(confirmMessage, 'Enter your email address.', true);
      return;
    }
    completingSignIn = true;
    finishSignIn(email);
  }

  // ===================================================================
  // App entry — load user doc + logs, then dashboard
  // ===================================================================
  function ensureUserDoc(fbUser) {
    var email = (fbUser.email || '').toLowerCase();
    var match = users.filter(function (u) { return u.email === email; })[0];
    if (match) {
      return db.collection('users').doc(match.id).get().then(function (snap) {
        return { id: match.id, data: snap.data() || {} };
      });
    }
    var ref = db.collection('users').doc();
    var data = {
      name: email.split('@')[0] || 'Forger',
      email: email,
      avatar: null,
      totalPoints: 0,
      currentStreak: 0,
      longestStreak: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return ref.set(data).then(function () { return { id: ref.id, data: data }; });
  }

  function loadLogs(id) {
    return db.collection('users').doc(id).collection('logs').get().then(function (snap) {
      var arr = [];
      snap.forEach(function (d) {
        var x = d.data();
        x._id = d.id;
        arr.push(x);
      });
      return arr;
    });
  }

  function enterApp(fbUser) {
    ensureUserDoc(fbUser)
      .then(function (res) {
        state.user = Object.assign({ id: res.id }, res.data);
        return loadLogs(res.id);
      })
      .then(function (logs) {
        state.logs = logs;
        return refreshStats();
      })
      .then(renderDashboard)
      .catch(function (err) {
        console.error('Failed to enter app:', err);
        renderDashboard();
      });
  }

  // DEV_MODE only: skip the magic link and enter the app as Mark, loading his
  // real Firestore data via the normal enterApp path.
  function devLogin() {
    if (!DEV_MODE) return;
    enterApp({ email: 'markbrown667@gmail.com', displayName: 'Mark' });
  }

  function refreshStats() {
    var stats = computeStats(state.logs);
    state.user.totalPoints = stats.totalPoints;
    state.user.currentStreak = stats.currentStreak;
    state.user.longestStreak = stats.longestStreak;
    return db.collection('users').doc(state.user.id).set({
      totalPoints: stats.totalPoints,
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak
    }, { merge: true }).catch(function (err) {
      console.error('Failed to persist stats:', err);
    });
  }

  function todayLogs() {
    var key = dateKey(new Date());
    return state.logs.filter(function (l) { return l.date === key; });
  }

  function isLogged(exKey) {
    return todayLogs().some(function (l) { return l.exercise === exKey && !l.bonusExercise; });
  }

  // The bonus log recorded today, if the user has already spun. One per day.
  function todaysBonusLog() {
    return todayLogs().filter(function (l) { return l.bonusExercise; })[0] || null;
  }

  // --- Warm-up / cool-down routine helpers ---------------------------
  function routineFor(d) {
    return ROUTINES[d.getDay()] || null;
  }

  function hasLoggedTrainingToday() {
    return todayLogs().some(function (l) { return !l.bonusExercise; });
  }

  function allDueLoggedToday(sched) {
    return sched.active.length > 0 && sched.active.every(isLogged);
  }

  function routineShownToday(type) {
    if (!state.user) return true; // no user doc -> don't pop routines
    var field = type === 'warmup' ? 'warmupShownDate' : 'cooldownShownDate';
    return state.user[field] === dateKey(new Date());
  }

  function markRoutineShown(type) {
    var field = type === 'warmup' ? 'warmupShownDate' : 'cooldownShownDate';
    var key = dateKey(new Date());
    if (!state.user) return Promise.resolve();
    state.user[field] = key;
    var patch = {};
    patch[field] = key;
    return db.collection('users').doc(state.user.id).set(patch, { merge: true })
      .catch(function (err) { console.error('Failed to store routine flag:', err); });
  }

  function saveLog(exKey, repsCompleted, target, mood, isBestEffort, bonusExercise) {
    var entry = {
      date: dateKey(new Date()),
      exercise: exKey,
      repsCompleted: repsCompleted, // number on training days, description for bonus moves
      target: target,
      mood: mood,
      isBestEffort: !!isBestEffort,
      bonusExercise: !!bonusExercise,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return db.collection('users').doc(state.user.id).collection('logs').add(entry)
      .then(function (ref) {
        entry._id = ref.id;
        state.logs.push(entry);
        return refreshStats();
      });
  }

  // ===================================================================
  // Dashboard
  // ===================================================================
  function renderDashboard() {
    var today = new Date();
    var day = challengeDay(today);
    var sched = scheduleFor(today);

    // Auto-show the warm-up (before any training is logged) or the cool-down
    // (once all due exercises are logged), unless already seen today.
    var routine = routineFor(today);
    if (routine) {
      if (!routineShownToday('warmup') && !hasLoggedTrainingToday()) {
        return showRoutine('warmup', routine.warmup);
      }
      if (!routineShownToday('cooldown') && allDueLoggedToday(sched)) {
        return showRoutine('cooldown', routine.cooldown);
      }
    }

    var dayLabel = day < 1 ? '0' : (day > TOTAL_DAYS ? TOTAL_DAYS : day);
    var week = day < 1 ? 0 : Math.min(weekNumber(Math.min(day, TOTAL_DAYS)), TOTAL_WEEKS);

    var banner = '';
    if (day > TOTAL_DAYS) {
      banner = 'Challenge complete — you forged 90 days!';
    } else if (atMidnight(today) < POINTS_START) {
      // Soft launch (16–21 June) and the run-up: points/streaks begin 22 June.
      banner = 'Forge ignites Monday 22 June — keep training!';
    }

    var body;
    if (sched.type === 'rest') {
      body = '<div class="rest-day">' +
               '<p class="rest-emoji">🛌</p>' +
               '<h2 class="rest-title">FULL REST DAY</h2>' +
               '<p class="rest-text">Recovery is where the gains are forged. ' +
               'Rest up — tomorrow you go again.</p>' +
             '</div>';
    } else {
      body = '<div class="cards">' + ORDER.map(function (k) {
        return cardHTML(k, sched, day);
      }).join('') + '</div>';
    }

    var html =
      '<header class="topbar">' +
        '<span class="topbar-brand">FORGE</span>' +
        '<div class="topbar-right">' +
          topbarAvatarHTML() +
          '<span class="topbar-version">v0.2.14</span>' +
        '</div>' +
      '</header>' +

      '<h1 class="welcome">Welcome back, ' + esc(state.user ? state.user.name : 'Forger') + '</h1>' +

      (banner ? '<div class="banner">' + esc(banner) + '</div>' : '') +

      '<section class="stats">' +
        statCard(dayLabel + '<span class="stat-sub">/ ' + TOTAL_DAYS + '</span>', 'Day') +
        statCard(week + '<span class="stat-sub">/ ' + TOTAL_WEEKS + '</span>', 'Week') +
        statCard('🔥 ' + (state.user ? state.user.currentStreak : 0), 'Streak') +
        statCard((state.user ? state.user.totalPoints : 0), 'Points') +
      '</section>' +

      (sched.type === 'besteffort'
        ? '<p class="section-label">Best Effort Friday — 2 min each</p>'
        : '<p class="section-label">Today\'s training</p>') +

      body +

      bonusSpinHTML() +

      '<div class="dash-footer">' +
        '<button type="button" class="btn-link" data-nav="board">Message board</button>' +
        '<button type="button" class="btn-link" data-action="signout">Sign out</button>' +
      '</div>' +
      '<button type="button" class="install-link" data-action="install">Install App</button>';

    dashboardScreen.innerHTML = html;
    wireDashboard();
    showScreen(dashboardScreen);
  }

  function statCard(value, label) {
    return '<div class="stat">' +
             '<div class="stat-value">' + value + '</div>' +
             '<div class="stat-label">' + label + '</div>' +
           '</div>';
  }

  // Topbar profile button shows the user's avatar (photo or initial placeholder),
  // matching the carousel and profile screen.
  function topbarAvatarHTML() {
    var name = state.user ? state.user.name : 'Forger';
    var photo = AVATARS[name];
    if (photo) {
      return '<button type="button" class="icon-btn icon-btn--photo" data-nav="profile" ' +
               'aria-label="Profile"><img class="topbar-avatar" src="' + photo + '" alt=""></button>';
    }
    return '<button type="button" class="icon-btn icon-btn--placeholder" data-nav="profile" ' +
             'aria-label="Profile">' + esc(name.charAt(0).toUpperCase()) + '</button>';
  }

  // Bonus spin is once per day: show the button, or a completed confirmation
  // if a bonus exercise has already been logged today.
  function bonusSpinHTML() {
    var bonus = todaysBonusLog();
    if (bonus) {
      return '<div class="bonus-done">' +
               '<span class="tick" aria-label="Completed">✓</span>' +
               '<div class="bonus-done-text">' +
                 '<span class="bonus-done-label">Bonus complete</span>' +
                 '<span class="bonus-done-name">' + esc(bonus.exercise) + '</span>' +
               '</div>' +
             '</div>';
    }
    return '<button type="button" class="btn-forge btn-spin" data-action="spin">★ Bonus Spin</button>';
  }

  function cardHTML(exKey, sched, day) {
    var ex = EXERCISES[exKey];
    var isRest = sched.rest === exKey;
    var isActive = sched.active.indexOf(exKey) >= 0;
    var logged = isLogged(exKey);
    var target = targetFor(ex, day);
    var bestEffort = sched.type === 'besteffort';

    var statusEl;
    if (isRest) {
      statusEl = '<span class="badge badge-rest">REST</span>';
    } else if (logged) {
      statusEl = '<span class="tick" aria-label="Logged">✓</span>';
    } else if (isActive) {
      statusEl = '<button type="button" class="btn-log" data-log="' + exKey + '"' +
                 (bestEffort ? ' data-best="1"' : '') + '>' +
                 (bestEffort ? 'Start' : 'Log') + '</button>';
    } else {
      statusEl = '';
    }

    return '<div class="card' + (isRest ? ' card-rest' : '') + (logged ? ' card-done' : '') + '">' +
             '<div class="card-info">' +
               '<h3 class="card-name">' + ex.name + '</h3>' +
               '<p class="card-target">' +
                 (isRest ? 'Rest day for this one' :
                   (bestEffort ? 'Max effort · 2:00' : formatTarget(ex, target))) +
               '</p>' +
             '</div>' +
             '<div class="card-action">' + statusEl + '</div>' +
           '</div>';
  }

  function wireDashboard() {
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-log]'), function (btn) {
      btn.addEventListener('click', function () {
        openLogScreen(btn.getAttribute('data-log'), btn.getAttribute('data-best') === '1', false);
      });
    });
    var spin = dashboardScreen.querySelector('[data-action="spin"]');
    if (spin) spin.addEventListener('click', openSpin);

    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-nav]'), function (btn) {
      btn.addEventListener('click', function () {
        var dest = btn.getAttribute('data-nav');
        if (dest === 'profile') openProfile();
        else openPlaceholder(dest);
      });
    });
    var out = dashboardScreen.querySelector('[data-action="signout"]');
    if (out) out.addEventListener('click', onSignOut);
    var install = dashboardScreen.querySelector('[data-action="install"]');
    if (install) install.addEventListener('click', openInstall);
  }

  // ===================================================================
  // Exercise logging screen (normal + best effort)
  // ===================================================================
  function openLogScreen(exKey, isBestEffort, bonusExercise) {
    var ex = EXERCISES[exKey];
    var day = challengeDay(new Date());
    var target = targetFor(ex, day);
    var screen = ensureScreen('log-screen');

    var targetText = isBestEffort
      ? 'Best Effort · 2 minute timer'
      : 'Target: ' + formatTarget(ex, target);

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">' + (isBestEffort ? 'BEST EFFORT' : (bonusExercise ? 'BONUS' : 'LOG')) + '</span>' +
      '</header>' +
      '<h1 class="log-title">' + ex.name + '</h1>' +
      '<p class="log-target">' + targetText + '</p>' +
      (isBestEffort
        ? '<div class="timer-zone">' +
            '<div class="ring-wrap">' +
              '<svg class="ring" viewBox="0 0 120 120">' +
                '<circle class="ring-bg" cx="60" cy="60" r="54"></circle>' +
                '<circle class="ring-fg" cx="60" cy="60" r="54"></circle>' +
              '</svg>' +
              '<span class="ring-label">2:00</span>' +
            '</div>' +
            '<button type="button" class="btn-forge timer-start">Start</button>' +
          '</div>'
        : '') +
      '<div class="log-flow' + (isBestEffort ? ' hidden' : '') + '"></div>';

    screen.querySelector('.back-btn').addEventListener('click', renderDashboard);

    var flow = screen.querySelector('.log-flow');

    if (isBestEffort) {
      var ringFg = screen.querySelector('.ring-fg');
      var ringLabel = screen.querySelector('.ring-label');
      var startBtn = screen.querySelector('.timer-start');
      startBtn.addEventListener('click', function () {
        startBtn.disabled = true;
        startBtn.textContent = 'Go!';
        startCountdown(120, ringFg, ringLabel, function () {
          ringLabel.textContent = 'Done!';
          flow.classList.remove('hidden');
        });
      });
    }

    buildLogFlow(flow, {
      requireInput: isBestEffort,            // only Best Effort Fridays take a number
      unitLabel: unitLabel(ex),
      targetDisplay: isBestEffort ? target : formatTarget(ex, target),
      confirmValue: target,                  // normal days log the known target
      onConfirm: function (reps, mood) {
        saveLog(ex.key, reps, target, mood, isBestEffort, bonusExercise).then(renderDashboard);
      }
    });

    showScreen(screen);
  }

  // opts: { requireInput, unitLabel, targetDisplay, confirmValue, onConfirm }
  // requireInput true  -> user types a number (Best Effort Fridays only)
  // requireInput false -> confirm the known target; logs confirmValue as completed
  function buildLogFlow(container, opts) {
    var inputId = 'log-input';
    var topBlock = opts.requireInput
      ? '<label class="field">' +
          '<span class="field-label">' + esc(opts.unitLabel) + '</span>' +
          '<input id="' + inputId + '" type="number" inputmode="numeric" min="0" ' +
            'placeholder="' + esc(String(opts.targetDisplay)) + '" />' +
        '</label>'
      : '<p class="log-confirm-q">Did you complete ' + esc(String(opts.targetDisplay)) + '?</p>';

    container.innerHTML =
      topBlock +
      '<p class="field-label mood-heading">How did it feel?</p>' +
      '<div class="moods">' + MOODS.map(function (m, i) {
        return '<button type="button" class="mood" data-mood="' + esc(m) + '">' +
                 '<span class="mood-num">' + (i + 1) + '</span>' + esc(m) + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="btn-forge confirm-btn">Confirm</button>' +
      '<p class="message log-msg" role="status" aria-live="polite"></p>';

    var selectedMood = null;
    var moodBtns = container.querySelectorAll('.mood');
    Array.prototype.forEach.call(moodBtns, function (b) {
      b.addEventListener('click', function () {
        selectedMood = b.getAttribute('data-mood');
        Array.prototype.forEach.call(moodBtns, function (x) { x.classList.remove('is-selected'); });
        b.classList.add('is-selected');
      });
    });

    var msg = container.querySelector('.log-msg');
    container.querySelector('.confirm-btn').addEventListener('click', function () {
      var value = opts.confirmValue;
      if (opts.requireInput) {
        var raw = container.querySelector('#' + inputId).value.trim();
        if (raw === '' || isNaN(Number(raw)) || Number(raw) < 0) {
          setMessage(msg, 'Enter how many you completed.', true);
          return;
        }
        value = Number(raw);
      }
      if (!selectedMood) {
        setMessage(msg, 'Pick how it felt.', true);
        return;
      }
      opts.onConfirm(value, selectedMood);
    });
  }

  function startCountdown(seconds, ringEl, labelEl, onDone) {
    var C = 2 * Math.PI * 54; // circumference for r=54
    var total = seconds;
    var remaining = seconds;
    ringEl.style.strokeDasharray = C;
    ringEl.style.strokeDashoffset = 0;
    labelEl.textContent = clock(remaining);
    var iv = setInterval(function () {
      remaining--;
      labelEl.textContent = clock(Math.max(0, remaining));
      ringEl.style.strokeDashoffset = C * (1 - remaining / total);
      if (remaining <= 0) {
        clearInterval(iv);
        onDone();
      }
    }, 1000);
  }

  function clock(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ===================================================================
  // Bonus spin
  // ===================================================================
  function openSpin() {
    var screen = ensureScreen('spin-screen');

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">BONUS</span>' +
      '</header>' +
      '<h1 class="log-title">Bonus Spin</h1>' +
      '<p class="log-target">Spin for a bonus challenge — worth 20 points</p>' +
      '<div class="spin-reel"><span class="spin-name">★</span></div>' +
      '<button type="button" class="btn-forge spin-go">Spin</button>' +
      '<div class="spin-result hidden"></div>';

    screen.querySelector('.back-btn').addEventListener('click', renderDashboard);

    var reel = screen.querySelector('.spin-name');
    var goBtn = screen.querySelector('.spin-go');
    var result = screen.querySelector('.spin-result');

    goBtn.addEventListener('click', function () {
      goBtn.disabled = true;
      var ticks = 0;
      var final = Math.floor(Math.random() * BONUS_EXERCISES.length);
      var iv = setInterval(function () {
        reel.textContent = BONUS_EXERCISES[ticks % BONUS_EXERCISES.length].name;
        ticks++;
        if (ticks > 16) {
          clearInterval(iv);
          var bonus = BONUS_EXERCISES[final];
          reel.textContent = bonus.name;
          result.classList.remove('hidden');
          result.innerHTML =
            '<p class="spin-result-name">' + esc(bonus.name) + '</p>' +
            '<p class="spin-result-target">' + esc(bonus.target) + '</p>' +
            '<div class="log-flow"></div>';
          buildLogFlow(result.querySelector('.log-flow'), {
            requireInput: false,
            targetDisplay: bonus.target,
            confirmValue: bonus.target,
            onConfirm: function (value, mood) {
              saveLog(bonus.name, value, bonus.target, mood, false, true).then(renderDashboard);
            }
          });
        }
      }, 90);
    });

    showScreen(screen);
  }

  // ===================================================================
  // Warm-up / cool-down screens
  // ===================================================================
  function showRoutine(type, items) {
    var isWarmup = type === 'warmup';
    var screen = ensureScreen(type + '-screen');

    var list = items.map(function (it) {
      return '<li class="routine-item">' +
               '<span class="routine-name">' + esc(it.name) + '</span>' +
               '<span class="routine-target">' + esc(it.target) + '</span>' +
             '</li>';
    }).join('');

    screen.innerHTML =
      '<header class="topbar">' +
        '<span class="topbar-brand">FORGE</span>' +
        '<span class="topbar-version">' + (isWarmup ? 'WARM UP' : 'COOL DOWN') + '</span>' +
      '</header>' +
      '<h1 class="routine-title">' + (isWarmup ? 'WARM UP' : 'COOL DOWN') + '</h1>' +
      '<p class="routine-sub">' +
        (isWarmup ? 'Prime your body before you train.' : 'Ease down and recover.') +
      '</p>' +
      '<ul class="routine-list">' + list + '</ul>' +
      '<button type="button" class="btn-forge routine-go">' +
        (isWarmup ? 'Start Training' : 'Done') + '</button>' +
      '<button type="button" class="btn-link routine-skip">Skip</button>';

    function dismiss() {
      markRoutineShown(type).then(renderDashboard);
    }
    screen.querySelector('.routine-go').addEventListener('click', dismiss);
    screen.querySelector('.routine-skip').addEventListener('click', dismiss);

    showScreen(screen);
  }

  // ===================================================================
  // Profile screen
  // ===================================================================
  function openProfile() {
    var screen = ensureScreen('profile-screen');
    var name = state.user ? state.user.name : 'Forger';
    var photo = AVATARS[name];
    var avatarHTML = photo
      ? '<img class="ucard-avatar profile-avatar" src="' + photo + '" alt="">'
      : '<span class="ucard-avatar ucard-avatar--placeholder profile-avatar">' +
          esc(name.charAt(0).toUpperCase()) + '</span>';

    var pref = (state.user && state.user.plankPreference) || null;
    var totalExercises = state.logs.filter(function (l) { return !l.bonusExercise; }).length;
    var totalBonus = state.logs.filter(function (l) { return l.bonusExercise; }).length;

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">PROFILE</span>' +
      '</header>' +

      '<div class="profile-head">' +
        avatarHTML +
        '<h1 class="profile-name">' + esc(name) + '</h1>' +
      '</div>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Plank Preference</p>' +
        '<div class="plank-opts">' +
          plankOption('forward', 'Forward Plank', 'Classic core hold, face down', pref) +
          plankOption('reverse', 'Reverse Plank', 'Posterior chain hold, face up', pref) +
        '</div>' +
      '</section>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Personal Stats</p>' +
        '<div class="profile-stats">' +
          statRow('Total points', state.user ? state.user.totalPoints : 0) +
          statRow('Current streak', state.user ? state.user.currentStreak : 0) +
          statRow('Longest streak', state.user ? state.user.longestStreak : 0) +
          statRow('Exercises logged', totalExercises) +
          statRow('Bonus exercises', totalBonus) +
        '</div>' +
      '</section>';

    screen.querySelector('.back-btn').addEventListener('click', renderDashboard);
    Array.prototype.forEach.call(screen.querySelectorAll('[data-plank]'), function (btn) {
      btn.addEventListener('click', function () {
        setPlankPreference(btn.getAttribute('data-plank'));
      });
    });

    showScreen(screen);
  }

  function plankOption(value, title, desc, current) {
    return '<button type="button" class="plank-opt' + (current === value ? ' is-selected' : '') +
             '" data-plank="' + value + '">' +
             '<span class="plank-title">' + title + '</span>' +
             '<span class="plank-desc">' + desc + '</span>' +
           '</button>';
  }

  function statRow(label, value) {
    return '<div class="profile-stat">' +
             '<span class="profile-stat-label">' + label + '</span>' +
             '<span class="profile-stat-value">' + value + '</span>' +
           '</div>';
  }

  function setPlankPreference(value) {
    if (!state.user) return;
    state.user.plankPreference = value;
    db.collection('users').doc(state.user.id).set({ plankPreference: value }, { merge: true })
      .catch(function (err) { console.error('Failed to save plank preference:', err); });
    openProfile(); // re-render to update the highlighted option
  }

  // ===================================================================
  // Install instructions screen
  // ===================================================================
  function openInstall() {
    var screen = ensureScreen('install-screen');
    var appUrl = 'https://learning-development667.github.io/forge-app/';

    function steps(list) {
      return '<ol class="install-steps">' + list.map(function (s) {
        return '<li>' + esc(s) + '</li>';
      }).join('') + '</ol>';
    }

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">INSTALL</span>' +
      '</header>' +
      '<h1 class="install-title">INSTALL FORGE</h1>' +

      '<section class="install-section">' +
        '<h2 class="install-os">iPhone</h2>' +
        steps([
          'Open this link in Safari (not Chrome or Gmail)',
          'Tap the Share button at the bottom of the screen',
          'Scroll down and tap "Add to Home Screen"',
          'Tap Add in the top right corner',
          'Forge will appear on your home screen ready to use'
        ]) +
        '<p class="install-note">Push notifications only work when installed via Safari on iPhone</p>' +
      '</section>' +

      '<section class="install-section">' +
        '<h2 class="install-os">Android</h2>' +
        steps([
          'Open this link in Chrome',
          'Tap the three dots menu in the top right',
          'Tap "Add to Home Screen" or "Install App"',
          'Tap Install to confirm',
          'Forge will appear on your home screen ready to use'
        ]) +
      '</section>' +

      '<section class="install-section install-share">' +
        '<p class="section-heading">Shareable link</p>' +
        '<p class="install-url">' + esc(appUrl) + '</p>' +
        '<button type="button" class="btn-forge copy-link-btn">Copy Link</button>' +
      '</section>';

    screen.querySelector('.back-btn').addEventListener('click', renderDashboard);

    var copyBtn = screen.querySelector('.copy-link-btn');
    copyBtn.addEventListener('click', function () {
      copyToClipboard(appUrl);
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy Link'; }, 2000);
    });

    showScreen(screen);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
  }

  // ===================================================================
  // Placeholder screens (profile, message board)
  // ===================================================================
  function openPlaceholder(which) {
    var screen = ensureScreen(which + '-screen');
    var title = which === 'profile' ? 'Profile' : 'Message Board';
    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">FORGE</span>' +
      '</header>' +
      '<div class="placeholder">' +
        '<h1 class="welcome">' + title + '</h1>' +
        '<p class="dashboard-placeholder">' + title + ' coming soon</p>' +
      '</div>';
    screen.querySelector('.back-btn').addEventListener('click', renderDashboard);
    showScreen(screen);
  }

  function onSignOut() {
    auth.signOut().then(function () {
      state.user = null;
      state.logs = [];
      showScreen(loginScreen);
    });
  }

  // ===================================================================
  // Helpers
  // ===================================================================
  function friendlyError(err) {
    if (err && err.message) return err.message;
    return 'Something went wrong. Please try again.';
  }

  // ===================================================================
  // Boot
  // ===================================================================
  function showRandomQuote() {
    var el = document.getElementById('login-quote');
    if (el) el.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  function init() {
    showRandomQuote();
    forgeBtn.addEventListener('click', onForge);

    if (DEV_MODE && devLoginBtn) {
      devLoginBtn.classList.remove('hidden');
      devLoginBtn.addEventListener('click', devLogin);
    }

    renderCarousel(); // static team list — independent of Firestore

    carouselPrev.addEventListener('click', function () { carouselGo(-1); });
    carouselNext.addEventListener('click', function () { carouselGo(1); });
    carousel.addEventListener('touchstart', onTouchStart, { passive: true });
    carousel.addEventListener('touchend', onTouchEnd, { passive: true });
    // Left/right arrow keys drive the carousel while the login screen is shown.
    document.addEventListener('keydown', function (e) {
      if (!loginScreen.classList.contains('hidden') &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        onCarouselKey(e);
      }
    });

    registerForm.addEventListener('submit', onRegisterSubmit);
    registerBack.addEventListener('click', function () { showScreen(loginScreen); });
    confirmBtn.addEventListener('click', onConfirmEmail);

    completeSignInIfPresent();

    auth.onAuthStateChanged(function (firebaseUser) {
      loadUsers().then(function () {
        if (firebaseUser) {
          enterApp(firebaseUser);
        } else if (!completingSignIn) {
          showScreen(loginScreen);
        }
      });
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
          console.error('Service worker registration failed:', err);
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
