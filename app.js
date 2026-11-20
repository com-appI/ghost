'use strict';

(() => {
  const config = window.GHOST_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const apiBase = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const state = {
    auth: null,
    db: null,
    user: null,
    chats: [],
    activeChatId: null,
    messages: [],
    createdAt: null,
    loading: false,
    controller: null,
    toastTimer: null,
    authMode: 'login'
  };

  const els = {
    sidebar: $('sidebar'), sidebarBackdrop: $('sidebarBackdrop'), closeSidebar: $('closeSidebar'),
    menuBtn: $('menuBtn'), newChatBtn: $('newChatBtn'), mobileNewChat: $('mobileNewChat'),
    chatList: $('chatList'), signInBtn: $('signInBtn'), signOutBtn: $('signOutBtn'),
    userName: $('userName'), userEmail: $('userEmail'), avatar: $('avatar'),
    welcome: $('welcome'), messages: $('messages'), signinHint: $('signinHint'),
    composerForm: $('composerForm'), messageInput: $('messageInput'), sendBtn: $('sendBtn'),
    stopBtn: $('stopBtn'), toast: $('toast'), authOverlay: $('authOverlay'), authClose: $('authClose'),
    authForm: $('authForm'), authName: $('authName'), authNameLabel: $('authNameLabel'),
    authEmail: $('authEmail'), authPassword: $('authPassword'), authSubmit: $('authSubmit'),
    authGoogle: $('authGoogle'), authForgot: $('authForgot'), authError: $('authError'),
    authTitle: $('authTitle'), authSubtitle: $('authSubtitle'), loginTab: $('loginTab'), registerTab: $('registerTab'),
    profileOverlay: $('profileOverlay'), profileClose: $('profileClose'), profileAvatar: $('profileAvatar'),
    profileDisplayName: $('profileDisplayName'), profileEmailText: $('profileEmailText'), profileNameInput: $('profileNameInput'),
    profileSaveBtn: $('profileSaveBtn'), profileSignoutBtn: $('profileSignoutBtn'), profileError: $('profileError'),
    settingsOverlay: $('settingsOverlay'), settingsClose: $('settingsClose'), settingLightTheme: $('settingLightTheme'),
    settingEnterSend: $('settingEnterSend'), settingAnimations: $('settingAnimations'),
    searchOverlay: $('searchOverlay'), searchClose: $('searchClose'), searchCloseAction: $('searchCloseAction'),
    searchBtn: $('searchBtn'), micBtn: $('micBtn'), sideProfileBtn: $('sideProfileBtn'), sideSettingsBtn: $('sideSettingsBtn'), accountRow: $('accountRow')
  };

  const preferences = {
    lightTheme: localStorage.getItem('ghost-light-theme') === 'true',
    enterToSend: localStorage.getItem('ghost-enter-send') !== 'false',
    animations: localStorage.getItem('ghost-animations') !== 'false'
  };

  let voiceRecognition = null;
  let voiceListening = false;

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function formatMessage(value) {
    const codeBlocks = [];
    let safe = escapeHtml(value || '');
    safe = safe.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_match, code) => {
      const key = `%%CODE_BLOCK_${codeBlocks.length}%%`;
      codeBlocks.push(`<pre class="code-block"><code>${code.replace(/\n$/, '')}</code></pre>`);
      return key;
    });
    safe = safe.replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/^\s*[-*] (.+)$/gm, '<span class="md-list-item">• $1</span>')
      .replace(/\n/g, '<br>');
    return safe.replace(/%%CODE_BLOCK_(\d+)%%/g, (_match, index) => codeBlocks[Number(index)] || '');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('show');
  }

  function closeOverlay(overlay) {
    if (overlay) overlay.classList.add('hidden');
  }

  function applyPreferences() {
    document.body.classList.toggle('light-theme', preferences.lightTheme);
    document.body.classList.toggle('no-animations', !preferences.animations);
    if (els.settingLightTheme) els.settingLightTheme.checked = preferences.lightTheme;
    if (els.settingEnterSend) els.settingEnterSend.checked = preferences.enterToSend;
    if (els.settingAnimations) els.settingAnimations.checked = preferences.animations;
  }

  function savePreferences() {
    localStorage.setItem('ghost-light-theme', String(preferences.lightTheme));
    localStorage.setItem('ghost-enter-send', String(preferences.enterToSend));
    localStorage.setItem('ghost-animations', String(preferences.animations));
    applyPreferences();
  }

  function openProfile() {
    closeSidebar();
    if (!state.user) { openAuth('login'); return; }
    els.profileError.textContent = '';
    els.profileNameInput.value = state.user.displayName || '';
    els.profileOverlay.classList.remove('hidden');
  }

  function openSettings() {
    closeSidebar();
    els.settingsOverlay.classList.remove('hidden');
  }

  function openSearch() {
    els.searchOverlay.classList.remove('hidden');
  }

  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.classList.add('show');
  }

  function updateAuthUI(user) {
    state.user = user || null;
    const signedIn = Boolean(user);
    els.signInBtn.classList.toggle('hidden', signedIn);
    els.signOutBtn.classList.toggle('hidden', !signedIn);
    els.userName.textContent = signedIn ? (user.displayName || 'Пользователь') : 'Гость';
    els.userEmail.textContent = signedIn ? (user.email || 'Google аккаунт') : 'Войдите, чтобы начать';
    els.avatar.textContent = signedIn ? (user.displayName || user.email || 'G').slice(0, 1).toUpperCase() : 'G';
    if (signedIn && user.photoURL) {
      try {
        const photoUrl = new URL(user.photoURL);
        if (photoUrl.protocol === 'https:') {
          els.avatar.style.backgroundImage = `url("${photoUrl.href}")`;
          els.avatar.textContent = '';
        } else {
          els.avatar.style.backgroundImage = '';
        }
      } catch {
        els.avatar.style.backgroundImage = '';
      }
    } else {
      els.avatar.style.backgroundImage = '';
    }
    els.signinHint.textContent = signedIn ? 'Готово. Напишите сообщение ниже.' : 'Войдите или создайте аккаунт, чтобы начать.';
    if (els.profileDisplayName) els.profileDisplayName.textContent = signedIn ? (user.displayName || 'Пользователь') : 'Гость';
    if (els.profileEmailText) els.profileEmailText.textContent = signedIn ? (user.email || 'Аккаунт Google') : 'Нет активного аккаунта';
    if (els.profileNameInput && signedIn) els.profileNameInput.value = user.displayName || '';
    if (els.profileAvatar) {
      els.profileAvatar.textContent = signedIn ? (user.displayName || user.email || 'G').slice(0, 1).toUpperCase() : 'G';
      els.profileAvatar.style.backgroundImage = '';
      if (signedIn && user.photoURL) {
        try {
          const profilePhoto = new URL(user.photoURL);
          if (profilePhoto.protocol === 'https:') {
            els.profileAvatar.style.backgroundImage = `url("${profilePhoto.href}")`;
            els.profileAvatar.textContent = '';
          }
        } catch { /* Ignore an invalid profile image URL. */ }
      }
    }
  }

  function newChat() {
    if (state.loading) stopGeneration();
    state.activeChatId = null;
    state.createdAt = null;
    state.messages = [];
    renderMessages();
    closeSidebar();
    els.messageInput.focus();
  }

  function renderChatList() {
    if (!state.user) {
      els.chatList.innerHTML = '<div class="empty-history">Войдите, чтобы сохранять историю чатов</div>';
      return;
    }
    if (!state.chats.length) {
      els.chatList.innerHTML = '<div class="empty-history">Здесь появятся ваши чаты</div>';
      return;
    }
    els.chatList.innerHTML = state.chats.map((chat) => `
      <button class="chat-item ${chat.id === state.activeChatId ? 'active' : ''}" data-chat-id="${escapeHtml(chat.id)}" title="${escapeHtml(chat.title || 'Новый чат')}">${escapeHtml(chat.title || 'Новый чат')}</button>
    `).join('');
  }

  function renderMessages() {
    const hasMessages = state.messages.length > 0;
    els.welcome.classList.toggle('hidden', hasMessages);
    els.messages.classList.toggle('hidden', !hasMessages);
    if (!hasMessages) {
      els.messages.innerHTML = '';
      renderChatList();
      return;
    }
    els.messages.innerHTML = state.messages.map((message, index) => {
      const isUser = message.role === 'user';
      const avatar = isUser ? escapeHtml((state.user?.displayName || 'Я').slice(0, 1).toUpperCase()) : '✧';
      const actions = !isUser && message.content ? `<div class="message-actions"><button class="tiny-action" data-copy-index="${index}">Копировать</button></div>` : '';
      return `<article class="message-row ${isUser ? 'user' : 'assistant'}">
        ${isUser ? '' : `<div class="message-avatar">${avatar}</div>`}
        <div class="message-content">
          <div class="message-role">${isUser ? '' : 'GHOST AI'}</div>
          <div class="message-text">${message.content ? formatMessage(message.content) : '<span class="typing-dots"><i></i><i></i><i></i></span>'}</div>
          ${actions}
        </div>
        ${isUser ? '' : ''}
      </article>`;
    }).join('');
    renderChatList();
    els.conversation?.scrollTo?.({ top: els.conversation.scrollHeight, behavior: 'smooth' });
    const conversation = $('conversation');
    conversation.scrollTop = conversation.scrollHeight;
  }

  async function loadChats() {
    if (!state.user || !state.db) return;
    try {
      const snapshot = await state.db.collection('users').doc(state.user.uid)
        .collection('chats').orderBy('updatedAt', 'desc').limit(30).get();
      state.chats = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      renderChatList();
    } catch (error) {
      console.warn('Chat history unavailable:', error.code || error.message);
      toast('История чатов пока недоступна. Проверьте правила Firestore.');
    }
  }

  async function saveActiveChat() {
    if (!state.user || !state.db || !state.activeChatId || !state.messages.length) return;
    try {
      const ref = state.db.collection('users').doc(state.user.uid).collection('chats').doc(state.activeChatId);
      const existing = state.chats.find((chat) => chat.id === state.activeChatId);
      const firstUserMessage = state.messages.find((message) => message.role === 'user')?.content || 'Новый чат';
      const title = existing?.title || firstUserMessage.slice(0, 52);
      const payload = {
        title,
        messages: state.messages.slice(-24).map((message) => ({ role: message.role, content: message.content.slice(0, 12000) })),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (!existing) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await ref.set(payload, { merge: true });
      const update = { id: state.activeChatId, title, ...payload };
      state.chats = [update, ...state.chats.filter((chat) => chat.id !== state.activeChatId)].slice(0, 30);
      renderChatList();
    } catch (error) {
      console.warn('Could not save chat:', error.code || error.message);
      toast('Не удалось сохранить чат. Проверьте настройки Firestore.');
    }
  }

  function openAuth(mode = 'login') {
    if (!state.auth) {
      toast('Firebase не загрузился. Проверьте настройки проекта.');
      return;
    }
    setAuthMode(mode);
    els.authOverlay.classList.remove('hidden');
    document.body.classList.add('auth-open');
    setTimeout(() => (mode === 'register' ? els.authName : els.authEmail).focus(), 30);
  }

  function closeAuth() {
    els.authOverlay.classList.add('hidden');
    document.body.classList.remove('auth-open');
    els.authError.textContent = '';
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const registering = mode === 'register';
    els.authTitle.textContent = registering ? 'Создать аккаунт' : 'С возвращением';
    els.authSubtitle.textContent = registering ? 'Зарегистрируйтесь, чтобы сохранять свои чаты.' : 'Войдите, чтобы продолжить общение с Ghost AI.';
    els.authName.classList.toggle('hidden', !registering);
    els.authNameLabel.classList.toggle('hidden', !registering);
    els.authName.required = registering;
    els.authPassword.autocomplete = registering ? 'new-password' : 'current-password';
    els.authSubmit.textContent = registering ? 'Создать аккаунт' : 'Войти';
    els.authForgot.classList.toggle('hidden', registering);
    els.loginTab.classList.toggle('active', !registering);
    els.registerTab.classList.toggle('active', registering);
    els.loginTab.setAttribute('aria-selected', String(!registering));
    els.registerTab.setAttribute('aria-selected', String(registering));
    els.authError.textContent = '';
  }

  function authErrorMessage(error) {
    const messages = {
      'auth/invalid-email': 'Проверьте правильность адреса электронной почты.',
      'auth/user-not-found': 'Аккаунт с такой почтой не найден. Зарегистрируйтесь.',
      'auth/wrong-password': 'Неверный пароль. Попробуйте ещё раз.',
      'auth/invalid-credential': 'Неверная почта или пароль.',
      'auth/email-already-in-use': 'Эта почта уже зарегистрирована. Перейдите во вкладку «Вход».',
      'auth/weak-password': 'Пароль слишком простой. Используйте не менее 6 символов.',
      'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже.',
      'auth/network-request-failed': 'Нет соединения. Проверьте интернет.',
      'auth/operation-not-allowed': 'Этот способ входа не включён в Firebase Authentication.',
      'auth/unauthorized-domain': 'Домен сайта не добавлен в Firebase → Authentication → Settings → Authorized domains.',
      'auth/api-key-not-valid': 'Firebase API-ключ в config.js неверный. Проверьте, что опубликован последний ZIP с исправленным config.js.',
      'auth/popup-closed-by-user': 'Окно входа закрыто. Попробуйте ещё раз.'
    };
    return messages[error?.code] || `Не удалось выполнить вход (${error?.code || 'unknown'}). Проверьте настройки Firebase.`;
  }

  async function signInWithGoogle() {
    if (!state.auth) return openAuth('login');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    provider.addScope('email');
    provider.addScope('profile');
    try {
      const result = await state.auth.signInWithPopup(provider);
      if (result.user) closeAuth();
    } catch (error) {
      if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request' || error.code === 'auth/operation-not-supported-in-this-environment') {
        try { await state.auth.signInWithRedirect(provider); return; }
        catch (redirectError) { error = redirectError; }
      }
      console.error('Google sign-in:', error.code || error.message);
      els.authError.textContent = authErrorMessage(error);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!state.auth) return;
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    const registering = state.authMode === 'register';
    els.authSubmit.disabled = true;
    els.authSubmit.textContent = registering ? 'Создаём аккаунт…' : 'Входим…';
    els.authError.textContent = '';
    try {
      if (registering) {
        const name = els.authName.value.trim();
        const result = await state.auth.createUserWithEmailAndPassword(email, password);
        if (name) await result.user.updateProfile({ displayName: name });
        closeAuth();
        toast('Аккаунт создан. Добро пожаловать в Ghost AI!');
      } else {
        await state.auth.signInWithEmailAndPassword(email, password);
        closeAuth();
        toast('Вы вошли в Ghost AI.');
      }
    } catch (error) {
      console.error('Email authentication:', error.code || error.message);
      els.authError.textContent = authErrorMessage(error);
    } finally {
      els.authSubmit.disabled = false;
      els.authSubmit.textContent = registering ? 'Создать аккаунт' : 'Войти';
    }
  }

  async function resetPassword() {
    const email = els.authEmail.value.trim();
    if (!email) {
      els.authError.textContent = 'Сначала введите свою электронную почту.';
      els.authEmail.focus();
      return;
    }
    try {
      await state.auth.sendPasswordResetEmail(email);
      els.authError.textContent = 'Письмо для сброса пароля отправлено. Проверьте почту.';
    } catch (error) {
      els.authError.textContent = authErrorMessage(error);
    }
  }

  async function switchChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat) return;
    if (state.loading) stopGeneration();
    state.activeChatId = chatId;
    state.createdAt = chat.createdAt || null;
    state.messages = Array.isArray(chat.messages) ? chat.messages.map((m) => ({ role: m.role, content: m.content })) : [];
    renderMessages();
    closeSidebar();
  }

  function setLoading(value) {
    state.loading = value;
    els.sendBtn.disabled = value;
    els.messageInput.disabled = value;
    els.stopBtn.classList.toggle('hidden', !value);
    els.sendBtn.classList.toggle('hidden', value);
  }

  function stopGeneration() {
    if (state.controller) state.controller.abort();
    state.controller = null;
    setLoading(false);
    saveActiveChat();
    renderMessages();
  }

  async function sendMessage(text) {
    if (!text || state.loading) return;
    if (!state.user) {
      toast('Сначала войдите в Ghost AI.');
      return openAuth('login');
    }
    if (!state.activeChatId) state.activeChatId = crypto.randomUUID();
    state.messages.push({ role: 'user', content: text });
    state.messages = state.messages.slice(-24);
    if (state.messages[0]?.role === 'assistant') state.messages.shift();
    renderMessages();
    els.messageInput.value = '';
    resizeInput();
    setLoading(true);
    state.controller = new AbortController();
    state.messages.push({ role: 'assistant', content: '' });
    renderMessages();

    try {
      const token = await state.user.getIdToken();
      const contextMessages = state.messages.slice(0, -1).slice(-23);
      if (contextMessages[0]?.role === 'assistant') contextMessages.shift();
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: contextMessages }),
        signal: state.controller.signal
      });
      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch { /* no JSON response */ }
        throw new Error(payload.error || `Ошибка сервера (${response.status})`);
      }
      if (!response.body) throw new Error('Браузер не поддерживает потоковый ответ.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      const processLine = (line) => {
        if (!line.startsWith('data:')) return;
        const raw = line.slice(5).trim();
        if (!raw) return;
        let packet;
        try { packet = JSON.parse(raw); } catch { return; }
        if (packet.error) throw new Error(packet.error);
        if (typeof packet.content === 'string') {
          assistantText += packet.content;
          state.messages[state.messages.length - 1].content = assistantText;
          renderMessages();
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      if (!assistantText.trim()) state.messages[state.messages.length - 1].content = 'Я не получил текстовый ответ. Попробуйте ещё раз.';
      await saveActiveChat();
    } catch (error) {
      if (error.name === 'AbortError') {
        if (!state.messages[state.messages.length - 1]?.content) state.messages.pop();
      } else {
        console.error('Ghost AI chat error:', error.message);
        if (state.messages[state.messages.length - 1]?.role === 'assistant' && !state.messages[state.messages.length - 1].content) {
          state.messages[state.messages.length - 1].content = `Не удалось получить ответ: ${error.message}`;
        } else {
          state.messages.push({ role: 'assistant', content: `Не удалось получить ответ: ${error.message}` });
        }
        toast('Не удалось получить ответ.');
      }
      await saveActiveChat();
    } finally {
      state.controller = null;
      setLoading(false);
      renderMessages();
      els.messageInput.focus();
    }
  }

  function resizeInput() {
    els.messageInput.style.height = 'auto';
    els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 170)}px`;
  }

  async function initializeFirebase() {
    const cfg = config.firebase;
    if (!cfg || !cfg.apiKey || !cfg.projectId || !window.firebase) {
      updateAuthUI(null);
      toast('Firebase не загрузился. Проверьте подключение и public/config.js.');
      return;
    }
    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      state.auth = app.auth();
      state.db = app.firestore();
      await state.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      state.auth.getRedirectResult().catch((error) => {
        if (error) console.warn('Redirect sign-in:', error.code || error.message);
      });
      state.auth.onAuthStateChanged(async (user) => {
        updateAuthUI(user);
        if (user) await loadChats();
        else {
          state.chats = [];
          renderChatList();
        }
      });
    } catch (error) {
      console.error('Firebase init:', error.code || error.message);
      toast('Ошибка инициализации Firebase. Проверьте настройки проекта.');
      updateAuthUI(null);
    }
  }

  els.signInBtn.addEventListener('click', () => openAuth('login'));
  els.authClose.addEventListener('click', closeAuth);
  els.authOverlay.addEventListener('click', (event) => { if (event.target === els.authOverlay) closeAuth(); });
  els.loginTab.addEventListener('click', () => setAuthMode('login'));
  els.registerTab.addEventListener('click', () => setAuthMode('register'));
  els.authForm.addEventListener('submit', submitAuth);
  els.authGoogle.addEventListener('click', signInWithGoogle);
  els.authForgot.addEventListener('click', resetPassword);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAuth(); closeOverlay(els.profileOverlay); closeOverlay(els.settingsOverlay); closeOverlay(els.searchOverlay); closeSidebar();
    }
  });
  els.signOutBtn.addEventListener('click', async () => {
    try { await state.auth.signOut(); newChat(); toast('Вы вышли из аккаунта.'); }
    catch { toast('Не удалось выйти из аккаунта.'); }
  });
  els.newChatBtn.addEventListener('click', newChat);
  els.mobileNewChat.addEventListener('click', newChat);
  els.menuBtn.addEventListener('click', openSidebar);
  els.closeSidebar.addEventListener('click', closeSidebar);
  els.sidebarBackdrop.addEventListener('click', closeSidebar);
  els.chatList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat-id]');
    if (button) switchChat(button.dataset.chatId);
  });
  els.messages.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-index]');
    if (!button) return;
    const message = state.messages[Number(button.dataset.copyIndex)];
    if (!message) return;
    try { await navigator.clipboard.writeText(message.content); toast('Ответ скопирован.'); }
    catch { toast('Не удалось скопировать текст.'); }
  });
  els.composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(els.messageInput.value.trim());
  });
  els.messageInput.addEventListener('input', resizeInput);
  els.messageInput.addEventListener('keydown', (event) => {
    const shouldSend = event.key === 'Enter' && (preferences.enterToSend ? !event.shiftKey : event.ctrlKey);
    if (shouldSend) {
      event.preventDefault();
      els.composerForm.requestSubmit();
    }
  });
  els.stopBtn.addEventListener('click', stopGeneration);

  // Profile, settings and planned web-search screen.
  els.sideProfileBtn.addEventListener('click', openProfile);
  els.sideSettingsBtn.addEventListener('click', openSettings);
  els.accountRow.addEventListener('click', (event) => { if (!event.target.closest('#signOutBtn')) openProfile(); });
  els.profileClose.addEventListener('click', () => closeOverlay(els.profileOverlay));
  els.settingsClose.addEventListener('click', () => closeOverlay(els.settingsOverlay));
  els.searchClose.addEventListener('click', () => closeOverlay(els.searchOverlay));
  els.searchCloseAction.addEventListener('click', () => closeOverlay(els.searchOverlay));
  [els.profileOverlay, els.settingsOverlay, els.searchOverlay].forEach((overlay) => {
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeOverlay(overlay); });
  });
  els.profileSaveBtn.addEventListener('click', async () => {
    if (!state.user) return openAuth('login');
    const displayName = els.profileNameInput.value.trim();
    if (!displayName) { els.profileError.textContent = 'Введите имя профиля.'; return; }
    els.profileSaveBtn.disabled = true;
    els.profileError.textContent = '';
    try {
      await state.user.updateProfile({ displayName });
      updateAuthUI(state.auth.currentUser || state.user);
      toast('Профиль обновлён.');
      closeOverlay(els.profileOverlay);
    } catch (error) {
      console.warn('Profile update:', error.code || error.message);
      els.profileError.textContent = 'Не удалось сохранить имя. Попробуйте ещё раз.';
    } finally { els.profileSaveBtn.disabled = false; }
  });
  els.profileSignoutBtn.addEventListener('click', async () => {
    if (!state.auth) return;
    try { await state.auth.signOut(); newChat(); closeOverlay(els.profileOverlay); toast('Вы вышли из аккаунта.'); }
    catch { els.profileError.textContent = 'Не удалось выйти из аккаунта.'; }
  });
  els.settingLightTheme.addEventListener('change', () => { preferences.lightTheme = els.settingLightTheme.checked; savePreferences(); });
  els.settingEnterSend.addEventListener('change', () => { preferences.enterToSend = els.settingEnterSend.checked; savePreferences(); toast(preferences.enterToSend ? 'Enter отправляет сообщение.' : 'Для отправки используйте Ctrl + Enter.'); });
  els.settingAnimations.addEventListener('change', () => { preferences.animations = els.settingAnimations.checked; savePreferences(); });
  els.searchBtn.addEventListener('click', openSearch);

  // Speech-to-text is browser-dependent; gracefully explain when unavailable.
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = /ru/i.test(navigator.language || '') ? 'ru-RU' : (navigator.language || 'en-US');
    voiceRecognition.onstart = () => { voiceListening = true; els.micBtn.classList.add('listening'); };
    voiceRecognition.onend = () => { voiceListening = false; els.micBtn.classList.remove('listening'); };
    voiceRecognition.onerror = (event) => { voiceListening = false; els.micBtn.classList.remove('listening'); toast(event.error === 'not-allowed' ? 'Разрешите доступ к микрофону.' : 'Голосовой ввод не сработал.'); };
    voiceRecognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) transcript += event.results[index][0].transcript;
      if (transcript) { els.messageInput.value = `${els.messageInput.value}${els.messageInput.value ? ' ' : ''}${transcript.trim()}`; resizeInput(); }
    };
  }
  els.micBtn.addEventListener('click', () => {
    if (!voiceRecognition) { toast('Голосовой ввод не поддерживается этим браузером.'); return; }
    if (voiceListening) { try { voiceRecognition.stop(); } catch {} return; }
    try { voiceRecognition.start(); } catch { toast('Не удалось запустить микрофон.'); }
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      els.messageInput.value = button.dataset.prompt || '';
      resizeInput();
      if (state.user) els.composerForm.requestSubmit(); else openAuth('login');
    });
  });

  // Keep the health check separate from authentication; it never exposes secrets.
  fetch(`${apiBase}/api/health`).then((response) => response.json()).then((health) => {
    if (!health.nvidiaConfigured) toast('Сервер запущен, но NVIDIA_API_KEY ещё не добавлен.');
  }).catch(() => {
    console.info('Ghost AI API health check unavailable.');
  });

  applyPreferences();
  renderChatList();
  initializeFirebase();
})();
