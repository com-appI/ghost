/* ChatClaud public configuration.
   apiKey below is Firebase's browser project identifier, not the NVIDIA secret.
   NVIDIA_API_KEY must only exist in the server's environment. */
window.CHATCLAUD_CONFIG = {
  // Empty = use this Cloudflare Pages origin for both the app and its Worker API.
  apiBaseUrl: '',
  firebase: {
    apiKey: 'AIzaSyD_s04tXQMdTI2PMmdXJvvOy9S5P4zfTuA',
    authDomain: 'toypsig-2953f.firebaseapp.com',
    projectId: 'toypsig-2953f',
    storageBucket: 'toypsig-2953f.firebasestorage.app',
    messagingSenderId: '21149962549',
    appId: '1:21149962549:web:9c7c75964ae5bafdd4fc7c'
  }
};
