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
    toastTimer: null
  };

  const els = {
    sidebar: $('sidebar'), sidebarBackdrop: $('sidebarBackdrop'), closeSidebar: $('closeSidebar'),
    menuBtn: $('menuBtn'), newChatBtn: $('newChatBtn'), mobileNewChat: $('mobileNewChat'),
    chatList: $('chatList'), signInBtn: $('signInBtn'), signOutBtn: $('signOutBtn'),
    userName: $('userName'), userEmail: $('userEmail'), avatar: $('avatar'),
    welcome: $('welcome'), messages: $('messages'), signinHint: $('signinHint'),
    composerForm: $('composerForm'), messageInput: $('messageInput'), sendBtn: $('sendBtn'),
    stopBtn: $('stopBtn'), toast: $('toast')
  };

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
    els.signinHint.textContent = signedIn ? 'Готово. Напишите сообщение ниже.' : 'Чтобы начать, войдите через Google.';
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

  async function signIn() {
    if (!state.auth) return toast('Firebase не настроен. Проверьте public/config.js.');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    provider.addScope('email');
    provider.addScope('profile');
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    try {
      if (mobile) await state.auth.signInWithRedirect(provider);
      else await state.auth.signInWithPopup(provider);
    } catch (error) {
      if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
        await state.auth.signInWithRedirect(provider);
      } else {
        console.error('Google sign-in:', error.code || error.message);
        toast('Не удалось войти через Google. Проверьте настройки Firebase.');
      }
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
      toast('Сначала войдите через Google.');
      return signIn();
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

  els.signInBtn.addEventListener('click', signIn);
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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      els.composerForm.requestSubmit();
    }
  });
  els.stopBtn.addEventListener('click', stopGeneration);
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      els.messageInput.value = button.dataset.prompt || '';
      resizeInput();
      if (state.user) els.composerForm.requestSubmit(); else signIn();
    });
  });

  // Keep the health check separate from authentication; it never exposes secrets.
  fetch(`${apiBase}/api/health`).then((response) => response.json()).then((health) => {
    if (!health.nvidiaConfigured) toast('Сервер запущен, но NVIDIA_API_KEY ещё не добавлен.');
  }).catch(() => {
    console.info('Ghost AI API health check unavailable.');
  });

  renderChatList();
  initializeFirebase();
})();
