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
  var MAX_USERS = 10;
  // Local identity: { uid, name, email, avatar } stored as JSON.
  var FORGE_USER_KEY = 'forgeUser';
  // Name of the last user to sign in on this device — centres the carousel.
  var FORGE_LAST_AVATAR_KEY = 'forgeLastAvatar';

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

  var MOOD_EMOJI = {
    'Crushed it': '💪',
    'Felt good': '😊',
    'Got through it': '😅',
    'Struggled': '😬',
    'Really tough': '😤'
  };

  // Custom 48x48 SVG icons, one per mood (colour via currentColor).
  var MOOD_ICONS = [
    // Crushed it — flexing bicep arm
    '<svg viewBox="0 0 48 48" fill="currentColor"><path d="M15 9a3 3 0 0 1 6 0v8c0 1.6 1.1 2.6 3 2.6 7 0 12 4.6 12 11.4a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2z"/><path d="M15 22c-3.2 0-5 2-5 5.2V33a2 2 0 0 0 2 2h3V22z"/></svg>',
    // Felt good — smiley
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="18"/><circle cx="18" cy="20" r="1.7" fill="currentColor" stroke="none"/><circle cx="30" cy="20" r="1.7" fill="currentColor" stroke="none"/><path d="M16 28c2.5 4 13.5 4 16 0"/></svg>',
    // Got through it — neutral + sweat drop
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="18"/><circle cx="18" cy="21" r="1.7" fill="currentColor" stroke="none"/><circle cx="30" cy="21" r="1.7" fill="currentColor" stroke="none"/><line x1="17" y1="30" x2="31" y2="30"/><path d="M38 11c-2.2 3-2.2 5.2 0 5.2s2.2-2.2 0-5.2z" fill="currentColor" stroke="none"/></svg>',
    // Struggled — grimace teeth + furrowed brow
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="18"/><line x1="14" y1="17" x2="20" y2="19.5"/><line x1="34" y1="17" x2="28" y2="19.5"/><rect x="16" y="28" width="16" height="5.5" rx="1"/><line x1="21" y1="28" x2="21" y2="33.5"/><line x1="27" y1="28" x2="27" y2="33.5"/></svg>',
    // Really tough — flame
    '<svg viewBox="0 0 48 48" fill="currentColor"><path d="M24 4c2.5 7.5 9.5 9.5 9.5 17.5a9.5 9.5 0 0 1-19 0c0-3.2 1.2-5.4 3.2-7.4.6 3.8 3.3 3.8 3.3.5 0-3.2-1.1-5.4 3-10.6z"/></svg>'
  ];

  // Real form videos keyed by exercise (others fall back to the placeholder).
  var FORM_VIDEOS = {
    pressups: 'images/form-pressup.mp4',
    situps: 'images/form-situp.mp4'
  };

  // Plank form guide shows both variants — each image full width with its own
  // coaching points beneath (not preference-gated like the rest of the guides).
  var PLANK_GUIDE = [
    { title: 'Standard Plank', image: 'images/form-plankdown.png', points: [
      'Keep your body in a straight line from head to heels',
      'Hips level — do not let them sag or rise',
      'Arms straight, hands directly below shoulders',
      'Core and glutes engaged throughout',
      'Head neutral, gaze toward the floor',
      'Breathe steadily — do not hold your breath'
    ] },
    { title: 'Reverse Plank', image: 'images/form-plankreverse.png', points: [
      'Hands behind hips, fingers pointing toward your feet',
      'Push through your heels and hands to lift your hips',
      'Keep your body in a straight line from shoulders to heels',
      'Squeeze your glutes and core to hold the position',
      'Head neutral or gently tilted back',
      'Breathe steadily throughout the hold'
    ] }
  ];

  // Form guides keyed by exercise (plank has forward/reverse variants; bonus
  // moves keyed by their display name).
  var FORM_GUIDES = {
    pressups: { points: [
      'Start in a high plank position, hands slightly wider than shoulder width',
      'Keep your body in a straight line from head to heels — no sagging hips',
      'Lower your chest to just above the floor, elbows at roughly 45 degrees',
      'Push back up to full arm extension',
      'Keep your core engaged throughout',
      'Breathe in on the way down, out on the way up'
    ], mistakes: 'sagging hips, flaring elbows too wide, not going low enough' },
    'plank-forward': { points: [
      'Start face down, resting on forearms and toes',
      'Elbows directly under shoulders',
      'Keep body in a straight line from head to heels',
      'Engage core and glutes — do not let hips sag or rise',
      'Keep breathing steadily',
      'Eyes looking down at the floor'
    ], mistakes: 'hips too high or too low, holding breath, shoulders raised' },
    'plank-reverse': { points: [
      'Sit with legs extended, place hands behind hips with fingers pointing forward',
      'Press through palms and heels to lift your torso',
      'Your body should form a straight line from head to heels',
      'Squeeze glutes and engage core',
      'Keep chin slightly tucked',
      'Hold steady, keep breathing'
    ], mistakes: 'hips sagging, elbows bending, looking straight up straining the neck' },
    situps: { points: [
      'Keep your feet flat on the floor throughout the movement',
      'Knees bent at 90 degrees',
      'Arms crossed flat against your chest, hands on opposite shoulders',
      'Engage your core to lift your upper body toward your knees',
      'Lower back down with control — do not drop',
      'Breathe out on the way up, breathe in on the way down'
    ], mistakes: 'pulling on neck with hands, using momentum, not lowering fully' },
    lunges: { points: [
      'Stand tall with feet hip width apart',
      'Step forward with one leg and lower your back knee toward the floor',
      'Front thigh should be parallel to the floor, front knee behind toes',
      'Keep torso upright and core engaged',
      'Push through the front heel to return to standing',
      'Alternate legs each rep'
    ], mistakes: 'front knee going past toes, leaning forward, back knee crashing to floor' },
    'Dead Bug': { points: [
      'Lie on your back with arms pointing straight up and knees bent at 90 degrees',
      'Slowly lower opposite arm and leg toward the floor while keeping lower back pressed flat',
      'Return to start and repeat on the other side',
      'Keep core braced throughout',
      'Move slowly and controlled'
    ], mistakes: 'lower back arching off floor, rushing the movement' },
    'Bird Dog': { points: [
      'Start on hands and knees, wrists under shoulders, knees under hips',
      'Extend opposite arm and leg simultaneously until both are parallel to the floor',
      'Hold briefly, return and repeat on the other side',
      'Keep hips level — do not rotate',
      'Keep core engaged'
    ], mistakes: 'hips rotating, lower back arching, rushing' },
    'Glute Bridge': { points: [
      'Lie on your back, knees bent, feet flat and hip width apart',
      'Press through heels to lift hips until body forms a straight line from shoulders to knees',
      'Squeeze glutes at the top, hold briefly',
      'Lower with control'
    ], mistakes: 'pushing through toes instead of heels, overextending lower back' },
    'Mountain Climbers': { points: [
      'Start in a high plank position',
      'Drive one knee toward your chest, then quickly switch legs',
      'Keep hips level — do not bounce them up and down',
      'Keep core tight throughout',
      'Maintain a strong plank position in upper body'
    ], mistakes: 'hips rising, upper body collapsing, too slow to build cardio benefit' },
    'Superman Hold': { points: [
      'Lie face down with arms extended in front',
      'Simultaneously lift arms, chest and legs off the floor',
      'Squeeze glutes and lower back muscles',
      'Hold the position, keep breathing',
      'Lower with control'
    ], mistakes: 'only lifting legs or only lifting arms, straining the neck' },
    'Hollow Body Hold': { points: [
      'Lie on your back, press lower back firmly into the floor',
      'Extend arms overhead and legs out straight, both slightly off the floor',
      'Hold this position with core fully engaged',
      'If too difficult, bend knees or raise legs higher'
    ], mistakes: 'lower back arching off floor, holding breath' },
    'Single Leg Balance': { points: [
      'Stand tall and lift one foot off the floor',
      'Hold for the required time then switch legs',
      'Keep a soft bend in the standing knee',
      'Fix your gaze on a point ahead to help balance',
      'Engage your core'
    ], mistakes: 'locking the knee, looking down, rushing' },
    'Crab Reach': { points: [
      'Sit with knees bent, feet flat, hands behind you fingers pointing away',
      'Press up into a reverse table top position',
      'Lift one hand and rotate to reach it over to the opposite side',
      'Return and repeat on the other side',
      'Keep hips lifted throughout'
    ], mistakes: 'hips dropping, rushing the rotation' },
    'Flutter Kicks': { points: [
      'Lie on your back with hands under your glutes for support',
      'Lift both legs slightly off the floor',
      'Alternate small rapid up and down kicks',
      'Keep lower back pressed into the floor',
      'Keep core engaged throughout'
    ], mistakes: 'lower back arching, legs kicking too high' },
    'Bear Crawl': { points: [
      'Start on hands and knees, lift knees just off the floor',
      'Move forward by stepping opposite hand and foot simultaneously',
      'Keep back flat and parallel to the floor',
      'Take controlled steps — do not rush',
      'Keep core engaged throughout'
    ], mistakes: 'hips rising too high, moving same side hand and foot together' }
  };

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
    Hayley: 'images/hayley.png',
    Liisa: 'images/liisa.png',
    Nikki: 'images/nikki.png',
    Keith: 'images/keith.png',
    Lou: 'images/lou.png',
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
  var db = firebase.firestore();
  // Firebase Authentication is no longer used — identity lives in localStorage
  // (forgeUser). Users are added to the Firestore users collection by the squad
  // admin; login is carousel tap + optional Face ID. Firestore = data storage.

  // ---- Local identity (localStorage) -------------------------------
  function getForgeUser() {
    try {
      var raw = window.localStorage.getItem(FORGE_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setForgeUser(identity) {
    window.localStorage.setItem(FORGE_USER_KEY, JSON.stringify(identity));
  }
  function clearForgeUser() {
    window.localStorage.removeItem(FORGE_USER_KEY);
  }

  // ---- WebAuthn biometrics (optional "cool factor" sign-in) --------
  var webauthnSupported = !!(window.PublicKeyCredential && navigator.credentials &&
                             navigator.credentials.create && navigator.credentials.get);
  function bufToB64(buf) {
    var arr = new Uint8Array(buf), bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }
  // Register a platform authenticator and store the credential id on the user doc.
  function registerBiometric() {
    if (!webauthnSupported) return Promise.reject(new Error('WebAuthn unsupported'));
    var docId = state.user && state.user.id;
    if (!docId) return Promise.reject(new Error('No user'));
    var name = cleanName(state.user.name, '');
    return navigator.credentials.create({
      publicKey: {
        rp: { name: 'Forge', id: window.location.hostname },
        user: { id: new TextEncoder().encode(docId), name: name, displayName: name },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000
      }
    }).then(function (cred) {
      var idB64 = bufToB64(cred.rawId);
      return db.collection('users').doc(docId).set({ biometricCredentialId: idB64 }, { merge: true })
        .then(function () { state.user.biometricCredentialId = idB64; });
    });
  }
  function authBiometric(credIdB64) {
    if (!webauthnSupported) return Promise.reject(new Error('WebAuthn unsupported'));
    return navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: b64ToBuf(credIdB64), transports: ['internal'] }],
        userVerification: 'required',
        rpId: window.location.hostname,
        timeout: 60000
      }
    });
  }

  // Finalise a successful login: persist the identity + last-avatar, enter app.
  function finishLogin(identity) {
    setForgeUser(identity);
    window.localStorage.setItem(FORGE_LAST_AVATAR_KEY, identity.name);
    enterApp(identity);
  }

  // Funny "that's not you" lines for a failed Face ID check.
  function randomFaceFail(name) {
    var msgs = [
      "You sure don't look like " + name + "! Please choose your avatar.",
      'Nice try! ' + name + ' has a much better face than that.',
      'Our Face ID is good, but not THAT good. Try your own avatar!',
      'Forge security level: Fort Knox. Please choose your avatar.'
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  // First time on this device for a known user: offer Face ID enrolment.
  function showEnableFaceId(identity) {
    // registerBiometric reads state.user for the doc id + name.
    state.user = { id: identity.uid, name: identity.name, email: '', avatar: identity.avatar || null };
    var screen = ensureScreen('faceid-screen');
    screen.innerHTML =
      '<header class="brand brand--compact"><h1 class="brand-name">FORGE</h1></header>' +
      '<div class="lock-id">' + avatarMarkup(identity.name, 'lock-avatar') +
        '<p class="lock-name">' + esc(identity.name) + '</p></div>' +
      '<p class="pin-subtext">Enable Face ID to sign in as ' + esc(identity.name) + '</p>' +
      '<button type="button" class="btn-forge faceid-enable">Enable Face ID</button>' +
      '<button type="button" class="btn-link faceid-skip">Skip</button>' +
      '<p class="pin-error message" role="status" aria-live="polite"></p>';
    showScreen(screen);
    var enableBtn = screen.querySelector('.faceid-enable');
    enableBtn.addEventListener('click', function () {
      if (!webauthnSupported) { finishLogin(identity); return; } // skip silently
      enableBtn.disabled = true;
      registerBiometric()
        .then(function () { finishLogin(identity); })
        .catch(function () { finishLogin(identity); }); // cancel/unsupported → continue
    });
    screen.querySelector('.faceid-skip').addEventListener('click', function () { finishLogin(identity); });
    addFire(enableBtn);
  }

  // ---- DOM references (login screens live in index.html) -----------
  var loginScreen = document.getElementById('login-screen');
  var dashboardScreen = document.getElementById('dashboard-screen');

  var carousel = document.getElementById('carousel');
  var forgeBtn = document.getElementById('forge-btn');
  var devLoginBtn = document.getElementById('dev-login-btn');
  var devFridayBtn = document.getElementById('dev-friday-btn');
  var installBtn = document.getElementById('install-btn');
  var loginMessage = document.getElementById('login-message');
  var loginJunk = document.getElementById('login-junk');

  // ---- State --------------------------------------------------------
  var users = [];           // registered users from Firestore
  var cards = [];           // carousel card elements
  var currentIndex = 0;     // centred carousel card
  var touchStartX = null;   // swipe tracking

  var state = { user: null, logs: [] };

  // DEV_MODE session flag: treat today as a Friday (best-effort) for display.
  var devForceFriday = false;

  // Message board real-time state.
  var boardUnsubs = [];
  var boardSubscribed = false; // listeners attached once, kept alive for session
  var boardMessages = [];
  var boardActivities = [];
  var squadStatus = {}; // userId -> [logged exercise keys today]

  // ===================================================================
  // Screen helpers
  // ===================================================================
  function showScreen(screen) {
    var all = document.querySelectorAll('.screen');
    Array.prototype.forEach.call(all, function (s) {
      s.classList.add('hidden');
    });
    screen.classList.remove('hidden');
    hideNav(); // main screens re-show it via showNav(); others stay nav-free
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

  // Resolve a user's display name. Prefer a real name; if it's missing, empty,
  // or actually an email address, fall back to the email local part capitalised
  // — never show a full email address as a name. `email` is optional; if absent,
  // an email-looking name is used as the source.
  function cleanName(name, email) {
    var n = (name == null ? '' : String(name)).trim();
    if (n && n.indexOf('@') < 0) return n;
    var src = (email && String(email).indexOf('@') >= 0) ? String(email) : n;
    var local = (src.split('@')[0] || '').trim();
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Forger';
  }

  // Give a forge-laser element a random start point so they don't sweep in sync.
  function staggerLaser(el) {
    if (el && !el.style.getPropertyValue('--laser-delay')) {
      el.style.setProperty('--laser-delay', '-' + (Math.random() * 3).toFixed(2) + 's');
    }
  }

  // Buttons that must never carry the laser border — its 3px border + glow
  // overrides their borderless look. Class-based so it works even while the
  // button is hidden (clientWidth 0) and unmeasurable.
  function laserExempt(el) {
    return !!el && (el.classList.contains('btn-log') || el.classList.contains('board-post'));
  }

  // Wrap a button's text in a label span, add the rotating laser border, and a
  // canvas particle-fire layer along the bottom. The flames sit behind the text
  // and never block clicks.
  function addFire(btn) {
    if (!btn || btn.classList.contains('has-fire')) return;
    btn.classList.add('has-fire');
    // Only large buttons get the laser border — its 3px border + glow overwhelms
    // small buttons (e.g. Log, Post) and overrides their borderless look. Never
    // applied to Log/Post (class-based — reliable even while hidden); otherwise
    // added when the button is measurably large (startFire's resize() re-checks
    // buttons that are still hidden at creation time).
    if (!laserExempt(btn) && btn.clientWidth >= 120 && btn.clientHeight >= 48) {
      btn.classList.add('forge-laser');
      staggerLaser(btn);
    }
    var label = document.createElement('span');
    label.className = 'btn-label';
    while (btn.firstChild) label.appendChild(btn.firstChild);
    btn.appendChild(label);
    var canvas = document.createElement('canvas');
    canvas.className = 'btn-fire';
    if (btn.id === 'forge-btn') canvas.id = 'forge-fire'; // primary hero fire
    btn.appendChild(canvas);
    startFire(canvas);
  }

  // Canvas particle fire: 120 flame + 30 spark particles, additive ('lighter')
  // blending, radial-gradient glow on each flame, sin-based value-noise
  // turbulence. The canvas is transparent (clearRect only — never filled) so it
  // sits over the background image. Runs ~60fps via requestAnimationFrame, and
  // stops itself when the canvas is removed from the DOM (screen re-render).
  function startFire(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var W = 0, H = 0;
    // Log and Post buttons use a short strip — cap flame size so the radial glow
    // stays within the canvas and doesn't bleed around the button edges.
    var isLog = !!(canvas.parentNode && canvas.parentNode.classList &&
                   (canvas.parentNode.classList.contains('btn-log') ||
                    canvas.parentNode.classList.contains('board-post')));

    function resize() {
      // Button fire only (the timer 'ring-fire' is laid out by its own CSS).
      // Small buttons (under 48px tall OR under 120px wide) get a slim fire strip
      // and never the laser border; large ones keep full height + laser.
      var host = canvas.parentNode;
      if (canvas.classList.contains('btn-fire') && host) {
        var exempt = laserExempt(host);
        if (exempt) host.classList.remove('forge-laser'); // never on Log/Post, even while hidden
        if (host.clientWidth && host.clientHeight) {
          var small = host.clientHeight < 48 || host.clientWidth < 120;
          // Slim strip height by button: btn-log is taller so it gets 30px to
          // fill its base; board-post and all other small buttons get 16px.
          canvas.classList.remove('btn-fire--slim', 'btn-fire--slim-log');
          if (small) {
            canvas.classList.add(host.classList.contains('btn-log') ? 'btn-fire--slim-log' : 'btn-fire--slim');
          }
          if (small || exempt) {
            host.classList.remove('forge-laser');
          } else if (!host.classList.contains('forge-laser')) {
            host.classList.add('forge-laser'); // large button revealed after a hidden start
            staggerLaser(host);
          }
        }
      }
      W = canvas.clientWidth || 0;
      H = canvas.clientHeight || 0;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
    }
    resize();
    // Observe the host button (not the canvas): its size is stable, so toggling
    // the canvas height doesn't re-trigger us, and it reliably fires when a
    // previously-hidden screen (e.g. the dashboard) becomes visible.
    if (window.ResizeObserver) {
      var host = canvas.parentNode;
      if (host) new ResizeObserver(resize).observe(host);
    }

    var flames = [];
    var sparks = [];
    var t = 0; // noise time offset, increments 0.018 per frame

    function rand(a, b) { return a + Math.random() * (b - a); }

    // Value noise from a sin-based hash, sampled at x*0.012, y*0.012 (+ time).
    function noise(x, y) {
      return Math.sin(x * 0.012 + t) * Math.cos(y * 0.012 - t * 0.7);
    }

    function spawnFlame(p) {
      p.x = Math.random() * W;     // spawn across the full button width
      p.y = H;
      p.vx = rand(-0.2, 0.2);
      p.vy = rand(-1.7, -0.9);     // rises
      p.size = isLog ? rand(3, 8) : rand(8, 18); // smaller flames on Log buttons
      p.life = 1;
      p.decay = rand(0.006, 0.018);
      return p;
    }
    function spawnSpark(p) {
      p.x = Math.random() * W;     // spawn across the full button width
      p.y = H;
      p.vx = rand(-0.7, 0.7);
      p.vy = rand(-3.6, -2.2);     // high upward velocity
      p.size = rand(1, 2.4);
      p.life = 1;
      p.decay = rand(0.012, 0.026);
      return p;
    }

    // Lazily initialised: created "dead" (life 0) and first spawned by the draw
    // loop, by which point the ResizeObserver has set W to the real (visible)
    // button width — so particles never spawn against a stale W=0.
    var i;
    for (i = 0; i < 120; i++) flames.push({ life: 0 });
    for (i = 0; i < 30; i++) sparks.push({ life: 0 });

    // Colour by life stage.
    function flameColor(life) {
      if (life > 0.7) return '255,244,200';  // near-white / yellow core
      if (life > 0.4) return '255,150,40';   // orange mid
      if (life > 0.15) return '200,45,20';   // deep red ember
      return '45,35,35';                     // dark smoke
    }

    function frame() {
      if (!canvas.isConnected) return; // detached on screen re-render → stop loop
      t += 0.018;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (W > 0 && H > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.globalCompositeOperation = 'lighter';

        for (var f = 0; f < flames.length; f++) {
          var p = flames[f];
          // (Re)spawn dead / uninitialised particles first, so a lazy life:0
          // particle is fully populated (against the current W) before any use.
          if (p.life <= 0 || p.size < 0.6 || p.y < -10) spawnFlame(p);
          p.vx += noise(p.x, p.y) * 0.05; // noise-based turbulence drift
          p.x += p.vx;
          p.y += p.vy;
          p.life -= p.decay;
          p.size *= 0.985;                // size decays over lifetime
          var rgb = flameColor(p.life);
          var a = Math.min(1, p.life) * 0.9;
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
          g.addColorStop(1, 'rgba(' + rgb + ',0)'); // soft glow edge
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        for (var s = 0; s < sparks.length; s++) {
          var q = sparks[s];
          if (q.life <= 0 || q.y > H + 6) spawnSpark(q);
          q.vy += 0.05;                   // gravity pulls sparks back down
          q.x += q.vx;
          q.y += q.vy;
          q.life -= q.decay;
          // Fade orange to transparent over life.
          ctx.fillStyle = 'rgba(255,' + (130 + Math.round(70 * q.life)) + ',40,' + Math.min(1, q.life) + ')';
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ===================================================================
  // Top navigation bar (persistent across main screens)
  // ===================================================================
  var NAV_ITEMS = [
    { key: 'board', label: 'Messages',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H8l-3 2v-2H5a2 2 0 0 1-2-2z"/><path d="M11 13v1a2 2 0 0 0 2 2h4l2 2v-2a2 2 0 0 0 2-2v-3"/></svg>' },
    { key: 'exercises', label: 'Exercises',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.6 2.7 3.5 3.8 3.5 7.2a3.5 3.5 0 0 1-7 0c0-1.4.6-2.3 1.4-3.1.2 1.6 1.6 1.7 1.6.2 0-1.3-.5-2.6.5-4.3z"/><path d="M10 18.5a2 2 0 0 0 4 0"/></svg>' },
    { key: 'progress', label: 'Progress',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></svg>' },
    { key: 'plan', label: 'Plan',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8.5" y1="8" x2="15.5" y2="8"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><line x1="8.5" y1="16" x2="12.5" y2="16"/></svg>' },
    { key: 'settings', label: 'Settings',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/></svg>' }
  ];

  // One persistent nav element, built once and reused — never rebuilt per
  // screen, so its height/position are identical everywhere.
  var navEl = null;

  function buildNav() {
    navEl = document.createElement('nav');
    navEl.id = 'topnav';
    navEl.className = 'topnav hidden';
    navEl.innerHTML = NAV_ITEMS.map(function (it) {
      return '<button type="button" class="nav-item" data-go="' + it.key + '">' +
               it.icon + '<span class="nav-label">' + it.label + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(navEl.querySelectorAll('.nav-item'), function (btn) {
      btn.addEventListener('click', function () { navGo(btn.getAttribute('data-go')); });
    });
    document.body.appendChild(navEl);
  }

  function showNav(active) {
    if (!navEl) buildNav();
    navEl.classList.remove('hidden');
    Array.prototype.forEach.call(navEl.querySelectorAll('.nav-item'), function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-go') === active);
    });
    // Diagnostic: confirm one nav element at a consistent height.
    requestAnimationFrame(function () {
      console.log('[FORGE nav] screen=' + active +
        ' | .topnav count=' + document.querySelectorAll('.topnav').length +
        ' | clientHeight=' + navEl.clientHeight + 'px');
    });
  }

  function hideNav() {
    if (navEl) navEl.classList.add('hidden');
  }

  function navGo(dest) {
    // Board listeners persist across navigation (subscribed once) to avoid
    // re-reading on every visit.
    if (dest === 'board') openBoard();
    else if (dest === 'exercises') renderDashboard();
    else if (dest === 'progress') openProgress();
    else if (dest === 'plan') openPlan();
    else if (dest === 'settings') openSettings();
  }

  // ===================================================================
  // Countdown sounds (Web Audio API — generated, no audio files)
  // ===================================================================
  var audioCtx = null;

  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }

  // Generate a tone that respects device volume (Web Audio routes through it).
  function playTone(freq, durationSec, type, peak) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak || 0.5, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationSec + 0.05);
  }

  function soundStart()  { playTone(150, 2.0, 'sine', 0.6); }   // deep forge bell
  function soundStrike() { playTone(300, 0.8, 'triangle', 0.5); } // mid strike
  function soundBeep()   { playTone(500, 0.1, 'square', 0.4); }  // sharp final beep

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

  // Weekly rest-day rotation. weekday: 0=Sun .. 6=Sat
  function scheduleForDay(wd) {
    switch (wd) {
      case 1: return { type: 'normal', rest: 'lunges',   active: ['pressups', 'situps', 'plank'] };
      case 2: return { type: 'normal', rest: 'plank',    active: ['pressups', 'situps', 'lunges'] };
      case 3: return { type: 'normal', rest: 'pressups', active: ['situps', 'plank', 'lunges'] };
      case 4: return { type: 'normal', rest: 'situps',   active: ['pressups', 'plank', 'lunges'] };
      case 5: return { type: 'besteffort', rest: null,   active: ['pressups', 'situps', 'plank', 'lunges'] };
      case 6: return { type: 'rest', rest: null,         active: [] };
      default: return { type: 'normal', rest: 'lunges',  active: ['pressups', 'situps', 'plank'] }; // Sunday
    }
  }

  function scheduleFor(d) {
    return scheduleForDay(d.getDay());
  }

  // Today's schedule/routine, honouring the DEV_MODE Friday override. This only
  // affects what's shown for *today* — historical stats use real weekdays.
  function todaySchedule() {
    return devForceFriday ? scheduleForDay(5) : scheduleFor(new Date());
  }

  function todayRoutine() {
    return devForceFriday ? ROUTINES[5] : routineFor(new Date());
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

    cards.forEach(function (card) { carousel.appendChild(card); });

    // Centre on the last avatar to sign in on this device, if any.
    var last = window.localStorage.getItem(FORGE_LAST_AVATAR_KEY);
    var li = last ? TEAM.indexOf(last) : -1;
    currentIndex = li >= 0 ? li : 0;
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
    card.addEventListener('click', function () {
      // Tapping the already-centred avatar proceeds (sign in / register);
      // tapping a side card just centres it.
      if (index === currentIndex) { onForge(); } else { setIndex(index); }
    });
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
      // Depth is conveyed by avatar diameter: 120 active, 80 adjacent, 60 far.
      var x, opacity, z, size;
      if (off === 0) { x = 0; opacity = 1; z = 30; size = 120; }
      else if (abs === 1) { x = off * 120; opacity = 0.5; z = 20; size = 80; }
      else { x = (off > 0 ? 1 : -1) * 150; opacity = 0; z = 10; size = 60; }

      card.style.transform = 'translate(-50%, -50%) translateX(' + x + 'px)';
      card.style.opacity = opacity;
      card.style.zIndex = z;
      card.classList.toggle('is-active', off === 0);

      var av = card.querySelector('.ucard-avatar');
      if (av) {
        av.style.width = size + 'px';
        av.style.height = size + 'px';
        // Scale the placeholder/register glyph with the circle.
        if (av.tagName !== 'IMG') av.style.fontSize = Math.round(size * 0.5) + 'px';
      }
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

  function setIndexByName(name) {
    var i = TEAM.indexOf(name);
    if (i >= 0) setIndex(i);
  }

  // A logged-out user lands on the carousel login screen.
  function showLoginEntry() {
    showScreen(loginScreen);
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
  // Load the registered-users list once per session (used by the carousel to
  // tell who's already registered). Reset usersLoaded after a new registration.
  var usersLoaded = false;

  function loadUsers() {
    if (usersLoaded) return Promise.resolve();
    return db.collection('users').limit(MAX_USERS).get()
      .then(function (snap) {
        users = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          users.push({
            id: doc.id,
            name: cleanName(data.name, data.email),
            email: data.email || '',
            avatar: data.avatar || null,
            biometricCredentialId: data.biometricCredentialId || null
          });
        });
        usersLoaded = true;
      })
      .catch(function (err) {
        users = [];
        console.error('Failed to load users:', err);
      });
  }

  function registeredUser(name) {
    return users.filter(function (u) { return u.name === name; })[0] || null;
  }

  // Authoritative existence check: query Firestore directly for a user document
  // by name (the cached `users` list is capped at MAX_USERS and may miss someone).
  // Falls back to the cached list for cleaned/legacy names. Resolves to a user
  // object { id, name, email, avatar, biometricCredentialId } or null.
  function findExistingUser(name) {
    return db.collection('users').where('name', '==', name).limit(1).get()
      .then(function (snap) {
        if (!snap.empty) {
          var d = snap.docs[0];
          var data = d.data() || {};
          return {
            id: d.id,
            name: cleanName(data.name, data.email),
            email: data.email || '',
            avatar: data.avatar || null,
            biometricCredentialId: data.biometricCredentialId || null
          };
        }
        return registeredUser(name);
      })
      .catch(function (err) {
        console.error('findExistingUser failed:', err);
        return registeredUser(name);
      });
  }

  // Login flow: tap the centred avatar → look the name up in Firestore.
  //  - no document      → friendly "we don't recognise you" message (no register)
  //  - no biometric yet → offer Face ID enrolment, then enter the app
  //  - biometric exists → verify Face ID; success enters, failure jokes + returns
  function onForge() {
    setMessage(loginMessage, '');
    loginJunk.classList.add('hidden');

    var name = TEAM[currentIndex];
    forgeBtn.disabled = true;
    findExistingUser(name).then(function (existing) {
      forgeBtn.disabled = false;
      if (!existing) {
        setMessage(loginMessage,
          "We don't recognise you! Ask your squad admin to add you to Forge.", true);
        return;
      }
      var identity = { uid: existing.id, name: existing.name, email: '', avatar: existing.avatar || null };
      if (existing.biometricCredentialId) {
        // Returning device — verify Face ID. Either outcome is handled here.
        authBiometric(existing.biometricCredentialId)
          .then(function () { finishLogin(identity); })
          .catch(function () {
            setMessage(loginMessage, randomFaceFail(existing.name), true);
            showScreen(loginScreen);
            setIndexByName(existing.name);
          });
      } else {
        // First time on this device for this user — offer Face ID enrolment.
        showEnableFaceId(identity);
      }
    });
  }

  // ===================================================================
  // App entry — load the user's profile + logs, then the dashboard
  // ===================================================================
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

  // identity = { uid, name, email, avatar } from localStorage / registration.
  function enterApp(identity) {
    var id = identity.uid;
    state.user = { id: id, name: cleanName(identity.name, identity.email), email: identity.email || '', avatar: identity.avatar || null };
    db.collection('users').doc(id).get()
      .then(function (snap) {
        if (snap.exists) {
          var data = snap.data() || {};
          state.user = Object.assign({ id: id }, data);
          state.user.name = cleanName(data.name, data.email);
        }
        return loadLogs(id);
      })
      .then(function (logs) {
        state.logs = logs;
        return refreshStats();
      })
      .then(enterHome)
      .catch(function (err) {
        console.error('Failed to enter app:', err);
        enterHome();
      });
  }

  // Daily entry: the message board is always the first screen after login.
  // The warm-up now intercepts the Exercises tab (see renderDashboard).
  function enterHome() {
    openBoard();
  }

  // DEV_MODE only: enter as Mark using his existing Firestore profile (matched
  // by name in the loaded users list), via the normal enterApp path.
  function devEnterAsMark() {
    var mark = registeredUser('Mark');
    if (!mark) { console.warn('Dev login: no "Mark" user found in Firestore.'); return; }
    enterApp({ uid: mark.id, name: mark.name, email: '', avatar: mark.avatar });
  }
  function devLogin() {
    if (!DEV_MODE) return;
    devForceFriday = false;
    devEnterAsMark();
  }

  // DEV_MODE only: log in as Mark and treat today as a best-effort Friday.
  function devFridayLogin() {
    if (!DEV_MODE) return;
    devForceFriday = true;
    devEnterAsMark();
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
        writeActivity(exKey, repsCompleted, mood);
        return refreshStats();
      });
  }

  // Auto-write a public activity entry to the message board feed.
  function writeActivity(exKey, repsCompleted, mood) {
    var ex = EXERCISES[exKey];
    var displayName = ex ? ex.name : exKey; // bonus passes the move name
    var detail = ex ? formatTarget(ex, Number(repsCompleted)) : String(repsCompleted);
    db.collection('activities').add({
      userId: state.user.id,
      userName: state.user.name,
      exercise: displayName,
      repsCompleted: detail,
      mood: mood,
      reactions: [],
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function (err) { console.error('Failed to write activity:', err); });
  }

  // ===================================================================
  // Dashboard
  // ===================================================================
  function renderDashboard() {
    var today = new Date();
    var day = challengeDay(today);
    var sched = todaySchedule();
    var routine = todayRoutine();

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

    var showIntro = !!(state.user && !state.user.introSeen);

    var html =
      '<header class="topbar">' +
        '<span class="topbar-brand">FORGE</span>' +
      '</header>' +

      (showIntro
        ? '<div class="intro-note">New to Forge? Tap the info icon on each exercise to check your form before you start.</div>'
        : '') +

      (banner ? '<div class="banner">' + esc(banner) + '</div>' : '') +

      '<section class="stats">' +
        statCard(dayLabel + '<span class="stat-sub">/ ' + TOTAL_DAYS + '</span>', 'Day') +
        statCard(week + '<span class="stat-sub">/ ' + TOTAL_WEEKS + '</span>', 'Week') +
        statCard('🔥 ' + (state.user ? state.user.currentStreak : 0), 'Streak') +
        statCard((state.user ? state.user.totalPoints : 0), 'Points') +
      '</section>' +

      (routine ? '<button type="button" class="btn-outline forge-laser" data-action="warmup">Warm Up</button>' : '') +

      (sched.type === 'besteffort'
        ? '<p class="section-label">Best Effort Friday — 2 min each</p>'
        : '<p class="section-label">Today\'s training</p>') +

      body +

      bonusSpinHTML() +

      (routine ? '<button type="button" class="btn-outline forge-laser" data-action="cooldown">Cool Down</button>' : '');

    dashboardScreen.innerHTML = html;
    wireDashboard();
    showScreen(dashboardScreen);
    showNav('exercises');
    if (showIntro) markIntroSeen(); // one-time note; gone on next render
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

    var infoBtn = isRest ? '' :
      '<button type="button" class="card-info-btn" data-info="' + exKey + '" aria-label="Form guide">i</button>';

    // Cards no longer carry the laser border — it visually wraps the small Log
    // button inside. The laser is reserved for full-width standalone buttons.
    return '<div class="card' + (isRest ? ' card-rest' : '') + (logged ? ' card-done' : '') + '">' +
             '<div class="card-info">' +
               '<div class="card-name-row">' +
                 '<h3 class="card-name">' + ex.name + '</h3>' + infoBtn +
               '</div>' +
               '<p class="card-target">' +
                 (isRest ? 'Rest day for this one' :
                   (bestEffort ? 'Max effort · 2:00' : formatTarget(ex, target))) +
               '</p>' +
             '</div>' +
             '<div class="card-action">' + statusEl + '</div>' +
           '</div>';
  }

  function wireDashboard() {
    // Random start point for the laser elements (Warm Up / Cool Down buttons).
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('.forge-laser'), staggerLaser);
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-log]'), function (btn) {
      btn.addEventListener('click', function () {
        openLogScreen(btn.getAttribute('data-log'), btn.getAttribute('data-best') === '1', false);
      });
      addFire(btn);
    });
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-info]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-info');
        openFormGuide(EXERCISES[key].name, key, renderDashboard, renderDashboard);
      });
    });
    var spin = dashboardScreen.querySelector('[data-action="spin"]');
    if (spin) { spin.addEventListener('click', openSpin); addFire(spin); }

    var warm = dashboardScreen.querySelector('[data-action="warmup"]');
    if (warm) warm.addEventListener('click', function () { openRoutineScreen('warmup'); });
    var cool = dashboardScreen.querySelector('[data-action="cooldown"]');
    if (cool) cool.addEventListener('click', function () { openRoutineScreen('cooldown'); });
  }

  function openRoutineScreen(type) {
    var routine = todayRoutine();
    if (!routine) return;
    showRoutine(type, type === 'warmup' ? routine.warmup : routine.cooldown);
  }

  // ===================================================================
  // Exercise logging screen (normal + best effort)
  // ===================================================================
  // --- Form guides --------------------------------------------------
  function guideKeyFor(exKey) {
    if (exKey === 'plank') return 'plank-' + ((state.user && state.user.plankPreference) || 'forward');
    return exKey; // daily keys or bonus move names
  }

  function seenKeyFor(exKey) {
    return exKey === 'plank' ? 'plank' : exKey;
  }

  function hasSeenGuide(exKey) {
    return !!(state.user && state.user.formSeen && state.user.formSeen[seenKeyFor(exKey)]);
  }

  function markFormSeen(exKey) {
    if (!state.user) return;
    var key = seenKeyFor(exKey);
    state.user.formSeen = state.user.formSeen || {};
    if (state.user.formSeen[key]) return;
    state.user.formSeen[key] = true;
    var patch = {};
    patch['formSeen.' + key] = true;
    db.collection('users').doc(state.user.id).update(patch).catch(function () {
      db.collection('users').doc(state.user.id)
        .set({ formSeen: state.user.formSeen }, { merge: true })
        .catch(function (e) { console.error('Failed to store form-seen:', e); });
    });
  }

  function markIntroSeen() {
    if (!state.user || state.user.introSeen) return;
    state.user.introSeen = true;
    db.collection('users').doc(state.user.id).set({ introSeen: true }, { merge: true })
      .catch(function (e) { console.error('Failed to store intro-seen:', e); });
  }

  function openFormGuide(displayName, exKey, onProceed, backFn) {
    var screen = ensureScreen('form-screen');
    var mediaHTML = '';
    var contentHTML;

    if (exKey === 'plank') {
      // Plank shows both variants: each image full width with points beneath it.
      contentHTML = PLANK_GUIDE.map(function (sec) {
        return '<p class="section-heading">' + esc(sec.title) + '</p>' +
          '<img class="form-image" src="' + sec.image + '" alt="' + esc(sec.title) + ' demonstration" />' +
          '<ul class="form-points">' + sec.points.map(function (p) {
            return '<li>' + esc(p) + '</li>';
          }).join('') + '</ul>';
      }).join('');
    } else {
      var guide = FORM_GUIDES[guideKeyFor(exKey)] || { points: [], mistakes: '' };
      // Video area only for the 4 main exercises; bonus moves are text-only.
      var isMain = !!EXERCISES[exKey];
      var video = FORM_VIDEOS[exKey];

      mediaHTML = !isMain ? '' :
        (video
          ? '<video class="form-video-el" src="' + video + '" autoplay loop muted playsinline></video>'
          : '<div class="form-video">' +
              '<svg class="form-play" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3">' +
                '<circle cx="32" cy="32" r="26"/><path d="M27 23l16 9-16 9z" fill="currentColor" stroke="none"/></svg>' +
              '<span class="form-video-label">Video coming soon</span>' +
            '</div>');

      var pointsHTML =
        '<p class="section-heading">Key points</p>' +
        '<ul class="form-points">' + guide.points.map(function (p) {
          return '<li>' + esc(p) + '</li>';
        }).join('') + '</ul>' +
        (guide.mistakes
          ? '<p class="form-mistakes"><strong>Common mistakes:</strong> ' + esc(guide.mistakes) + '</p>'
          : '');

      // Bonus guides wrap the text in a styled card (no video area).
      contentHTML = isMain ? pointsHTML : '<div class="form-card">' + pointsHTML + '</div>';
    }

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">FORM GUIDE</span>' +
      '</header>' +
      '<h1 class="log-title">' + esc(displayName) + '</h1>' +
      mediaHTML +
      contentHTML +
      '<button type="button" class="btn-forge form-ok">I understand good form</button>' +
      '<button type="button" class="btn-link form-skip">Skip for now</button>';

    function proceed() { markFormSeen(exKey); onProceed(); }
    screen.querySelector('.form-ok').addEventListener('click', proceed);
    screen.querySelector('.form-skip').addEventListener('click', proceed);
    screen.querySelector('.back-btn').addEventListener('click', backFn || renderDashboard);
    addFire(screen.querySelector('.form-ok'));
    showScreen(screen);
  }

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
        '<button type="button" class="btn-link form-link">Form Guide</button>' +
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
    var formLink = screen.querySelector('.form-link');
    if (formLink) {
      formLink.addEventListener('click', function () {
        openFormGuide(ex.name, exKey, function () { openLogScreen(exKey, isBestEffort, bonusExercise); },
          function () { openLogScreen(exKey, isBestEffort, bonusExercise); });
      });
    }

    var flow = screen.querySelector('.log-flow');

    if (isBestEffort) {
      var ringFg = screen.querySelector('.ring-fg');
      var ringLabel = screen.querySelector('.ring-label');
      var ringWrap = screen.querySelector('.ring-wrap');
      var startBtn = screen.querySelector('.timer-start');

      // Fire along the bottom of the timer container (canvas particle fire).
      var timerFire = document.createElement('canvas');
      timerFire.className = 'ring-fire';
      ringWrap.appendChild(timerFire);
      startFire(timerFire);

      addFire(startBtn); // laser border + fire on the START button
      startBtn.addEventListener('click', function () {
        startBtn.disabled = true;
        var lbl = startBtn.querySelector('.btn-label');
        if (lbl) lbl.textContent = 'Go!';
        soundStart(); // deep forge bell on start (user gesture unlocks audio)
        startCountdown(120, ringFg, ringLabel, timerFire, function () {
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
                 '<span class="mood-icon">' + MOOD_ICONS[i] + '</span>' +
                 '<span class="mood-cap">' + esc(m) + '</span></button>';
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
    addFire(container.querySelector('.confirm-btn'));
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

  function startCountdown(seconds, ringEl, labelEl, fireEl, onDone) {
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
      // Halfway (60s) and 30s marks: mid strike tone.
      if (remaining === 60 || remaining === 30) soundStrike();
      // Final 30s: double the fire animation speed for urgency.
      if (remaining === 30 && fireEl && fireEl.setSpeed) {
        fireEl.setSpeed(2);
      }
      // Final 10 seconds: sharp beep each second.
      if (remaining <= 10 && remaining >= 1) soundBeep();
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

          function showResult() {
            showScreen(screen);
            result.classList.remove('hidden');
            result.innerHTML =
              '<p class="spin-result-name">' + esc(bonus.name) + '</p>' +
              '<p class="spin-result-target">' + esc(bonus.target) + '</p>' +
              '<button type="button" class="btn-link form-link">Form Guide</button>' +
              '<div class="log-flow"></div>';
            result.querySelector('.form-link').addEventListener('click', function () {
              openFormGuide(bonus.name, bonus.name, showResult, showResult);
            });
            buildLogFlow(result.querySelector('.log-flow'), {
              requireInput: false,
              targetDisplay: bonus.target,
              confirmValue: bonus.target,
              onConfirm: function (value, mood) {
                saveLog(bonus.name, value, bonus.target, mood, false, true).then(renderDashboard);
              }
            });
          }

          showResult();
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
      // Both warm-up and cool-down lead into the dashboard (Exercises tab).
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
    openSettings(); // re-render to update the highlighted option
  }

  // ===================================================================
  // Progress / Plan placeholders + Settings
  // ===================================================================
  var progressCharts = [];
  var progressGroupCache = null;       // cached cross-user best-effort logs
  var progressGroupAt = 0;
  var PROGRESS_GROUP_TTL = 5 * 60 * 1000; // 5 minutes

  function moodScore(label) {
    var i = MOODS.indexOf(label);
    return i < 0 ? null : (5 - i); // Crushed it = 5 … Really tough = 1
  }

  function computeDaysCompleted() {
    var byDate = logsByDate(state.logs);
    var today = atMidnight(new Date());
    var d = new Date(CHALLENGE_START);
    var count = 0;
    while (d <= today) {
      var sched = scheduleForDay(d.getDay());
      if (sched.active.length && dayCompleted(d, byDate)) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function openProgress() {
    var screen = ensureScreen('progress-screen');
    var totalExercises = state.logs.filter(function (l) { return !l.bonusExercise; }).length;
    var totalBonus = state.logs.filter(function (l) { return l.bonusExercise; }).length;
    var u = state.user || {};
    var name = u.name || 'Forger';
    var photo = AVATARS[name];
    var avatarHTML = photo
      ? '<img class="ucard-avatar profile-avatar" src="' + photo + '" alt="">'
      : '<span class="ucard-avatar ucard-avatar--placeholder profile-avatar">' +
          esc(name.charAt(0).toUpperCase()) + '</span>';

    screen.innerHTML =
      '<div class="profile-head">' +
        avatarHTML +
        '<h1 class="profile-name">' + esc(name) + '</h1>' +
      '</div>' +
      '<p class="section-heading">Best Effort</p>' +
      '<div id="progress-graphs" class="progress-graphs"></div>' +
      '<section class="profile-section">' +
        '<p class="section-heading">Personal Stats</p>' +
        '<div class="profile-stats">' +
          statRow('Total points', u.totalPoints || 0) +
          statRow('Current streak', u.currentStreak || 0) +
          statRow('Longest streak', u.longestStreak || 0) +
          statRow('Exercises logged', totalExercises) +
          statRow('Bonus exercises', totalBonus) +
          statRow('Days completed', computeDaysCompleted() + ' / ' + TOTAL_DAYS) +
        '</div>' +
      '</section>';

    showScreen(screen);
    showNav('progress');
    loadProgressGraphs();
  }

  function loadProgressGraphs() {
    var container = document.getElementById('progress-graphs');
    if (!container) return;
    progressCharts.forEach(function (c) { try { c.destroy(); } catch (e) { /* no-op */ } });
    progressCharts = [];
    container.innerHTML = '';

    var userBE = state.logs.filter(function (l) { return l.isBestEffort; });

    function draw(groupBE) {
      ORDER.forEach(function (k) { buildExerciseGraph(container, k, userBE, groupBE); });
    }

    // Cache the cross-user best-effort query (TTL) — avoids re-reading every
    // best-effort log each time the Progress tab is opened.
    if (progressGroupCache && (Date.now() - progressGroupAt) < PROGRESS_GROUP_TTL) {
      draw(progressGroupCache);
      return;
    }
    db.collectionGroup('logs').where('isBestEffort', '==', true).get()
      .then(function (snap) {
        var groupBE = [];
        snap.forEach(function (doc) { groupBE.push(doc.data()); });
        progressGroupCache = groupBE;
        progressGroupAt = Date.now();
        draw(groupBE);
      })
      .catch(function (err) {
        console.error('Group best-effort load failed:', err);
        draw(progressGroupCache || []);
      });
  }

  function buildExerciseGraph(container, key, userBE, groupBE) {
    var ex = EXERCISES[key];
    var card = document.createElement('div');
    card.className = 'graph-card';
    card.innerHTML = '<p class="graph-title">' + esc(ex.name) + '</p>';

    var ub = userBE.filter(function (l) { return l.exercise === key; });
    if (!ub.length) {
      card.innerHTML += '<p class="graph-empty">Best effort scores will appear here after your first Friday session</p>';
      container.appendChild(card);
      return;
    }

    var gb = groupBE.filter(function (l) { return l.exercise === key; });
    function wk(l) { return weekNumber(challengeDay(parseKey(l.date))); }
    function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }

    var weekSet = {};
    ub.forEach(function (l) { weekSet[wk(l)] = true; });
    gb.forEach(function (l) { var w = wk(l); if (w >= 1 && w <= TOTAL_WEEKS) weekSet[w] = true; });
    var weeks = Object.keys(weekSet).map(Number).sort(function (a, b) { return a - b; });

    var userData = weeks.map(function (w) {
      var v = ub.filter(function (l) { return wk(l) === w; }).map(function (l) { return Number(l.repsCompleted) || 0; });
      return v.length ? Math.max.apply(null, v) : null;
    });
    var groupData = weeks.map(function (w) {
      return avg(gb.filter(function (l) { return wk(l) === w; }).map(function (l) { return Number(l.repsCompleted) || 0; }));
    });
    var moodData = weeks.map(function (w) {
      return avg(ub.filter(function (l) { return wk(l) === w; })
        .map(function (l) { return moodScore(l.mood); })
        .filter(function (x) { return x != null; }));
    });

    var wrap = document.createElement('div');
    wrap.className = 'graph-canvas-wrap';
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    card.appendChild(wrap);
    container.appendChild(card);

    if (typeof Chart === 'undefined') return;
    var chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks.map(function (w) { return 'Week ' + w; }),
        datasets: [
          { label: 'You', data: userData, borderColor: '#E8621A', backgroundColor: '#E8621A', tension: 0.3, spanGaps: true, yAxisID: 'y' },
          { label: 'Group avg', data: groupData, borderColor: '#F5F0E8', backgroundColor: '#F5F0E8', tension: 0.3, spanGaps: true, yAxisID: 'y' },
          { label: 'Mood', data: moodData, borderColor: '#FF8C00', backgroundColor: '#FF8C00', tension: 0.3, spanGaps: true, yAxisID: 'mood' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#F5F0E8', boxWidth: 12, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#F5F0E8' }, grid: { color: 'rgba(245,240,232,0.08)' } },
          y: { position: 'left', beginAtZero: true,
            ticks: { color: '#F5F0E8' }, grid: { color: 'rgba(245,240,232,0.08)' },
            title: { display: true, text: ex.kind === 'time' ? 'seconds' : 'reps', color: '#F5F0E8' } },
          mood: { position: 'right', min: 1, max: 5,
            ticks: { color: '#FF8C00', stepSize: 1 }, grid: { drawOnChartArea: false } }
        }
      }
    });
    progressCharts.push(chart);
  }

  function openPlan() {
    var screen = ensureScreen('plan-screen');
    var day = challengeDay(new Date());
    var dayLabel = day < 1 ? '0' : (day > TOTAL_DAYS ? TOTAL_DAYS : day);

    var flame = '<svg class="day-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1.3 3.7 4.7 4.7 4.7 8.6a4.7 4.7 0 0 1-9.4 0c0-1.7.6-2.8 1.6-3.7.3 2 1.7 2 1.7.2 0-1.7-.6-2.7 1.4-5.3z"/></svg>';
    var moon = '<svg class="day-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 12.5A7 7 0 0 1 8 5a7 7 0 1 0 7.5 7.5z"/></svg>';

    var WEEK = [
      { d: 'Monday', a: 'Press-ups, Sit-ups, Plank', r: 'Lunges' },
      { d: 'Tuesday', a: 'Press-ups, Sit-ups, Lunges', r: 'Plank' },
      { d: 'Wednesday', a: 'Sit-ups, Plank, Lunges', r: 'Press-ups' },
      { d: 'Thursday', a: 'Press-ups, Plank, Lunges', r: 'Sit-ups' },
      { d: 'Friday', t: 'best' },
      { d: 'Saturday', t: 'rest' },
      { d: 'Sunday', a: 'Press-ups, Sit-ups, Plank', r: 'Lunges' }
    ];
    var weekHTML = WEEK.map(function (w) {
      if (w.t === 'best') {
        return '<div class="day-card day-best">' + flame +
                 '<div class="day-body"><span class="day-name">Friday</span>' +
                 '<span class="day-detail">BEST EFFORT — all 4 exercises · 2 min timer each</span></div></div>';
      }
      if (w.t === 'rest') {
        return '<div class="day-card day-restday">' + moon +
                 '<div class="day-body"><span class="day-name">Saturday</span>' +
                 '<span class="day-detail">FULL REST</span></div></div>';
      }
      return '<div class="day-card"><div class="day-body"><span class="day-name">' + w.d + '</span>' +
               '<span class="day-detail"><span class="day-active">' + w.a + '</span> · rest: ' + w.r + '</span></div></div>';
    }).join('');

    var PROG = [
      { name: 'Press-ups', steps: ['Day 1: 5 reps', 'Week 4: 16 reps', 'Week 7: 28 reps', 'Week 10: 39 reps', 'Day 90: 50 reps'] },
      { name: 'Sit-ups', steps: ['Day 1: 10 reps', 'Week 4: 33 reps', 'Week 7: 56 reps', 'Week 10: 79 reps', 'Day 90: 100 reps'] },
      { name: 'Plank', steps: ['Day 1: 20 sec', 'Week 4: 1 min', 'Week 7: 1 min 45 sec', 'Week 10: 2 min 30 sec', 'Day 90: 3 min'] },
      { name: 'Lunges', steps: ['Day 1: 5 each leg', 'Week 4: 9 each leg', 'Week 7: 13 each leg', 'Week 10: 17 each leg', 'Day 90: 20 each leg'] }
    ];
    var progHTML = PROG.map(function (p) {
      var steps = p.steps.map(function (s) {
        var parts = s.split(': ');
        return '<div class="prog-step"><span class="prog-dot"></span>' +
                 '<span class="prog-when">' + esc(parts[0]) + '</span>' +
                 '<span class="prog-val">' + esc(parts[1] || '') + '</span></div>';
      }).join('');
      return '<div class="prog-row"><p class="prog-ex-name">' + esc(p.name) + '</p>' +
               '<div class="prog-track">' + steps + '</div></div>';
    }).join('');

    var bonusHTML = BONUS_EXERCISES.map(function (b, i) {
      return '<div class="plan-bonus"><span class="plan-bonus-name">' + (i + 1) + '. ' + esc(b.name) + '</span>' +
               '<span class="plan-bonus-target">' + esc(b.target) + '</span></div>';
    }).join('');

    var POINTS = [
      ['Log any exercise', 10], ['All exercises due that day', 25],
      ['Friday best effort (all 4)', 50], ['7-day streak', 100],
      ['30-day streak', 500], ['Bonus exercise', 20]
    ];
    var pointsHTML = POINTS.map(function (p) {
      return '<div class="plan-points-row"><span class="set-label">' + esc(p[0]) + '</span>' +
               '<span class="plan-pts">+' + p[1] + '</span></div>';
    }).join('');

    screen.innerHTML =
      '<h1 class="settings-title">THE PLAN</h1>' +
      '<p class="plan-sub">90 days. Built together.</p>' +

      '<p class="section-heading">Challenge overview</p>' +
      '<div class="plan-card">' +
        '<div class="plan-ov-row"><span>Start</span><span class="plan-ov-val">Tue 23 June 2026</span></div>' +
        '<div class="plan-ov-row"><span>End</span><span class="plan-ov-val">Sun 20 September 2026</span></div>' +
        '<div class="plan-ov-row"><span>Total days</span><span class="plan-ov-val">90</span></div>' +
        '<div class="plan-ov-row"><span>Current day</span><span class="plan-ov-current">' + dayLabel + ' / 90</span></div>' +
      '</div>' +

      '<p class="section-heading">Weekly structure</p>' +
      '<div class="day-cards">' + weekHTML + '</div>' +

      '<p class="section-heading">Progression targets</p>' +
      '<div class="plan-card">' + progHTML + '</div>' +

      '<p class="section-heading">Bonus exercises</p>' +
      '<div class="plan-card">' + bonusHTML + '</div>' +

      '<p class="section-heading">Points system</p>' +
      '<div class="plan-card">' + pointsHTML + '</div>';

    showScreen(screen);
    showNav('plan');
  }

  function openSettings() {
    var screen = ensureScreen('settings-screen');
    var u = state.user || {};
    var pref = u.plankPreference || null;
    var reminderOn = !!u.reminderEnabled;
    var reminderTime = u.reminderTime || '07:00';
    var hasBio = !!u.biometricCredentialId;

    screen.innerHTML =
      '<h1 class="settings-title">SETTINGS</h1>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Reminders</p>' +
        '<div class="set-row">' +
          '<span class="set-label">Daily reminder</span>' +
          '<button type="button" class="toggle' + (reminderOn ? ' is-on' : '') +
            '" id="reminder-toggle" role="switch" aria-checked="' + reminderOn +
            '"><span class="toggle-knob"></span></button>' +
        '</div>' +
        '<label class="set-row">' +
          '<span class="set-label">Reminder time</span>' +
          '<input type="time" id="reminder-time" class="set-time" value="' + esc(reminderTime) + '" />' +
        '</label>' +
        '<button type="button" class="btn-forge" id="save-reminders">Save</button>' +
        '<p class="set-note">Reminders require the app to be installed on your home screen</p>' +
      '</section>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Plank Preference</p>' +
        '<div class="plank-opts">' +
          plankOption('forward', 'Forward Plank', 'Classic core hold, face down', pref) +
          plankOption('reverse', 'Reverse Plank', 'Posterior chain hold, face up', pref) +
        '</div>' +
      '</section>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Sign in</p>' +
        (hasBio
          ? '<button type="button" class="btn-outline set-bio-disable">Disable Face ID</button>'
          : '<button type="button" class="btn-outline set-bio-enable">Enable Face ID</button>') +
        '<p class="set-bio-msg message" role="status" aria-live="polite"></p>' +
      '</section>' +

      '<section class="profile-section">' +
        '<p class="section-heading">Account</p>' +
        '<div class="profile-stat"><span class="profile-stat-label">Name</span>' +
          '<span class="set-value">' + esc(u.name || '') + '</span></div>' +
        '<div class="profile-stat"><span class="profile-stat-label">Email</span>' +
          '<span class="set-value">' + esc(u.email || '') + '</span></div>' +
        '<button type="button" class="btn-link set-signout">Sign out</button>' +
      '</section>' +
      '<p class="message set-msg" role="status" aria-live="polite"></p>';

    var toggle = screen.querySelector('#reminder-toggle');
    toggle.addEventListener('click', function () {
      toggle.classList.toggle('is-on');
      toggle.setAttribute('aria-checked', toggle.classList.contains('is-on'));
    });

    screen.querySelector('#save-reminders').addEventListener('click', function () {
      var on = toggle.classList.contains('is-on');
      var time = screen.querySelector('#reminder-time').value || '07:00';
      state.user.reminderEnabled = on;
      state.user.reminderTime = time;
      db.collection('users').doc(state.user.id)
        .set({ reminderEnabled: on, reminderTime: time }, { merge: true })
        .then(function () { setMessage(screen.querySelector('.set-msg'), 'Reminders saved.'); })
        .catch(function (err) { setMessage(screen.querySelector('.set-msg'), friendlyError(err), true); });
    });

    Array.prototype.forEach.call(screen.querySelectorAll('[data-plank]'), function (btn) {
      btn.addEventListener('click', function () { setPlankPreference(btn.getAttribute('data-plank')); });
    });

    screen.querySelector('.set-signout').addEventListener('click', onSignOut);

    var bioMsg = screen.querySelector('.set-bio-msg');
    // Enable Face ID — register a platform credential against the user doc.
    var bioEnable = screen.querySelector('.set-bio-enable');
    if (bioEnable) {
      if (!webauthnSupported) {
        bioEnable.disabled = true;
        setMessage(bioMsg, 'Face ID is not supported on this device.', true);
      }
      bioEnable.addEventListener('click', function () {
        bioEnable.disabled = true;
        registerBiometric()
          .then(function () { openSettings(); }) // re-render → shows Disable
          .catch(function () { bioEnable.disabled = false; setMessage(bioMsg, 'Could not enable Face ID.', true); });
      });
    }
    // Disable Face ID — clear biometricCredentialId from the user doc.
    var bioDisable = screen.querySelector('.set-bio-disable');
    if (bioDisable) {
      bioDisable.addEventListener('click', function () {
        bioDisable.disabled = true;
        db.collection('users').doc(state.user.id)
          .set({ biometricCredentialId: firebase.firestore.FieldValue.delete() }, { merge: true })
          .then(function () { state.user.biometricCredentialId = null; openSettings(); })
          .catch(function () { bioDisable.disabled = false; setMessage(bioMsg, 'Could not disable Face ID.', true); });
      });
    }

    showScreen(screen);
    showNav('settings');
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
  // Message board (home screen) — squad row, live feed, post input
  // ===================================================================
  function avatarMarkup(name, sizeCls) {
    var photo = AVATARS[name];
    if (photo) return '<img class="' + sizeCls + '" src="' + photo + '" alt="">';
    return '<span class="' + sizeCls + ' avatar-ph">' +
             esc((name || '?').charAt(0).toUpperCase()) + '</span>';
  }

  function isAdmin() {
    return state.user && state.user.name === 'Mark';
  }

  function goDashboard() {
    renderDashboard();
  }

  // Detach board listeners — only on sign-out, never on normal navigation.
  function teardownBoard() {
    boardUnsubs.forEach(function (u) { try { u(); } catch (e) { /* no-op */ } });
    boardUnsubs = [];
    boardSubscribed = false;
  }

  function openBoard() {
    var screen = ensureScreen('board-screen');
    screen.innerHTML =
      '<h1 class="welcome">Welcome back, ' + esc(state.user ? state.user.name : 'Forger') + '</h1>' +
      '<p class="section-heading">Today\'s Squad</p>' +
      '<div id="squad-row" class="squad-row"></div>' +
      '<div id="board-feed" class="board-feed"></div>' +
      '<div class="board-input">' +
        '<input id="board-msg" type="text" maxlength="200" placeholder="Say something motivating..." />' +
        '<button type="button" class="btn-forge board-post">Post</button>' +
      '</div>';

    var input = screen.querySelector('#board-msg');
    var postBtn = screen.querySelector('.board-post');
    function post() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      db.collection('messages').add({
        userId: state.user.id,
        userName: state.user.name,
        message: text.slice(0, 200),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (err) { console.error('Failed to post message:', err); });
    }
    postBtn.addEventListener('click', post);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') post(); });

    addFire(postBtn);

    renderSquad();
    renderFeed();
    listenBoard();
    showScreen(screen);
    showNav('board');
  }

  function listenBoard() {
    // Subscribe only once per session — these live listeners persist across
    // screen changes so navigating back to the board does NOT re-read.
    if (boardSubscribed) return;
    boardSubscribed = true;
    // Squad completion: all logs across users for today (one collection-group query).
    boardUnsubs.push(
      db.collectionGroup('logs').where('date', '==', dateKey(new Date()))
        .onSnapshot(function (snap) {
          var byUser = {};
          snap.forEach(function (doc) {
            var d = doc.data();
            if (d.bonusExercise) return;
            var uid = doc.ref.parent.parent.id;
            (byUser[uid] = byUser[uid] || []).push(d.exercise);
          });
          squadStatus = byUser;
          renderSquad();
        }, function (err) { console.error('Squad listener failed:', err); })
    );

    boardUnsubs.push(
      db.collection('messages').orderBy('timestamp', 'desc').limit(40)
        .onSnapshot(function (snap) {
          boardMessages = snap.docs.map(function (d) {
            return Object.assign({ _id: d.id, _kind: 'message' }, d.data());
          });
          renderFeed();
        }, function (err) { console.error('Messages listener failed:', err); })
    );

    boardUnsubs.push(
      db.collection('activities').orderBy('timestamp', 'desc').limit(40)
        .onSnapshot(function (snap) {
          boardActivities = snap.docs.map(function (d) {
            return Object.assign({ _id: d.id, _kind: 'activity' }, d.data());
          });
          renderFeed();
        }, function (err) { console.error('Activities listener failed:', err); })
    );
  }

  function renderSquad() {
    var row = document.getElementById('squad-row');
    if (!row) return;
    var sched = todaySchedule();
    var isRest = sched.type === 'rest';

    row.innerHTML = TEAM.map(function (name) {
      var user = registeredUser(name);
      var ringClass, overlay = '';
      if (isRest) {
        ringClass = 'ring-rest';
        overlay = '<span class="squad-moon">🌙</span>';
      } else {
        var done = user && squadStatus[user.id] &&
          sched.active.every(function (k) { return squadStatus[user.id].indexOf(k) >= 0; });
        ringClass = done ? 'ring-complete' : 'ring-incomplete';
      }
      return '<div class="squad-item">' +
               '<div class="squad-ring ' + ringClass + '">' +
                 avatarMarkup(name, 'squad-avatar') + overlay +
               '</div>' +
               '<span class="squad-name">' + esc(name) + '</span>' +
             '</div>';
    }).join('');
  }

  function feedTime(ts) {
    if (!ts || !ts.toMillis) return 'now';
    var diff = Date.now() - ts.toMillis();
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  function tsMillis(e) {
    return e.timestamp && e.timestamp.toMillis ? e.timestamp.toMillis() : Date.now();
  }

  function renderFeed() {
    var feed = document.getElementById('board-feed');
    if (!feed) return;
    var entries = boardMessages.concat(boardActivities).sort(function (a, b) {
      return tsMillis(b) - tsMillis(a);
    }).slice(0, 40);

    feed.innerHTML = entries.map(function (e) {
      var del = isAdmin()
        ? '<button type="button" class="feed-del" data-del-kind="' + e._kind +
          '" data-del-id="' + e._id + '" aria-label="Delete">×</button>'
        : '';
      if (e._kind === 'activity') {
        var emoji = MOOD_EMOJI[e.mood] || '';
        var feedName = cleanName(e.userName);
        var reacts = (e.reactions || []).map(function (n) {
          return avatarMarkup(cleanName(n), 'react-avatar');
        }).join('');
        return '<div class="feed-card feed-activity">' +
                 avatarMarkup(feedName, 'mini-avatar') +
                 '<div class="feed-body">' +
                   '<p class="feed-text"><strong>' + esc(feedName) + '</strong> completed ' +
                     esc(e.exercise) + ' — ' + esc(e.repsCompleted || '') + ' ' + emoji + '</p>' +
                   (reacts ? '<div class="feed-reactions">' + reacts + '</div>' : '') +
                   '<span class="feed-time">' + feedTime(e.timestamp) + '</span>' +
                 '</div>' +
                 '<button type="button" class="react-btn" data-react="' + e._id + '">🎉</button>' +
                 del +
               '</div>';
      }
      var msgName = cleanName(e.userName);
      return '<div class="feed-card feed-message">' +
               avatarMarkup(msgName, 'mini-avatar') +
               '<div class="feed-body">' +
                 '<span class="feed-name">' + esc(msgName) + '</span>' +
                 '<p class="feed-text">' + esc(e.message || '') + '</p>' +
                 '<span class="feed-time">' + feedTime(e.timestamp) + '</span>' +
               '</div>' + del +
             '</div>';
    }).join('') || '<p class="feed-empty">No activity yet — be the first to post!</p>';

    Array.prototype.forEach.call(feed.querySelectorAll('[data-react]'), function (btn) {
      btn.addEventListener('click', function () {
        fireConfetti(btn);
        addReaction(btn.getAttribute('data-react'));
      });
    });
    Array.prototype.forEach.call(feed.querySelectorAll('[data-del-id]'), function (btn) {
      btn.addEventListener('click', function () {
        var coll = btn.getAttribute('data-del-kind') === 'activity' ? 'activities' : 'messages';
        db.collection(coll).doc(btn.getAttribute('data-del-id')).delete()
          .catch(function (err) { console.error('Failed to delete:', err); });
      });
    });
  }

  function addReaction(activityId) {
    db.collection('activities').doc(activityId).update({
      reactions: firebase.firestore.FieldValue.arrayUnion(state.user.name)
    }).catch(function (err) { console.error('Failed to react:', err); });
  }

  function fireConfetti(originEl) {
    var rect = originEl.getBoundingClientRect();
    var colors = ['#E8621A', '#F5F0E8', '#27AE60', '#ffffff'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = (rect.left + rect.width / 2) + 'px';
      p.style.top = (rect.top + rect.height / 2) + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 220) + 'px');
      p.style.setProperty('--dy', (-(Math.random() * 180 + 60)) + 'px');
      document.body.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 900); })(p);
    }
  }

  function onSignOut() {
    teardownBoard();
    devForceFriday = false;
    clearForgeUser();      // remove the local identity (keep forgeLastAvatar)
    state.user = null;
    state.logs = [];
    var last = window.localStorage.getItem(FORGE_LAST_AVATAR_KEY);
    if (last) setIndexByName(last); // carousel still defaults to them
    showLoginEntry();
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
    if (DEV_MODE && devFridayBtn) {
      devFridayBtn.classList.remove('hidden');
      devFridayBtn.addEventListener('click', devFridayLogin);
    }

    if (installBtn) installBtn.addEventListener('click', openInstall);

    addFire(forgeBtn);
    addFire(installBtn);

    buildNav();       // one persistent top nav, reused across screens
    renderCarousel(); // static team list — independent of Firestore

    // Swipe-only navigation (arrow buttons removed); arrow keys still work.
    carousel.addEventListener('touchstart', onTouchStart, { passive: true });
    carousel.addEventListener('touchend', onTouchEnd, { passive: true });
    // Left/right arrow keys drive the carousel while the login screen is shown.
    document.addEventListener('keydown', function (e) {
      if (!loginScreen.classList.contains('hidden') &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        onCarouselKey(e);
      }
    });

    // No Firebase auth — identity lives in localStorage. Load the users list,
    // then either resume the stored identity straight into the app or show the
    // login carousel (centred on the last avatar to sign in here).
    loadUsers().then(function () {
      var identity = getForgeUser();
      if (identity && identity.uid) {
        enterApp(identity);
      } else {
        showLoginEntry();
      }
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
