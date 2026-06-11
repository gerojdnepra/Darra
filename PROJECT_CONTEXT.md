# Darra / Scalp Station: текущий контекст проекта

Документ собран по текущим исходникам в `frontend/`, `backend/` и `desktop/`.

## 1. Текущий стек

### Frontend

- `Next.js 14.2.35` на `App Router`
- `React 18.3.1`
- `TypeScript 5.7`
- `Tailwind CSS 3`
- `Zustand` для клиентского состояния
- `idb` + `IndexedDB` для локальной персистентности
- `qrcode`
- `PWA`-сборка
- `Capacitor 8` для Android-оболочки

### Backend

- `Node.js >= 20`
- `TypeScript 5.7`
- `Express 5`
- `ws`
- `dotenv`
- `node-edge-tts`
- `firebase-admin`
- `jsonwebtoken`
- `jwk-to-pem`

### Desktop

- `Electron 42`
- `electron-builder`
- `esbuild`
- preload bridge через `desktop/preload.cjs`

### Внешние интеграции

- `Binance Futures USDT-M` REST + WebSocket
- `Firebase Admin` для social auth / custom token flow
- `Apple Sign In`
- `Telegram OAuth/OIDC`
- локальный `JSONL`-журнал событий
- `Docker Compose`

## 2. Архитектурные ограничения

- Архитектура трёхконтурная: `frontend` + `backend` + `desktop`, при этом desktop не живёт сам по себе, а поднимает собранные бандлы фронта и бэка.
- Frontend общается с backend в основном через `WebSocket`; базовый runtime URL по умолчанию: `ws://localhost:3001/ws`.
- Backend строит скринер в памяти. Это не БД-центричная система: live-состояние рынка, метрики, focus-basket и alert pipeline пересобираются после рестарта.
- Персистентность разделена:
  - UI, watchlist, layout, cabinet-профили и workspace хранятся локально в `IndexedDB`
  - market-события для reviving coin и signal history хранятся локально в `.data/market-events.jsonl`
- Desktop runtime использует `desktop/.bundle`, а не `frontend/.next` и не `backend/src` напрямую. После изменений в коде нужен нормальный rebuild pipeline:
  1. сборка фронта
  2. `desktop/scripts/prepare-bundles.mjs`
  3. при необходимости `desktop/scripts/package-folder.mjs`
- Основная логика сканирования рассчитана на полный рынок USDT-M perpetual, но детальный анализ делается по rotating focus basket.
- Базовые runtime-параметры сейчас жёстко зашиты в конфиг/нормализацию:
  - `BACKEND_PORT=3001`
  - `BACKEND_WS_PATH=/ws`
  - `DEFAULT_FOCUS_UNIVERSE_SIZE=40`
  - `FRAME_INTERVAL_MS=1000`
  - `FOCUS_REBALANCE_INTERVAL_MS=15000`
- Доступ к Binance account из `.env` ограничен trusted-local model:
  - по умолчанию env-ключи не должны отдаваться удалённым клиентам
  - удалённый доступ включается только через `ALLOW_REMOTE_ENV_BINANCE_ACCOUNT_ACCESS=true`
- Desktop bridge ограничен preload-слоем:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - UI получает доступ к desktop-функциям только через `window.scalpStationDesktop`
- Desktop shell currently uses separate `BrowserWindow` instances for the dashboard, control
  center, signal overlay, and module routes. It does not use `BrowserView`.
- This gives clean renderer isolation per module, but it also means higher RAM/CPU cost than a
  single-window embedded-view shell.
- Cross-window UI state is not one shared Zustand store. Runtime synchronization is done through
  `BroadcastChannel` plus persisted state snapshots, so the consistency model is eventual rather
  than transactional.
- Social auth в live-режиме зависит от внешнего HTTPS base URL и корректных redirect URI. Это не purely-local фича.
- Desktop UX завязан на multi-window mode: отдельные module windows, control center, signal overlay, tray mode, `alwaysOnTop`, `opacity`.
- Current render-health thresholds in the frontend are:
  - `HEALTHY` above `50 FPS`
  - `STRESSED` at `50 FPS` or lower, or frame age above `1000 ms`
  - `DEGRADED` below `30 FPS` or frame age above `3000 ms`
- Combined with `FRAME_INTERVAL_MS=1000`, the current product target is stable `1 Hz` market frame
  delivery with smooth interaction, not high-frequency `60 Hz` market redrawing.
- The transport layer already supports `request_snapshot`, `snapshot`, `frame_patch`, `ping`, and
  `pong`, plus per-client delta state on the backend.
- The current recovery model is practical but incomplete for a strict trading-terminal standard:
  there are snapshots and patches, but no documented explicit `frameSeq` / `baseSeq` numbering in
  the message contract yet.
- The next reliability step should be sequence-numbered patches, client `lastSeenSeq`, gap
  detection, and forced full resync when the client cannot prove patch continuity.
- Binance account runtime credentials entered in the UI are intentionally kept out of `IndexedDB`
  and browser `localStorage`; they are sent to the backend and held in the local backend process
  for the current session only.
- `.env` Binance credentials remain a trusted-local mode and are not meant for remote reuse unless
  `ALLOW_REMOTE_ENV_BINANCE_ACCOUNT_ACCESS=true` is explicitly enabled.
- The desktop shell currently does not use Electron `safeStorage` for persisted Binance account
  secrets.

## 3. Источники данных

### Публичные рыночные данные Binance

#### REST

- `GET /fapi/v1/exchangeInfo`
  - источник списка торгуемых perpetual USDT-M контрактов
- `GET /fapi/v1/ticker/24hr`
  - стартовый снимок 24h метрик по рынку
- `GET /fapi/v1/klines`
  - дневные свечи для расчёта historical quote volume в reviving-coin detector
- `GET /fapi/v1/time`
  - синхронизация server time для signed account-запросов
- `POST|PUT|DELETE /fapi/v1/listenKey`
  - lifecycle private user data stream
- `GET /fapi/v3/positionRisk`
  - snapshot позиций для account mode

#### WebSocket

- `!ticker@arr`
  - поток 24h ticker updates по всему рынку
- `!markPrice@arr@1s`
  - поток mark price / funding context
- `!forceOrder@arr`
  - ликвидации
- `<symbol>@aggTrade`
  - аггрегированные трейды по focus-symbols
- `<symbol>@bookTicker`
  - best bid / best ask по focus-symbols
- `private/ws/{listenKey}`
  - приватный account stream Binance

### Локальные данные приложения

- `IndexedDB`
  - БД `scalp-station`
  - store `ui`
  - содержит UI state, cabinet session, profiles, Darra workspace, сохранённые настройки
- `.data/market-events.jsonl`
  - локальный event journal backend
  - хранит signal history и reviving-coin history

### Внешние auth-источники

- `Firebase Admin`
- `Apple Sign In`
- `Telegram OAuth/OIDC`

### Внутренние backend API

- `GET /`
- `GET /health`
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/reviving-coin-alerts/events?limit=100`
- `GET /api/tts/models`
- `GET|POST /api/tts/synthesize`
- `POST /api/tts/synthesize-stream`
- `GET|POST /oauth/*`

## 4. Требования к UI

### Каналы доставки UI

- Браузерная версия
- PWA
- Android-оболочка через Capacitor
- Windows desktop-оболочка через Electron

### Обязательные продуктовые секции

- `Overview`
- `Filters`
- `Darra Terminal` / screener grid
- `Binance Account`
- `Active Trades`
- `Watchlist`
- `100M Volume`
- `1-100M Volume`
- `Signal Tape`
- `Feed Health`
- `Social Auth`
- `Cabinet`

### Основные требования к desktop UI

- На desktop-sized экранах панели должны жить на одном workspace, а не в мобильной swipe-раскладке.
- Панели должны поддерживать:
  - drag/move
  - resize по границам
  - `grid` mode
  - `free` mode
  - сохранение order / size / coordinates / mode
- Должны существовать отдельные module windows:
  - `overview`
  - `filters`
  - `screener`
  - `account`
  - `activeTrades`
  - `watchlist`
  - `volumeMilestones`
  - `volumeThresholdMilestones`
  - `alerts`
  - `health`
- Должны поддерживаться desktop-специфичные функции:
  - control center
  - signal overlay
  - `always on top`
  - `opacity`
  - tray/background mode

### Основные требования к mobile/tablet UI

- Мобильная и tablet-версия сохраняют swipe/paged navigation.
- Desktop free/grid layout не должен ломать mobile-поток.

### Onboarding direction

- The current module count is powerful for an experienced user but cognitively heavy for a first
  session.
- Product onboarding should eventually support a `Simple View` with only core workflow modules such
  as `Screener`, `Binance Account`, `Signal Tape`, and `Risk Center`.
- The preferred UX pattern is progressive disclosure: core scanner workflow first, advanced regime,
  statistics, learning, and portfolio modules second.

### Фильтры и интерактив

- Поиск по `symbol` / `baseAsset`
- `Min 24h Quote Volume`
- `Sort By`:
  - `score`
  - `30s Momentum`
  - `2m Momentum`
  - `Volume Impulse`
  - `Liquidations 5m`
  - `24h Quote Volume`
- `Bias Filter`:
  - `ALL`
  - `LONG`
  - `SHORT`
  - `NEUTRAL`
- `Focus Basket Size` c диапазоном `12..90`
- `Watchlist only`

### Alert UX

- `Signal Tape` живёт отдельно от volume milestone windows.
- `100M Volume` не должен смешиваться с обычными tape alerts.
- Для `reviving_coin` нужен полноэкранный `Critical Alert` overlay:
  - крупный symbol title
  - 24h volume
  - average volume baseline
  - volume change %
  - detection time
  - кнопка `Open chart`
  - кнопка `Close`
  - очередь алертов
  - повторяющийся sound до закрытия модалки

### Локальная персистентность UI

- Watchlist должен храниться локально
- Layout и panel bounds должны храниться локально
- Cabinet profiles и session должны храниться локально
- Darra workspace должен храниться локально
- Sound/preferences должны храниться локально

### Retention model

- The most important retention loop is the accumulation of user-specific context, not only live
  alerts.
- `Auto Journal`, `Trade Journal`, `Signal Statistics`, `Learning Center`, and saved workspace
  state together create product memory and switching costs.
- This means long-term retention should come from better review, learning, and personalization
  workflows, not only from adding more market alerts.

### Локализация

- В проекте уже есть минимум `en` и `ru` слой названий/копирайта
- UI нельзя проектировать как strictly English-only

## 5. Формулы расчётов

### Базовые временные окна

- price series хранится по бакетам `1s`
- trade flow хранится по бакетам `1s`
- liquidation flow хранится по бакетам `1s`
- окно хранения буферов: `300_000 ms` (`5 минут`)

### Momentum

```text
momentum30sPct = ((latestPrice - price_30s_ago) / price_30s_ago) * 100
momentum2mPct  = ((latestPrice - price_120s_ago) / price_120s_ago) * 100
```

### Торговый поток и импульс объёма

```text
tradeNotional5s  = buy5s + sell5s
tradeNotional60s = buy60s + sell60s
tradeNotional5m  = buy5m + sell5m

previousFourMinuteAverage = max((tradeNotional5m - tradeNotional60s) / 4, 1)
volumeImpulse = tradeNotional60s / previousFourMinuteAverage
buyRatio60s   = buy60s / tradeNotional60s
```

Если `tradeNotional60s == 0`, то `buyRatio60s = 0.5`.

### Спред и стакан

```text
spreadBps = ((bestAsk - bestBid) / price) * 10_000

orderBookImbalance =
  (bestBidQty - bestAskQty) / (bestBidQty + bestAskQty)
```

### Ликвидации

```text
liquidation5m = longsHit5m + shortsHit5m
liquidationSkew = clamp((shortsHit5m - longsHit5m) / 120_000, -12, 12)
```

`liquidationBias`:

- `LONGS_HIT`, если `longsHit > shortsHit * 1.15`
- `SHORTS_HIT`, если `shortsHit > longsHit * 1.15`
- иначе `BALANCED`

### Основной bias/score скринера

```text
rawBiasScore =
  clamp(momentum30sPct * 18, -24, 24) +
  clamp(momentum2mPct * 10, -18, 18) +
  clamp((buyRatio60s - 0.5) * 90, -14, 14) +
  clamp((volumeImpulse - 1) * 6, -12, 18) +
  clamp(orderBookImbalance * 18, -10, 10) +
  clamp(change24hPct / 3, -10, 10) +
  liquidationSkew -
  clamp(spreadBps * 0.8, 0, 15)

score = clamp(50 + rawBiasScore, 0, 100)
```

Интерпретация `bias`:

- `LONG`, если `rawBiasScore >= 9`
- `SHORT`, если `rawBiasScore <= -9`
- иначе `NEUTRAL`

### Focus rank

Формула выбора/приоритезации focus basket:

```text
focusRank =
  quoteVolume24h * (1 + abs(change24hPct) / 100) +
  (flow60s.buy + flow60s.sell) * 4 +
  (liq5m.longsHit + liq5m.shortsHit) * 8 +
  price * abs(momentum2mPct) * 100
```

### Overview / market pulse

```text
advancingCount = count(change24hPct >= 0)
decliningCount = totalRows - advancingCount

marketPulse =
  sum(
    +1 for LONG rows in focus set,
    -1 for SHORT rows in focus set,
     0 for NEUTRAL rows in focus set
  )
```

Интерпретация `dominantRegime`:

- `risk-on`, если `marketPulse >= 6`
- `risk-off`, если `marketPulse <= -6`
- иначе `balanced`

`hotLiquidationsUsd` = сумма `liquidation5m` по первым `20` строкам.

### Теги строк

Текущие tag-правила:

- `FOCUS`, если символ в focus basket
- `TRADE`, если символ в active trade
- `WATCH`, если символ в watchlist
- `VOL SPIKE`, если `volumeImpulse >= 1.8`
- `BID TAPE`, если `buyRatio60s >= 0.58` и `momentum30sPct > 0.25`
- `OFFER TAPE`, если `buyRatio60s <= 0.42` и `momentum30sPct < -0.25`
- `WIDE`, если `spreadBps >= 6`
- `LIQ SWEEP`, если `liquidation5m >= 250_000`
- `FUNDING`, если `abs(fundingRate) >= 0.0008`

### Tape alerts

Кандидат на tape alert:

```text
volumeImpulse >= 2.2
AND tradeNotional60s >= 300_000
```

Bias tape alert:

- `LONG`, если `momentum30sPct >= 0.4` и `buyRatio60s >= 0.5`
- `SHORT`, если `momentum30sPct <= -0.4` и `buyRatio60s <= 0.5`

Severity:

- `critical`, если `volumeImpulse >= 3`
- иначе `high`

Cooldown ключа alert:

```text
90_000 ms
```

### Liquidation alerts

Кандидат на liquidation alert:

```text
liquidation5m >= 400_000
```

Bias liquidation alert:

- `SHORTS_HIT -> LONG`
- `LONGS_HIT -> SHORT`

Severity:

- `critical`, если `liquidation5m >= 1_000_000`
- иначе `high`

### Reviving coin detector

Базовый кандидат:

```text
quoteVolume24h >= minCurrentQuoteVolume24h
```

Average-volume criterion:

```text
averageDailyQuoteVolume < maxAverageDailyQuoteVolume
```

No-signal criterion:

```text
нет signal events по символу за noSignalLookbackDays
```

Комбинация dead-criteria:

- если `requireAllDeadCriteria = true`, то нужны все активные критерии
- если `false`, достаточно любого одного

Средняя ликвидность:

```text
averageDailyQuoteVolume =
  sum(dailyQuoteVolume over completed daily candles) / count(candles)
```

Изменение объёма к среднему:

```text
volumeChangePct =
  ((quoteVolume24h - averageDailyQuoteVolume) / averageDailyQuoteVolume) * 100
```

Cooldown:

```text
alertCooldownHours
```

Текущие default значения:

- `minCurrentQuoteVolume24h = 100_000_000`
- `liquidityLookbackDays = 30`
- `maxAverageDailyQuoteVolume = 10_000_000`
- `noSignalLookbackDays = 30`
- `scanIntervalMinutes = 5`
- `alertCooldownHours = 24`

### Volume milestone logic

Отдельное окно `100M Volume` работает по crossing-логике:

- событие `above`, если символ пересёк threshold снизу вверх
- событие `below`, если символ ушёл ниже threshold

Default threshold:

```text
100_000_000 USDT
```

### 1-100M threshold milestones

Дополнительное окно milestone-уровней использует набор threshold-ов:

- `1M, 2M, 3M, ... 10M`
- `20M, 30M, ... 100M`

События также генерируются на пересечении уровня вверх или вниз.

### Формула видимости строк в UI

После сортировки строка показывается, если:

```text
quoteVolume24h >= minimumQuoteVolume
AND bias matches selected biasFilter
AND (showOnlyWatchlist -> symbol in watchlist)
AND search term matches symbol/baseAsset
```

Отдельное правило:

- `activeTrades` поднимаются наверх списка независимо от стандартного фильтра.
