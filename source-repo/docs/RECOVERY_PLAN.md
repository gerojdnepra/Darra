# Recovery Plan

## What cannot be done automatically here

We cannot fully restore the original source repository from this workspace alone because:

- `.git` is missing
- source files are not present
- backend is bundled
- frontend is compiled
- no source maps were found in the workspace

## Best recovery order

1. Find the original repository first.
2. If it exists elsewhere, treat the installed bundle only as a verification target.
3. If the original repo is gone, reconstruct the project into this scaffold manually.

## Manual reconstruction order

### 1. Desktop shell

Start from:

- `../Darra Terminal/resources/app/main.cjs`
- `../Darra Terminal/resources/app/preload.cjs`
- `../Darra Terminal/resources/app/desktop-visual-override.css`

Move these into:

- `apps/desktop/src/main/`
- `apps/desktop/src/preload/`
- `apps/desktop/assets/`

### 2. Backend

Use the recovered backend module map from `MODULE_MAP.md`.

Re-split `index.cjs` into:

- config
- auth broker
- TTS service
- Binance REST service
- Binance account stream service
- Binance public stream service
- screener engine
- shared math/rolling utilities
- root startup module

### 3. Frontend

Reconstruct from the compiled app into:

- `apps/frontend/app/`
- `apps/frontend/components/`
- `apps/frontend/lib/`

Start from visible product areas:

- dashboard
- filters
- screener
- alerts
- watchlist
- account panel
- feed health
- desktop terminal

### 4. Environment and secrets

- use `.env.example` from this scaffold
- never copy real secrets from the installed app into git
- move production secrets into secure runtime storage

## Definition of done

The project can be considered back on a normal source repository when:

1. The repo has a real VCS root.
2. Desktop, frontend, and backend live as source code, not only bundles.
3. The app can be built from source into an identical or near-identical bundle.
4. Secrets are removed from shipped runtime files.
5. Tests cover startup, websocket, TTS, and localization behavior.
