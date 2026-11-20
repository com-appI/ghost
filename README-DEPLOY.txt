GHOST AI — CLOUDFLARE PAGES DIRECT UPLOAD

ЭТОТ ZIP ПОДГОТОВЛЕН ИМЕННО ДЛЯ ЭКРАНА CLOUDFLARE «UPLOAD AND DEPLOY».
Внутри архива файлы лежат в корне: index.html, styles.css, app.js, config.js,
favicon.svg и _worker.js. Загружай ZIP целиком, не исходный Node/Render архив.

1. Cloudflare Dashboard → Workers & Pages → Pages project → Create deployment.
2. Перетащи этот ZIP в область Upload and deploy → Deploy.
   Файл _worker.js включает серверный API и обслуживает статические файлы.
3. Открой проект → Settings → Functions → Variables and Secrets.
   Добавь для Production:
   - NVIDIA_API_KEY — Secret. Используй новый ключ NVIDIA; старый ключ,
     ранее опубликованный в чате, нужно отозвать и заменить.
   - FIREBASE_PROJECT_ID больше не обязателен: Worker уже содержит публичный
     ID Firebase-проекта toypsig-2953f как резервное значение.
   При желании добавь RATE_LIMIT_REQUESTS=20.
   Важно: Cloudflare применяет Secret к новым deployment. После сохранения
   секрета загрузи этот ZIP ещё раз через Create deployment.
4. В Firebase Console → Authentication → Sign-in method включи ДВА способа:
   - Email/Password — для обычной регистрации и входа по почте и паролю.
   - Google — для входа через Google.
5. В Firebase Console → Authentication → Settings → Authorized domains
   добавь точный адрес сайта вида имя-проекта.pages.dev.
   Без этого Firebase может вернуть auth/unauthorized-domain.
6. В Firebase Console → Firestore → Rules вставь содержимое файла firestore.rules
   из этого ZIP и опубликуй правила.

Регистрация и вход:
Открой боковое меню → «Sign in / Sign out» → вкладка «Register» для нового аккаунта.
Можно зарегистрироваться по имени, почте и паролю либо нажать «Continue with Google».
Для уже созданного аккаунта выбери «Sign in». «Forgot password?» отправит
письмо для сброса пароля на указанную почту.

Проверка:
Открой https://ИМЯ-ПРОЕКТА.pages.dev/api/health
Ожидается JSON с ok:true. Когда Production deployment получит секрет, будет
nvidiaConfigured:true и nvidiaBindings:["NVIDIA_API_KEY"]. Если значение
false и список пуст, Cloudflare ещё не передал секрет этому deployment.

Безопасность:
- NVIDIA_API_KEY хранится только в Cloudflare Secret и не попадает в браузер.
- Firebase apiKey в config.js — публичный идентификатор Firebase web-приложения,
  а не секрет NVIDIA.
- Не вставляй NVIDIA-ключ в config.js, HTML, GitHub или ZIP.

Примечание:
Это Cloudflare Pages Advanced Mode Worker (_worker.js), а не папка Pages Functions.
Dashboard Direct Upload поддерживает _worker.js. Папку /functions через
Dashboard drag-and-drop загружать нельзя.


НОВЫЙ ИНТЕРФЕЙС
- Главный экран взят из последнего присланного ghost-ui.html и используется как основной; его чёрная минималистичная компоновка сохранена.
- Профиль: просмотр аккаунта и изменение отображаемого имени через Firebase Auth.
- Настройки: тактильный отклик (если поддерживается браузером), Enter для отправки и включение/отключение анимаций; параметры хранятся локально на устройстве.
- История чатов, регистрация по email/password, Google-вход и отправка запросов в NVIDIA Nemotron сохранены.
- Экран/кнопка поиска пока не запускает веб-поиск: подключение поискового сервиса будет отдельным этапом.

СОБЫТИЯ АГЕНТА (SSE)
- Worker отправляет события вида {"type":"status","stage":"thinking","label":"Thinking…"}; клиент читает SSE через fetch + ReadableStream, сохраняя POST и Firebase Bearer token.
- Когда upstream Nemotron действительно отдаёт reasoning_content, Worker отправляет статус Reasoning…; сам reasoning-текст клиенту не передаётся.
- Текст ответа идёт отдельными событиями {"type":"token","text":"..."}, завершение — {"type":"done"}.
- Ошибки идут событием {"type":"error","code":"...","message":"..."}; перегрузка/429 включает retryAfterSec:150.
- Клиент отображает только серверные статусы, не определяет этап по тексту запроса. planFromInput() и циклическая смена фраз удалены.
- Пока search/math/code/vision/tools не подключены к серверному lifecycle, эти статусы намеренно не отправляются. Они появятся только после реального запуска соответствующего инструмента.
- Stop прерывает fetch stream через AbortController и скрывает активный статус локально.


============================================================
SERPER (Google Search) setup
============================================================
1. Create a key at https://serper.dev
2. Cloudflare Pages → Settings → Environment variables (Production):
   SERPER_API_KEY = your_serper_key
3. Redeploy.
4. Health check: GET /api/health should show "serperConfigured": true

Search runs only when the question needs live web info (or forceSearch).
Statuses "Checking the site…" / "Checking resources…" fire only on real Serper calls.

SERPER FIX (if serperConfigured is false on /api/health):
1. Cloudflare Dashboard → Pages → ghostai-4e6 → Settings → Environment variables
2. Production (not only Preview):
   Name exactly: SERPER_API_KEY
   Value: your serper.dev key (no quotes, no spaces)
3. Save
4. Deployments → Retry deployment / Create new deployment (REQUIRED — secrets apply on next deploy)
5. Open https://ghostai-4e6.pages.dev/api/health
   Need: "serperConfigured": true


============================================================
FIRECRAWL SEARCH (replaces Serper)
============================================================
1. Create API key: https://www.firecrawl.dev (Free: 1000 credits/month, no card)
2. Cloudflare Pages → Settings → Environment variables → Production:
   Name:  FIRECRAWL_API_KEY
   Value: fc-...  (no quotes)
3. Remove old SERPER_* secrets if you want (optional)
4. Redeploy
5. Check: GET /api/health → "firecrawlConfigured": true

Statuses (real only):
  Searching the web…  = Firecrawl /v2/search started
  Reading sources…    = pages extracted, feeding model

Free limits (official docs):
  - 1000 credits / month
  - Search ~2 credits per 10 results
  - /search rate: 10 req/min, 2 concurrent
  - HTTP 402 when credits exhausted
