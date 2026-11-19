GHOST AI — CLOUDFLARE PAGES DIRECT UPLOAD

ЭТОТ ZIP ПОДГОТОВЛЕН ИМЕННО ДЛЯ ЭКРАНА CLOUDFLARE «UPLOAD AND DEPLOY».
Внутри архива файлы лежат в корне: index.html, styles.css, app.js, config.js,
favicon.svg и _worker.js. Загружай ZIP целиком, не исходный Node/Render архив.

1. Cloudflare Dashboard → Workers & Pages → Pages project → Create deployment.
2. Перетащи этот ZIP в область Upload and deploy → Deploy.
   Файл _worker.js включает серверный API и обслуживает статические файлы.
3. Открой проект → Settings → Functions → Variables and Secrets.
   Добавь для Production:
   - NVIDIA_API_KEY — Secret. Создай новый ключ NVIDIA; опубликованный в чате
     ключ нужно отозвать и заменить.
   - FIREBASE_PROJECT_ID — Variable: toypsig-2953f
   При желании добавь RATE_LIMIT_REQUESTS=20.
   После изменения секретов создай новый deployment.
4. В Firebase Console → Authentication → Settings → Authorized domains
   добавь точный адрес своего сайта вида имя-проекта.pages.dev.
   Убедись, что провайдер Google включён.
5. В Firebase Console → Firestore → Rules вставь содержимое файла firestore.rules
   из этого ZIP и опубликуй правила.

Проверка:
Открой https://ИМЯ-ПРОЕКТА.pages.dev/api/health
Ожидается JSON с ok:true. После настройки переменных также будут
nvidiaConfigured:true и firebaseConfigured:true.

Безопасность:
- NVIDIA_API_KEY хранится только в Cloudflare Secret и не попадает в браузер.
- Firebase apiKey в config.js — публичный идентификатор Firebase web-приложения,
  а не секрет NVIDIA.
- Не вставляй NVIDIA-ключ в config.js, HTML, GitHub или ZIP.

Примечание:
Это Cloudflare Pages Advanced Mode Worker (_worker.js), а не папка Pages Functions.
Dashboard Direct Upload поддерживает _worker.js. Папку /functions через
Dashboard drag-and-drop загружать нельзя.
