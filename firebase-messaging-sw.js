importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBHa9tjcF7liqYRrnqcsuTZYdsJz5zgd-E',
  authDomain: 'forge-bc1d3.firebaseapp.com',
  projectId: 'forge-bc1d3',
  storageBucket: 'forge-bc1d3.firebasestorage.app',
  messagingSenderId: '340499125460',
  appId: '1:340499125460:web:e57967151f8f57e80e9741'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  var title = (payload.data && payload.data.title) || 'Forge 🔥';
  var body = (payload.data && payload.data.body) || 'Time to train!';
  self.registration.showNotification(title, {
    body: body,
    icon: '/forge-app/icons/icon-192.png',
    badge: '/forge-app/icons/icon-192.png',
    tag: 'forge-reminder',
    renotify: true
  });
});
