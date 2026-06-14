/* ===================================================================
   Forge — app logic
   90-day bodyweight challenge for up to 10 named users.
   Auth: Firebase magic-link (passwordless) email sign-in.
   Dashboard, exercise logging, best-effort Fridays, points & streaks
   are all rendered dynamically here so index.html stays untouched.
   =================================================================== */

(function () {
  'use strict';

  // ---- Constants ----------------------------------------------------
  var INVITE_CODE = 'FORGE2026';
  var MAX_USERS = 10;
  var EMAIL_STORAGE_KEY = 'forge:pendingEmail';

  var TOTAL_DAYS = 90;
  var TOTAL_WEEKS = 13;
  // Day 1 = 16 June 2026; points/streaks begin 22 June 2026.
  var CHALLENGE_START = new Date(2026, 5, 16);
  var POINTS_START = new Date(2026, 5, 22);

  // Exercise definitions with linear progression start/end points.
  var EXERCISES = {
    pressups: { key: 'pressups', name: 'Press-ups', kind: 'reps', start: 5, end: 50 },
    situps:   { key: 'situps',   name: 'Sit-ups',   kind: 'reps', start: 10, end: 100 },
    plank:    { key: 'plank',    name: 'Plank',     kind: 'time', start: 20, end: 180 },
    lunges:   { key: 'lunges',   name: 'Lunges',    kind: 'legs', start: 5, end: 20 }
  };
  var ORDER = ['pressups', 'situps', 'plank', 'lunges'];

  var MOODS = ['Crushed it', 'Felt good', 'Got through it', 'Struggled', 'Really tough'];

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

  var actionCodeSettings = {
    url: window.location.origin + '/forge-app/',
    handleCodeInApp: true
  };

  // ---- DOM references (login screens live in index.html) -----------
  var loginScreen = document.getElementById('login-screen');
  var registerScreen = document.getElementById('register-screen');
  var dashboardScreen = document.getElementById('dashboard-screen');

  var drum = document.getElementById('drum');
  var forgeBtn = document.getElementById('forge-btn');
  var loginMessage = document.getElementById('login-message');

  var registerForm = document.getElementById('register-form');
  var registerBack = document.getElementById('register-back');
  var registerMessage = document.getElementById('register-message');
  var regName = document.getElementById('reg-name');
  var regEmail = document.getElementById('reg-email');
  var regCode = document.getElementById('reg-code');

  // ---- State --------------------------------------------------------
  var users = [];           // registered users from Firestore
  var selectedIndex = 0;    // drum selection (users + register row)
  var snapTimer = null;

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
    return m >= CHALLENGE_START && m < POINTS_START;
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
  // Drum (slot-machine) selector — login screen
  // ===================================================================
  function renderDrum() {
    drum.innerHTML = '';
    users.forEach(function (user, i) {
      drum.appendChild(buildDrumItem(user.name, user.avatar, i, false));
    });
    drum.appendChild(buildDrumItem('Register', null, users.length, true));

    selectedIndex = 0;
    requestAnimationFrame(function () {
      scrollToIndex(selectedIndex, 'auto');
      updateSelectionStyles();
    });
  }

  function buildDrumItem(name, avatar, index, isRegister) {
    var li = document.createElement('li');
    li.className = 'drum-item' + (isRegister ? ' drum-item--register' : '');
    li.setAttribute('role', 'option');
    li.dataset.index = String(index);

    if (!isRegister) {
      if (avatar) {
        var img = document.createElement('img');
        img.className = 'drum-avatar';
        img.src = avatar;
        img.alt = '';
        li.appendChild(img);
      } else {
        var av = document.createElement('span');
        av.className = 'drum-avatar';
        av.textContent = name.charAt(0).toUpperCase();
        li.appendChild(av);
      }
    }

    var label = document.createElement('span');
    label.className = 'drum-name';
    label.textContent = name;
    li.appendChild(label);

    li.addEventListener('click', function () { scrollToIndex(index, 'smooth'); });
    return li;
  }

  function itemHeight() {
    var css = getComputedStyle(document.documentElement).getPropertyValue('--drum-item-height');
    return parseInt(css, 10) || 64;
  }

  function scrollToIndex(index, behavior) {
    drum.scrollTo({ top: index * itemHeight(), behavior: behavior || 'smooth' });
  }

  function updateSelectionStyles() {
    var idx = Math.round(drum.scrollTop / itemHeight());
    idx = Math.max(0, Math.min(idx, drum.children.length - 1));
    selectedIndex = idx;
    Array.prototype.forEach.call(drum.children, function (child, i) {
      child.classList.toggle('is-selected', i === idx);
    });
  }

  function onDrumScroll() {
    updateSelectionStyles();
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(function () { scrollToIndex(selectedIndex, 'smooth'); }, 90);
  }

  function isRegisterSelected() {
    return selectedIndex === users.length;
  }

  function onDrumKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollToIndex(Math.min(selectedIndex + 1, drum.children.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollToIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onForge();
    }
  }

  // ===================================================================
  // Users / login
  // ===================================================================
  function loadUsers() {
    return db.collection('users').orderBy('createdAt', 'asc').limit(MAX_USERS).get()
      .then(function (snap) {
        users = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          users.push({ id: doc.id, name: data.name, email: data.email, avatar: data.avatar || null });
        });
        renderDrum();
      })
      .catch(function (err) {
        users = [];
        renderDrum();
        console.error('Failed to load users:', err);
      });
  }

  function onForge() {
    setMessage(loginMessage, '');
    if (isRegisterSelected()) {
      showScreen(registerScreen);
      setMessage(registerMessage, '');
      return;
    }
    var user = users[selectedIndex];
    if (!user) {
      setMessage(loginMessage, 'Please select a user.', true);
      return;
    }
    sendMagicLink(user.email)
      .then(function () {
        setMessage(loginMessage, 'Magic link sent to ' + user.email + '. Check your inbox.');
      })
      .catch(function (err) { setMessage(loginMessage, friendlyError(err), true); });
  }

  function sendMagicLink(email) {
    return auth.sendSignInLinkToEmail(email, actionCodeSettings).then(function () {
      window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
    });
  }

  function onRegisterSubmit(e) {
    e.preventDefault();
    setMessage(registerMessage, '');

    var name = regName.value.trim();
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
        registerForm.reset();
      })
      .catch(function (err) { setMessage(registerMessage, friendlyError(err), true); });
  }

  function completeSignInIfPresent() {
    if (!auth.isSignInWithEmailLink(window.location.href)) return;
    var email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    if (!email) email = window.prompt('Please confirm your email to finish signing in:');
    if (!email) return;
    auth.signInWithEmailLink(email, window.location.href)
      .then(function () {
        window.localStorage.removeItem(EMAIL_STORAGE_KEY);
        history.replaceState(null, '', window.location.origin + '/forge-app/');
      })
      .catch(function (err) { setMessage(loginMessage, friendlyError(err), true); });
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

  function saveLog(exKey, repsCompleted, target, mood, isBestEffort, bonusExercise) {
    var entry = {
      date: dateKey(new Date()),
      exercise: exKey,
      repsCompleted: Number(repsCompleted),
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

    var dayLabel = day < 1 ? '0' : (day > TOTAL_DAYS ? TOTAL_DAYS : day);
    var week = day < 1 ? 0 : Math.min(weekNumber(Math.min(day, TOTAL_DAYS)), TOTAL_WEEKS);

    var banner = '';
    if (day < 1) {
      banner = 'Forge ignites 16 June — get ready!';
    } else if (day > TOTAL_DAYS) {
      banner = 'Challenge complete — you forged 90 days!';
    } else if (inSoftLaunch(today)) {
      banner = 'Forge ignites 22 June — keep training!';
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
          '<button type="button" class="icon-btn" data-nav="profile" aria-label="Profile">👤</button>' +
          '<span class="topbar-version">v0.1.0</span>' +
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

      '<button type="button" class="btn-forge btn-spin" data-action="spin">★ Bonus Spin</button>' +

      '<div class="dash-footer">' +
        '<button type="button" class="btn-link" data-nav="board">Message board</button>' +
        '<button type="button" class="btn-link" data-action="signout">Sign out</button>' +
      '</div>';

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
      btn.addEventListener('click', function () { openPlaceholder(btn.getAttribute('data-nav')); });
    });
    var out = dashboardScreen.querySelector('[data-action="signout"]');
    if (out) out.addEventListener('click', onSignOut);
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

    buildLogFlow(flow, ex, target, function (reps, mood) {
      saveLog(ex.key, reps, target, mood, isBestEffort, bonusExercise).then(renderDashboard);
    });

    showScreen(screen);
  }

  function buildLogFlow(container, ex, target, onConfirm) {
    var inputId = 'log-input';
    container.innerHTML =
      '<label class="field">' +
        '<span class="field-label">' + unitLabel(ex) + '</span>' +
        '<input id="' + inputId + '" type="number" inputmode="numeric" min="0" ' +
          'placeholder="' + target + '" />' +
      '</label>' +
      '<p class="field-label mood-heading">How did it feel?</p>' +
      '<div class="moods">' + MOODS.map(function (m, i) {
        return '<button type="button" class="mood" data-mood="' + esc(m) + '">' +
                 '<span class="mood-num">' + (i + 1) + '</span>' + esc(m) + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="btn-forge confirm-btn">Confirm Log</button>' +
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
      var input = container.querySelector('#' + inputId);
      var reps = input.value.trim();
      if (reps === '' || isNaN(Number(reps)) || Number(reps) < 0) {
        setMessage(msg, 'Enter how many you completed.', true);
        return;
      }
      if (!selectedMood) {
        setMessage(msg, 'Pick how it felt.', true);
        return;
      }
      onConfirm(Number(reps), selectedMood);
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
    var day = challengeDay(new Date());

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
      var final = ORDER[Math.floor(Math.random() * ORDER.length)];
      var iv = setInterval(function () {
        reel.textContent = EXERCISES[ORDER[ticks % ORDER.length]].name;
        ticks++;
        if (ticks > 16) {
          clearInterval(iv);
          reel.textContent = EXERCISES[final].name;
          var ex = EXERCISES[final];
          var target = targetFor(ex, day);
          result.classList.remove('hidden');
          result.innerHTML =
            '<p class="spin-target">Bonus: ' + formatTarget(ex, target) + '</p>' +
            '<div class="log-flow"></div>';
          buildLogFlow(result.querySelector('.log-flow'), ex, target, function (reps, mood) {
            saveLog(ex.key, reps, target, mood, false, true).then(renderDashboard);
          });
        }
      }, 90);
    });

    showScreen(screen);
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
  function init() {
    forgeBtn.addEventListener('click', onForge);
    drum.addEventListener('scroll', onDrumScroll, { passive: true });
    drum.addEventListener('keydown', onDrumKey);
    registerForm.addEventListener('submit', onRegisterSubmit);
    registerBack.addEventListener('click', function () { showScreen(loginScreen); });

    completeSignInIfPresent();

    auth.onAuthStateChanged(function (firebaseUser) {
      loadUsers().then(function () {
        if (firebaseUser) {
          enterApp(firebaseUser);
        } else {
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
