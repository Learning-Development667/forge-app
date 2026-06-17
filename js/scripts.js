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
  const DEV_MODE = false;

  // ---- Constants ----------------------------------------------------
  var MAX_USERS = 10;
  // Local identity: { uid, name, email, avatar } stored as JSON.
  var FORGE_USER_KEY = 'forgeUser';
  // Name of the last user to sign in on this device — centres the carousel.
  var FORGE_LAST_AVATAR_KEY = 'forgeLastAvatar';
  // First-login onboarding seen flag.
  var ONBOARDING_KEY = 'forgeOnboardingSeen';
  // Date (YYYY-MM-DD) the daily motivation pop-up was last shown on this device.
  var DAILY_QUOTE_KEY = 'forgeDailyQuoteDate';

  // Fallback motivational quotes for the daily pop-up when the ZenQuotes API is
  // unreachable. One is chosen by day-of-year so it stays stable all day.
  var DAILY_FALLBACK_QUOTES = [
    'The pain you feel today will be the strength you feel tomorrow.',
    'It never gets easier, you just get stronger.',
    "Your body can stand almost anything. It's your mind you have to convince.",
    'Success is the sum of small efforts repeated day in and day out.',
    "Don't stop when you're tired. Stop when you're done.",
    "The only bad workout is the one that didn't happen.",
    'Strength does not come from the body. It comes from the will of the soul.',
    'Push yourself because no one else is going to do it for you.',
    'Wake up with determination. Go to bed with satisfaction.',
    "The harder you work for something the greater you'll feel when you achieve it."
  ];

  // Default onboarding cards (overridden by the Firestore notices/onboarding doc
  // if it exists — see loadOnboarding). Card 6 carries the "Let's Forge" CTA.
  var ONBOARDING_DEFAULT = [
    { heading: 'Welcome to Forge', body: '90 days. Built together. This is your squad’s fitness challenge — press-ups, sit-ups, plank and lunges, every day, getting stronger together.' },
    { heading: 'How It Works', body: 'Each day you’ll see your exercises and targets. Complete them and log how it felt. If you gave it a go but couldn’t finish, tap Attempted — it still counts and the squad will cheer you on. Miss a day entirely? No problem — just keep going.' },
    { heading: 'Scoring', body: 'Log any exercise: +10 points. Complete all due exercises: +25 bonus. Friday Best Effort (all 4): +50 bonus. 7-day streak: +100. 30-day streak: +500. Bonus spin: +20.' },
    { heading: 'The Squad', body: 'You’re not doing this alone. Check the message board to see what your squad is up to, post messages, and cheer each other on with the confetti button.' },
    { heading: 'Best Effort Friday', body: 'Every Friday is Best Effort day — all four exercises, maximum effort. No targets, just give everything you’ve got. You’ll see your own numbers and the squad average — but your individual scores are private. Only you can see how many reps you did.' },
    { heading: 'Let’s Go', body: 'The challenge starts 23 June 2026. Points count from Day 1. Your squad is ready. Are you?' }
  ];
  var onboardingCards = ONBOARDING_DEFAULT.slice(); // current content (Firestore may override)

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

  var MOODS = ['Crushed it', 'Felt good', 'Got through it', 'Struggled', 'Gave it a go'];

  var MOOD_EMOJI = {
    'Crushed it': '💪',
    'Felt good': '😊',
    'Got through it': '😅',
    'Struggled': '😬',
    'Gave it a go': '👌'
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
    // Gave it a go — dashed incomplete circle (a circle with a gap)
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="16" stroke-dasharray="80 28"/></svg>'
  ];

  // One-tap mood buttons on the exercise cards. `mood` matches the MOODS array
  // (so the feed icon/label stays consistent); `label` is the on-card caption.
  var MOOD_BUTTONS = [
    { mood: 'Crushed it', label: 'CRUSHED IT',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2"/></svg>' },
    { mood: 'Felt good', label: 'GOOD',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>' },
    { mood: 'Got through it', label: 'STEADY',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>' },
    { mood: 'Struggled', label: 'STRUGGLED',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>' },
    { mood: 'Gave it a go', label: 'ATTEMPTED',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/></svg>' }
  ];

  // Non-timed exercise (Press-ups / Sit-ups / Lunges) card flow:
  //   ready → in-progress (motivation → mood buttons) → complete.
  // State persists per exercise for the current day so re-renders keep STATE 2.
  var cardStates = {};       // exKey -> 'progress' (ready = absent, complete = isLogged)
  var cardStatesDate = null; // resets the store when the day rolls over
  var MOTIVATION = [
    "You've got this!",
    "Let's go! Give it everything.",
    "Time to earn those points.",
    "The squad is counting on you.",
    "Make it count."
  ];
  var GREEN_CHECK = '<svg class="card-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

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

  // Firebase Storage holds post-workout mood photos. Guarded so a missing or
  // mismatched Storage SDK can never break the rest of the app.
  // Storage security rules — paste into Firebase console → Storage → Rules:
  //   rules_version = '2';
  //   service firebase.storage {
  //     match /b/{bucket}/o {
  //       match /{allPaths=**} {
  //         allow read, write: if true;
  //       }
  //     }
  //   }
  var storage = null;
  try { storage = firebase.storage(); }
  catch (e) { console.error('Firebase Storage init failed:', e); }

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

  // Return to the login carousel, centred on the given avatar.
  function backToCarousel(name) {
    setMessage(loginMessage, '');
    showScreen(loginScreen);
    if (name) setIndexByName(name);
  }

  // First time on this device for a known user: offer Face ID enrolment.
  // Skip is ONLY offered if this device has previously signed in as this person
  // (forgeLastAvatar matches) — otherwise anyone could tap an avatar and skip
  // straight in. Without a match, the only options are Enable Face ID or Back.
  function showEnableFaceId(identity) {
    // registerBiometric reads state.user for the doc id + name.
    state.user = { id: identity.uid, name: identity.name, email: '', avatar: identity.avatar || null };
    var allowSkip = window.localStorage.getItem(FORGE_LAST_AVATAR_KEY) === identity.name;
    var screen = ensureScreen('faceid-screen');
    screen.innerHTML =
      '<header class="brand brand--compact"><h1 class="brand-name">FORGE</h1></header>' +
      '<div class="lock-id">' + avatarMarkup(identity.name, 'lock-avatar') +
        '<p class="lock-name">' + esc(identity.name) + '</p></div>' +
      '<p class="pin-subtext">Enable Face ID to sign in as ' + esc(identity.name) + '</p>' +
      '<button type="button" class="btn-forge faceid-enable">Enable Face ID</button>' +
      (allowSkip
        ? '<button type="button" class="btn-link faceid-skip">Skip</button>'
        : '<button type="button" class="btn-link faceid-back">Back</button>') +
      '<p class="pin-error message" role="status" aria-live="polite"></p>';
    showScreen(screen);
    var enableBtn = screen.querySelector('.faceid-enable');
    enableBtn.addEventListener('click', function () {
      if (!webauthnSupported) { showBiometricFallback(identity); return; } // no WebAuthn → confirm fallback
      enableBtn.disabled = true;
      registerBiometric()
        .then(function () { finishLogin(identity); })
        .catch(function () {
          // Enrolment cancelled/failed. A known returning user (Skip allowed)
          // may proceed; otherwise WebAuthn genuinely failed here (e.g. a desktop
          // with no biometrics) — offer the non-biometric fallback rather than
          // locking the user out behind a dead-end retry.
          if (allowSkip) { finishLogin(identity); return; }
          showBiometricFallback(identity);
        });
    });
    var skipBtn = screen.querySelector('.faceid-skip');
    if (skipBtn) skipBtn.addEventListener('click', function () { finishLogin(identity); });
    var backBtn = screen.querySelector('.faceid-back');
    if (backBtn) backBtn.addEventListener('click', function () { backToCarousel(identity.name); });
    addFire(enableBtn);
  }

  // A user with a stored credential that isn't on THIS device (different device
  // or cleared credentials). Offer to enrol Face ID here instead of a misleading
  // "wrong face" message.
  function showFaceIdNotSetUp(identity) {
    state.user = { id: identity.uid, name: identity.name, email: '', avatar: identity.avatar || null };
    var screen = ensureScreen('faceid-setup-screen');
    screen.innerHTML =
      '<header class="brand brand--compact"><h1 class="brand-name">FORGE</h1></header>' +
      '<div class="lock-id">' + avatarMarkup(identity.name, 'lock-avatar') +
        '<p class="lock-name">' + esc(identity.name) + '</p></div>' +
      '<p class="pin-subtext">Face ID not set up on this device. Are you ' + esc(identity.name) + '?</p>' +
      '<button type="button" class="btn-forge faceid-setup-yes">Yes, set up Face ID</button>' +
      '<button type="button" class="btn-link faceid-setup-no">Not me</button>' +
      '<p class="pin-error message" role="status" aria-live="polite"></p>';
    showScreen(screen);
    var yesBtn = screen.querySelector('.faceid-setup-yes');
    yesBtn.addEventListener('click', function () {
      if (!webauthnSupported) { showBiometricFallback(identity); return; }
      yesBtn.disabled = true;
      registerBiometric() // creates a new credential + updates biometricCredentialId
        .then(function () { finishLogin(identity); })
        .catch(function () {
          // Registration genuinely failed (no platform authenticator / Windows
          // Hello unavailable). Offer the non-biometric fallback rather than a
          // dead-end retry that would lock the user out.
          showBiometricFallback(identity);
        });
    });
    screen.querySelector('.faceid-setup-no').addEventListener('click', function () { backToCarousel(identity.name); });
    addFire(yesBtn);
  }

  // Non-biometric fallback: shown only when WebAuthn genuinely fails or is
  // unsupported on this device (never on devices where biometrics work). Lets a
  // recognised user confirm and sign in directly instead of being locked out.
  function showBiometricFallback(identity) {
    state.user = { id: identity.uid, name: identity.name, email: '', avatar: identity.avatar || null };
    var screen = ensureScreen('biometric-fallback-screen');
    screen.innerHTML =
      '<header class="brand brand--compact"><h1 class="brand-name">FORGE</h1></header>' +
      '<div class="lock-id">' + avatarMarkup(identity.name, 'lock-avatar') +
        '<p class="lock-name">' + esc(identity.name) + '</p></div>' +
      '<p class="pin-subtext">Biometrics not available on this device.</p>' +
      '<button type="button" class="btn-forge bio-fallback-yes">That\'s me — continue</button>' +
      '<button type="button" class="btn-link bio-fallback-no">Not me</button>';
    showScreen(screen);
    var yesBtn = screen.querySelector('.bio-fallback-yes');
    yesBtn.addEventListener('click', function () { finishLogin(identity); }); // stores forgeLastAvatar
    screen.querySelector('.bio-fallback-no').addEventListener('click', function () { backToCarousel(identity.name); });
    addFire(yesBtn);
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
  var plankTimerActive = false; // true while the best-effort/plank countdown runs

  // Message board real-time state.
  var boardUnsubs = [];
  var boardSubscribed = false; // listeners attached once, kept alive for session
  var boardMessages = [];
  var boardActivities = [];
  var squadStatus = {}; // userId -> [logged exercise keys today]
  var boardSubtitleTimer = null; // rotating Messages-header subtitle interval
  var seenFeedIds = new Set(); // feed item ids already rendered — only new ones animate

  // ===================================================================
  // Screen helpers
  // ===================================================================
  function showScreen(screen) {
    plankTimerActive = false; // leaving any screen ends the timer context
    if (typeof drainCheerQueue === 'function') drainCheerQueue(); // show cheers queued during the timer
    // Leaving the Forge Card detaches its 3D tilt listeners.
    if (typeof teardownFcardTilt === 'function' && (!screen || screen.id !== 'forgecard-screen')) teardownFcardTilt();
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
    // Progress-screen streak fire sits in a tiny 40px canvas — cap the flame
    // size so it reads as a flame rather than a zoomed-in blob.
    var isStreak = !!(canvas.classList && canvas.classList.contains('prog-streak-fire'));

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
      p.size = isStreak ? rand(2, 5) : (isLog ? rand(3, 8) : rand(8, 18)); // smaller flames on Log/streak
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
    { key: 'forgecard', label: 'Forge Card',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="11" r="1.6"/><line x1="13" y1="10" x2="18" y2="10"/><line x1="13" y1="13.5" x2="18" y2="13.5"/><line x1="6" y1="15" x2="11" y2="15"/></svg>' },
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
    // iOS: request motion permission synchronously at the very start of the tap
    // handler (no awaits/timeouts before it) so it counts as a direct user
    // gesture. This is the ONLY place requestPermission is called.
    if (dest === 'forgecard' &&
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // The flip may have already finished (setupFcardTilt ran with the flag
      // still false) — re-attach now if the card screen is still visible.
      var attachTiltIfVisible = function () {
        var fcScreen = document.getElementById('forgecard-screen');
        var fcCard = fcScreen && fcScreen.querySelector('.fcard');
        if (fcardMotionGranted && fcScreen && !fcScreen.classList.contains('hidden') && fcCard) {
          setupFcardTilt(fcCard);
        }
      };
      var cached = false;
      try { cached = window.localStorage && localStorage.getItem('forgeMotionGranted') === 'true'; } catch (e) {}
      if (cached) {
        // Granted in a previous session — skip the prompt (only ever shows once).
        fcardMotionGranted = true;
        attachTiltIfVisible();
      } else {
        DeviceOrientationEvent.requestPermission()
          .then(function (result) {
            fcardMotionGranted = result === 'granted';
            if (fcardMotionGranted) {
              try { localStorage.setItem('forgeMotionGranted', 'true'); } catch (e) {}
            }
            attachTiltIfVisible();
          })
          .catch(function () {});
      }
    }
    // Board listeners persist across navigation (subscribed once) to avoid
    // re-reading on every visit.
    if (dest === 'board') openBoard();
    else if (dest === 'exercises') renderDashboard();
    else if (dest === 'progress') openProgress();
    else if (dest === 'plan') openPlan();
    else if (dest === 'forgecard') openForgeCard();
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
  // Plank countdown: short sharp 880Hz beep each of the final seconds, and a
  // longer 1046Hz success tone on the last second.
  function soundPlankBeep() { playTone(880, 0.08, 'square', 0.4); }
  function soundPlankDone() { playTone(1046, 0.3, 'sine', 0.5); }

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

      // Per-exercise points: bonus spin = 20, "Gave it a go" = 5, otherwise 10.
      dayLogs.forEach(function (l) {
        points += l.bonusExercise ? 20 : (l.mood === 'Gave it a go' ? 5 : 10);
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

    // Avatar sits in a ring wrapper (rotating laser on the centred card,
    // a subtle grey ring otherwise — purely presentational).
    var ring = document.createElement('div');
    ring.className = 'ucard-avatar-ring';
    if (isRegister) {
      var plus = document.createElement('span');
      plus.className = 'ucard-avatar ucard-avatar--register';
      plus.textContent = '+';
      ring.appendChild(plus);
    } else if (avatar) {
      var img = document.createElement('img');
      img.className = 'ucard-avatar';
      img.src = avatar;
      img.alt = '';
      ring.appendChild(img);
    } else {
      var ph = document.createElement('span');
      ph.className = 'ucard-avatar ucard-avatar--placeholder';
      ph.textContent = name.charAt(0).toUpperCase();
      ring.appendChild(ph);
    }
    inner.appendChild(ring);

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

  // Merge Firestore-registered users (e.g. added via the Admin Panel) into the
  // in-memory TEAM + AVATARS so they persist in the carousel across reloads. The
  // hardcoded TEAM/AVATARS remain the fallback if the query fails.
  function loadTeamFromFirestore() {
    return db.collection('users').orderBy('joinedAt').get()
      .then(function (snap) {
        snap.forEach(function (doc) {
          var data = doc.data() || {};
          var name = cleanName(data.name, data.email);
          if (!name) return;
          // Only add a name that isn't already in TEAM (case-insensitive), so a
          // duplicate Firestore doc never adds a second carousel/squad entry.
          var exists = TEAM.some(function (n) { return n.toLowerCase() === name.toLowerCase(); });
          if (!exists) TEAM.push(name);
          if (data.avatar) {
            var av = String(data.avatar);
            AVATARS[name] = av.indexOf('/') >= 0 ? av : 'images/' + av;
          }
        });
        renderCarousel(); // re-render to reflect the current squad
      })
      .catch(function (err) {
        // Keep the hardcoded TEAM as the fallback.
        console.error('Failed to load team from Firestore:', err);
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
        // This device can't do WebAuthn at all (e.g. desktop without Windows
        // Hello) → skip the verify attempt and offer the non-biometric fallback.
        if (!webauthnSupported) { showBiometricFallback(identity); return; }
        // Stored credential — verify Face ID on this device.
        authBiometric(existing.biometricCredentialId)
          .then(function (cred) {
            if (!cred) { showFaceIdNotSetUp(identity); return; }
            finishLogin(identity);
          })
          .catch(function () {
            // NotAllowedError / null → the credential isn't on this device (or
            // the check failed). Offer to set Face ID up here rather than a
            // misleading "wrong face" message.
            showFaceIdNotSetUp(identity);
          });
      } else {
        // No credential anywhere yet — offer Face ID enrolment.
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
      .then(function () {
        startCheerListener(); // real-time cheer pop-ups
        // First login on this device → show the onboarding before the dashboard.
        if (!window.localStorage.getItem(ONBOARDING_KEY)) {
          showOnboarding({ fromSettings: false });
        } else {
          enterHome();
        }
        scheduleDailyQuote(); // once-per-day motivation pop-up, after a short delay
      })
      .catch(function (err) {
        console.error('Failed to enter app:', err);
        enterHome();
        scheduleDailyQuote();
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

  function saveLog(exKey, repsCompleted, target, mood, isBestEffort, bonusExercise, plankDuration) {
    var sched = todaySchedule();
    var wasComplete = allDueLoggedToday(sched); // before this log
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
    if (plankDuration != null) entry.plankDuration = plankDuration; // seconds held (Friday plank)
    return db.collection('users').doc(state.user.id).collection('logs').add(entry)
      .then(function (ref) {
        entry._id = ref.id;
        state.logs.push(entry);
        // Individual logs no longer post to the feed. Post ONE consolidated
        // activity only when this log completes all of today's due exercises.
        if (!wasComplete && allDueLoggedToday(sched)) {
          writeSessionComplete(sched);
        }
        return refreshStats();
      });
  }

  // One consolidated "session complete" activity for the message board. The mood
  // shown is the average of every (non-bonus) mood logged today.
  function writeSessionComplete(sched) {
    var todays = todayLogs().filter(function (l) { return !l.bonusExercise; });
    var bestEffort = sched.type === 'besteffort';
    var anyAttempted = todays.some(function (l) { return l.mood === 'Gave it a go'; });
    var message = bestEffort
      ? state.user.name + ' gave it everything on Best Effort Friday 🔥'
      : (anyAttempted
          ? state.user.name + ' gave it a go today'
          : state.user.name + " crushed today's session 💪");
    db.collection('activities').add({
      userId: state.user.id,
      userName: state.user.name,
      kind: 'session',
      message: message,
      mood: avgMoodLabel(todays), // label → matching icon in the feed
      reactions: [],
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function (ref) {
      // Offer a post-workout mood photo immediately on session complete.
      showCameraPrompt(ref.id);
    }).catch(function (err) { console.error('Failed to write activity:', err); });
  }

  // ===================================================================
  // Dashboard
  // ===================================================================
  // Simple geometric exercise icons for the dashboard cards (decorative).
  var EXERCISE_ICONS = {
    pressups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="8" r="1.8"/><path d="M6.2 8.7l8.8 1.8"/><path d="M15 10.5l4 .6"/><path d="M8.5 10l-.6 4M12.5 10.9l-.4 3.6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    situps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6.5" r="1.8"/><path d="M8 7.6l4.5 6.4"/><path d="M12.5 14h6"/><path d="M18.5 14l-3-4"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    plank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.8" cy="9" r="1.8"/><line x1="6.4" y1="9.6" x2="19" y2="13.6"/><line x1="6.8" y1="10.2" x2="6" y2="15"/><line x1="19" y1="13.6" x2="20.4" y2="14.6"/><line x1="3" y1="16" x2="21" y2="16"/></svg>',
    lunges: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4.5" r="1.8"/><path d="M11 6.3v6"/><path d="M11 12.3L7 19"/><path d="M11 12.3l4 3v3.5"/><line x1="4" y1="20" x2="20" y2="20"/></svg>'
  };

  function renderDashboard() {
    var today = new Date();
    var day = challengeDay(today);
    var sched = todaySchedule();
    var routine = todayRoutine();

    // Reset the per-card state store when the day rolls over.
    var todayKey = dateKey(today);
    if (cardStatesDate !== todayKey) { cardStates = {}; cardStatesDate = todayKey; }

    var dayNum = day < 1 ? 0 : (day > TOTAL_DAYS ? TOTAL_DAYS : day);
    var weekNum = day < 1 ? 0 : Math.min(weekNumber(Math.min(day, TOTAL_DAYS)), TOTAL_WEEKS);
    var streakVal = state.user ? (state.user.currentStreak || 0) : 0;
    var pointsVal = state.user ? (state.user.totalPoints || 0) : 0;

    var DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
    var dowName = DOW[today.getDay()];
    var dateStr = today.getDate() + ' ' + MONTHS[today.getMonth()] + ' ' + today.getFullYear();

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
      body = '<div class="cards' + (allDueLoggedToday(sched) ? ' cards--deck' : '') + '">' + ORDER.map(function (k) {
        return cardHTML(k, sched, day);
      }).join('') + '</div>';
    }

    var allDone = sched.type !== 'rest' && allDueLoggedToday(sched);
    var showIntro = !!(state.user && !state.user.introSeen);

    var html =
      '<header class="topbar">' +
        '<span class="topbar-brand">FORGE</span>' +
      '</header>' +

      (showIntro
        ? '<div class="intro-note">New to Forge? Tap the info icon on each exercise to check your form before you start.</div>'
        : '') +

      (banner ? '<div class="banner">' + esc(banner) + '</div>' : '') +

      // Stats hero row — animated counters; ember glow + small fire under STREAK.
      '<section class="dash-stats">' +
        '<div class="dash-stat">' +
          '<span class="dash-num"><span data-count="' + dayNum + '" data-dur="600">0</span>' +
            '<span class="dash-sub">/' + TOTAL_DAYS + '</span></span>' +
          '<span class="dash-label">DAY</span>' +
        '</div>' +
        '<div class="dash-stat">' +
          '<span class="dash-num"><span data-count="' + weekNum + '" data-dur="700">0</span>' +
            '<span class="dash-sub">/' + TOTAL_WEEKS + '</span></span>' +
          '<span class="dash-label">WEEK</span>' +
        '</div>' +
        '<div class="dash-stat dash-stat--streak">' +
          '<span class="dash-num" data-count="' + streakVal + '" data-dur="800">0</span>' +
          '<canvas class="dash-fire prog-streak-fire"></canvas>' +
          '<span class="dash-label">STREAK</span>' +
        '</div>' +
        '<div class="dash-stat">' +
          '<span class="dash-num" data-count="' + pointsVal + '" data-dur="1000">0</span>' +
          '<span class="dash-label">POINTS</span>' +
        '</div>' +
      '</section>' +

      (routine ? '<button type="button" class="btn-outline forge-laser" data-action="warmup">Warm Up</button>' : '') +

      // Training section header — day + date + animated underline.
      '<div class="dash-trainhead">' +
        '<h2 class="dash-trainhead-day">' + esc(dowName) + '</h2>' +
        '<p class="dash-trainhead-date">' + esc(dateStr) + '</p>' +
        (sched.type === 'besteffort'
          ? '<p class="dash-trainhead-be">Best Effort · 2 min each</p>' : '') +
        '<span class="dash-trainhead-rule"></span>' +
      '</div>' +

      body +

      bonusSpinHTML() +

      (allDone ? '<div class="dash-alldone">ALL DONE TODAY! 💪</div>' : '') +

      (routine ? '<button type="button" class="btn-outline forge-laser" data-action="cooldown">Cool Down</button>' : '');

    dashboardScreen.innerHTML = html;
    wireDashboard();
    showScreen(dashboardScreen);
    showNav('exercises');
    // Counters + streak fire trigger once the dashboard is visible.
    requestAnimationFrame(function () { runDashboardAnimations(dashboardScreen); });
    if (showIntro) markIntroSeen(); // one-time note; gone on next render
  }

  // Animate the four stat counters up from 0 and start the small streak fire.
  function runDashboardAnimations(screen) {
    Array.prototype.forEach.call(screen.querySelectorAll('.dash-stats [data-count]'), function (el) {
      animateCount(el, Number(el.getAttribute('data-count')), Number(el.getAttribute('data-dur')));
    });
    var fire = screen.querySelector('.dash-fire');
    if (fire) startFire(fire); // capped particle size via the prog-streak-fire class
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

  // Bonus spin is once per day: a live "Bonus Spin" button, or a greyed
  // "Spin Used" button (still opens the overlay to review today's result).
  function bonusSpinHTML() {
    if (todaysBonusLog()) {
      return '<button type="button" class="btn-forge btn-spin btn-spin--used" data-action="spin">★ Spin Used</button>';
    }
    return '<button type="button" class="btn-forge btn-spin" data-action="spin">★ Bonus Spin</button>';
  }

  // The mood logged for an exercise today (or null if not logged yet).
  function loggedMood(exKey) {
    var l = todayLogs().filter(function (x) { return x.exercise === exKey && !x.bonusExercise; })[0];
    return l ? l.mood : null;
  }

  // The five inline mood buttons for an exercise. showHint adds the STATE 2 hint.
  function moodRowHTML(exKey, selMood, logged, showHint) {
    return '<div class="card-moods">' +
        '<p class="card-moods-label">HOW DID IT FEEL?</p>' +
        (showHint ? '<p class="card-moods-hint">Couldn\'t finish? Tap Attempted.</p>' : '') +
        '<div class="card-moods-row">' +
          MOOD_BUTTONS.map(function (m) {
            var attemptedCls = m.mood === 'Gave it a go' ? ' mood-btn--attempted' : '';
            return '<button type="button" class="mood-btn' + attemptedCls + (selMood === m.mood ? ' is-selected' : '') + '"' +
              (logged ? ' disabled' : '') + ' data-mood-ex="' + exKey + '" data-mood="' + esc(m.mood) +
              '" aria-label="' + esc(m.label) + '">' +
              '<span class="mood-btn-circle">' + m.icon + '</span>' +
              '<span class="mood-btn-label">' + esc(m.label) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function cardHTML(exKey, sched, day) {
    var ex = EXERCISES[exKey];
    var isRest = sched.rest === exKey;
    var isActive = sched.active.indexOf(exKey) >= 0;
    var logged = isLogged(exKey);
    var target = targetFor(ex, day);
    var bestEffort = sched.type === 'besteffort';
    var isPlank = exKey === 'plank';
    // The new READY → IN-PROGRESS → COMPLETE flow is for non-timed regular-day
    // exercises only (Press-ups, Sit-ups, Lunges). Plank and Best Effort Friday
    // are untouched.
    var nonTimed = isActive && !isRest && !bestEffort && !isPlank;
    var plankRegular = isActive && !isRest && !bestEffort && isPlank;

    // Right-hand action slot: rest badge / Best Effort start or tick.
    var statusEl = '';
    if (isRest) {
      statusEl = '<span class="badge badge-rest">REST</span>';
    } else if (bestEffort && logged) {
      statusEl = '<span class="tick" aria-label="Logged">✓</span>';
    } else if (bestEffort && isActive) {
      statusEl = '<button type="button" class="btn-log" data-log="' + exKey + '" data-best="1">Start</button>';
    }

    var infoBtn = isRest ? '' :
      '<button type="button" class="card-info-btn" data-info="' + exKey + '" aria-label="Form guide">i</button>';

    // Logged: non-timed cards get a green checkmark SVG; plank/Best Effort keep ✓.
    var checkPrefix = '';
    if (logged) {
      checkPrefix = nonTimed
        ? '<span class="card-check">' + GREEN_CHECK + '</span> '
        : '<span class="card-check">✓</span> ';
    }

    // The below-the-row state block.
    var stateHtml = '', classExtra = '';
    if (plankRegular) {
      // Plank keeps its current direct mood buttons (unchanged).
      stateHtml = '<div class="card-state">' + moodRowHTML(exKey, logged ? loggedMood(exKey) : null, logged) +
        (logged ? '<p class="card-logged">Logged</p>' : '') + '</div>';
    } else if (nonTimed) {
      classExtra = ' card-nontimed';
      if (logged) {
        classExtra += ' card-done';
        stateHtml = '<div class="card-state">' + moodRowHTML(exKey, loggedMood(exKey), true) +
          '<p class="card-logged">Logged</p></div>';
      } else if (cardStates[exKey] === 'progress') {
        classExtra += ' is-progress';
        stateHtml = '<div class="card-state">' + moodRowHTML(exKey, null, false, true) + '</div>';
      } else {
        stateHtml = '<div class="card-state">' +
          '<button type="button" class="card-start forge-laser" data-start="' + exKey + '">START</button></div>';
      }
    }

    return '<div class="card' + (isRest ? ' card-rest' : '') + ((logged && !nonTimed) ? ' card-done' : '') + classExtra + '">' +
             '<div class="card-main">' +
               '<span class="card-icon">' + (EXERCISE_ICONS[exKey] || '') + '</span>' +
               '<div class="card-info">' +
                 '<div class="card-name-row">' +
                   '<h3 class="card-name">' + checkPrefix + ex.name + '</h3>' + infoBtn +
                 '</div>' +
                 '<p class="card-target">' +
                   (isRest ? 'Rest day for this one' :
                     (bestEffort ? 'Max effort · 2:00' : formatTarget(ex, target))) +
                 '</p>' +
               '</div>' +
               (statusEl ? '<div class="card-action">' + statusEl + '</div>' : '') +
             '</div>' +
             stateHtml +
           '</div>';
  }

  function wireDashboard() {
    // Random start point for the laser elements (Warm Up / Cool Down buttons).
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('.forge-laser'), staggerLaser);
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-log]'), function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-log');
        var best = btn.getAttribute('data-best') === '1';
        // Plank shows its dedicated timer first; other exercises log directly.
        if (k === 'plank') openPlankTimer(best);
        else openLogScreen(k, best, false);
      });
      addFire(btn);
    });
    // Non-timed START buttons → in-progress flow.
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-start]'), function (btn) {
      btn.addEventListener('click', function () { startExercise(btn, btn.getAttribute('data-start')); });
    });
    // Mood buttons (plank + non-timed in-progress/complete) log on tap.
    wireMoodButtons(dashboardScreen);
    Array.prototype.forEach.call(dashboardScreen.querySelectorAll('[data-info]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-info');
        openFormGuide(EXERCISES[key].name, key, renderDashboard, renderDashboard);
      });
    });
    var spin = dashboardScreen.querySelector('[data-action="spin"]');
    if (spin) {
      spin.addEventListener('click', openSpin);
      if (!spin.classList.contains('btn-spin--used')) addFire(spin); // no fire on the greyed state
    }

    var warm = dashboardScreen.querySelector('[data-action="warmup"]');
    if (warm) warm.addEventListener('click', function () { openRoutineScreen('warmup'); });
    var cool = dashboardScreen.querySelector('[data-action="cooldown"]');
    if (cool) cool.addEventListener('click', function () { openRoutineScreen('cooldown'); });
  }

  // Wire any not-yet-wired mood buttons within a scope (re-render + dynamic insert).
  function wireMoodButtons(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-mood-ex]'), function (btn) {
      if (btn._moodWired) return;
      btn._moodWired = true;
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        logMoodTap(btn, btn.getAttribute('data-mood-ex'), btn.getAttribute('data-mood'));
      });
    });
  }

  // Non-timed READY → IN-PROGRESS: fade START out, show a motivational line for
  // 1.5s, then slide the mood buttons up. State is recorded so a re-render keeps
  // STATE 2 (mood buttons) rather than reverting to the START button.
  function startExercise(btn, exKey) {
    cardStates[exKey] = 'progress';
    var card = btn.closest && btn.closest('.card');
    if (!card) return;
    var stateEl = card.querySelector('.card-state');
    card.classList.add('is-progress');
    btn.classList.add('is-fading');
    setTimeout(function () {
      if (!card.isConnected || !stateEl.isConnected) return;
      var msg = MOTIVATION[Math.floor(Math.random() * MOTIVATION.length)];
      stateEl.innerHTML = '<p class="card-motivation">' + esc(msg) + '</p>';
      var msgEl = stateEl.querySelector('.card-motivation');
      requestAnimationFrame(function () { msgEl.classList.add('is-in'); });
      setTimeout(function () {
        if (!card.isConnected || !stateEl.isConnected) return;
        msgEl.classList.remove('is-in'); // fade out
        setTimeout(function () {
          if (!card.isConnected || !stateEl.isConnected) return;
          stateEl.innerHTML = moodRowHTML(exKey, null, false, true);
          var moods = stateEl.querySelector('.card-moods');
          moods.classList.add('card-moods--slide');
          requestAnimationFrame(function () { moods.classList.add('is-in'); });
          wireMoodButtons(card);
        }, 250);
      }, 1500);
    }, 200);
  }

  // One-tap mood log: visual feedback (fill, spring, burst, card pulse) then
  // saveLog. saveLog fires writeSessionComplete when the day's last exercise lands.
  function logMoodTap(btn, exKey, mood) {
    btn.classList.add('is-selected', 'tapped');
    moodBurst(btn);
    var card = btn.closest && btn.closest('.card');
    if (card) {
      card.classList.remove('card-tap'); void card.offsetWidth; card.classList.add('card-tap');
      Array.prototype.forEach.call(card.querySelectorAll('.mood-btn'), function (b) { b.disabled = true; });
    }
    var target = targetFor(EXERCISES[exKey], challengeDay(new Date()));
    saveLog(exKey, target, target, mood, false).then(renderDashboard).catch(renderDashboard);
  }

  // Small, fast orange particle burst from a button centre (tap feedback).
  function moodBurst(el) {
    var rect = el.getBoundingClientRect();
    var size = 60;
    var canvas = document.createElement('canvas');
    canvas.className = 'mood-burst';
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
    canvas.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    ctx.scale(dpr, dpr);
    var parts = [];
    var n = 15;
    for (var i = 0; i < n; i++) {
      var ang = (Math.PI * 2) * (i / n) + Math.random() * 0.4;
      var spd = 1.2 + Math.random() * 1.5;
      parts.push({ x: size / 2, y: size / 2, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: 1.4 + Math.random() * 1.6 });
    }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = (ts - start) / 400;
      ctx.clearRect(0, 0, size, size);
      var life = 1 - t;
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95;
        ctx.globalAlpha = Math.max(0, life);
        ctx.fillStyle = '#E8621A';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t < 1) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
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
      : '<p class="log-confirm-q">' +
          esc(opts.confirmText || ('Did you complete ' + String(opts.targetDisplay) + '?')) +
        '</p>';

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

  // "Target: 20s" / "Target: 1m 30s"
  function plankTargetText(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m === 0) return s + 's';
    if (s === 0) return m + 'm';
    return m + 'm ' + s + 's';
  }

  // Plank timer shown before the plank logging flow. On scheduled plank days
  // (Mon/Wed/Thu/Sun) it counts DOWN to the day's target; on Best Effort Friday
  // it counts UP from zero. plankTimerActive gates cheer pop-ups while it runs.
  function openPlankTimer(isBestEffort) {
    var ex = EXERCISES.plank;
    var day = challengeDay(new Date());
    var target = targetFor(ex, day); // seconds
    var countUp = !!isBestEffort;
    var screen = ensureScreen('plank-timer-screen');

    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<button type="button" class="btn-link form-link">Form Guide</button>' +
      '</header>' +
      '<h1 class="log-title">PLANK</h1>' +
      (countUp ? '' : '<p class="log-target">Target: ' + esc(plankTargetText(target)) + '</p>') +
      '<div class="timer-zone">' +
        '<div class="ring-wrap">' +
          '<svg class="ring" viewBox="0 0 120 120">' +
            '<circle class="ring-bg" cx="60" cy="60" r="54"></circle>' +
            '<circle class="ring-fg" cx="60" cy="60" r="54"></circle>' +
          '</svg>' +
          '<span class="ring-label ring-label--bebas">' + (countUp ? '0:00' : clock(target)) + '</span>' +
        '</div>' +
        '<button type="button" class="btn-forge plank-start">Start</button>' +
        '<button type="button" class="btn-outline plank-stop hidden">Stop</button>' +
      '</div>' +
      '<div class="log-flow hidden"></div>';

    showScreen(screen); // (sets plankTimerActive = false until Start is pressed)

    var ringFg = screen.querySelector('.ring-fg');
    var ringLabel = screen.querySelector('.ring-label');
    var startBtn = screen.querySelector('.plank-start');
    var stopBtn = screen.querySelector('.plank-stop');
    var flow = screen.querySelector('.log-flow');
    var C = 2 * Math.PI * 54;
    var iv = null;

    function cancelTimer() { if (iv) { clearInterval(iv); iv = null; } plankTimerActive = false; }

    screen.querySelector('.back-btn').addEventListener('click', function () {
      cancelTimer();
      renderDashboard();
    });
    screen.querySelector('.form-link').addEventListener('click', function () {
      cancelTimer();
      openFormGuide(ex.name, 'plank',
        function () { openPlankTimer(isBestEffort); },
        function () { openPlankTimer(isBestEffort); });
    });

    addFire(startBtn);

    function finish(held, auto) {
      cancelTimer();
      startBtn.classList.add('hidden');
      stopBtn.classList.add('hidden');
      if (auto && navigator.vibrate) { try { navigator.vibrate(200); } catch (e) {} }
      showPlankLog(flow, ex, target, isBestEffort, held);
    }

    startBtn.addEventListener('click', function () {
      ensureAudio(); // unlock Web Audio on the user gesture
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      plankTimerActive = true;
      ringFg.style.strokeDasharray = C;
      ringFg.style.strokeDashoffset = 0;

      if (countUp) {
        var elapsed = 0;
        ringLabel.textContent = clock(0);
        iv = setInterval(function () {
          elapsed++;
          ringLabel.textContent = clock(elapsed);
        }, 1000);
        stopBtn.onclick = function () { finish(elapsed, false); };
      } else {
        var total = target, remaining = target;
        ringLabel.textContent = clock(remaining);
        iv = setInterval(function () {
          remaining--;
          ringLabel.textContent = clock(Math.max(0, remaining));
          ringFg.style.strokeDashoffset = C * (1 - remaining / total); // ring depletes
          if (remaining <= 10 && remaining >= 2) soundPlankBeep();
          else if (remaining === 1) soundPlankDone();
          if (remaining <= 0) { finish(total, true); }
        }, 1000);
        stopBtn.onclick = function () { finish(total - remaining, false); };
      }
    });
  }

  // Reveal the plank logging flow after the timer. Friday records the held time
  // as plankDuration; other days confirm the day's target.
  function showPlankLog(flow, ex, target, isBestEffort, held) {
    flow.classList.remove('hidden');
    if (isBestEffort) {
      buildLogFlow(flow, {
        requireInput: false,
        confirmText: 'Log your ' + plankTargetText(held) + ' plank hold?',
        targetDisplay: plankTargetText(held),
        confirmValue: held,
        onConfirm: function (value, mood) {
          saveLog('plank', value, target, mood, true, false, held).then(renderDashboard);
        }
      });
    } else {
      buildLogFlow(flow, {
        requireInput: false,
        targetDisplay: formatTarget(ex, target),
        confirmValue: target,
        onConfirm: function (value, mood) {
          saveLog('plank', value, target, mood, false, false).then(renderDashboard);
        }
      });
    }
  }

  function startCountdown(seconds, ringEl, labelEl, fireEl, onDone) {
    plankTimerActive = true; // suppress cheer pop-ups while the timer runs
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
  // ===================================================================
  // Bonus spin — full-screen slot-machine experience
  // ===================================================================
  var SPIN_CELL = 64; // px height of each reel cell
  var spinTimers = [];
  function clearSpinTimers() {
    spinTimers.forEach(function (id) { clearTimeout(id); });
    spinTimers = [];
  }
  function spinDefer(fn, ms) { var id = setTimeout(fn, ms); spinTimers.push(id); return id; }

  function bonusIndexOf(name) {
    for (var i = 0; i < BONUS_EXERCISES.length; i++) {
      if (BONUS_EXERCISES[i].name === name) return i;
    }
    return 0;
  }

  // ---- Spin sounds (Web Audio, generated — no files) ----
  // Short filtered noise burst → a mechanical reel "click".
  function spinClick(freq) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime, dur = 0.03;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }
  function spinThump() { playTone(80, 0.08, 'sine', 0.9); } // landing bass impact
  function spinFanfare() { // three ascending tones in sequence
    playTone(523, 0.15, 'triangle', 0.5);
    spinDefer(function () { playTone(659, 0.15, 'triangle', 0.5); }, 150);
    spinDefer(function () { playTone(784, 0.22, 'triangle', 0.5); }, 300);
  }

  function closeSpin() {
    clearSpinTimers();
    var overlay = document.getElementById('spin-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    setTimeout(function () { overlay.classList.add('hidden'); overlay.innerHTML = ''; }, 300);
  }

  // Fill the five reel cells for a window centred on index c (3 visible + 2 buffer).
  function renderReel(overlay, c) {
    var n = BONUS_EXERCISES.length;
    var cells = overlay.querySelectorAll('.spin-cell');
    for (var k = 0; k < cells.length; k++) {
      var idx = ((c - 2 + k) % n + n) % n;
      cells[k].textContent = BONUS_EXERCISES[idx].name;
    }
  }

  function openSpin() {
    var overlay = document.getElementById('spin-overlay');
    if (!overlay) return;
    clearSpinTimers();
    ensureAudio(); // unlock audio on the user gesture

    overlay.innerHTML =
      '<button type="button" class="spin-close" aria-label="Close">×</button>' +
      '<div class="spin-glow"></div>' +
      '<div class="spin-stage">' +
        '<p class="spin-kicker">BONUS SPIN · 20 PTS</p>' +
        '<div class="spin-window">' +
          '<div class="spin-selbar"></div>' +
          '<div class="spin-strip">' +
            '<div class="spin-cell spin-cell--off"></div>' +
            '<div class="spin-cell spin-cell--edge"></div>' +
            '<div class="spin-cell spin-cell--cur"></div>' +
            '<div class="spin-cell spin-cell--edge"></div>' +
            '<div class="spin-cell spin-cell--off"></div>' +
          '</div>' +
        '</div>' +
        '<div class="spin-outcome"></div>' +
      '</div>' +
      '<div class="spin-flash"></div>';

    overlay.classList.remove('hidden');
    requestAnimationFrame(function () { overlay.classList.add('is-visible'); });
    overlay.querySelector('.spin-close').addEventListener('click', closeSpin);

    // Once per day: if already spun, show today's result rather than respinning.
    var existing = todaysBonusLog();
    if (existing) {
      var bx = BONUS_EXERCISES[bonusIndexOf(existing.exercise)] ||
               { name: existing.exercise, target: existing.target || '' };
      renderReel(overlay, bonusIndexOf(bx.name));
      overlay.querySelector('.spin-strip').style.transform = 'translateY(-' + SPIN_CELL + 'px)';
      showSpinOutcome(overlay, bx, true);
    } else {
      startReelSpin(overlay);
    }
  }

  function startReelSpin(overlay) {
    var n = BONUS_EXERCISES.length;
    var selected = Math.floor(Math.random() * n);

    // Tick durations: fast 50ms, easing slower over ~2s, then the dramatic
    // final three (200, 400, 800ms).
    var durs = [];
    for (var k = 0; k < 22; k++) { var p = k / 21; durs.push(Math.round(50 + 100 * (p * p))); }
    durs.push(200, 400, 800);
    var T = durs.length;
    // Choose the start so that exactly T ticks land the centre on `selected`.
    var c = ((selected - T) % n + n) % n;

    var strip = overlay.querySelector('.spin-strip');
    renderReel(overlay, c);
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(-' + SPIN_CELL + 'px)';

    var i = 0;
    function step() {
      i++;
      var dur = durs[i - 1];
      var ease = (i >= T - 1) ? 'cubic-bezier(0.15,0.85,0.25,1)' : 'linear';
      var blur = dur <= 70 ? 5 : dur <= 110 ? 3 : dur <= 180 ? 1.5 : 0;
      strip.style.setProperty('--spin-blur', blur + 'px');
      void strip.offsetWidth;
      strip.style.transition = 'transform ' + dur + 'ms ' + ease;
      strip.style.transform = 'translateY(-' + (SPIN_CELL * 2) + 'px)'; // slide up one cell

      spinDefer(function () {
        // Seamlessly re-centre on the next item (no visible jump).
        c = (c + 1) % n;
        strip.style.transition = 'none';
        renderReel(overlay, c);
        strip.style.transform = 'translateY(-' + SPIN_CELL + 'px)';
        void strip.offsetWidth;
        // Click as the item locks in — deeper for the final three.
        if (i === T - 2) spinClick(150);
        else if (i === T - 1) spinClick(120);
        else if (i === T) spinClick(100);
        else spinClick(200);
        if (i < T) step();
        else landSpin(overlay, selected);
      }, dur);
    }
    spinDefer(step, 60);
  }

  function landSpin(overlay, selected) {
    var bonus = BONUS_EXERCISES[selected];
    overlay.querySelector('.spin-strip').style.setProperty('--spin-blur', '0px');

    // CLUNK — bass thump, white flash, selection-bar pulse.
    spinThump();
    var flash = overlay.querySelector('.spin-flash');
    flash.classList.add('is-flash');
    spinDefer(function () { flash.classList.remove('is-flash'); }, 40);
    var selbar = overlay.querySelector('.spin-selbar');
    selbar.classList.remove('is-clunk'); void selbar.offsetWidth; selbar.classList.add('is-clunk');

    if (typeof fireConfettiCannon === 'function') fireConfettiCannon();
    spinDefer(spinFanfare, 120);
    showSpinOutcome(overlay, bonus, false);
  }

  function showSpinOutcome(overlay, bonus, alreadyUsed) {
    var out = overlay.querySelector('.spin-outcome');
    out.innerHTML =
      '<span class="spin-shockwave"></span>' +
      '<h2 class="spin-win-name">' + esc(bonus.name) + '</h2>' +
      '<p class="spin-win-target">' + esc(bonus.target || '') + '</p>' +
      (alreadyUsed
        ? '<p class="spin-used-note">Bonus already claimed today</p>' +
          '<button type="button" class="btn-forge spin-done">Close</button>'
        : '<button type="button" class="btn-forge spin-go">LET\'S GO</button>');
    out.classList.add('is-shown');

    if (alreadyUsed) {
      out.querySelector('.spin-done').addEventListener('click', closeSpin);
      return;
    }
    var go = out.querySelector('.spin-go');
    addFire(go);
    go.addEventListener('click', function () {
      go.disabled = true;
      // Mark the spin used via the existing logging path (bonusExercise = true).
      saveLog(bonus.name, bonus.target, bonus.target, null, false, true)
        .then(function () { closeSpin(); renderDashboard(); })
        .catch(function () { closeSpin(); renderDashboard(); });
    });
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
  function moodScore(label) {
    var i = MOODS.indexOf(label);
    return i < 0 ? null : (5 - i); // Crushed it = 5 … Gave it a go = 1
  }

  // Average a set of logs' moods into a single mood label (rounded to nearest).
  function avgMoodLabel(logs) {
    var scores = (logs || []).map(function (l) { return moodScore(l.mood); })
      .filter(function (s) { return s != null; });
    if (!scores.length) return null;
    var avg = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    avg = Math.max(1, Math.min(5, Math.round(avg)));
    return MOODS[5 - avg]; // score → label (inverse of moodScore)
  }

  // The logging-screen SVG icon for a mood label (same representation as logging).
  function moodIconHtml(label) {
    var i = MOODS.indexOf(label);
    return i >= 0 ? '<span class="feed-mood" title="' + esc(label) + '">' + MOOD_ICONS[i] + '</span>' : '';
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

  // ---- Progress animation helpers ----------------------------------
  // Count an element's text up from 0 to `to` over `dur` ms (easeOutCubic),
  // via requestAnimationFrame. Triggered when the Progress screen is shown.
  function animateCount(el, to, dur) {
    to = Math.round(Number(to) || 0);
    dur = dur || 800;
    if (to <= 0) { el.textContent = '0'; return; }
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(to * e));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = String(to);
    }
    requestAnimationFrame(step);
  }

  // Draw the challenge-completion ring: sweep the stroke and count the % label
  // together over `dur` ms. r=88 (matches the 200-viewBox ring in the markup).
  function animateRing(arc, label, pct, dur) {
    var C = 2 * Math.PI * 88;
    pct = Math.max(0, Math.min(100, pct));
    arc.style.strokeDasharray = C;
    arc.style.strokeDashoffset = C;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      arc.style.strokeDashoffset = C * (1 - (pct / 100) * e);
      label.textContent = Math.round(pct * e) + '%';
      if (p < 1) requestAnimationFrame(step);
      else { arc.style.strokeDashoffset = C * (1 - pct / 100); label.textContent = Math.round(pct) + '%'; }
    }
    requestAnimationFrame(step);
  }

  // Best-effort score in its display unit (time → m/s, legs → "/leg", reps → n).
  function beScoreText(ex, val) {
    if (ex.kind === 'time') return plankTargetText(val);
    if (ex.kind === 'legs') return val + '/leg';
    return String(val);
  }

  function openProgress() {
    var screen = ensureScreen('progress-screen');
    var u = state.user || {};
    var name = u.name || 'Forger';
    var streak = u.currentStreak || 0;
    var points = u.totalPoints || 0;
    var longest = u.longestStreak || 0;
    var totalExercises = state.logs.filter(function (l) { return !l.bonusExercise; }).length;
    var totalBonus = state.logs.filter(function (l) { return l.bonusExercise; }).length;
    var daysDone = computeDaysCompleted();
    var daysPct = Math.round(daysDone / TOTAL_DAYS * 100);

    // User best-effort best score per exercise (null when never logged).
    var userBE = state.logs.filter(function (l) { return l.isBestEffort; });
    function userBest(key) {
      var v = userBE.filter(function (l) { return l.exercise === key; })
        .map(function (l) { return Number(l.repsCompleted) || 0; });
      return v.length ? Math.max.apply(null, v) : null;
    }

    var flameSVG = '<svg class="pr-flame" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2c1.3 3.7 4.7 4.7 4.7 8.6a4.7 4.7 0 0 1-9.4 0c0-1.7.6-2.8 1.6-3.7.3 2 1.7 2 1.7.2 0-1.7-.6-2.7 1.4-5.3z"/></svg>';
    var lockSVG = '<svg class="pr-be-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

    // SECTION 4 — best-effort cards (locked until the first Friday session).
    var beHTML = ORDER.map(function (key) {
      var ex = EXERCISES[key];
      var best = userBest(key);
      var target = targetFor(ex, TOTAL_DAYS); // the Day 90 goal
      if (best == null) {
        return '<div class="pr-be-card pr-be-locked">' +
                 '<div class="pr-be-head">' +
                   '<span class="pr-be-name">' + esc(ex.name) + '</span>' + lockSVG +
                 '</div>' +
                 '<div class="pr-be-bar pr-be-bar--empty"></div>' +
                 '<span class="pr-be-locktext">Complete your first Best Effort Friday to unlock</span>' +
               '</div>';
      }
      var pct = Math.max(2, Math.min(100, Math.round(best / target * 100)));
      return '<div class="pr-be-card">' +
               '<div class="pr-be-head">' +
                 '<span class="pr-be-name">' + esc(ex.name) + '</span>' +
                 '<span class="pr-be-score">' + esc(beScoreText(ex, best)) + '</span>' +
               '</div>' +
               '<div class="pr-be-bar"><div class="pr-be-fill" data-fill="' + pct + '"></div></div>' +
               '<span class="pr-be-target">Day 90 target: ' + esc(formatTarget(ex, target)) + '</span>' +
             '</div>';
    }).join('');

    screen.innerHTML =
      // SECTION 1 — hero stats row
      '<section class="pr-hero">' +
        '<div class="pr-hero-glow"></div>' +
        '<div class="pr-hero-stat">' +
          '<span class="pr-stat-num" data-count="' + streak + '" data-dur="800">0</span>' +
          '<canvas class="pr-hero-fire prog-streak-fire"></canvas>' +
          '<span class="pr-hero-label">STREAK</span>' +
        '</div>' +
        '<div class="pr-hero-stat pr-hero-main">' +
          '<span class="pr-stat-num pr-stat-num--big" data-count="' + points + '" data-dur="1000">0</span>' +
          '<span class="pr-hero-label">POINTS</span>' +
        '</div>' +
        '<div class="pr-hero-stat">' +
          '<span class="pr-stat-num"><span data-count="' + daysDone + '" data-dur="600">0</span>' +
            '<span class="pr-days-total"> / ' + TOTAL_DAYS + '</span></span>' +
          '<span class="pr-hero-label">DAYS</span>' +
        '</div>' +
      '</section>' +

      // SECTION 2 — challenge-completion ring
      '<section class="pr-ring-section">' +
        '<div class="pr-ring-wrap">' +
          '<div class="pr-ring-glow"></div>' +
          '<svg class="pr-ring-svg" viewBox="0 0 200 200">' +
            '<circle class="pr-ring-track" cx="100" cy="100" r="88"></circle>' +
            '<circle class="pr-ring-arc" cx="100" cy="100" r="88"></circle>' +
          '</svg>' +
          '<div class="pr-ring-center">' +
            avatarMarkup(name, 'pr-ring-avatar') +
            '<span class="pr-ring-pct">0%</span>' +
            '<span class="pr-ring-caption">OF CHALLENGE COMPLETE</span>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // SECTION 3 — personal stats grid
      '<section class="pr-section">' +
        '<p class="section-heading">Personal Stats</p>' +
        '<div class="pr-stat-grid">' +
          '<div class="pr-card">' +
            '<span class="pr-card-label">Total Points</span>' +
            '<span class="pr-card-value">' + points + '</span>' +
          '</div>' +
          '<div class="pr-card">' +
            '<span class="pr-card-label">Current Streak</span>' +
            '<span class="pr-card-value">' + flameSVG + streak + '</span>' +
          '</div>' +
          '<div class="pr-card">' +
            '<span class="pr-card-label">Longest Streak</span>' +
            '<span class="pr-card-value">' + longest + '</span>' +
          '</div>' +
          '<div class="pr-card">' +
            '<span class="pr-card-label">Exercises Logged</span>' +
            '<span class="pr-card-value">' + totalExercises + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pr-stat-rows">' +
          '<div class="pr-row">' +
            '<span class="pr-row-label">Days Completed</span>' +
            '<span class="pr-row-value">' + daysDone + ' / ' + TOTAL_DAYS + '</span>' +
          '</div>' +
          '<div class="pr-row">' +
            '<span class="pr-row-label">Bonus Exercises</span>' +
            '<span class="pr-row-value">' + totalBonus + '</span>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // SECTION 4 — best effort
      '<section class="pr-section">' +
        '<p class="section-heading">Best Effort</p>' +
        '<div class="pr-be-list">' + beHTML + '</div>' +
      '</section>' +

      // SECTION 5 — squad average comparison
      '<section class="pr-section">' +
        '<p class="section-heading">Squad Comparison</p>' +
        '<div class="pr-squad">' +
          '<div class="pr-squad-row">' +
            '<div class="pr-squad-meta">' +
              '<span class="pr-squad-label">YOU</span>' +
              '<span class="pr-squad-val pr-squad-you-val">' + points + '</span>' +
            '</div>' +
            '<div class="pr-squad-track"><div class="pr-squad-fill pr-squad-you"></div></div>' +
          '</div>' +
          '<div class="pr-squad-row">' +
            '<div class="pr-squad-meta">' +
              '<span class="pr-squad-label">SQUAD AVG</span>' +
              '<span class="pr-squad-val pr-squad-avg-val">—</span>' +
            '</div>' +
            '<div class="pr-squad-track"><div class="pr-squad-fill pr-squad-avg"></div></div>' +
          '</div>' +
        '</div>' +
      '</section>';

    showScreen(screen);
    showNav('progress');

    // Trigger all entrance animations now the screen is visible.
    requestAnimationFrame(function () { runProgressAnimations(screen, daysPct); });
    loadSquadComparison(screen);
  }

  // Kick off the hero counters, ring sweep, best-effort bars and streak fire.
  function runProgressAnimations(screen, daysPct) {
    Array.prototype.forEach.call(screen.querySelectorAll('[data-count]'), function (el) {
      animateCount(el, Number(el.getAttribute('data-count')), Number(el.getAttribute('data-dur')));
    });

    var arc = screen.querySelector('.pr-ring-arc');
    var pctEl = screen.querySelector('.pr-ring-pct');
    if (arc && pctEl) animateRing(arc, pctEl, daysPct, 1200);

    // Bars start at width:0 (CSS) and transition to their target width.
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(screen.querySelectorAll('.pr-be-fill[data-fill]'), function (el) {
        el.style.width = (Number(el.getAttribute('data-fill')) || 0) + '%';
      });
    });

    var fire = screen.querySelector('.pr-hero-fire');
    if (fire) startFire(fire); // small particle fire beneath the streak number
  }

  // SECTION 5 data: squad average total points across the users collection,
  // compared with the current user. Bars are sized relative to the larger value.
  function loadSquadComparison(screen) {
    var youFill = screen.querySelector('.pr-squad-you');
    var avgFill = screen.querySelector('.pr-squad-avg');
    var avgValEl = screen.querySelector('.pr-squad-avg-val');
    if (!youFill || !avgFill) return;
    var you = (state.user && state.user.totalPoints) || 0;

    db.collection('users').get().then(function (snap) {
      var total = 0, n = 0;
      snap.forEach(function (d) { total += Number((d.data() || {}).totalPoints) || 0; n++; });
      var avg = n ? Math.round(total / n) : 0;
      var max = Math.max(you, avg, 1);
      if (avgValEl) avgValEl.textContent = avg;
      requestAnimationFrame(function () {
        youFill.style.width = Math.round(you / max * 100) + '%';
        avgFill.style.width = Math.round(avg / max * 100) + '%';
      });
    }).catch(function (err) {
      console.error('Squad average load failed:', err);
      if (avgValEl) avgValEl.textContent = '—';
      requestAnimationFrame(function () { youFill.style.width = you > 0 ? '100%' : '0%'; });
    });
  }

  // ---- Plan screen helpers -----------------------------------------
  // Animate an element's number from `from` to `to` over `dur` ms (easeOutCubic);
  // handles both count-up and count-down.
  function animateValue(el, from, to, dur) {
    from = Math.round(Number(from) || 0);
    to = Math.round(Number(to) || 0);
    dur = dur || 800;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = String(to);
    }
    requestAnimationFrame(step);
  }

  // Compact target label for the Plan screen (plank shown as minutes/seconds).
  function planTargetText(ex, val) {
    if (ex.kind === 'time') return plankTargetText(val);
    if (ex.kind === 'legs') return val + '/leg';
    return val + ' reps';
  }

  // Sparse, slow ember particles behind the Plan hero (very subtle, 7 of them).
  // Self-stops when the canvas detaches on screen re-render, like startFire.
  function startEmbers(canvas, count) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var W = 0, H = 0;
    function resize() {
      W = canvas.clientWidth || 0;
      H = canvas.clientHeight || 0;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    function rand(a, b) { return a + Math.random() * (b - a); }
    var parts = [];
    function spawn(p, initial) {
      p.x = rand(0, W || 1);
      p.y = initial ? rand(0, H || 1) : (H || 1) + rand(2, 14);
      p.r = rand(1, 2.4);
      p.vx = rand(-0.1, 0.1);
      p.vy = rand(-0.28, -0.08); // slow rise
      p.life = rand(0.4, 1);
      p.fade = rand(0.0009, 0.0024);
      return p;
    }
    var N = count || 7;
    for (var i = 0; i < N; i++) parts.push(spawn({}, true));
    function frame() {
      if (!canvas.isConnected) return; // screen re-render → stop
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (W > 0 && H > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.globalCompositeOperation = 'lighter';
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          p.x += p.vx; p.y += p.vy; p.life -= p.fade;
          if (p.y < -6 || p.life <= 0) spawn(p, false);
          var a = Math.min(1, p.life) * 0.35; // very subtle
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
          g.addColorStop(0, 'rgba(255,150,70,' + a + ')');
          g.addColorStop(1, 'rgba(232,98,26,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function openPlan() {
    var screen = ensureScreen('plan-screen');
    var day = challengeDay(new Date());
    var dayClamped = Math.max(0, Math.min(TOTAL_DAYS, day));
    var dayLabel = day < 1 ? 0 : (day > TOTAL_DAYS ? TOTAL_DAYS : day);
    var endDate = new Date(2026, 8, 20); // Day 90 — 20 September 2026
    var daysRemaining = Math.max(0, daysBetween(new Date(), endDate));
    var elapsedPct = Math.round(dayClamped / TOTAL_DAYS * 100);

    var trophy = '<svg class="pl-goal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4v1.5A3 3 0 0 0 7 9.5M17 5h3v1.5a3 3 0 0 1-3 3"/>' +
      '<path d="M12 13v3M9.5 21h5l-.7-4h-3.6z"/></svg>';
    var chev = '<svg class="pl-acc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    // SECTION 2 — end-of-challenge goal targets.
    var goalHTML = ORDER.map(function (k) {
      var ex = EXERCISES[k];
      return '<div class="pl-goal-item">' +
               '<span class="pl-goal-ex">' + esc(ex.name) + '</span>' +
               '<span class="pl-goal-val">' + esc(formatTarget(ex, ex.end)) + '</span>' +
             '</div>';
    }).join('');

    // SECTION 4 — weekly structure (Mon→Sun; today's index marked).
    var WEEK = [
      { d: 'Monday', active: ['Press-ups', 'Sit-ups', 'Plank'], rest: 'Lunges' },
      { d: 'Tuesday', active: ['Press-ups', 'Sit-ups', 'Lunges'], rest: 'Plank' },
      { d: 'Wednesday', active: ['Sit-ups', 'Plank', 'Lunges'], rest: 'Press-ups' },
      { d: 'Thursday', active: ['Press-ups', 'Plank', 'Lunges'], rest: 'Sit-ups' },
      { d: 'Friday', type: 'best' },
      { d: 'Saturday', type: 'rest' },
      { d: 'Sunday', active: ['Press-ups', 'Sit-ups', 'Plank'], rest: 'Lunges' }
    ];
    var todayIdx = (new Date().getDay() + 6) % 7; // getDay 0=Sun → WEEK index (Mon-first)
    function pill(name, extra) { return '<span class="pl-pill' + (extra || '') + '">' + esc(name) + '</span>'; }
    var weekHTML = WEEK.map(function (w, idx) {
      var isToday = idx === todayIdx;
      var badge = isToday ? '<span class="pl-today-badge">TODAY</span>' : '';
      var cls = 'pl-day';
      if (w.type === 'best') cls += ' pl-day--best forge-laser';
      else if (w.type === 'rest') cls += ' pl-day--rest';
      if (isToday) cls += ' pl-day--today';
      var inner;
      if (w.type === 'best') {
        inner = '<div class="pl-day-head"><span class="pl-day-name">Friday</span><span class="pl-day-emoji">🔥</span></div>' +
          '<div class="pl-pills">' + ORDER.map(function (k) { return pill(EXERCISES[k].name); }).join('') + '</div>' +
          '<span class="pl-day-note">Best effort — 2 min each</span>';
      } else if (w.type === 'rest') {
        inner = '<div class="pl-day-head"><span class="pl-day-name">Saturday</span><span class="pl-day-emoji">🌙</span></div>' +
          '<span class="pl-day-note">Full rest day</span>';
      } else {
        inner = '<div class="pl-day-head"><span class="pl-day-name">' + esc(w.d) + '</span></div>' +
          '<div class="pl-pills">' + w.active.map(function (n) { return pill(n); }).join('') +
            pill('Rest: ' + w.rest, ' pl-pill--rest') + '</div>';
      }
      return '<div class="' + cls + '" style="animation-delay:' + (idx * 80) + 'ms">' + badge + inner + '</div>';
    }).join('');

    // SECTION 5 — progression bars (current interpolated target vs Day 90).
    var progHTML = ORDER.map(function (k, i) {
      var ex = EXERCISES[k];
      var curr = targetFor(ex, Math.max(1, dayClamped || 1));
      var pct = Math.max(2, Math.min(100, Math.round(curr / ex.end * 100)));
      return '<div class="pl-prog">' +
               '<span class="pl-prog-name">' + esc(ex.name) + '</span>' +
               '<div class="pl-prog-bar"><div class="pl-prog-fill" data-w="' + pct +
                 '" style="transition-delay:' + (i * 120) + 'ms"></div></div>' +
               '<div class="pl-prog-vals">' +
                 '<span class="pl-prog-curr">' + esc(planTargetText(ex, curr)) + '</span>' +
                 '<span class="pl-prog-end">Day 90: ' + esc(planTargetText(ex, ex.end)) + '</span>' +
               '</div>' +
             '</div>';
    }).join('');

    // SECTION 6 — points + bonus (accordion bodies).
    var POINTS = [
      ['Log any exercise', 10], ['All exercises due that day', 25],
      ['Friday best effort (all 4)', 50], ['7-day streak', 100],
      ['30-day streak', 500], ['Bonus exercise', 20]
    ];
    var pointsHTML = POINTS.map(function (p) {
      return '<div class="pl-acc-row"><span class="pl-acc-label">' + esc(p[0]) +
               '</span><span class="pl-acc-pts">+' + p[1] + '</span></div>';
    }).join('');
    var bonusHTML = BONUS_EXERCISES.map(function (b, i) {
      return '<div class="pl-acc-row"><span class="pl-acc-label">' + (i + 1) + '. ' + esc(b.name) +
               '</span><span class="pl-acc-target">' + esc(b.target) + '</span></div>';
    }).join('');

    screen.innerHTML =
      // SECTION 1 — hero header
      '<section class="pl-hero">' +
        '<canvas class="pl-hero-embers"></canvas>' +
        '<div class="pl-hero-inner">' +
          '<h1 class="pl-hero-title">THE PLAN</h1>' +
          '<p class="pl-hero-sub">90 days. Built together.</p>' +
          '<div class="pl-countdown">' +
            '<span class="pl-countdown-num" data-from="' + (daysRemaining + 30) + '" data-to="' + daysRemaining + '">' +
              (daysRemaining + 30) + '</span>' +
            '<span class="pl-countdown-label">DAYS REMAINING</span>' +
          '</div>' +
          '<div class="pl-hero-bar"><div class="pl-hero-bar-fill" data-w="' + elapsedPct + '"></div></div>' +
        '</div>' +
      '</section>' +

      // SECTION 2 — your goal
      '<section class="pl-section pl-anim-rise">' +
        '<div class="pl-goal">' +
          '<div class="pl-goal-head">' + trophy + '<span class="pl-goal-title">YOUR GOAL</span></div>' +
          '<div class="pl-goal-grid">' + goalHTML + '</div>' +
        '</div>' +
      '</section>' +

      // SECTION 3 — challenge overview timeline
      '<section class="pl-section">' +
        '<p class="section-heading">Challenge overview</p>' +
        '<div class="pl-timeline">' +
          '<div class="pl-tl-track">' +
            '<div class="pl-tl-fill" data-w="' + elapsedPct + '"></div>' +
            '<span class="pl-tl-dot pl-tl-start"></span>' +
            '<span class="pl-tl-dot pl-tl-end"></span>' +
            '<span class="pl-tl-marker" style="left:' + elapsedPct + '%"></span>' +
          '</div>' +
          '<div class="pl-tl-labels">' +
            '<div class="pl-tl-label"><span class="pl-tl-when">23 Jun 2026</span><span class="pl-tl-cap">START</span></div>' +
            '<div class="pl-tl-label pl-tl-label--right"><span class="pl-tl-when">20 Sep 2026</span><span class="pl-tl-cap">END</span></div>' +
          '</div>' +
          '<p class="pl-tl-current">Day ' + dayLabel + ' of ' + TOTAL_DAYS + '</p>' +
        '</div>' +
      '</section>' +

      // SECTION 4 — weekly structure
      '<section class="pl-section">' +
        '<p class="section-heading">Weekly structure</p>' +
        '<div class="pl-days">' + weekHTML + '</div>' +
      '</section>' +

      // SECTION 5 — progression targets
      '<section class="pl-section">' +
        '<p class="section-heading">Progression targets</p>' +
        '<div class="pl-progs">' + progHTML + '</div>' +
      '</section>' +

      // SECTION 6 — points + bonus accordions
      '<section class="pl-section">' +
        '<div class="pl-acc">' +
          '<button type="button" class="pl-acc-head"><span class="pl-acc-htitle">Points system</span>' + chev + '</button>' +
          '<div class="pl-acc-body"><div class="pl-acc-inner">' + pointsHTML + '</div></div>' +
        '</div>' +
        '<div class="pl-acc">' +
          '<button type="button" class="pl-acc-head"><span class="pl-acc-htitle">Bonus exercises</span>' + chev + '</button>' +
          '<div class="pl-acc-body"><div class="pl-acc-inner">' + bonusHTML + '</div></div>' +
        '</div>' +
      '</section>';

    showScreen(screen);
    showNav('plan');

    // Accordions — toggle open/closed (collapsed by default).
    Array.prototype.forEach.call(screen.querySelectorAll('.pl-acc-head'), function (head) {
      head.addEventListener('click', function () { head.parentNode.classList.toggle('is-open'); });
    });

    requestAnimationFrame(function () { runPlanAnimations(screen, daysRemaining); });
  }

  // Trigger the Plan entrance animations once the screen is visible.
  function runPlanAnimations(screen, daysRemaining) {
    var cd = screen.querySelector('.pl-countdown-num');
    if (cd) animateValue(cd, Number(cd.getAttribute('data-from')), Number(cd.getAttribute('data-to')), 800);

    // Hero bar, timeline fill and progression bars all transition from width:0.
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(screen.querySelectorAll('[data-w]'), function (el) {
        el.style.width = (Number(el.getAttribute('data-w')) || 0) + '%';
      });
    });

    var embers = screen.querySelector('.pl-hero-embers');
    if (embers) startEmbers(embers);
  }

  // ===================================================================
  // Forge Card (coming soon)
  // ===================================================================
  // ===================================================================
  // Forge Card — Top Trumps style attribute card (Best Effort Friday data)
  // ===================================================================
  // Best-effort logs for an exercise, most recent first (date desc, then
  // createdAt). repsCompleted holds reps (or held seconds for plank).
  function bestEffortEntries(key) {
    return state.logs
      .filter(function (l) { return l.isBestEffort && l.exercise === key; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        var am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        var bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return bm - am;
      });
  }

  function forgeScore(value, denom) {
    return Math.min(100, Math.round((Number(value) || 0) / denom * 100));
  }

  function openForgeCard() {
    var screen = ensureScreen('forgecard-screen');
    var u = state.user || {};
    var name = u.name || 'Forger';

    // Day-90 denominators per attribute (plank uses held seconds).
    var ATTRS = [
      { key: 'pressups', label: 'STRENGTH', denom: 50 },
      { key: 'situps', label: 'ENDURANCE', denom: 100 },
      { key: 'plank', label: 'IRON CORE', denom: 180 },
      { key: 'lunges', label: 'AGILITY', denom: 20 }
    ];

    var lockSvg = '<svg class="fcard-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

    var scores = [];        // displayed score per row (for the total)
    var latestDate = null;  // most recent best-effort date across exercises
    var anyData = false;

    function deltaHTML(delta) {
      if (delta == null || delta === 0) return '';
      var up = delta > 0;
      return '<span class="fcard-delta ' + (up ? 'fcard-delta--up' : 'fcard-delta--down') + '">' +
               (up ? '↑' : '↓') + Math.abs(delta) + '</span>';
    }

    function attrRow(label, score, locked, delta) {
      return '<div class="fcard-attr' + (locked ? ' is-locked' : '') + '">' +
               '<div class="fcard-attr-top">' +
                 '<span class="fcard-attr-name">' + (locked ? lockSvg : '') + esc(label) + '</span>' +
                 '<span class="fcard-attr-score">' + score + deltaHTML(delta) + '</span>' +
               '</div>' +
               '<div class="fcard-bar"><div class="fcard-fill" data-w="' + score + '"></div></div>' +
             '</div>';
    }

    var rowsHTML = ATTRS.map(function (a) {
      var entries = bestEffortEntries(a.key);
      var locked = entries.length === 0;
      var score = 0, delta = null;
      if (!locked) {
        anyData = true;
        score = forgeScore(entries[0].repsCompleted, a.denom);
        if (entries[0].date && (!latestDate || entries[0].date > latestDate)) latestDate = entries[0].date;
        if (entries.length > 1) {
          var prev = forgeScore(entries[1].repsCompleted, a.denom);
          delta = score - prev;
        }
      }
      scores.push(score);
      return attrRow(a.label, score, locked, delta);
    }).join('');

    // CONSISTENCY is computed live and never locked. It reflects the user's
    // current streak plus every distinct day they have completed all due
    // exercises — counted straight from their logs, so it works from Day 1 (and
    // soft launch), not only within the fixed challenge window.
    var streak = u.currentStreak || 0;
    var cByDate = logsByDate(state.logs);
    var daysDone = 0;
    Object.keys(cByDate).forEach(function (dk) {
      var cd = parseKey(dk);
      var csched = scheduleForDay(cd.getDay());
      if (!csched.active.length || !dayCompleted(cd, cByDate)) return;
      // Each completed day counts as 1.0, but exercises logged as "Gave it a go"
      // weigh 0.5 — so an all-attempted day counts as half a completed day.
      var dl = cByDate[dk];
      var weight = 0;
      csched.active.forEach(function (k) {
        var l = dl.filter(function (x) { return x.exercise === k && !x.bonusExercise; })[0];
        weight += (l && l.mood === 'Gave it a go') ? 0.5 : 1;
      });
      daysDone += weight / csched.active.length;
    });
    var consistency = Math.min(100, Math.round((streak / 30 * 50) + (daysDone / 90 * 50)));
    scores.push(consistency);
    rowsHTML += attrRow('CONSISTENCY', consistency, false, null);

    var total = Math.round(scores.reduce(function (s, x) { return s + x; }, 0) / scores.length);

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var updated = 'Not yet recorded';
    if (latestDate) {
      var d = parseKey(latestDate);
      updated = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    var RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚠ', 'ᚢ'];
    var RUNE_POS = [
      'top:5px;left:7px', 'top:4px;left:50%;transform:translateX(-50%)', 'top:5px;right:7px',
      'top:50%;right:6px;transform:translateY(-50%)', 'bottom:5px;right:7px',
      'bottom:4px;left:50%;transform:translateX(-50%)', 'bottom:5px;left:7px',
      'top:50%;left:6px;transform:translateY(-50%)'
    ];
    var runesHTML = '<div class="fcard-runes">' + RUNES.map(function (r, i) {
      return '<span class="fcard-rune" style="' + RUNE_POS[i] + '">' + r + '</span>';
    }).join('') + '</div>';

    screen.innerHTML =
      '<h1 class="fcard-title">FORGE CARD</h1>' +
      '<p class="fcard-subtitle">Your attributes. Your progress.</p>' +

      '<div class="fcard-stage">' +
        '<canvas class="fcard-halo"></canvas>' +
        '<div class="fcard fcard--flip">' +
          '<canvas class="fcard-embers"></canvas>' +
          '<div class="fcard-highlight"></div>' +
          runesHTML +
          '<div class="fcard-sweep"></div>' +
          '<div class="fcard-body">' +
            '<div class="fcard-head">' +
              avatarMarkup(name, 'fcard-avatar') +
              '<p class="fcard-name">' + esc(name) + '</p>' +
              '<p class="fcard-role">FORGER</p>' +
            '</div>' +
            '<div class="fcard-divider"></div>' +
            '<div class="fcard-attrs">' + rowsHTML + '</div>' +
            '<div class="fcard-footer">' +
              '<span class="fcard-total-label">TOTAL SCORE</span>' +
              '<span class="fcard-total"><span class="fcard-total-num">' + total + '</span>' +
                '<span class="fcard-total-max"> / 100</span></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      (anyData ? '' : '<p class="fcard-unlock">Complete your first Best Effort Friday to unlock your attributes</p>') +
      '<p class="fcard-updated">Last updated: ' + esc(updated) + '</p>';

    showScreen(screen);
    showNav('forgecard');

    var card = screen.querySelector('.fcard');

    // Animate the attribute bars in.
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(screen.querySelectorAll('.fcard-fill[data-w]'), function (el) {
        el.style.width = (Number(el.getAttribute('data-w')) || 0) + '%';
      });
    });

    // Faint inner ember texture + orbiting particle halo around the card.
    var emb = screen.querySelector('.fcard-embers');
    if (emb) startEmbers(emb, 4);
    var halo = screen.querySelector('.fcard-halo');
    if (halo) startHalo(halo);

    // Activate the borders + 3D tilt once the flip finishes (timeout fallback).
    var activated = false;
    function activate() {
      if (activated || !card || !card.isConnected) return;
      activated = true;
      card.classList.remove('fcard--flip');
      card.classList.add('is-active');
      setupFcardTilt(card);
    }
    if (card) {
      card.addEventListener('animationend', function (e) {
        if (e.animationName === 'fcardFlip') activate();
      });
    }
    setTimeout(activate, 900);
  }

  // ---- Forge Card 3D tilt (gyroscope on mobile, cursor on desktop) ----
  var fcardOrientHandler = null, fcardMouseHandler = null;
  var fcardMotionGranted = false; // iOS motion permission granted this session

  function teardownFcardTilt() {
    if (fcardOrientHandler) { window.removeEventListener('deviceorientation', fcardOrientHandler); fcardOrientHandler = null; }
    if (fcardMouseHandler) { window.removeEventListener('mousemove', fcardMouseHandler); fcardMouseHandler = null; }
  }

  function setupFcardTilt(card) {
    teardownFcardTilt();
    function applyTilt(rx, ry) {
      if (!card.isConnected) { teardownFcardTilt(); return; }
      card.style.transform = 'perspective(800px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
    }
    // Desktop: follow the cursor (max 6deg).
    fcardMouseHandler = function (e) {
      var r = card.getBoundingClientRect();
      if (!r.width) return;
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      applyTilt(Math.max(-6, Math.min(6, -dy * 6)), Math.max(-6, Math.min(6, dx * 6)));
    };
    window.addEventListener('mousemove', fcardMouseHandler);
    // Mobile: gyroscope (max 30deg for a dramatic tilt).
    function addOrient() {
      fcardOrientHandler = function (ev) {
        var gamma = ev.gamma || 0, beta = ev.beta || 0; // left-right, front-back
        applyTilt(Math.max(-30, Math.min(30, -(beta - 45) / 5)), Math.max(-30, Math.min(30, gamma / 5)));
      };
      window.addEventListener('deviceorientation', fcardOrientHandler);
    }
    var DOE = window.DeviceOrientationEvent;
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && DOE && typeof DOE.requestPermission === 'function') {
      // iOS: permission is requested synchronously in navGo (the nav-tap
      // gesture); attach the listener only once it has been granted.
      if (fcardMotionGranted) addOrient();
    } else if (DOE) {
      addOrient(); // Android (and desktop, where no orientation events fire) — automatic
    }
  }

  // ---- Forge Card energy particle halo (orbiting bright embers) ----
  function startHalo(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var W = 0, H = 0;
    function resize() {
      W = canvas.clientWidth || 0;
      H = canvas.clientHeight || 0;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    function rand(a, b) { return a + Math.random() * (b - a); }
    var parts = [];
    function spawn(p) {
      p.ang = rand(0, Math.PI * 2);
      p.spd = rand(0.002, 0.008) * (Math.random() < 0.5 ? 1 : -1);
      p.rad = rand(0.8, 1.02);            // orbit radius factor
      p.size = rand(2, 4);
      p.color = Math.random() < 0.5 ? '232,98,26' : '255,215,0';
      p.alpha = rand(0.5, 1);
      p.life = 1;
      p.shoot = 0;                        // outward burst velocity
      p.shootR = 0;
      return p;
    }
    for (var i = 0; i < 22; i++) parts.push(spawn({}));
    function frame() {
      if (!canvas.isConnected) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (W > 0 && H > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.globalCompositeOperation = 'lighter';
        var cx = W / 2, cy = H / 2, rx = W / 2 - 8, ry = H / 2 - 8;
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          p.ang += p.spd;
          if (p.shoot === 0 && Math.random() < 0.0018) p.shoot = rand(0.5, 1.1); // occasional shoot-out
          if (p.shoot > 0) { p.shootR += p.shoot; p.shoot *= 0.97; p.life -= 0.02; }
          var x = cx + Math.cos(p.ang) * (rx * p.rad + p.shootR);
          var y = cy + Math.sin(p.ang) * (ry * p.rad + p.shootR);
          if (p.life <= 0) { spawn(p); continue; }
          var a = Math.min(1, p.life) * p.alpha;
          var rr = p.size * 2.2;
          var g = ctx.createRadialGradient(x, y, 0, x, y, rr);
          g.addColorStop(0, 'rgba(' + p.color + ',' + a + ')');
          g.addColorStop(1, 'rgba(' + p.color + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function openSettings() {
    var screen = ensureScreen('settings-screen');
    var u = state.user || {};
    var pref = u.plankPreference || null;
    var reminderOn = !!u.reminderEnabled;
    var reminderTime = u.reminderTime || '07:00';
    var hasBio = !!u.biometricCredentialId;

    var logoutIcon = '<svg class="set-signout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

    // Animated inline "Mark 1 Apps" logo (replaces the static PNG in the footer).
    var m1Logo =
      '<svg width="120" height="127" viewBox="0 0 180 190" style="display:block;margin:0 auto;">' +
        '<g fill="#1d4ed8" stroke="#60A5FA" stroke-width="0.8" opacity="0.9">' +
          '<ellipse cx="38" cy="145" rx="5" ry="11" transform="rotate(-80 38 145)" style="animation:m1Shimmer 2s infinite 0s"/>' +
          '<ellipse cx="28" cy="128" rx="5" ry="11" transform="rotate(-65 28 128)" style="animation:m1Shimmer 2s infinite 0.15s"/>' +
          '<ellipse cx="22" cy="108" rx="5" ry="11" transform="rotate(-50 22 108)" style="animation:m1Shimmer 2s infinite 0.3s"/>' +
          '<ellipse cx="22" cy="87" rx="5" ry="11" transform="rotate(-35 22 87)" style="animation:m1Shimmer 2s infinite 0.45s"/>' +
          '<ellipse cx="28" cy="67" rx="5" ry="11" transform="rotate(-20 28 67)" style="animation:m1Shimmer 2s infinite 0.6s"/>' +
          '<ellipse cx="40" cy="50" rx="5" ry="11" transform="rotate(-5 40 50)" style="animation:m1Shimmer 2s infinite 0.75s"/>' +
          '<ellipse cx="57" cy="38" rx="5" ry="11" transform="rotate(12 57 38)" style="animation:m1Shimmer 2s infinite 0.9s"/>' +
          '<ellipse cx="142" cy="145" rx="5" ry="11" transform="rotate(80 142 145)" style="animation:m1Shimmer 2s infinite 0.08s"/>' +
          '<ellipse cx="152" cy="128" rx="5" ry="11" transform="rotate(65 152 128)" style="animation:m1Shimmer 2s infinite 0.23s"/>' +
          '<ellipse cx="158" cy="108" rx="5" ry="11" transform="rotate(50 158 108)" style="animation:m1Shimmer 2s infinite 0.38s"/>' +
          '<ellipse cx="158" cy="87" rx="5" ry="11" transform="rotate(35 158 87)" style="animation:m1Shimmer 2s infinite 0.53s"/>' +
          '<ellipse cx="152" cy="67" rx="5" ry="11" transform="rotate(20 152 67)" style="animation:m1Shimmer 2s infinite 0.68s"/>' +
          '<ellipse cx="140" cy="50" rx="5" ry="11" transform="rotate(5 140 50)" style="animation:m1Shimmer 2s infinite 0.83s"/>' +
          '<ellipse cx="123" cy="38" rx="5" ry="11" transform="rotate(-12 123 38)" style="animation:m1Shimmer 2s infinite 0.98s"/>' +
        '</g>' +
        '<g transform="translate(90,78)" class="m1-bolt">' +
          '<polygon points="8,-28 -8,6 2,6 -6,28 10,-4 0,-4" fill="#3B82F6" stroke="#93C5FD" stroke-width="1"/>' +
        '</g>' +
        '<g transform="translate(90,138)">' +
          '<ellipse cx="0" cy="0" rx="24" ry="15" fill="none" stroke="#3B82F6" stroke-width="1.6"/>' +
          '<ellipse cx="0" cy="0" rx="11" ry="15" fill="none" stroke="#3B82F6" stroke-width="0.9" opacity="0.55"/>' +
          '<line x1="-24" y1="0" x2="24" y2="0" stroke="#3B82F6" stroke-width="0.9" opacity="0.55" stroke-dasharray="3 2">' +
            '<animate attributeName="stroke-dashoffset" from="0" to="-14" dur="2s" repeatCount="indefinite"/>' +
          '</line>' +
          '<line x1="0" y1="-15" x2="0" y2="15" stroke="#3B82F6" stroke-width="0.8" opacity="0.35"/>' +
          '<ellipse cx="0" cy="0" rx="24" ry="8" fill="none" stroke="#3B82F6" stroke-width="0.7" opacity="0.3"/>' +
        '</g>' +
      '</svg>';

    screen.innerHTML =
      '<header class="set-header">' +
        '<canvas class="set-embers"></canvas>' +
        '<h1 class="settings-title">SETTINGS</h1>' +
        '<div class="set-id">' +
          '<div class="set-avatar-ring">' + avatarMarkup(u.name, 'set-avatar') + '</div>' +
          '<p class="set-name">' + esc(u.name || 'Forger') + '</p>' +
        '</div>' +
      '</header>' +

      '<section class="set-section">' +
        '<p class="set-section-title">Reminders</p>' +
        '<div class="set-card">' +
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
        '</div>' +
      '</section>' +

      '<section class="set-section">' +
        '<p class="set-section-title">Plank Preference</p>' +
        '<div class="plank-opts">' +
          plankOption('forward', 'Forward Plank', 'Classic core hold, face down', pref) +
          plankOption('reverse', 'Reverse Plank', 'Posterior chain hold, face up', pref) +
        '</div>' +
      '</section>' +

      '<section class="set-section">' +
        '<p class="set-section-title">Face ID</p>' +
        '<div class="set-card">' +
          '<span class="set-label">Use Face ID to sign in on this device</span>' +
          (hasBio
            ? '<button type="button" class="btn-outline set-bio-disable">Disable Face ID</button>'
            : '<button type="button" class="btn-outline set-bio-enable">Enable Face ID</button>') +
          '<p class="set-bio-msg message" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</section>' +

      '<section class="set-section">' +
        '<p class="set-section-title">App</p>' +
        '<div class="set-actions">' +
          '<button type="button" class="btn-outline set-view-intro">View intro</button>' +
          '<button type="button" class="btn-outline set-check-updates">Check for Updates</button>' +
          (isAdmin() ? '<button type="button" class="btn-outline set-admin">Admin</button>' : '') +
        '</div>' +
      '</section>' +

      '<section class="set-section set-section--account">' +
        '<p class="set-section-title">Account</p>' +
        '<button type="button" class="set-signout">' + logoutIcon + 'Sign out</button>' +
      '</section>' +

      '<p class="message set-msg" role="status" aria-live="polite"></p>' +

      '<footer class="settings-footer">' +
        m1Logo +
        '<p class="m1-logo-text">Mark 1 Apps</p>' +
        '<p class="settings-version">' + esc(appVersion()) + '</p>' +
        '<p class="m1-credit">Built by Mark One Apps</p>' +
      '</footer>';

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

    var checkBtn = screen.querySelector('.set-check-updates');
    if (checkBtn) checkBtn.addEventListener('click', function () { onCheckUpdates(checkBtn); });

    var introBtn = screen.querySelector('.set-view-intro');
    if (introBtn) introBtn.addEventListener('click', function () { showOnboarding({ fromSettings: true }); });

    var adminBtn = screen.querySelector('.set-admin');
    if (adminBtn) adminBtn.addEventListener('click', openAdmin);

    showScreen(screen);
    showNav('settings');

    var saveBtn = screen.querySelector('#save-reminders');
    if (saveBtn) addFire(saveBtn); // fire animation on the Save button
    var setEmbers = screen.querySelector('.set-embers');
    if (setEmbers) startEmbers(setEmbers); // subtle embers behind the header
  }

  // The current app version (single source of truth: the login-screen badge).
  function appVersion() {
    var el = document.querySelector('.brand-version');
    return el ? el.textContent : '';
  }

  // Force a service-worker update check from Settings.
  function onCheckUpdates(btn) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) {
      btn.textContent = 'Updates unavailable';
      setTimeout(function () { btn.textContent = 'Check for Updates'; }, 2000);
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    var settled = false;
    function settle(text, reload) {
      if (settled) return;
      settled = true;
      btn.textContent = text;
      if (reload) {
        setTimeout(function () { window.location.reload(); }, 2000);
      } else {
        setTimeout(function () { btn.textContent = 'Check for Updates'; btn.disabled = false; }, 2000);
      }
    }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { settle('You are up to date', false); return; }
      var onFound = function () { settle('Update available — tap to reload', true); };
      reg.addEventListener('updatefound', onFound);
      try { reg.update(); } catch (e) {}
      setTimeout(function () {
        reg.removeEventListener('updatefound', onFound);
        settle('You are up to date', false);
      }, 3000);
    }).catch(function () { settle('You are up to date', false); });
  }

  // ===================================================================
  // Onboarding (first login + Settings "View intro")
  // ===================================================================
  // Pull the latest card content from notices/onboarding (admin-editable),
  // falling back to the hardcoded defaults for any missing field.
  function loadOnboarding() {
    return db.collection('notices').doc('onboarding').get()
      .then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : {};
        onboardingCards = ONBOARDING_DEFAULT.map(function (def, i) {
          var n = i + 1;
          return {
            heading: d['card' + n + 'heading'] || def.heading,
            body: d['card' + n + 'body'] || def.body
          };
        });
      })
      .catch(function (err) {
        console.error('Failed to load onboarding notice:', err);
        onboardingCards = ONBOARDING_DEFAULT.slice();
      });
  }

  function showOnboarding(opts) {
    loadOnboarding().then(function () { renderOnboarding(opts || {}); });
  }

  function renderOnboarding(opts) {
    opts = opts || {};
    var fromSettings = !!opts.fromSettings;
    var screen = ensureScreen('onboarding-screen');
    var idx = 0;

    function exit() { if (fromSettings) openSettings(); else enterHome(); }
    function finish() { window.localStorage.setItem(ONBOARDING_KEY, 'true'); exit(); }

    function render() {
      var total = onboardingCards.length;
      var card = onboardingCards[idx] || ONBOARDING_DEFAULT[idx];
      var last = idx === total - 1;
      var dots = '';
      for (var i = 0; i < total; i++) {
        dots += '<span class="onb-dot' + (i === idx ? ' is-active' : '') + '"></span>';
      }
      var showTopLink = fromSettings || !last; // Skip hidden on the last card (first-login)
      var topRight = showTopLink
        ? '<button type="button" class="btn-link onb-skip">' + (fromSettings ? 'Close' : 'Skip') + '</button>'
        : '<span></span>';
      var editBtn = isAdmin()
        ? '<button type="button" class="btn-link onb-edit">Edit</button>'
        : '<span></span>';

      var footer;
      if (last) {
        footer =
          '<button type="button" class="btn-forge onb-forge">Let\'s Forge</button>' +
          (fromSettings ? '' : '<button type="button" class="btn-link onb-dontshow">Don\'t show again</button>') +
          (idx > 0 ? '<button type="button" class="btn-link onb-back">Back</button>' : '');
      } else {
        footer = '<div class="onb-nav">' +
          (idx > 0 ? '<button type="button" class="btn-outline onb-back">Back</button>' : '') +
          '<button type="button" class="btn-forge onb-next">Next</button>' +
        '</div>';
      }

      screen.innerHTML =
        '<header class="brand brand--compact"><h1 class="brand-name">FORGE</h1></header>' +
        '<div class="onb-top">' + editBtn + topRight + '</div>' +
        '<div class="onb-card">' +
          '<h2 class="onb-heading">' + esc(card.heading) + '</h2>' +
          '<p class="onb-body">' + esc(card.body) + '</p>' +
        '</div>' +
        '<div class="onb-dots">' + dots + '</div>' +
        footer;

      var skip = screen.querySelector('.onb-skip');
      if (skip) skip.addEventListener('click', exit);
      var edit = screen.querySelector('.onb-edit');
      if (edit) edit.addEventListener('click', function () { openOnboardingEdit(opts); });
      var back = screen.querySelector('.onb-back');
      if (back) back.addEventListener('click', function () { if (idx > 0) { idx--; render(); } });
      var next = screen.querySelector('.onb-next');
      if (next) next.addEventListener('click', function () { if (idx < total - 1) { idx++; render(); } });
      var forge = screen.querySelector('.onb-forge');
      if (forge) { forge.addEventListener('click', finish); addFire(forge); }
      var dont = screen.querySelector('.onb-dontshow');
      if (dont) dont.addEventListener('click', finish);

      // Swipe left/right on the card (fresh listeners each render — old DOM is replaced).
      var cardEl = screen.querySelector('.onb-card');
      var sx = null;
      cardEl.addEventListener('touchstart', function (e) { sx = e.changedTouches[0].clientX; }, { passive: true });
      cardEl.addEventListener('touchend', function (e) {
        if (sx === null) return;
        var dx = e.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0 && idx < total - 1) { idx++; render(); }
        else if (dx > 0 && idx > 0) { idx--; render(); }
      }, { passive: true });

      showScreen(screen);
    }

    render();
  }

  // Mark-only: edit the onboarding card content (saved to notices/onboarding).
  function openOnboardingEdit(opts) {
    var screen = ensureScreen('onboarding-edit-screen');
    var rows = '';
    for (var i = 0; i < ONBOARDING_DEFAULT.length; i++) {
      var c = onboardingCards[i] || ONBOARDING_DEFAULT[i];
      var n = i + 1;
      rows +=
        '<div class="onb-edit-row">' +
          '<label class="field"><span class="field-label">Card ' + n + ' heading</span>' +
            '<input class="onb-edit-h" data-i="' + i + '" type="text" value="' + esc(c.heading) + '" /></label>' +
          '<label class="field"><span class="field-label">Card ' + n + ' body</span>' +
            '<textarea class="onb-edit-b" data-i="' + i + '" rows="3">' + esc(c.body) + '</textarea></label>' +
        '</div>';
    }
    screen.innerHTML =
      '<header class="topbar">' +
        '<button type="button" class="btn-link back-btn">← Back</button>' +
        '<span class="topbar-version">EDIT INTRO</span>' +
      '</header>' +
      '<h1 class="log-title">Edit Intro</h1>' +
      rows +
      '<button type="button" class="btn-forge onb-edit-save">Save</button>' +
      '<p class="message onb-edit-msg" role="status" aria-live="polite"></p>';
    showScreen(screen);

    screen.querySelector('.back-btn').addEventListener('click', function () { renderOnboarding(opts); });
    screen.querySelector('.onb-edit-save').addEventListener('click', function () {
      var data = {};
      Array.prototype.forEach.call(screen.querySelectorAll('.onb-edit-h'), function (inp) {
        data['card' + (Number(inp.getAttribute('data-i')) + 1) + 'heading'] = inp.value;
      });
      Array.prototype.forEach.call(screen.querySelectorAll('.onb-edit-b'), function (ta) {
        data['card' + (Number(ta.getAttribute('data-i')) + 1) + 'body'] = ta.value;
      });
      db.collection('notices').doc('onboarding').set(data, { merge: true })
        .then(function () {
          for (var i = 0; i < ONBOARDING_DEFAULT.length; i++) {
            onboardingCards[i] = { heading: data['card' + (i + 1) + 'heading'], body: data['card' + (i + 1) + 'body'] };
          }
          renderOnboarding(opts);
        })
        .catch(function (err) { setMessage(screen.querySelector('.onb-edit-msg'), friendlyError(err), true); });
    });
  }

  // ===================================================================
  // Admin panel (Mark only)
  // ===================================================================
  // Spinner + checkmark SVGs for admin loading/success states.
  var ADMIN_SPINNER = '<svg class="admin-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="42 60"/></svg>';
  var ADMIN_CHECK = '<svg class="admin-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  var ADMIN_RESET_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6l2 2"/>' +
    '<polyline points="20.5 3 20.5 8 15.5 8"/><path d="M20.5 12a8.5 8.5 0 0 1-14.5 6l-2-2"/>' +
    '<polyline points="3.5 21 3.5 16 8.5 16"/></svg>';

  // App-styled confirm modal. opts: { title, body, confirmLabel, danger, onConfirm(cBtn, close, overlay) }
  function showAdminConfirm(opts) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML =
      '<div class="admin-modal">' +
        '<p class="admin-modal-title">' + esc(opts.title || 'Confirm') + '</p>' +
        '<p class="admin-modal-body">' + esc(opts.body || '') + '</p>' +
        '<p class="admin-modal-msg message" role="status" aria-live="polite"></p>' +
        '<div class="admin-modal-actions">' +
          '<button type="button" class="btn-link admin-modal-cancel">Cancel</button>' +
          '<button type="button" class="admin-modal-confirm' + (opts.danger ? ' admin-modal-confirm--danger' : '') +
            '">' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('is-visible'); });
    function close() { overlay.classList.remove('is-visible'); setTimeout(function () { overlay.remove(); }, 200); }
    overlay.querySelector('.admin-modal-cancel').addEventListener('click', close);
    var cBtn = overlay.querySelector('.admin-modal-confirm');
    cBtn.addEventListener('click', function () { opts.onConfirm(cBtn, close, overlay); });
  }

  function openAdmin() {
    var screen = ensureScreen('admin-screen');
    var backArrow = '<svg class="admin-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

    screen.innerHTML =
      '<div class="admin-topbar"><button type="button" class="admin-back">' + backArrow + 'Back</button></div>' +

      '<header class="admin-header">' +
        '<canvas class="admin-embers"></canvas>' +
        '<h1 class="admin-title">ADMIN PANEL</h1>' +
        '<p class="admin-subtitle">Squad management. Challenge control.</p>' +
        '<span class="admin-underline"></span>' +
      '</header>' +

      '<section class="admin-section">' +
        '<p class="set-section-title">Challenge Data</p>' +
        '<div class="admin-danger-card">' +
          '<p class="admin-warn">Deletes all logs, resets every score and streak to zero, and clears the ' +
            'activity feed and message board. This cannot be undone.</p>' +
          '<button type="button" class="admin-reset">Reset All Challenge Data</button>' +
          '<p class="admin-reset-msg" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</section>' +

      '<section class="admin-section">' +
        '<p class="set-section-title">Squad</p>' +
        '<div class="admin-users"><p class="feed-empty">Loading…</p></div>' +
      '</section>' +

      '<section class="admin-section">' +
        '<p class="set-section-title">Add to Squad</p>' +
        '<div class="admin-add-card">' +
          '<label class="admin-field"><span class="admin-field-label">First name</span>' +
            '<input type="text" class="admin-add-name" placeholder="e.g. Hayley" /></label>' +
          '<label class="admin-field"><span class="admin-field-label">Avatar filename</span>' +
            '<input type="text" class="admin-add-avatar" placeholder="e.g. hayley.png" /></label>' +
          '<div class="admin-add-preview"></div>' +
          '<button type="button" class="btn-forge admin-add-btn">Add to Squad</button>' +
          '<p class="admin-add-msg message" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</section>';

    showScreen(screen);

    screen.querySelector('.admin-back').addEventListener('click', openSettings);

    // ---- Reset flow ----
    screen.querySelector('.admin-reset').addEventListener('click', function () {
      var rm = screen.querySelector('.admin-reset-msg');
      showAdminConfirm({
        title: 'Reset Challenge Data',
        body: 'This deletes all logs and clears every score, streak, the activity feed and the message ' +
          'board. This cannot be undone.',
        confirmLabel: 'Reset Everything',
        danger: true,
        onConfirm: function (cBtn, close, overlay) {
          cBtn.disabled = true;
          cBtn.innerHTML = ADMIN_SPINNER + 'Resetting…';
          resetChallengeData(function (ok, text) {
            if (!ok) {
              cBtn.disabled = false;
              cBtn.textContent = 'Reset Everything';
              setMessage(overlay.querySelector('.admin-modal-msg'), text, true);
              return;
            }
            rm.innerHTML = ADMIN_CHECK + 'Challenge data reset.';
            rm.className = 'admin-reset-msg admin-ok';
            loadAdminUsers(screen.querySelector('.admin-users'));
            close();
          });
        }
      });
    });

    // ---- Add-to-squad flow ----
    var addName = screen.querySelector('.admin-add-name');
    var addAvatar = screen.querySelector('.admin-add-avatar');
    var preview = screen.querySelector('.admin-add-preview');
    var addMsg = screen.querySelector('.admin-add-msg');
    function avatarPath(fn) {
      fn = (fn || '').trim();
      if (!fn) return '';
      return fn.indexOf('/') >= 0 ? fn : 'images/' + fn;
    }
    addAvatar.addEventListener('input', function () {
      var path = avatarPath(addAvatar.value);
      if (!path) { preview.innerHTML = ''; return; }
      preview.innerHTML = '<img class="admin-add-img" src="' + esc(path) + '" alt="" />' +
        '<span class="admin-add-prevnote"></span>';
      var img = preview.querySelector('img');
      var note = preview.querySelector('.admin-add-prevnote');
      img.addEventListener('error', function () {
        img.classList.add('hidden');
        note.textContent = 'Image not found in images/';
        note.classList.add('is-error');
      });
      img.addEventListener('load', function () {
        img.classList.remove('hidden');
        note.textContent = 'Preview';
        note.classList.remove('is-error');
      });
    });

    var addBtn = screen.querySelector('.admin-add-btn');
    addBtn.addEventListener('click', function () {
      var name = (addName.value || '').trim();
      if (!name) { setMessage(addMsg, 'Enter a first name.', true); return; }
      name = name.charAt(0).toUpperCase() + name.slice(1);
      var path = avatarPath(addAvatar.value);
      addBtn.disabled = true;
      db.collection('users').add({
        name: name,
        avatar: path || null,
        totalPoints: 0,
        currentStreak: 0,
        longestStreak: 0,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        if (path) AVATARS[name] = path;        // photo shows in carousel + everywhere
        if (TEAM.indexOf(name) < 0) TEAM.push(name);
        usersLoaded = false;
        renderCarousel();                       // new user appears in the login carousel now
        fireConfettiCannon();
        setMessage(addMsg, name + ' added to the squad!');
        addName.value = ''; addAvatar.value = ''; preview.innerHTML = '';
        addBtn.disabled = false;
        loadAdminUsers(screen.querySelector('.admin-users'));
      }).catch(function (err) {
        addBtn.disabled = false;
        setMessage(addMsg, friendlyError(err), true);
      });
    });

    loadAdminUsers(screen.querySelector('.admin-users'));
    addFire(addBtn); // fire on the primary Add button

    var emb = screen.querySelector('.admin-embers');
    if (emb) startEmbers(emb); // subtle embers behind the header
  }

  // Delete every document in a top-level collection.
  function deleteCollection(name) {
    return db.collection(name).get().then(function (snap) {
      return Promise.all(snap.docs.map(function (d) { return d.ref.delete(); }));
    });
  }

  // Reset all challenge data (logs, points, streaks, feed, board, cheers).
  // done(ok, text) — the caller manages the button/loading UI.
  function resetChallengeData(done) {
    db.collection('users').get()
      .then(function (usnap) {
        var docs = usnap.docs;
        // 1. Reset each user's score fields.
        return Promise.all(docs.map(function (d) {
          return d.ref.set({ totalPoints: 0, currentStreak: 0, longestStreak: 0 }, { merge: true });
        }))
        // 2. Delete every user's logs subcollection.
        .then(function () {
          return Promise.all(docs.map(function (d) {
            return d.ref.collection('logs').get().then(function (lsnap) {
              return Promise.all(lsnap.docs.map(function (l) { return l.ref.delete(); }));
            });
          }));
        });
      })
      .then(function () { return deleteCollection('activities'); }) // 3
      .then(function () { return deleteCollection('messages'); })   // 4
      .then(function () { return deleteCollection('cheers'); })     // 5
      .then(function () {
        // Reflect the reset in the current session.
        if (state.user) { state.user.totalPoints = 0; state.user.currentStreak = 0; state.user.longestStreak = 0; }
        state.logs = [];
        done(true, 'Challenge data reset successfully. All scores and logs have been cleared.'); // 6
      })
      .catch(function (err) { done(false, friendlyError(err)); });
  }

  // Premium squad list for the admin panel — status-ringed user cards.
  function loadAdminUsers(container) {
    var today = dateKey(new Date());
    Promise.all([
      db.collection('users').get(),
      db.collectionGroup('logs').where('date', '==', today).get()
        .catch(function () { return { forEach: function () {} }; }) // logged-today is best-effort
    ]).then(function (res) {
      var loggedToday = {};
      res[1].forEach(function (doc) {
        try { loggedToday[doc.ref.parent.parent.id] = true; } catch (e) { /* no-op */ }
      });

      // Deduplicate by name — if a name has two docs, keep the most recent
      // joinedAt and discard the other (e.g. a duplicate "Liisa").
      var byName = {};
      res[0].docs.forEach(function (d) {
        var u = d.data() || {};
        var key = cleanName(u.name, u.email).toLowerCase();
        var jt = (u.joinedAt && u.joinedAt.toMillis) ? u.joinedAt.toMillis() : 0;
        if (!byName[key] || jt > byName[key].jt) byName[key] = { doc: d, jt: jt };
      });
      var docs = Object.keys(byName).map(function (k) { return byName[k].doc; })
        .sort(function (a, b) {
          return ((b.data() || {}).totalPoints || 0) - ((a.data() || {}).totalPoints || 0);
        });

      var rows = docs.map(function (d, i) {
        var u = d.data() || {};
        var name = cleanName(u.name, u.email);
        var joined = (u.joinedAt && u.joinedAt.toDate) ? u.joinedAt.toDate().toLocaleDateString() : '—';
        var hasBio = !!u.biometricCredentialId;
        var pts = u.totalPoints || 0;
        var ring = loggedToday[d.id] ? 'admin-ring--green'
          : ((pts > 0 || hasBio) ? 'admin-ring--orange' : 'admin-ring--grey');
        var faceBadge = hasBio
          ? '<span class="admin-badge admin-badge--face">FACE ID ✓</span>'
          : '<span class="admin-badge admin-badge--noface">NO FACE ID</span>';
        return '<div class="admin-user" style="animation-delay:' + (Math.min(i, 12) * 80) + 'ms">' +
                 '<div class="admin-user-ring ' + ring + '">' + avatarMarkup(name, 'admin-avatar') + '</div>' +
                 '<div class="admin-user-info">' +
                   '<span class="admin-user-name">' + esc(name) + '</span>' +
                   '<span class="admin-user-join">Joined ' + esc(joined) + '</span>' +
                   faceBadge +
                 '</div>' +
                 '<span class="admin-user-pts">' + pts + ' pts</span>' +
                 '<div class="admin-user-actions">' +
                   '<button type="button" class="admin-user-reset" data-uid="' + esc(d.id) +
                     '" data-name="' + esc(name) + '" aria-label="Reset ' + esc(name) + '">' + ADMIN_RESET_ICON + '</button>' +
                   '<button type="button" class="admin-user-remove" data-remove-id="' + esc(d.id) +
                     '" data-remove-name="' + esc(name) + '" aria-label="Remove ' + esc(name) + '">×</button>' +
                 '</div>' +
               '</div>';
      }).join('');
      container.innerHTML = rows || '<p class="feed-empty">No users registered yet.</p>';

      // Per-user reset — clears one user's logs/points/streaks + their activities.
      Array.prototype.forEach.call(container.querySelectorAll('.admin-user-reset'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-uid');
          var nm = btn.getAttribute('data-name');
          showAdminConfirm({
            title: 'Reset Challenge Data',
            body: 'Reset ' + nm + "'s challenge data? This will clear their logs, points and " +
              'streaks but keep their account. This cannot be undone.',
            confirmLabel: 'Confirm Reset',
            danger: true,
            onConfirm: function (cBtn, close, overlay) {
              cBtn.disabled = true;
              cBtn.innerHTML = ADMIN_SPINNER + 'Resetting…';
              resetUserData(id, nm).then(function () {
                close();
                var card = btn.parentNode && btn.parentNode.parentNode; // .admin-user
                if (card && card.classList && card.classList.contains('admin-user')) {
                  var ok = document.createElement('div');
                  ok.className = 'admin-user-resetok';
                  ok.innerHTML = ADMIN_CHECK + esc(nm) + ' reset successfully';
                  card.appendChild(ok);
                }
                setTimeout(function () { loadAdminUsers(container); }, 2000); // revert to normal
              }).catch(function (err) {
                cBtn.disabled = false;
                cBtn.textContent = 'Confirm Reset';
                setMessage(overlay.querySelector('.admin-modal-msg'), friendlyError(err), true);
              });
            }
          });
        });
      });

      Array.prototype.forEach.call(container.querySelectorAll('.admin-user-remove'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-remove-id');
          var nm = btn.getAttribute('data-remove-name');
          showAdminConfirm({
            title: 'Remove from Forge',
            body: 'Remove ' + nm + ' from Forge? This cannot be undone.',
            confirmLabel: 'Remove',
            danger: true,
            onConfirm: function (cBtn, close, overlay) {
              cBtn.disabled = true;
              cBtn.innerHTML = ADMIN_SPINNER + 'Removing…';
              // Delete the user doc only — their logs subcollection is left intact.
              db.collection('users').doc(id).delete().then(function () {
                var ti = TEAM.indexOf(nm);
                if (ti >= 0) TEAM.splice(ti, 1); // drop from the carousel immediately
                usersLoaded = false;
                renderCarousel();
                close();
                loadAdminUsers(container);
              }).catch(function (err) {
                cBtn.disabled = false;
                cBtn.textContent = 'Remove';
                setMessage(overlay.querySelector('.admin-modal-msg'), friendlyError(err), true);
              });
            }
          });
        });
      });
    }).catch(function (err) {
      container.innerHTML = '<p class="message is-error">' + esc(friendlyError(err)) + '</p>';
    });
  }

  // Reset a single user's challenge data — scores, logs, and their feed activities.
  // Does NOT touch any other user, and keeps the account in place.
  function resetUserData(userId, userName) {
    var userRef = db.collection('users').doc(userId);
    return userRef.set({ totalPoints: 0, currentStreak: 0, longestStreak: 0 }, { merge: true })
      .then(function () {
        return userRef.collection('logs').get().then(function (snap) {
          return Promise.all(snap.docs.map(function (l) { return l.ref.delete(); }));
        });
      })
      .then(function () {
        return db.collection('activities').where('userName', '==', userName).get().then(function (snap) {
          return Promise.all(snap.docs.map(function (a) { return a.ref.delete(); }));
        });
      })
      .then(function () {
        // If the admin reset their own account, reflect it in the live session.
        if (state.user && state.user.id === userId) {
          state.user.totalPoints = 0; state.user.currentStreak = 0; state.user.longestStreak = 0;
          state.logs = [];
        }
      });
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
    var name = state.user ? state.user.name : 'Forger';
    screen.innerHTML =
      '<canvas class="board-embers"></canvas>' +
      '<header class="board-head">' +
        '<span class="board-brand">FORGE</span>' +
        '<h1 class="board-welcome">WELCOME BACK, ' + esc(name.toUpperCase()) + '</h1>' +
        '<p class="board-subtitle"></p>' +
      '</header>' +
      '<p class="section-heading">Today\'s Squad</p>' +
      '<div id="squad-row" class="squad-row"></div>' +
      '<div class="squad-legend">🟢 Trained today&nbsp;&nbsp;🔴 Yet to train&nbsp;&nbsp;⚪ Rest day</div>' +
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

    // Subtle ember particles behind the screen (same as the Plan hero).
    var embers = screen.querySelector('.board-embers');
    if (embers) startEmbers(embers);
    startBoardSubtitle(screen.querySelector('.board-subtitle'));
  }

  // Rotate the Messages-header subtitle every 4s with a fade transition.
  function startBoardSubtitle(el) {
    if (boardSubtitleTimer) { clearInterval(boardSubtitleTimer); boardSubtitleTimer = null; }
    if (!el) return;
    var day = challengeDay(new Date());
    var dayLabel = day < 1 ? 0 : (day > TOTAL_DAYS ? TOTAL_DAYS : day);
    var subs = ['The squad is watching.', 'Every rep counts.', 'Built together.',
                'Day ' + dayLabel + ' of ' + TOTAL_DAYS + '.'];
    var idx = 0;
    el.textContent = subs[0];
    boardSubtitleTimer = setInterval(function () {
      if (!el.isConnected) { clearInterval(boardSubtitleTimer); boardSubtitleTimer = null; return; }
      idx = (idx + 1) % subs.length;
      el.style.opacity = '0';
      setTimeout(function () {
        if (!el.isConnected) return;
        el.textContent = subs[idx];
        el.style.opacity = '1';
      }, 400);
    }, 4000);
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

    // Deduplicate by name (case-insensitive) so a duplicate never shows twice.
    var seenNames = {};
    var uniqueTeam = TEAM.filter(function (name) {
      var key = String(name).toLowerCase();
      if (seenNames[key]) return false;
      seenNames[key] = true;
      return true;
    });

    row.innerHTML = uniqueTeam.map(function (name) {
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

    var newCount = 0;
    feed.innerHTML = entries.map(function (e) {
      // Only items absent from the previous render fade in (staggered, capped).
      var isNew = !seenFeedIds.has(e._id);
      var newCls = isNew ? ' feed-new' : '';
      var animStyle = isNew ? ' style="animation-delay:' + (Math.min(newCount++, 10) * 40) + 'ms"' : '';
      var del = isAdmin()
        ? '<button type="button" class="feed-del" data-del-kind="' + e._kind +
          '" data-del-id="' + e._id + '" aria-label="Delete">×</button>'
        : '';
      if (e._kind === 'activity') {
        var feedName = cleanName(e.userName);
        var moodIcon = moodIconHtml(e.mood); // same SVG as the logging screen
        var reacts = (e.reactions || []).map(function (n) {
          return avatarMarkup(cleanName(n), 'react-avatar');
        }).join('');
        // Consolidated session posts carry a message; legacy logs describe the exercise.
        var text = e.message
          ? esc(e.message)
          : '<strong>' + esc(feedName) + '</strong> completed ' +
            esc(e.exercise) + ' — ' + esc(e.repsCompleted || '');
        // Mood photo thumbnail (to the right of the mood icon), opens a lightbox.
        var photoHtml = '';
        if (e.photoThumb) {
          var pdate = (e.timestamp && e.timestamp.toDate) ? shortDate(e.timestamp.toDate()) : '';
          photoHtml = '<img class="feed-photo" src="' + esc(e.photoThumb) + '" alt="Workout photo" ' +
            'data-full="' + esc(e.photoFull || e.photoThumb) + '" data-name="' + esc(feedName) +
            '" data-date="' + esc(pdate) + '">';
        }
        return '<div class="feed-card feed-activity' + newCls + '"' + animStyle + '>' +
                 avatarMarkup(feedName, 'feed-avatar') +
                 '<div class="feed-body">' +
                   '<p class="feed-text">' + text + '</p>' +
                   (reacts ? '<div class="feed-reactions">' + reacts + '</div>' : '') +
                 '</div>' +
                 '<div class="feed-side">' +
                   '<div class="feed-side-top">' + moodIcon + photoHtml + '</div>' +
                   '<button type="button" class="react-btn" data-react="' + e._id + '">🎉</button>' +
                   '<span class="feed-time">' + feedTime(e.timestamp) + '</span>' +
                 '</div>' + del +
               '</div>';
      }
      var msgName = cleanName(e.userName);
      var isOwn = !!(state.user && e.userId && e.userId === state.user.id);
      return '<div class="chat-row' + (isOwn ? ' chat-own' : '') + newCls + '"' + animStyle + '>' +
               avatarMarkup(msgName, 'chat-avatar') +
               '<div class="chat-col">' +
                 '<span class="chat-name">' + esc(msgName) + '</span>' +
                 '<div class="chat-bubble">' + esc(e.message || '') + '</div>' +
                 '<span class="chat-time">' + feedTime(e.timestamp) + '</span>' +
               '</div>' + del +
             '</div>';
    }).join('') || '<p class="feed-empty">No activity yet — be the first to post!</p>';

    // Remember the ids rendered this pass so they won't re-animate next render.
    seenFeedIds = new Set(entries.map(function (e) { return e._id; }));

    Array.prototype.forEach.call(feed.querySelectorAll('.feed-photo'), function (img) {
      img.addEventListener('click', function () {
        showPhotoLightbox(img.getAttribute('data-full'), img.getAttribute('data-name'), img.getAttribute('data-date'));
      });
    });

    Array.prototype.forEach.call(feed.querySelectorAll('[data-react]'), function (btn) {
      btn.addEventListener('click', function () {
        cheerBurst(btn); // mini confetti + button pop
        var id = btn.getAttribute('data-react');
        addReaction(id);
        var act = boardActivities.filter(function (a) { return a._id === id; })[0];
        if (act) {
          var to = cleanName(act.userName);
          writeCheer(to);       // notify the cheered user
          showCheerToast(to);   // brief on-screen confirmation
        }
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

  // Cheer button feedback: a quick scale "pop" plus a mini canvas confetti burst.
  function cheerBurst(btn) {
    btn.classList.remove('react-pop');
    void btn.offsetWidth; // restart the CSS animation
    btn.classList.add('react-pop');
    setTimeout(function () { btn.classList.remove('react-pop'); }, 240);
    miniConfetti(btn);
  }

  // Small canvas confetti burst centred on a button (20 particles, ~500ms).
  function miniConfetti(btn) {
    var rect = btn.getBoundingClientRect();
    var size = 84;
    var canvas = document.createElement('canvas');
    canvas.className = 'mini-confetti';
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
    canvas.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    ctx.scale(dpr, dpr);
    var colors = ['#E8621A', '#F5F0E8', '#27AE60', '#FFD700', '#ffffff'];
    var parts = [];
    for (var i = 0; i < 20; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = 1.4 + Math.random() * 2.6;
      parts.push({ x: size / 2, y: size / 2, vx: Math.cos(ang) * spd,
                   vy: Math.sin(ang) * spd - 1, r: 2 + Math.random() * 2,
                   c: colors[i % colors.length] });
    }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = (ts - start) / 500;
      ctx.clearRect(0, 0, size, size);
      var life = 1 - t;
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        p.x += p.vx; p.y += p.vy; p.vy += 0.12;
        ctx.globalAlpha = Math.max(0, life);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t < 1) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  // Brief bottom-of-screen toast confirming a cheer was sent.
  // Standard Forge toast — brief bottom-of-screen confirmation.
  function showToast(text) {
    var toast = document.createElement('div');
    toast.className = 'cheer-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2000);
  }

  function showCheerToast(name) { showToast('Cheer sent to ' + name + '!'); }

  // Big centre-screen confetti cannon (used by the cheer pop-up).
  function fireConfettiCannon() {
    var colors = ['#E8621A', '#F5F0E8', '#27AE60', '#FFD700', '#ffffff'];
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (var i = 0; i < 40; i++) {
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 480) + 'px');
      p.style.setProperty('--dy', (-(Math.random() * 360 + 120)) + 'px');
      document.body.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 1100); })(p);
    }
  }

  // ---- Cheers (confetti notifications between squad members) -------
  function avatarFileFor(name) {
    return AVATARS[name] ? AVATARS[name].split('/').pop() : null;
  }

  // Tapping a feed cheer button writes a cheer doc the recipient sees next time.
  function writeCheer(toName) {
    var fromName = cleanName(state.user && state.user.name, '');
    if (!toName || !fromName || toName === fromName) return; // no self-cheers
    var msgs = [
      fromName + ' is cheering you on! 🎉',
      fromName + ' thinks you are smashing it! 🔥',
      fromName + ' just fired the confetti cannon for you! 🎊',
      fromName + ' says keep going, you legend! 💪'
    ];
    db.collection('cheers').add({
      fromName: fromName,
      fromAvatar: avatarFileFor(fromName),
      toName: toName,
      toAvatar: avatarFileFor(toName),
      message: msgs[Math.floor(Math.random() * msgs.length)],
      seen: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function (err) { console.error('Failed to write cheer:', err); });
  }

  // ---- Real-time cheer listener + display queue --------------------
  var cheersUnsub = null;     // onSnapshot unsubscribe handle
  var cheerQueue = [];        // unseen cheer docs awaiting display
  var cheerShowing = false;   // a pop-up is currently on screen
  var shownCheerIds = {};     // ids already shown this session (de-dupe)

  // Live listener: pop up unseen cheers for the current user in real time.
  // Uses the requested compound query; on a missing-index error it falls back
  // to a toName-only listener (unseen filtered client-side) so it still works.
  function startCheerListener() {
    stopCheerListener();
    if (!state.user) return;
    var myName = cleanName(state.user.name, '');

    function handle(snap) {
      snap.docChanges().forEach(function (chg) {
        if (chg.type === 'removed') return;
        var d = chg.doc;
        if ((d.data() || {}).seen === false) queueOrShowCheer(d);
      });
    }
    cheersUnsub = db.collection('cheers')
      .where('toName', '==', myName).where('seen', '==', false)
      .onSnapshot(handle, function (err) {
        console.error('Cheers listener (compound) failed, falling back:', err);
        cheersUnsub = db.collection('cheers').where('toName', '==', myName)
          .onSnapshot(handle, function (e2) { console.error('Cheers listener failed:', e2); });
      });
  }

  function stopCheerListener() {
    if (cheersUnsub) { cheersUnsub(); cheersUnsub = null; }
    cheerQueue = [];
    cheerShowing = false;
  }

  function queueOrShowCheer(doc) {
    if (shownCheerIds[doc.id]) return;
    if (cheerQueue.some(function (d) { return d.id === doc.id; })) return;
    cheerQueue.push(doc);
    drainCheerQueue();
  }

  // Show queued cheers one at a time. Never over the plank timer screen —
  // queued cheers are drained when the timer ends (showScreen → drainCheerQueue).
  function drainCheerQueue() {
    if (cheerShowing || plankTimerActive || !cheerQueue.length) return;
    var doc = cheerQueue.shift();
    shownCheerIds[doc.id] = true;
    cheerShowing = true;
    showCheerPopup(doc);
  }

  function showCheerPopup(doc) {
    var data = doc.data() || {};
    var overlay = document.createElement('div');
    overlay.className = 'cheer-overlay';
    overlay.innerHTML =
      '<div class="cheer-card">' +
        avatarMarkup(cleanName(data.fromName), 'cheer-avatar') +
        '<p class="cheer-msg">' + esc(data.message || '') + '</p>' +
        '<button type="button" class="btn-forge cheer-close">Thanks!</button>' +
      '</div>';
    document.body.appendChild(overlay);
    fireConfettiCannon();
    doc.ref.update({ seen: true }).catch(function (err) { console.error('Failed to mark cheer seen:', err); });
    overlay.querySelector('.cheer-close').addEventListener('click', function () {
      overlay.remove();
      cheerShowing = false;
      drainCheerQueue(); // next queued cheer, if any
    });
  }

  function onSignOut() {
    teardownBoard();
    stopCheerListener();   // detach the real-time cheer listener
    shownCheerIds = {};
    devForceFriday = false;
    clearForgeUser();      // remove the local identity (keep forgeLastAvatar)
    state.user = null;
    state.logs = [];
    var last = window.localStorage.getItem(FORGE_LAST_AVATAR_KEY);
    if (last) setIndexByName(last); // carousel still defaults to them
    showLoginEntry();
  }

  // ===================================================================
  // Post-workout mood photo (Firebase Storage). No emoji — SVG/text only.
  // ===================================================================
  var CAM_ICON =
    '<svg class="cam-icon" viewBox="0 0 64 64" fill="none" stroke="#E8621A" stroke-width="2.5" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 21a4 4 0 0 1 4-4h7l3-5h12l3 5h7a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/>' +
      '<circle cx="32" cy="34" r="12"/><circle cx="32" cy="34" r="7.5"/>' +
      '<circle cx="32" cy="34" r="3.5" fill="#E8621A" stroke="none"/>' +
      '<circle cx="48" cy="24" r="1.6" fill="#E8621A" stroke="none"/></svg>';
  var CAM_UPLOAD_ICON =
    '<svg class="cam-upload-icon" viewBox="0 0 64 64" fill="none" stroke="#E8621A" stroke-width="2.5" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 45a11 11 0 0 1-1-21.95 15 15 0 0 1 28.55 3.2A9 9 0 0 1 46 45"/>' +
      '<path d="M32 50V29"/><path d="M24 37l8-8 8 8"/></svg>';
  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  function shortDate(d) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
  }

  function closeCameraOverlay() {
    var overlay = document.getElementById('camera-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    overlay.classList.add('is-closing');
    setTimeout(function () {
      overlay.classList.add('hidden');
      overlay.classList.remove('is-closing');
      overlay.innerHTML = '';
    }, 300);
  }

  // PART 2 — camera prompt overlay, shown after a session completes.
  function showCameraPrompt(activityId) {
    if (!storage) return; // no Storage SDK → silently skip the prompt
    var overlay = document.getElementById('camera-overlay');
    if (!overlay) return;
    overlay.innerHTML =
      '<div class="cam-card">' +
        '<div class="cam-icon-wrap">' + CAM_ICON + '</div>' +
        '<h2 class="cam-heading">HOW ARE YOU LOOKING?</h2>' +
        '<p class="cam-sub">Share your post-workout face with the squad</p>' +
        '<button type="button" class="btn-forge cam-take">TAKE PHOTO</button>' +
        '<button type="button" class="cam-skip">Skip for now</button>' +
      '</div>';
    overlay.classList.remove('hidden');
    requestAnimationFrame(function () { overlay.classList.add('is-visible'); });

    // Hidden file input (front camera). Lives on the overlay so it survives the
    // card content being replaced for the preview/retake steps.
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.setAttribute('capture', 'user');
    fileInput.className = 'hidden';
    overlay.appendChild(fileInput);
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      processPhoto(file, function (result) {
        if (result) showCameraPreview(overlay, activityId, result, fileInput);
      });
    });

    var takeBtn = overlay.querySelector('.cam-take');
    addFire(takeBtn);
    takeBtn.addEventListener('click', function () { fileInput.click(); });
    overlay.querySelector('.cam-skip').addEventListener('click', closeCameraOverlay);
  }

  // PART 3 — resize the chosen photo into a 150px thumbnail and an 800px full.
  function processPhoto(file, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        // Thumbnail: 150x150 centre-cropped square, JPEG 70%.
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        var tc = document.createElement('canvas');
        tc.width = 150; tc.height = 150;
        tc.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, 150, 150);
        // Full: max 800px, aspect maintained, JPEG 85%.
        var scale = Math.min(1, 800 / Math.max(img.width, img.height));
        var fw = Math.max(1, Math.round(img.width * scale));
        var fh = Math.max(1, Math.round(img.height * scale));
        var fc = document.createElement('canvas');
        fc.width = fw; fc.height = fh;
        fc.getContext('2d').drawImage(img, 0, 0, fw, fh);
        var previewUrl = fc.toDataURL('image/jpeg', 0.85);
        tc.toBlob(function (thumbBlob) {
          fc.toBlob(function (fullBlob) {
            cb({ thumbBlob: thumbBlob, fullBlob: fullBlob, previewUrl: previewUrl });
          }, 'image/jpeg', 0.85);
        }, 'image/jpeg', 0.7);
      } catch (e) { console.error('Photo processing failed:', e); cb(null); }
      if (img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { cb(null); };
    img.src = URL.createObjectURL(file);
  }

  function showCameraPreview(overlay, activityId, result, fileInput) {
    var card = overlay.querySelector('.cam-card');
    if (!card) return;
    card.innerHTML =
      '<div class="cam-preview-ring"><img class="cam-preview-img" src="' + result.previewUrl + '" alt=""></div>' +
      '<h2 class="cam-heading">LOOKING GOOD!</h2>' +
      '<button type="button" class="btn-forge cam-share">SHARE WITH SQUAD</button>' +
      '<button type="button" class="btn-outline cam-retake">RETAKE</button>';
    var shareBtn = card.querySelector('.cam-share');
    addFire(shareBtn);
    shareBtn.addEventListener('click', function () { startPhotoUpload(overlay, activityId, result); });
    card.querySelector('.cam-retake').addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });
  }

  // PART 4 — upload both images, save URLs on the activity, toast + dismiss.
  function startPhotoUpload(overlay, activityId, result) {
    var card = overlay.querySelector('.cam-card');
    if (!card) return;
    card.innerHTML =
      '<div class="cam-upload-wrap">' + CAM_UPLOAD_ICON +
        '<svg class="cam-progress" viewBox="0 0 120 120">' +
          '<circle class="cam-progress-bg" cx="60" cy="60" r="52"></circle>' +
          '<circle class="cam-progress-fg" cx="60" cy="60" r="52"></circle>' +
        '</svg>' +
      '</div>' +
      '<h2 class="cam-heading">UPLOADING...</h2>';
    var fg = card.querySelector('.cam-progress-fg');
    var C = 2 * Math.PI * 52;
    fg.style.strokeDasharray = C;
    fg.style.strokeDashoffset = C;

    uploadPhoto(activityId, result.thumbBlob, result.fullBlob,
      function (pct) { fg.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, pct))); },
      function () { closeCameraOverlay(); showToast('Photo shared with the squad!'); },
      function (err) {
        console.error('Photo upload failed:', err);
        card.innerHTML =
          '<h2 class="cam-heading">UPLOAD FAILED</h2>' +
          '<p class="cam-sub">' + esc(friendlyError(err)) + '</p>' +
          '<button type="button" class="cam-skip">Close</button>';
        card.querySelector('.cam-skip').addEventListener('click', closeCameraOverlay);
      });
  }

  function uploadPhoto(activityId, thumbBlob, fullBlob, onProgress, onDone, onError) {
    if (!storage || !state.user) { onError(new Error('Storage unavailable')); return; }
    var base = 'photos/' + state.user.id + '/';
    var date = dateKey(new Date());
    var fullRef = storage.ref(base + date + '.jpg');
    var thumbRef = storage.ref(base + date + '_thumb.jpg');
    var meta = { contentType: 'image/jpeg' };

    var fullTask = fullRef.put(fullBlob, meta);
    fullTask.on('state_changed',
      function (snap) { onProgress(snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 0.85 : 0); },
      onError,
      function () {
        var thumbTask = thumbRef.put(thumbBlob, meta);
        thumbTask.on('state_changed',
          function (snap) { onProgress(0.85 + (snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 0.15 : 0)); },
          onError,
          function () {
            Promise.all([fullRef.getDownloadURL(), thumbRef.getDownloadURL()]).then(function (urls) {
              var save = activityId
                ? db.collection('activities').doc(activityId)
                    .set({ photoFull: urls[0], photoThumb: urls[1] }, { merge: true })
                : Promise.resolve();
              save.then(function () { onProgress(1); onDone(); }).catch(onError);
            }).catch(onError);
          });
      });
  }

  // PART 5 — full-screen lightbox for a feed photo.
  function showPhotoLightbox(fullUrl, name, dateStr) {
    var lb = document.getElementById('photo-lightbox');
    if (!lb) return;
    lb.innerHTML =
      '<button type="button" class="lightbox-close" aria-label="Close">' + CLOSE_ICON + '</button>' +
      '<div class="lightbox-inner">' +
        '<p class="lightbox-meta">' + esc(name || '') + (dateStr ? ' · ' + esc(dateStr) : '') + '</p>' +
        '<img class="lightbox-img" src="' + esc(fullUrl) + '" alt="">' +
      '</div>';
    lb.classList.remove('hidden');
    requestAnimationFrame(function () { lb.classList.add('is-visible'); });
    function close() {
      lb.classList.remove('is-visible');
      setTimeout(function () { lb.classList.add('hidden'); lb.innerHTML = ''; }, 300);
    }
    lb.querySelector('.lightbox-close').addEventListener('click', close);
    lb.addEventListener('click', function (e) {
      // Tap outside the photo (the overlay or its padded inner) closes.
      if (e.target === lb || e.target.classList.contains('lightbox-inner')) close();
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
  // Daily motivation pop-up (ZenQuotes, once per day)
  // ===================================================================
  // 1-based day of the year, used to pick a stable fallback quote per day.
  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((atMidnight(d) - start) / 86400000);
  }

  // Same fallback all day, chosen by day-of-year.
  function fallbackDailyQuote() {
    var list = DAILY_FALLBACK_QUOTES;
    return { q: list[dayOfYear(new Date()) % list.length], a: 'Unknown' };
  }

  // Normalise a ZenQuotes array response ([{q,a}]) into { q, a }.
  function parseZenQuote(arr) {
    if (Array.isArray(arr) && arr[0] && arr[0].q) {
      return { q: String(arr[0].q), a: String(arr[0].a || 'Unknown') };
    }
    throw new Error('Unexpected ZenQuotes response');
  }

  // JSONP fetch — ZenQuotes needs this in the browser (CORS). The callback name
  // is fixed to zenQuoteCallback because that is what we pass in the URL.
  function fetchQuoteJsonp(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var cbName = 'zenQuoteCallback';
      var script = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () { if (!done) { cleanup(); reject(new Error('timeout')); } }, timeoutMs);
      function cleanup() {
        done = true;
        clearTimeout(timer);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = function (data) { if (!done) { cleanup(); resolve(data); } };
      script.onerror = function () { if (!done) { cleanup(); reject(new Error('network')); } };
      script.src = 'https://zenquotes.io/api/today?callback=' + cbName;
      document.head.appendChild(script);
    });
  }

  // Fallback path: the random endpoint has more permissive CORS than /today.
  function fetchQuoteRandom(timeoutMs) {
    if (!window.fetch) return Promise.reject(new Error('no fetch'));
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    return fetch('https://zenquotes.io/api/random', ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { clearTimeout(timer); return r.json(); }, function (e) { clearTimeout(timer); throw e; });
  }

  // Try JSONP /today → random endpoint → hardcoded fallback. Always resolves.
  function fetchDailyQuote() {
    return fetchQuoteJsonp(3000).then(parseZenQuote)
      .catch(function () { return fetchQuoteRandom(3000).then(parseZenQuote); })
      .catch(function () { return fallbackDailyQuote(); });
  }

  // Show the pop-up once per day, 600ms after the dashboard has loaded so the
  // user briefly sees the app behind it.
  function scheduleDailyQuote() {
    if (window.localStorage.getItem(DAILY_QUOTE_KEY) === dateKey(new Date())) return;
    setTimeout(function () {
      var todayKey = dateKey(new Date());
      if (window.localStorage.getItem(DAILY_QUOTE_KEY) === todayKey) return; // guard re-entry
      fetchDailyQuote().then(function (quote) {
        if (window.localStorage.getItem(DAILY_QUOTE_KEY) === dateKey(new Date())) return;
        window.localStorage.setItem(DAILY_QUOTE_KEY, dateKey(new Date()));
        showDailyQuotePopup(quote);
      });
    }, 600);
  }

  function showDailyQuotePopup(quote) {
    var overlay = document.getElementById('daily-quote-overlay');
    if (!overlay) return;
    overlay.innerHTML =
      '<div class="quote-card">' +
        '<span class="quote-brand">FORGE</span>' +
        '<span class="quote-label">TODAY\'S MOTIVATION</span>' +
        '<p class="quote-text">' + esc(quote.q) + '</p>' +
        '<p class="quote-author">— ' + esc(quote.a || 'Unknown') + '</p>' +
        '<button type="button" class="btn-forge quote-close">LET\'S FORGE</button>' +
      '</div>';
    overlay.classList.remove('hidden', 'is-visible'); // reset so the entrance replays
    var closeBtn = overlay.querySelector('.quote-close');
    addFire(closeBtn);
    closeBtn.addEventListener('click', function () {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    });
    // Next frame → add the visible class so the fade/slide-up transition runs.
    requestAnimationFrame(function () { overlay.classList.add('is-visible'); });
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

    if (installBtn) {
      installBtn.addEventListener('click', openInstall);
      // Hide the install link entirely when already running as an installed PWA.
      var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                       window.navigator.standalone === true;
      if (standalone) installBtn.classList.add('hidden');
    }

    addFire(forgeBtn); // discreet install link gets no fire animation

    buildNav();       // one persistent top nav, reused across screens
    renderCarousel(); // initial render from the hardcoded TEAM (instant)
    loadTeamFromFirestore(); // merge Firestore-registered users, then re-render

    // Atmospheric drifting embers behind the login screen (behind all content,
    // above the dark overlay so the forge background stays visible).
    if (loginScreen && !loginScreen.querySelector('.login-embers')) {
      var loginEmbers = document.createElement('canvas');
      loginEmbers.className = 'login-embers';
      loginScreen.insertBefore(loginEmbers, loginScreen.firstChild);
      startEmbers(loginEmbers, 18);
    }

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
