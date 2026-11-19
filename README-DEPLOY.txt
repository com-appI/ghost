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
На сайте нажми «Войти» → выбери вкладку «Регистрация» для нового аккаунта.
Можно зарегистрироваться по имени, почте и паролю либо нажать «Продолжить с Google».
Для уже созданного аккаунта выбери вкладку «Вход». «Забыли пароль?» отправит
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
