# Аналіз проєкту Darra Terminal

Дата аналізу: 2026-05-29

## Коротко

У цій папці немає повного репозиторію з вихідними кодами. Тут збережено:

- інсталятор Windows: `Darra Terminal Setup 1.0.0.exe`
- розпакований desktop-дистрибутив: `installer-unpacked/`
- встановлена копія застосунку: `Darra Terminal/`

Тому це аналіз не сирців, а зібраного застосунку. Проте навіть у такому вигляді добре видно архітектуру, точки входу, внутрішні модулі та частину технічних ризиків.

## Повторний аналіз після встановлення

Після повторної перевірки з'ясувалося, що `Darra Terminal/` не є повністю ідентичною копією `installer-unpacked/`.

### Що відрізняється

Між `installer-unpacked/` і встановленою папкою знайдено лише такі відмінності:

- `resources/app/main.cjs` - відрізняється
- `resources/app/desktop-visual-override.css` - відрізняється
- `Uninstall Darra Terminal.exe` - є лише у встановленій копії
- `uninstallerIcon.ico` - є лише у встановленій копії

Інші перевірені ключові файли збігаються, зокрема:

- `resources/app/package.json`
- `resources/app/preload.cjs`
- `resources/app/verify-ru-locale.cjs`
- `resources/app/.bundle/backend/index.cjs`

Це важливо: backend-бандл у встановленій копії той самий, а відмінності зосереджені головно в desktop shell і CSS-оверрайдах.

### Що нового з'явилося у встановленій копії

У папці `Darra Terminal/` є `.env`, якого не було в первинному огляді `installer-unpacked/`. Це означає, що встановлена копія вже містить runtime-конфігурацію, а не лише "чистий" дистрибутив.

За назвами змінних видно, що застосунок підготовлено до роботи з:

- Binance API
- Firebase
- Android auth broker
- Apple sign-in
- Telegram auth

Безпечні значення з `.env`, які вдалося підтвердити:

- `BACKEND_PORT=3001`
- `BACKEND_WS_PATH=/ws`
- `NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:3001/ws`
- `BINANCE_REST_BASE=https://fapi.binance.com`
- `BINANCE_WS_BASE=wss://fstream.binance.com`
- `DEFAULT_FOCUS_UNIVERSE_SIZE=40`
- `FRAME_INTERVAL_MS=1000`
- `FOCUS_REBALANCE_INTERVAL_MS=15000`
- `SOCIAL_AUTH_BROKER_MODE=live`

Також видно, що в `.env`:

- `BINANCE_API_KEY` - заповнений
- `BINANCE_API_SECRET` - заповнений
- більшість Firebase/Apple/Telegram secret-полів - порожні

Практичний висновок: встановлена копія виглядає як жива локальна збірка з підключеним Binance-доступом, але не повністю налаштованим social auth.

### Важливе архітектурне уточнення

`main.cjs` у встановленій копії коротший, ніж у `installer-unpacked/`:

- `installer-unpacked/resources/app/main.cjs` - 2590 рядків
- `Darra Terminal/resources/app/main.cjs` - 1981 рядок

Найпомітніша різниця: у встановленій копії відсутня логіка `registerDesktopWindowMenu` та виклики `executeTrustedWindowCustomizationInMainWorld`, які були присутні у `installer-unpacked/`.

Це схоже на те, що встановлена версія:

- або старіша/спрощена на рівні desktop shell
- або навмисно зібрана без частини desktop-UI ін'єкцій

Тобто frontend і backend залишилися тими самими, але desktop-обгортка тут трохи інша.

### Відмінність у CSS-оверрайдах

`desktop-visual-override.css` також відрізняється. У встановленій копії файл коротший і спрощений:

- менший `border-radius` для елементів
- менше великих adaptive/media-block перевизначень
- загалом менш агресивна desktop-перекомпоновка

Отже, встановлена збірка має не тільки інший shell-код, а й інший візуальний desktop-тюнінг.

## Що це за застосунок

`Darra Terminal` це desktop-обгортка на Electron для торгового терміналу, орієнтованого на Binance Futures. Усередині застосунку є:

- desktop shell на Electron
- frontend, зібраний як Next.js/PWA-бандл
- backend, зібраний в один Node.js bundle
- WebSocket-потік ринкових даних
- TTS-озвучка алертів
- багатовіконний режим, tray-режим і signal overlay
- ознаки інтеграції із social auth/Firebase

## Структура, яка реально є в проєкті

### Корінь

- `Darra Terminal Setup 1.0.0.exe` - інсталятор застосунку
- `installer-unpacked/` - розпакований вміст встановленої програми

### Ключові файли в `installer-unpacked/resources/app/`

- `package.json` - мінімальний маніфест desktop shell
- `main.cjs` - головний Electron runtime
- `preload.cjs` - безпечний IPC-міст між renderer і main process
- `desktop-visual-override.css` - CSS-перевизначення desktop UI
- `verify-ru-locale.cjs` - smoke test локалізації
- `.bundle/frontend/` - статично зібраний frontend
- `.bundle/backend/index.cjs` - великий зібраний backend bundle

## Архітектура

### 1. Desktop shell

Основна логіка оболонки розташована в `main.cjs`.

Що робить shell:

- запускає локальний frontend-сервер з файлів у `.bundle/frontend`
- піднімає backend runtime з `.bundle/backend/index.cjs`
- створює вікна Electron для окремих модулів
- зберігає layout і настройки алертів у `app.getPath("userData")`
- працює в tray навіть коли всі вікна закриті
- показує background notifications і signal overlay

### 2. Frontend

Frontend виглядає як production build Next.js:

- є папка `/_next/`
- є `manifest.webmanifest` і `sw.js`
- HTML уже зрендерений і містить `__next_f`
- у UI видно торгові модулі, фільтри, watchlist, signal tape, account/personal cabinet

Помітні функціональні блоки у frontend:

- `Overview`
- `Filters`
- `Darra Terminal`
- `Binance Account`
- `Active Trades`
- `Watchlist`
- `Signal Tape`
- `Feed Health`
- окремий `desktop`-режим із dock/popup layout

### 3. Backend

Backend зібраний в один файл `index.cjs` розміром понад 3 МБ. За сигнатурами та рядками видно, що він використовує:

- `express`
- `ws`
- `node-edge-tts`
- `firebase-admin`
- інтеграцію з Binance REST/WebSocket

Основні backend-функції:

- health endpoint
- WebSocket-сервер для стрімінгу кадрів/алертів
- TTS API
- market data bootstrap і rebalance фокусних символів
- Binance account stream manager
- social auth broker

## Важливі runtime-деталі

### Frontend

Frontend роздається локальним HTTP-сервером, який Electron запускає на випадковому порту `127.0.0.1`.

### Backend

Backend за замовчуванням використовує:

- порт `3001`
- WebSocket path `/ws`
- Binance REST: `https://fapi.binance.com`
- Binance WS: `wss://fstream.binance.com`

Також видно конфігурацію через `.env` або `process.env`.

Desktop shell шукає `.env` у кількох місцях:

- поточна папка
- батьківська папка
- папка поруч з exe
- `resourcesPath`
- шлях із `SCALPSTATION_ENV_FILE`

## IPC і безпека Electron

У `preload.cjs` використано `contextBridge.exposeInMainWorld`, а в `main.cjs` видно добру базову ізоляцію:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- `webviewTag: false`

Також shell блокує:

- сторонні `window.open`
- навігацію на недовірені URL
- `webview`

Це хороший знак: desktop-обгортка не виглядає "дірявою" на базовому рівні.

## API та інтеграції, які видно

### Health

- `GET /`
- `GET /health`

Повертає статус backend, WebSocket URL, режим auth broker, stream health і account session summary.

### TTS

- `GET /api/tts/models`
- `GET /api/tts/synthesize`
- `POST /api/tts/synthesize`
- `POST /api/tts/synthesize-stream`

TTS побудовано на `node-edge-tts`, тобто озвучка, ймовірно, спирається на Edge Neural voices.

### WebSocket

- backend публікує потік через `/ws`
- desktop shell окремо підключається до цього сокета для фонового моніторингу алертів

### Auth / зовнішні сервіси

За конфігом і UI видно сліди інтеграції з:

- Firebase
- Google login
- Facebook login
- Telegram login
- Apple login

## Стан і збереження даних

Desktop shell зберігає локальний стан окремо від бандлів:

- `desktop-layout.json` - layout вікон
- `desktop-alert-monitor.json` - налаштування моніторингу алертів

Ці файли лежать у user data папці Electron, а не в робочій директорії проєкту.

## Що добре влаштовано

1. Архітектура логічно поділена на shell, frontend і backend.
2. Electron налаштований відносно безпечно.
3. Є tray-режим, background alerts і signal overlay, тобто desktop-функції справді інтегровані, а не просто webview.
4. Є гнучка конфігурація через env.
5. Є TTS, account streams, market streams і social auth, тобто проєкт функціонально насичений.

## Ризики та проблемні місця

### 1. У папці немає повних вихідних кодів

Це головне обмеження. Зараз доступні переважно production artifacts. Через це:

- складніше підтримувати проєкт
- важче вносити точкові зміни
- майже неможливо якісно рев'юнути архітектуру frontend/backend на рівні модулів

### 2. Backend зібраний в один великий bundle

Це ускладнює:

- пошук дефектів
- рефакторинг
- відновлення структури домену
- аудит залежностей

### 3. Є ознаки проблем із локалізацією/кодуванням

У `main.cjs` російські рядки видно як mojibake на кшталт `Р”Р°С€Р±РѕСЂРґ`, а `verify-ru-locale.cjs` навіть перевіряє наявність саме таких фрагментів. Це схоже на закріплену проблему з кодуванням або некоректно збережену локалізацію.

Наслідки:

- ламаний інтерфейс для частини користувачів
- ризик неконсистентної локалізації між shell і frontend
- важкий подальший супровід i18n

### 4. Backend слухає порт без явного bind до `127.0.0.1`

У коді видно `server.listen(config.port)`, тобто без жорсткого loopback bind. Водночас є часткові захисти для доступу до env-based Binance account access лише з loopback/origin-перевіркою.

Ризик:

- якщо ОС/мережа дозволить зовнішній доступ до цього порту, частина endpoint-ів може бути видима зовні

Особливо варто перевірити:

- доступність `health`
- доступність `TTS` endpoint-ів
- поведінку `/ws`

### 5. Відкритий CORS на `/api/tts`

Для TTS виставляється:

- `Access-Control-Allow-Origin: *`
- дозволені `GET, POST, OPTIONS`

Для локального desktop-сценарію це може бути прийнятно, але разом із пунктом про bind порту це варто перевірити уважніше.

### 6. Проєкт виглядає як суміш кількох продуктових напрямів

У frontend одночасно видно:

- Binance terminal
- personal cabinet
- Firebase social auth
- Android-oriented auth notes
- dock desktop terminal

Це може означати:

- продукт ще активно еволюціонує
- в одному build змішані експериментальні та бойові частини
- межі між web/mobile/desktop сценаріями ще не повністю стабілізовані

## Ймовірний технологічний стек

- Electron
- Node.js
- Express
- ws
- Next.js
- PWA service worker
- Binance REST/WS
- Firebase Admin
- Edge TTS

## Що я б рекомендував далі

1. Знайти або відновити повний вихідний репозиторій з `src/`, а не працювати лише з unpacked build.
2. Розділити документацію на `desktop`, `frontend`, `backend`, `infra/env`.
3. Перевірити локалізацію і виправити проблему з кодуванням.
4. Жорстко прив'язати локальний backend до `127.0.0.1`, якщо він не має бути доступним зовні.
5. Переглянути CORS-політику для TTS.
6. Зробити окремий аудит env-змінних і секретів.
7. Якщо потрібно супроводжувати цей build далі, витягти карту endpoint-ів і runtime-залежностей у окремий технічний документ.

## Висновок

Перед нами не "звичайний репозиторій", а вже зібраний desktop-продукт з досить багатою функціональністю навколо Binance terminal. Архітектурно він виглядає як Electron shell + Next.js frontend + Node/Express/WebSocket backend. Основа виглядає працездатною, але для повноцінної підтримки бракує сирців, а головні технічні ризики зараз це доступність лише build-артефактів, потенційні мережеві огріхи backend і явна проблема з локалізацією.
