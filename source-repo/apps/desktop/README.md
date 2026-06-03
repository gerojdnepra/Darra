# Desktop App

Target contents for the Electron desktop shell:

- Electron main process
- preload bridge
- desktop-only CSS overrides
- tray and window-management logic

Recovered artifact references:

- `../../Darra Terminal/resources/app/main.cjs`
- `../../Darra Terminal/resources/app/preload.cjs`
- `../../Darra Terminal/resources/app/desktop-visual-override.css`

Suggested eventual structure:

- `src/main/`
- `src/preload/`
- `src/shared/`
- `assets/`
