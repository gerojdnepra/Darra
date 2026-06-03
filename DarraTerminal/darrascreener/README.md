# Scalp Station

`Scalp Station` is a localhost Binance Futures USDT-M perpetual screener built as:

- `backend/`: Node.js 20+, strict TypeScript, in-memory screener engine, Binance public WebSocket ingestion, local WebSocket server on `ws://localhost:3001/ws`
- `frontend/`: Next.js 14 App Router, Tailwind CSS 3, Zustand, IndexedDB persistence, WebSocket-only transport to the backend

The backend scans the full USDT-M perpetual universe through Binance global streams, then rotates a detailed focus basket for tighter trade-flow and spread analysis.

## Features

- Full-universe market breadth from Binance Futures public streams
- Dynamic focus universe for fast tape/spread/liquidation metrics
- Critical "reviving coin" alerts for symbols that were quiet/dead and suddenly cross a high 24h volume threshold
- Separate `100M Volume` window for coins that cross the configured 24h turnover threshold without mixing them into Signal Tape
- WebSocket-only frontend/backend communication
- Android-ready mobile UI with Capacitor native shell
- Windows desktop shell with separate module windows, multi-monitor placement, always-on-top and opacity controls
- Desktop dashboard layout manager: all panels on one screen, draggable panels, border resizing, grid mode and free mode without snap-to-grid
- Installable PWA manifest for browser install
- Runtime backend WebSocket URL switcher for phone/LAN usage
- Optional Binance account sync via runtime API key entry or `.env` for local trusted clients
- Watchlist persistence in IndexedDB
- Docker Compose support
- Works without API keys

## Project map

Use this section as the source-of-truth map before changing code.

- `backend/`: Node.js backend service
- `backend/src/index.ts`: backend entrypoint, local HTTP/WS bootstrap
- `backend/src/config.ts`: env parsing and runtime config
- `backend/src/services/binance-stream.ts`: public Binance stream ingestion
- `backend/src/services/binance-account-stream.ts`: private/account stream sync
- `backend/src/services/binance-rest.ts`: REST helpers for Binance data
- `backend/src/services/reviving-coin-detector.ts`: detects quiet/dead coins that suddenly revive on high 24h quote volume
- `backend/src/services/screener-engine.ts`: emits screener frames, normal alerts and separate 24h volume milestone events
- `backend/src/services/market-event-store.ts`: local market-event journal used for reviving-coin persistence and no-recent-signal checks
- `backend/src/services/screener-engine.ts`: in-memory screener logic and frame generation
- `backend/src/services/tts-service.ts`: text-to-speech server-side helpers
- `backend/src/lib/settings.ts`: backend defaults and validation for screener/runtime alert settings
- `backend/migrations/`: SQL migration contracts for persistent market alert storage
- `frontend/`: Next.js app
- `frontend/app/page.tsx`: main browser app route
- `frontend/components/scalp-station-app.tsx`: main web UI and the shared module UI used by desktop section pages
- `frontend/components/critical-alert-overlay.tsx`: full-screen Critical Alert modal for reviving-coin events
- `frontend/store/use-screener-store.ts`: central client state store
- `frontend/lib/`: browser-side helpers, transport, formatting, IndexedDB, TTS, desktop bridge types
- `frontend/lib/settings.ts`: frontend defaults and validation for dashboard and reviving-coin alert settings
- `frontend/app/module/[section]/page.tsx`: per-section desktop pages like `overview`, `watchlist`, `alerts`, `health`
- `frontend/lib/module-sections.ts`: allowed desktop sections, labels, dashboard panel order, default panel sizes and free-layout positions
- `frontend/app/desktop/page.tsx`: desktop route alias that reuses `app/desktopdaraterminal/page.tsx`
- `frontend/app/desktopdaraterminal/page.tsx`: dedicated Darra/Vataga terminal route
- `frontend/десктопдаратерминал/vataga-desktop-terminal.tsx`: source-of-truth for the dedicated terminal screen
- `frontend/десктопдаратерминал/workspace.ts`: dock/split workspace tree, default layouts, pane placement logic
- `frontend/десктопдаратерминал/storage.ts`: local persistence for the terminal workspace, filters and paper trading prefs
- `frontend/десктопдаратерминал/types.ts`: terminal-specific layout, quotes and trading types
- `frontend/app/desktop/signal/page.tsx`: standalone signal overlay page used by the desktop shell
- `frontend/components/desktop-control-center.tsx`: desktop control center UI
- `desktop/`: Electron shell
- `desktop/main.cjs`: Electron app entrypoint, window creation, menu/tray, frontend serving, bundled backend lifecycle
- `desktop/preload.cjs`: bridge between Electron and the frontend
- `desktop/scripts/prepare-bundles.mjs`: builds the desktop frontend export and bundles backend into `desktop/.bundle`
- `desktop/scripts/package-folder.mjs`: turns the prepared bundle into `desktop/release/win-unpacked`
- `frontend/scripts/build-desktop-web.mjs`: static Next export used by the Electron shell
- `frontend/scripts/build-android-web.mjs`: static build path used by the Capacitor Android shell

## Desktop build flow

This is the order to keep in mind when desktop changes do not show up in the packaged app:

1. Edit source files in `frontend/` and `backend/`.
2. `frontend/scripts/build-desktop-web.mjs` builds a static export into `frontend/out`.
3. `desktop/scripts/prepare-bundles.mjs` copies `frontend/out` into `desktop/.bundle/frontend` and bundles `backend/src/index.ts` into `desktop/.bundle/backend/index.cjs`.
4. `desktop/main.cjs` runs Electron against `desktop/.bundle`, not against `frontend/.next`.
5. `desktop/scripts/package-folder.mjs` copies Electron runtime plus `.bundle` into `desktop/release/win-unpacked`.

If the packaged desktop looks stale, the problem is usually that the source was changed but `prepare:bundles` or `package:folder` was not run again.

## Desktop dashboard layout

The main desktop dashboard is no longer forced into the mobile-style horizontal swipe layout. On
desktop-sized screens, dashboard panels are shown together on one workspace and can be arranged by
the user.

Controls:

- `grid off/on`: turns dashboard grid alignment off or on. `grid off` is the free manual mode.
- `arrange`: quickly packs the panels back into a usable desktop arrangement for the current window width.
- Top part of a panel: in `grid off` mode, drag the upper/title area of any panel to move it freely.
- `Move`: still works as a visible grab handle. In grid mode it reorders panels; in `grid off` mode it moves the panel freely.
- Panel borders: drag any edge or corner of a panel to resize it. There is no separate `Size` button.
- Double-click a panel border to reset that panel back to its default size and position.
- `grid on`: panels stay aligned to the dashboard grid. When one panel changes size, neighboring panels reflow around it.
- `grid off`: snap-to-grid is disabled. Panels can be placed and resized by pixels without grid alignment.

Persistence:

- The selected layout mode is saved in IndexedDB as part of `uiPreferences.dashboardLayoutMode`.
- Old saved dashboard layouts that did not explicitly choose a mode now open with `grid off` by default.
- Panel order, grid spans, minimum heights, free-mode positions and free-mode pixel sizes are saved in `uiPreferences.dashboardPanelLayout`.
- The layout is local to the browser/desktop profile. Clearing app storage resets it to defaults.

Important behavior:

- Free mode is intended for manual workstation-style layouts where exact placement matters.
- Grid mode is better when you want neighboring panels to automatically move and keep a clean aligned dashboard.
- The mobile/tablet layout keeps the swipe behavior; the desktop layout changes only apply on desktop-sized screens.

Source files:

- `frontend/components/scalp-station-app.tsx`: dashboard panel rendering, move logic, border resize logic and `layout grid/free` toggle.
- `frontend/app/globals.css`: desktop dashboard grid, free-layout positioning and invisible resize borders.
- `frontend/store/use-screener-store.ts`: saved UI preferences and panel layout actions.
- `frontend/lib/module-sections.ts`: panel IDs, default order, default grid sizes and default free-layout bounds.
- `frontend/lib/types.ts`: dashboard layout mode and panel layout types.
- `frontend/components/darra-terminal-shell.tsx`: persisted desktop shell state normalization.
- `frontend/components/social-auth-panel.tsx`: shared panel props so the account panel can also be moved/resized.

After changing dashboard layout code, rebuild the packaged desktop app with the normal desktop build
flow so `desktop/release/win-unpacked/Darra Terminal.exe` receives the updated frontend bundle.

## Generated output

These paths are build artifacts. Do not treat them as the primary source unless you intentionally need to inspect packaged output:

- `backend/dist`
- `frontend/.next`
- `frontend/out`
- `desktop/.bundle`
- `desktop/release`

When possible, fix the source files first and regenerate the output.

## SQLite persistence and journal

SQLite is enabled by the backend automatically on startup. For local development the default data
directory is `backend/.data`, and the default database file is
`backend/.data/darra-terminal.sqlite`.

Configuration:

- `SCALPSTATION_SQLITE_PATH`: exact SQLite file path. Use this when you want the database outside
  the source tree or on a persistent volume.
- `SCALPSTATION_DATA_DIR`: base data directory used when `SCALPSTATION_SQLITE_PATH` is empty.
- `AUTO_JOURNAL_FROM_BINANCE=true`: creates journal entries from connected Binance account events.
- `AUTO_JOURNAL_FROM_BINANCE=false`: disables automatic journal writes while keeping manual journal
  usage available.

Desktop packaged app:

- If no SQLite path is configured, Electron starts the bundled backend with a writable
  `userData/backend-data/darra-terminal.sqlite` path.
- Do not point `SCALPSTATION_SQLITE_PATH` into packaged resources or `desktop/.bundle`; those paths
  may be read-only after packaging.

Checks:

- Health: open `http://localhost:3001/health` and confirm `persistenceQueue.queueSize`,
  `droppedEventsCount`, `lastFlushAt`, and `flushErrorsCount` are present.
- Signals: connect the frontend, wait for market frames, then request signal statistics from the
  Signal Statistics module or send WebSocket `request_signal_statistics`.
- Journal: open the Trade Journal module and confirm entries load; with Binance account sync enabled,
  account position events can auto-create entries when `AUTO_JOURNAL_FROM_BINANCE=true`.
- Disable auto journal: set `AUTO_JOURNAL_FROM_BINANCE=false`, restart the backend, then confirm
  manual journal actions still work and no new Binance-derived auto events are emitted.

## Reviving coin critical alerts

The backend includes a high-priority detector for symbols that look "dead" and then suddenly
revive. It runs on top of the existing Binance scan data and emits normal screener alerts with
`kind: "reviving_coin"`, so the existing alert tape and notification pipeline continue to work.

Default detection rules:

- Current 24h quote volume must be at least `100,000,000 USDT`.
- A coin is treated as dead when its average daily quote volume over the liquidity lookback period is below `10,000,000 USDT`, or when it had no current screener signals during the no-signal lookback period.
- The default liquidity lookback is `30` days.
- The default no-signal lookback is `30` days.
- The default scan interval is `5` minutes.
- The default alert cooldown per symbol is `24` hours.

Runtime settings are available in the frontend Filters panel under `Reviving Coin Critical Alert`.
The important fields are:

- `Min 24h Volume USDT`
- `Liquidity Lookback Days`
- `Dead Avg Max USDT`
- `No Signal Days`
- `Scan Every Minutes`
- `Alert Cooldown Hours`
- `Use avg-volume criterion`
- `Use no-signal criterion`
- `Require all criteria`
- `Critical sound`
- `Sound Repeat Seconds`

When a reviving-coin alert arrives, the frontend shows a full-screen Critical Alert above the app
with a darkened background, large symbol name, 24h volume, percentage change versus the average
liquidity baseline, detection time, an `Open chart` button, and a manual `Close` button. Alerts are
queued: if multiple symbols fire together, only one modal is shown at a time. The critical sound
repeats until the visible modal is closed.

Backend API:

```http
GET /api/settings
PATCH /api/settings
GET /api/reviving-coin-alerts/events?limit=100
```

The WebSocket `set_settings` message also accepts:

```json
{
  "type": "set_settings",
  "payload": {
    "revivingCoins": {
      "enabled": true,
      "scanIntervalMinutes": 5,
      "minCurrentQuoteVolume24h": 100000000,
      "liquidityLookbackDays": 30,
      "maxAverageDailyQuoteVolume": 10000000,
      "noSignalLookbackDays": 30,
      "useAverageVolumeCriterion": true,
      "useNoSignalCriterion": true,
      "requireAllDeadCriteria": false,
      "alertCooldownHours": 24,
      "soundEnabled": true,
      "soundRepeatSeconds": 10
    }
  }
}
```

Persistence:

- By default, backend events are appended to `.data/market-events.jsonl`.
- Override the directory with `SCALPSTATION_DATA_DIR`.
- Override the exact event log path with `SCALPSTATION_MARKET_EVENT_STORE_PATH`.
- SQL migration contract: `backend/migrations/20260530_create_reviving_coin_alerts.sql`.

Integration checklist:

1. Restart the backend so it loads the new detector and settings defaults.
2. Restart the frontend so the Critical Alert overlay and settings panel are available.
3. If using an external SQL database, apply `backend/migrations/20260530_create_reviving_coin_alerts.sql`.
4. Confirm `GET /api/settings` returns a `revivingCoins` object.
5. Tune thresholds in the Filters panel if the default `100M USDT` trigger is too strict or too noisy.

## 100M Volume window

The app also tracks ordinary 24h volume milestones separately from Signal Tape. When any Binance
USDT-M coin reaches the configured 24h quote-volume threshold, the backend adds an item to
`frame.volumeMilestones` instead of `frame.alerts`.

Default behavior:

- The threshold is `100,000,000 USDT` 24h quote volume.
- The event appears in a separate dashboard panel named `100M Volume`.
- In the Windows desktop shell, a separate module window is available at `/module/volumeMilestones`.
- Fresh milestone events can open the `100M Volume` desktop window automatically.
- These events do not appear in `Signal Tape`.

Settings are in the Filters panel under `100M Volume Window`:

- `Enabled`
- `Min 24h Volume USDT`

## Where to look first

Use this quick index before searching the whole tree:

- Browser/mobile UI issue: start with `frontend/components/scalp-station-app.tsx`, `frontend/store/use-screener-store.ts` and `frontend/lib/`
- Dedicated Darra/Vataga terminal visual or docking issue: start with `frontend/десктопдаратерминал/vataga-desktop-terminal.tsx` and `frontend/десктопдаратерминал/workspace.ts`
- Desktop route confusion: check both `frontend/app/desktop/page.tsx` and `frontend/app/desktopdaraterminal/page.tsx`
- Desktop control center issue: check `frontend/components/desktop-control-center.tsx` and `frontend/lib/desktop-shell.ts`
- Desktop multi-window behavior, tray, menu, overlay window or packaged runtime issue: check `desktop/main.cjs`
- Section-specific desktop window issue like `watchlist` or `alerts`: check `frontend/app/module/[section]/page.tsx` and `frontend/lib/module-sections.ts`
- Backend websocket/feed/account problem: start with `backend/src/index.ts` and `backend/src/services/`
- Persistence issue: check `frontend/lib/indexed-db.ts`, `frontend/store/use-screener-store.ts`, and `frontend/десктопдаратерминал/storage.ts`
- Desktop build/package issue: check `frontend/scripts/build-desktop-web.mjs`, `desktop/scripts/prepare-bundles.mjs`, and `desktop/scripts/package-folder.mjs`

## Runtime logs and useful files

Useful places to inspect before deeper debugging:

- `backend/codex.dev.out.log`
- `backend/preview.out.log`
- `frontend/codex.dev.out.log`
- `frontend/.next-start.log`
- `frontend/build.log`
- `frontend/start.log`
- project root `.env`

## Current known issues

This section should describe the current checked state of the workspace, not ideal future behavior.

- `backend` TypeScript validation currently passes.
- `frontend/scripts/build-desktop-web.mjs` currently passes and exports the desktop web bundle.
- `desktop/scripts/prepare-bundles.mjs` currently passes. If `esbuild` cannot bundle the backend in a restricted environment, it falls back to compiling backend TypeScript into `.bundle/backend/dist` and copying backend `node_modules`.
- `desktop/scripts/package-folder.mjs` currently passes and writes `desktop/release/win-unpacked/Darra Terminal.exe`.
- Some desktop-related files contain mojibake/corrupted Cyrillic text, especially in `frontend/десктопдаратерминал/*` and parts of `desktop/main.cjs`. It makes UI text edits riskier, but it is no longer blocking the desktop build.

## Verified Binance docs

- [Exchange Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information)
- [All Market Tickers Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/All-Market-Tickers-Streams)
- [Mark Price Stream for All Market](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Mark-Price-Stream-for-All-market)
- [All Market Liquidation Order Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/All-Market-Liquidation-Order-Streams)
- [Aggregate Trade Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Aggregate-Trade-Streams)
- [Individual Symbol Book Ticker Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Individual-Symbol-Book-Ticker-Streams)

## Local run

Use Docker Compose:

```bash
docker compose up --build
```

Or run the parts separately:

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` on the computer. On another device in the same Wi-Fi network, open
`http://<computer-lan-ip>:3000` and set the backend field in the app to
`ws://<computer-lan-ip>:3001/ws`.

By default, Binance API keys from `.env` are only exposed to local trusted clients on the same
machine. LAN clients can still use the screener, but if they need account sync they should enter
their own API keys at runtime. If you intentionally want remote clients to inherit the server-side
`.env` Binance account, set `ALLOW_REMOTE_ENV_BINANCE_ACCOUNT_ACCESS=true`.

## Windows desktop build

The Windows shell lives in `desktop/` and bundles the current `frontend/` and `backend/` into one
Electron app. It adds:

- one control center window for layout management
- separate module windows for dashboard sections
- main dashboard panels on one desktop workspace instead of mobile-style left/right swiping
- draggable and resizable dashboard panels
- `layout grid` and `layout free` modes for aligned or fully manual panel placement
- live move/restore across multiple monitors
- per-window `Always on top`
- per-window opacity
- saved window bounds between launches

Build an unpacked folder:

```bash
cd desktop
npm install
npm run package:folder
```

The ready-to-run folder will appear in `desktop/release/win-unpacked/`.

If you want the packaged app to use custom backend or auth settings, place a `.env` file next to
the `.exe` (or keep using the project-root `.env` while running from source).

## Android build

The Android shell lives in `frontend/android` and uses Capacitor. The backend still runs as the
local Node.js service on your computer/server; the Android app connects to it over Wi-Fi/LAN.

```bash
cd frontend
npm install
npm run android:sync
npm run android:open
```

In Android Studio, build an APK/AAB from the opened project. After installing the app on the phone,
enter the backend URL in the top card:

```text
ws://<computer-lan-ip>:3001/ws
```

If the phone cannot connect, check that both devices are on the same network and that Windows
Firewall allows inbound connections to backend port `3001`.
