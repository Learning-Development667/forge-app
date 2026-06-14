/* ===================================================================
   Forge — app logic
   90-day bodyweight challenge for up to 10 named users.
   Auth: Firebase magic-link (passwordless) email sign-in.
   =================================================================== */

(function () {
  'use strict';

  // ---- Constants ----------------------------------------------------
  var INVITE_CODE = 'FORGE2026';
  var MAX_USERS = 10;
  var EMAIL_STORAGE_KEY = 'forge:pendingEmail';

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

  // Magic-link settings: the link returns to this same page.
  var actionCodeSettings = {
    url: window.location.origin + '/forge-app/',
    handleCodeInApp: true
  };

  // ---- DOM references ----------------------------------------------
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

  var dashboardUserName = document.getElementById('dashboard-user-name');
  var signOutBtn = document.getElementById('sign-out-btn');

  // ---- State --------------------------------------------------------
  var users = [];           // registered users from Firestore
  var selectedIndex = 0;    // index into the drum (users + register row)
  var snapTimer = null;

  // ===================================================================
  // Screen helpers
  // ===================================================================
  function showScreen(screen) {
    [loginScreen, registerScreen, dashboardScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screen.classList.remove('hidden');
  }

  function setMessage(el, text, isError) {
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  // ===================================================================
  // Drum (slot-machine) selector
  // ===================================================================
  function renderDrum() {
    drum.innerHTML = '';

    users.forEach(function (user, i) {
      drum.appendChild(buildDrumItem(user.name, user.avatar, i, false));
    });

    // Register row always last.
    drum.appendChild(buildDrumItem('Register', null, users.length, true));

    // Default selection to the first user (or Register if none).
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
      var av = document.createElement('span');
      av.className = 'drum-avatar';
      if (avatar) {
        var img = document.createElement('img');
        img.className = 'drum-avatar';
        img.src = avatar;
        img.alt = '';
        li.appendChild(img);
      } else {
        av.textContent = name.charAt(0).toUpperCase();
        li.appendChild(av);
      }
    }

    var label = document.createElement('span');
    label.className = 'drum-name';
    label.textContent = name;
    li.appendChild(label);

    li.addEventListener('click', function () {
      scrollToIndex(index, 'smooth');
    });

    return li;
  }

  function itemHeight() {
    var css = getComputedStyle(document.documentElement)
      .getPropertyValue('--drum-item-height');
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

  // Update highlight live while scrolling; snap to centre when it settles.
  function onDrumScroll() {
    updateSelectionStyles();
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(function () {
      scrollToIndex(selectedIndex, 'smooth');
    }, 90);
  }

  function isRegisterSelected() {
    return selectedIndex === users.length;
  }

  // Keyboard support for the drum.
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
  // Load users from Firestore
  // ===================================================================
  function loadUsers() {
    return db
      .collection('users')
      .orderBy('createdAt', 'asc')
      .limit(MAX_USERS)
      .get()
      .then(function (snap) {
        users = [];
        snap.forEach(function (doc) {
          var data = doc.data();
          users.push({
            id: doc.id,
            name: data.name,
            email: data.email,
            avatar: data.avatar || null
          });
        });
        renderDrum();
      })
      .catch(function (err) {
        // Even with no users we still render the Register row.
        users = [];
        renderDrum();
        console.error('Failed to load users:', err);
      });
  }

  // ===================================================================
  // "Let's Forge" — send magic link to the selected user
  // ===================================================================
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
        setMessage(
          loginMessage,
          'Magic link sent to ' + user.email + '. Check your inbox.'
        );
      })
      .catch(function (err) {
        setMessage(loginMessage, friendlyError(err), true);
      });
  }

  function sendMagicLink(email) {
    return auth
      .sendSignInLinkToEmail(email, actionCodeSettings)
      .then(function () {
        window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
      });
  }

  // ===================================================================
  // Registration
  // ===================================================================
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

    // Create the user record, then send a verification magic link.
    db.collection('users')
      .add({
        name: name,
        email: email,
        avatar: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      })
      .then(function () {
        return sendMagicLink(email);
      })
      .then(function () {
        setMessage(
          registerMessage,
          'Account created! A magic link is on its way to ' + email + '.'
        );
        registerForm.reset();
      })
      .catch(function (err) {
        setMessage(registerMessage, friendlyError(err), true);
      });
  }

  // ===================================================================
  // Magic-link sign-in completion
  // ===================================================================
  function completeSignInIfPresent() {
    if (!auth.isSignInWithEmailLink(window.location.href)) {
      return;
    }

    var email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    if (!email) {
      // Opened on a different device — ask for the email.
      email = window.prompt('Please confirm your email to finish signing in:');
    }
    if (!email) return;

    auth
      .signInWithEmailLink(email, window.location.href)
      .then(function () {
        window.localStorage.removeItem(EMAIL_STORAGE_KEY);
        // Clean the magic-link params out of the URL.
        history.replaceState(null, '', window.location.origin + '/forge-app/');
      })
      .catch(function (err) {
        setMessage(loginMessage, friendlyError(err), true);
      });
  }

  // ===================================================================
  // Dashboard
  // ===================================================================
  function showDashboard(firebaseUser) {
    // Prefer the registered display name from Firestore.
    var match = users.filter(function (u) {
      return u.email === (firebaseUser.email || '').toLowerCase();
    })[0];

    var displayName =
      (match && match.name) ||
      firebaseUser.displayName ||
      (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Forger');

    dashboardUserName.textContent = displayName;
    showScreen(dashboardScreen);
  }

  function onSignOut() {
    auth.signOut().then(function () {
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
    registerBack.addEventListener('click', function () {
      showScreen(loginScreen);
    });
    signOutBtn.addEventListener('click', onSignOut);

    // Try to complete a magic-link sign-in if we arrived via one.
    completeSignInIfPresent();

    // Route based on auth state.
    auth.onAuthStateChanged(function (firebaseUser) {
      loadUsers().then(function () {
        if (firebaseUser) {
          showDashboard(firebaseUser);
        } else {
          showScreen(loginScreen);
        }
      });
    });

    // Register the service worker.
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
