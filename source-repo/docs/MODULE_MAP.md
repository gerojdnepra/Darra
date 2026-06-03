# Module Map

## Current artifact layout

- Desktop shell: `../Darra Terminal/resources/app/main.cjs`
- Preload bridge: `../Darra Terminal/resources/app/preload.cjs`
- Desktop CSS override: `../Darra Terminal/resources/app/desktop-visual-override.css`
- Backend bundle: `../Darra Terminal/resources/app/.bundle/backend/index.cjs`
- Frontend bundle: `../Darra Terminal/resources/app/.bundle/frontend/`

## Recovered backend source modules

The backend bundle still contains module comments that reveal the original source split:

- `src/index.ts`
- `src/config.ts`
- `src/social-auth-broker.ts`
- `src/lib/math.ts`
- `src/lib/rolling-window.ts`
- `src/services/binance-rest.ts`
- `src/services/binance-account-stream.ts`
- `src/services/binance-stream.ts`
- `src/services/screener-engine.ts`
- `src/services/tts-service.ts`

## Recovered frontend entrypoints

Visible in the compiled frontend:

- app entry chunk: `/_next/static/chunks/app/page-11a23509ea4f6c8c.js`
- app layout chunk: `/_next/static/chunks/app/layout-771b6eed211cdfc5.js`
- runtime component names: `ScalpStationApp`, `VatagaDesktopTerminal`, `PwaRegistration`
- build id: `BAJgbwQOe1za1Bu1_xRFF`

## Observed product surfaces

- main dashboard
- screener
- alerts / signal tape
- watchlist
- account integration
- feed health
- cabinet/login
- social auth
- desktop signal overlay
- TTS controls

## Practical interpretation

This strongly suggests the original project was split into:

- Electron desktop shell
- Next.js frontend
- TypeScript backend service

That is the structure this recovery scaffold assumes.
