const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  screen,
  Tray,
  nativeImage
} = require("electron");

const rootDir = __dirname;
const bundleDir = path.join(rootDir, ".bundle");
const frontendDir = path.join(bundleDir, "frontend");
const backendBundlePath = path.join(bundleDir, "backend", "index.cjs");
const preloadPath = path.join(rootDir, "preload.cjs");
const layoutPath = path.join(app.getPath("userData"), "desktop-layout.json");
const alertMonitorStatePath = path.join(app.getPath("userData"), "desktop-alert-monitor.json");
const desktopEnv = loadDesktopEnv();
configureDesktopBackendDataPaths();
const backendWsUrl = `ws://127.0.0.1:${readNumberEnv("BACKEND_PORT", 3001)}${normalizeWsPath(
  readStringEnv("BACKEND_WS_PATH", "/ws")
)}`;
const desktopIconPath = resolveBundledAssetPath("icon-512.png");
const appName = "Darra Terminal";

app.setAppUserModelId("com.troesh.scalpstation.desktop");

const defaultInterfaceLanguage = "en";
const interfaceLanguageSet = new Set(["en", "ru"]);
const interfaceCopy = {
  en: {
    moduleTitles: {
      dashboard: "Dashboard",
      overview: "Overview",
      filters: "Filters",
      screener: "Darra Terminal",
      account: "Binance Account",
      activeTrades: "Active Trades",
      riskCenter: "Risk Center",
      correlationHeatmap: "Correlation Heatmap",
      varPanel: "VaR",
      fundingBasis: "Funding/Basis",
      marketFlow: "Market Flow",
      signalIntelligence: "Signal Intelligence",
      metaRegimeGovernor: "Meta Regime Governor",
      positionRiskOrchestrator: "Position Risk Orchestrator",
      regimeMemory: "Regime Memory",
      regimePrediction: "Regime Prediction",
      regimeFeedbackCalibration: "Regime Feedback Calibration",
      pnlAttribution: "PnL Attribution",
      signalStatistics: "Signal Statistics",
      learningCenter: "Learning Center",
      tradeJournal: "Trade Journal",
      watchlist: "Watchlist",
      volumeMilestones: "100M Volume",
      volumeThresholdMilestones: "1-100M Volume",
      alerts: "Signal Tape",
      frameTelemetry: "Frame Telemetry",
      renderTelemetry: "Render Telemetry",
      health: "Feed Health"
    },
    controlCenter: "Control Center",
    controlCenterWindowTitle: `${appName} - Desktop Terminal`,
    signalOverlayWindowTitle: `${appName} - Signal Overlay`,
    appMenu: appName,
    windowsMenu: "Windows",
    openControlCenter: "Open Control Center",
    openDashboard: "Open Dashboard",
    quit: "Quit",
    primaryDisplay: "Primary display",
    display: "Display",
    critical: "Critical",
    highPriority: "High Priority",
    info: "Info",
    liquidation: "Liquidation",
    signal: "Signal",
    longBias: "LONG bias",
    shortBias: "SHORT bias",
    newMarketAlert: "New market alert"
  },
    ru: {
      moduleTitles: {
        volumeMilestones: "100M Volume",
        volumeThresholdMilestones: "1-100M Volume",
        riskCenter: "Risk Center",
        correlationHeatmap: "Correlation Heatmap",
        varPanel: "VaR",
        fundingBasis: "Funding/Basis",
        marketFlow: "Market Flow",
        signalIntelligence: "Signal Intelligence",
        metaRegimeGovernor: "Meta Regime Governor",
        positionRiskOrchestrator: "Position Risk Orchestrator",
        regimeMemory: "Regime Memory",
        regimePrediction: "Regime Prediction",
        regimeFeedbackCalibration: "Regime Feedback Calibration",
        pnlAttribution: "PnL Attribution",
        signalStatistics: "Signal Statistics",
        learningCenter: "Learning Center",
        tradeJournal: "Trade Journal",
        frameTelemetry: "Frame Telemetry",
        renderTelemetry: "Render Telemetry",
      dashboard: "Дашборд",
      overview: "Обзор",
      filters: "Фильтры",
      screener: "Darra Terminal",
      account: "Аккаунт Binance",
      activeTrades: "Активные сделки",
      watchlist: "Лист наблюдения",
      alerts: "Лента сигналов",
      health: "Состояние фида"
    },
    controlCenter: "Центр управления",
    controlCenterWindowTitle: `${appName} - Рабочий стол`,
    signalOverlayWindowTitle: `${appName} - Signal Overlay`,
    appMenu: appName,
    windowsMenu: "Окна",
    openControlCenter: "Открыть центр управления",
    openDashboard: "Открыть дашборд",
    quit: "Выход",
    primaryDisplay: "Основной экран",
    display: "Экран",
    critical: "Критический",
    highPriority: "Высокий приоритет",
    info: "Инфо",
    liquidation: "Ликвидация",
    signal: "Сигнал",
    longBias: "ЛОНГ bias",
    shortBias: "ШОРТ bias",
    newMarketAlert: "Новый рыночный алерт"
  }
};

const managedWindowDefinitions = [
  { key: "dashboard", route: "/" },
  { key: "overview", route: "/module/overview" },
  { key: "filters", route: "/module/filters" },
  { key: "screener", route: "/module/screener" },
  { key: "account", route: "/module/account" },
  { key: "activeTrades", route: "/module/activeTrades" },
  { key: "riskCenter", route: "/module/riskCenter" },
  { key: "correlationHeatmap", route: "/module/correlationHeatmap" },
  { key: "varPanel", route: "/module/varPanel" },
  { key: "fundingBasis", route: "/module/fundingBasis" },
  { key: "marketFlow", route: "/module/marketFlow" },
  { key: "signalIntelligence", route: "/module/signalIntelligence" },
  { key: "metaRegimeGovernor", route: "/module/metaRegimeGovernor" },
  { key: "positionRiskOrchestrator", route: "/module/positionRiskOrchestrator" },
  { key: "regimeMemory", route: "/module/regimeMemory" },
  { key: "regimePrediction", route: "/module/regimePrediction" },
  { key: "regimeFeedbackCalibration", route: "/module/regimeFeedbackCalibration" },
  { key: "pnlAttribution", route: "/module/pnlAttribution" },
  { key: "signalStatistics", route: "/module/signalStatistics" },
  { key: "learningCenter", route: "/module/learningCenter" },
  { key: "tradeJournal", route: "/module/tradeJournal" },
  { key: "watchlist", route: "/module/watchlist" },
  { key: "volumeMilestones", route: "/module/volumeMilestones" },
  { key: "volumeThresholdMilestones", route: "/module/volumeThresholdMilestones" },
  { key: "alerts", route: "/module/alerts" },
  { key: "frameTelemetry", route: "/module/frameTelemetry" },
  { key: "renderTelemetry", route: "/module/renderTelemetry" },
  { key: "health", route: "/module/health" }
];

const windowDefinitionsByKey = new Map(
  managedWindowDefinitions.map((definition) => [definition.key, definition])
);
const managedWindows = new Map();

let controlCenterWindow = null;
let signalOverlayWindow = null;
let frontendServer = null;
let frontendBaseUrl = "";
let backendLifecycle = null;
let appTray = null;
let layoutState = loadLayoutState();
let alertMonitorSettings = loadAlertMonitorSettings();
let alertMonitorSocket = null;
let alertMonitorReconnectTimer = null;
let alertMonitorPingTimer = null;
let alertMonitorSeenAlertIds = new Set();
let alertMonitorSeenVolumeMilestoneIds = new Set();
let alertMonitorSeenVolumeThresholdMilestoneIds = new Set();
let alertMonitorFrame = null;
let alertMonitorPrimedHistory = false;
let alertMonitorPrimedVolumeMilestonesHistory = false;
let alertMonitorPrimedVolumeThresholdMilestonesHistory = false;
let runtimeStopping = false;
let signalOverlayState = null;
let signalOverlayHideTimer = null;
let lastSignalOverlayEventId = null;
let lastSignalOverlayShownAt = 0;

const initialAlertReplayWindowMs = 120_000;
const initialAlertReplayLimit = 3;
const alertMonitorReconnectDelayMs = 2_500;
const signalOverlayLifetimeMs = 2_600;
const signalOverlayDedupWindowMs = 900;
const startupVolumeWindowAutoOpenSuppressMs = 20_000;

const desktopRuntimeStartedAt = Date.now();

function normalizeInterfaceLanguage(value) {
  return interfaceLanguageSet.has(value) ? value : defaultInterfaceLanguage;
}

function getInterfaceCopy(language = alertMonitorSettings?.interfaceLanguage) {
  return interfaceCopy[normalizeInterfaceLanguage(language)];
}

function getManagedWindowLabel(key, language = alertMonitorSettings?.interfaceLanguage) {
  return getInterfaceCopy(language).moduleTitles[key] ?? key;
}

function getManagedWindowTitle(key, language = alertMonitorSettings?.interfaceLanguage) {
  return `${appName} - ${getManagedWindowLabel(key, language)}`;
}

function updateWindowTitles() {
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) {
    controlCenterWindow.setTitle(getInterfaceCopy().controlCenterWindowTitle);
  }

  if (signalOverlayWindow && !signalOverlayWindow.isDestroyed()) {
    signalOverlayWindow.setTitle(getInterfaceCopy().signalOverlayWindowTitle);
  }

  for (const [key, instance] of managedWindows.entries()) {
    if (instance && !instance.isDestroyed()) {
      instance.setTitle(getManagedWindowTitle(key));
    }
  }
}

function refreshApplicationChrome() {
  buildWindowMenu();
  updateWindowTitles();

  if (appTray) {
    appTray.setContextMenu(buildTrayMenu());
  }
}

function loadDesktopEnv() {
  const values = {};
  const candidatePaths = Array.from(
    new Set(
      [
        process.env.SCALPSTATION_ENV_FILE,
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "..", ".env"),
        path.resolve(path.dirname(process.execPath), ".env"),
        process.resourcesPath ? path.resolve(process.resourcesPath, ".env") : null
      ].filter(Boolean)
    )
  );

  for (const envPath of candidatePaths) {
    try {
      if (!fs.existsSync(envPath)) {
        continue;
      }

      const source = fs.readFileSync(envPath, "utf8");

      for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

        if (key && !Object.prototype.hasOwnProperty.call(values, key)) {
          values[key] = value;
        }
      }
    } catch {
      // Ignore malformed env files and continue with process env/defaults.
    }
  }

  return values;
}

function readStringEnv(key, fallback) {
  const value = process.env[key] ?? desktopEnv[key];
  const normalized = typeof value === "string" ? value.trim() : "";

  return normalized || fallback;
}

function readNumberEnv(key, fallback) {
  const parsed = Number(readStringEnv(key, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configureDesktopBackendDataPaths() {
  const backendDataDir = path.join(app.getPath("userData"), "backend-data");

  if (!process.env.SCALPSTATION_DATA_DIR && !desktopEnv.SCALPSTATION_DATA_DIR) {
    process.env.SCALPSTATION_DATA_DIR = backendDataDir;
  }

  if (!process.env.SCALPSTATION_SQLITE_PATH && !desktopEnv.SCALPSTATION_SQLITE_PATH) {
    process.env.SCALPSTATION_SQLITE_PATH = path.join(backendDataDir, "darra-terminal.sqlite");
  }
}

function normalizeWsPath(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "/ws";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeBackendWsUrl(value, fallback = backendWsUrl) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    return fallback;
  }

  let normalized = trimmed;

  if (/^https:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^https:\/\//i, "wss://");
  } else if (/^http:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^http:\/\//i, "ws://");
  } else if (!/^wss?:\/\//i.test(normalized)) {
    normalized = `ws://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/ws";
    }

    return parsed.toString();
  } catch {
    return fallback;
  }
}

function withBackendWsClientMarker(value, clientName) {
  try {
    const parsed = new URL(value);
    parsed.searchParams.set("client", clientName);
    return parsed.toString();
  } catch {
    return value;
  }
}

function resolveBundledAssetPath(fileName) {
  const filePath = path.join(frontendDir, fileName);
  return fs.existsSync(filePath) ? filePath : null;
}

function createDefaultWindowState(key) {
  return {
    open: false,
    alwaysOnTop: false,
    opacity: 1,
    displayId: null,
    bounds: null
  };
}

function loadLayoutState() {
  const defaults = {};

  for (const definition of managedWindowDefinitions) {
    defaults[definition.key] = createDefaultWindowState(definition.key);
  }

  try {
    const source = fs.readFileSync(layoutPath, "utf8");
    const parsed = JSON.parse(source);
    const savedWindows = parsed?.windows ?? {};

    for (const definition of managedWindowDefinitions) {
      if (!savedWindows[definition.key] || typeof savedWindows[definition.key] !== "object") {
        continue;
      }

      defaults[definition.key] = normalizeWindowState(
        definition.key,
        savedWindows[definition.key]
      );
    }
  } catch {
    // Keep defaults on first launch or malformed state.
  }

  return {
    windows: defaults
  };
}

function normalizeWindowState(key, value) {
  const defaultState = createDefaultWindowState(key);
  return {
    open: typeof value.open === "boolean" ? value.open : defaultState.open,
    alwaysOnTop:
      typeof value.alwaysOnTop === "boolean" ? value.alwaysOnTop : defaultState.alwaysOnTop,
    opacity: clampOpacity(value.opacity),
    displayId: Number.isInteger(value.displayId) ? value.displayId : null,
    bounds: normalizeBounds(value.bounds)
  };
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(Math.round(width), 320),
    height: Math.max(Math.round(height), 240)
  };
}

function clampOpacity(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(Math.max(numericValue, 0.35), 1);
}

function clampNumberInRange(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, min), max);
}

function createDefaultAlertMonitorSettings() {
  return {
    backendWsUrl,
    interfaceLanguage: defaultInterfaceLanguage,
    soundEnabled: true,
    signalSoundEnabled: true,
    signalAnimationEnabled: true,
    signalBillboard: {
      topBandSize: 16,
      bottomBandSize: 0,
      frameHeightPercent: 7,
      topBandOpacity: 88,
      bottomBandOpacity: 0
    },
    notifications: {
      tradeSignals: true,
      liquidationSignals: true,
      systemStatus: true,
      pulseChanges: true
    }
  };
}

function normalizeSignalBillboardSettings(value) {
  const defaults = createDefaultAlertMonitorSettings().signalBillboard;

  return {
    topBandSize: clampNumberInRange(
      value?.topBandSize,
      10,
      28,
      defaults.topBandSize
    ),
    bottomBandSize: clampNumberInRange(
      value?.bottomBandSize,
      0,
      20,
      defaults.bottomBandSize
    ),
    frameHeightPercent: clampNumberInRange(
      value?.frameHeightPercent,
      5,
      12,
      defaults.frameHeightPercent
    ),
    topBandOpacity: clampNumberInRange(
      value?.topBandOpacity,
      0,
      100,
      defaults.topBandOpacity
    ),
    bottomBandOpacity: clampNumberInRange(
      value?.bottomBandOpacity,
      0,
      100,
      defaults.bottomBandOpacity
    )
  };
}

function normalizeAlertMonitorSettings(value) {
  const defaults = createDefaultAlertMonitorSettings();
  const notifications = value?.notifications ?? {};

  return {
    backendWsUrl: normalizeBackendWsUrl(value?.backendWsUrl, defaults.backendWsUrl),
    interfaceLanguage: normalizeInterfaceLanguage(value?.interfaceLanguage),
    soundEnabled:
      typeof value?.soundEnabled === "boolean" ? value.soundEnabled : defaults.soundEnabled,
    signalSoundEnabled:
      typeof value?.signalSoundEnabled === "boolean"
        ? value.signalSoundEnabled
        : defaults.signalSoundEnabled,
    signalAnimationEnabled:
      typeof value?.signalAnimationEnabled === "boolean"
        ? value.signalAnimationEnabled
        : defaults.signalAnimationEnabled,
    signalBillboard: normalizeSignalBillboardSettings(value?.signalBillboard),
    notifications: {
      tradeSignals:
        typeof notifications.tradeSignals === "boolean"
          ? notifications.tradeSignals
          : defaults.notifications.tradeSignals,
      liquidationSignals:
        typeof notifications.liquidationSignals === "boolean"
          ? notifications.liquidationSignals
          : defaults.notifications.liquidationSignals,
      systemStatus:
        typeof notifications.systemStatus === "boolean"
          ? notifications.systemStatus
          : defaults.notifications.systemStatus,
      pulseChanges:
        typeof notifications.pulseChanges === "boolean"
          ? notifications.pulseChanges
          : defaults.notifications.pulseChanges
    }
  };
}

function loadAlertMonitorSettings() {
  try {
    const source = fs.readFileSync(alertMonitorStatePath, "utf8");
    return normalizeAlertMonitorSettings(JSON.parse(source));
  } catch {
    return createDefaultAlertMonitorSettings();
  }
}

function saveAlertMonitorSettings() {
  fs.mkdirSync(path.dirname(alertMonitorStatePath), { recursive: true });
  fs.writeFileSync(alertMonitorStatePath, JSON.stringify(alertMonitorSettings, null, 2));
}

function updateAlertMonitorSettings(patch) {
  const nextPatch = patch && typeof patch === "object" ? patch : {};
  const previousBackendWsUrl = alertMonitorSettings.backendWsUrl;
  const previousInterfaceLanguage = alertMonitorSettings.interfaceLanguage;

  alertMonitorSettings = normalizeAlertMonitorSettings({
    ...alertMonitorSettings,
    ...nextPatch,
    signalBillboard: {
      ...alertMonitorSettings.signalBillboard,
      ...(nextPatch.signalBillboard ?? {})
    },
    notifications: {
      ...alertMonitorSettings.notifications,
      ...(nextPatch.notifications ?? {})
    }
  });

  saveAlertMonitorSettings();

  if (alertMonitorSettings.backendWsUrl !== previousBackendWsUrl) {
    restartAlertMonitorConnection();
  }

  if (alertMonitorSettings.interfaceLanguage !== previousInterfaceLanguage) {
    refreshApplicationChrome();
    broadcastState();
  }
}

function saveLayoutState() {
  fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
  fs.writeFileSync(layoutPath, JSON.stringify(layoutState, null, 2));
}

function getManagedWindowState(key) {
  if (!layoutState.windows[key]) {
    layoutState.windows[key] = createDefaultWindowState(key);
  }

  return layoutState.windows[key];
}

function getDefaultBounds(key, display) {
  const workArea = display.workArea;
  const isDashboard = key === "dashboard";
  const width = Math.min(isDashboard ? 1600 : 980, workArea.width);
  const height = Math.min(isDashboard ? 960 : 760, workArea.height);
  const offsetIndex = Math.max(
    managedWindowDefinitions.findIndex((definition) => definition.key === key),
    0
  );

  return {
    x: workArea.x + Math.max(Math.floor((workArea.width - width) / 2) + offsetIndex * 24, 0),
    y: workArea.y + Math.max(Math.floor((workArea.height - height) / 2) + offsetIndex * 24, 0),
    width,
    height
  };
}

function clampBoundsToDisplay(bounds, display) {
  const workArea = display.workArea;
  const width = Math.min(Math.max(bounds.width, 320), workArea.width);
  const height = Math.min(Math.max(bounds.height, 240), workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
    width,
    height
  };
}

function resolveDisplay(displayId) {
  const displays = screen.getAllDisplays();

  if (displayId !== null) {
    const matchedDisplay = displays.find((display) => display.id === displayId);
    if (matchedDisplay) {
      return matchedDisplay;
    }
  }

  return screen.getPrimaryDisplay();
}

function resolveWindowBounds(key) {
  const windowState = getManagedWindowState(key);

  if (windowState.bounds) {
    const targetDisplay = windowState.displayId
      ? resolveDisplay(windowState.displayId)
      : screen.getDisplayMatching(windowState.bounds);

    return clampBoundsToDisplay(windowState.bounds, targetDisplay);
  }

  return getDefaultBounds(key, resolveDisplay(windowState.displayId));
}

function syncWindowStateFromInstance(key, instance) {
  const bounds = instance.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const windowState = getManagedWindowState(key);

  windowState.bounds = normalizeBounds(bounds);
  windowState.displayId = display?.id ?? null;
  windowState.opacity = clampOpacity(instance.getOpacity());
  windowState.alwaysOnTop = instance.isAlwaysOnTop();
  windowState.open = true;

  saveLayoutState();
}

function getStateSnapshot() {
  const copy = getInterfaceCopy();

  return {
    frontendBaseUrl,
    backendWsUrl,
    interfaceLanguage: normalizeInterfaceLanguage(alertMonitorSettings.interfaceLanguage),
    displays: screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.primary ? copy.primaryDisplay : `${copy.display} ${index + 1}`,
      primary: display.primary,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      workArea: display.workArea
    })),
    windows: managedWindowDefinitions.map((definition) => {
      const windowState = getManagedWindowState(definition.key);
      const instance = managedWindows.get(definition.key);
      const liveBounds = instance?.isDestroyed() ? null : instance?.getBounds() ?? null;
      const currentBounds = normalizeBounds(liveBounds) ?? windowState.bounds;
      const currentDisplay = currentBounds ? screen.getDisplayMatching(currentBounds) : null;

      return {
        key: definition.key,
        title: getManagedWindowLabel(definition.key),
        route: definition.route,
        open: !!instance && !instance.isDestroyed(),
        alwaysOnTop: instance?.isDestroyed()
          ? windowState.alwaysOnTop
          : instance?.isAlwaysOnTop() ?? windowState.alwaysOnTop,
        opacity: instance?.isDestroyed()
          ? windowState.opacity
          : clampOpacity(instance?.getOpacity() ?? windowState.opacity),
        displayId: currentDisplay?.id ?? windowState.displayId,
        bounds: currentBounds
      };
    })
  };
}

function broadcastState() {
  const snapshot = getStateSnapshot();

  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send("desktop-shell:state-changed", snapshot);
    }
  });

  return snapshot;
}

function buildWindowMenu() {
  Menu.setApplicationMenu(null);
}

function buildTrayMenu() {
  const copy = getInterfaceCopy();

  return Menu.buildFromTemplate([
    {
      label: copy.openControlCenter,
      click: () => {
        void showControlCenter();
      }
    },
    {
      label: copy.openDashboard,
      click: () => {
        void openManagedWindow("dashboard");
      }
    },
    { type: "separator" },
    {
      label: copy.quit,
      click: () => {
        app.quit();
      }
    }
  ]);
}

function createTray() {
  if (appTray) {
    return appTray;
  }

  const trayIcon = desktopIconPath
    ? nativeImage.createFromPath(desktopIconPath)
    : nativeImage.createEmpty();

  appTray = new Tray(trayIcon);
  appTray.setToolTip(appName);
  appTray.setContextMenu(buildTrayMenu());
  appTray.on("click", () => {
    void showControlCenter();
  });

  return appTray;
}

function createManagedWindow(key) {
  const definition = windowDefinitionsByKey.get(key);
  if (!definition) {
    throw new Error(`Unknown managed window: ${key}`);
  }

  const instance = managedWindows.get(key);
  if (instance && !instance.isDestroyed()) {
    return instance;
  }

  const windowState = getManagedWindowState(key);
  const browserWindow = new BrowserWindow({
    ...resolveWindowBounds(key),
    minWidth: key === "dashboard" ? 1100 : 480,
    minHeight: key === "dashboard" ? 700 : 360,
    show: false,
    backgroundColor: "#09111a",
    autoHideMenuBar: true,
    title: getManagedWindowTitle(definition.key),
    ...(desktopIconPath ? { icon: desktopIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  browserWindow.setMenuBarVisibility(false);
  browserWindow.setAlwaysOnTop(windowState.alwaysOnTop);
  browserWindow.setOpacity(windowState.opacity);
  managedWindows.set(key, browserWindow);

  browserWindow.on("ready-to-show", () => {
    browserWindow.show();
    syncWindowStateFromInstance(key, browserWindow);
    broadcastState();
  });

  browserWindow.on("moved", () => {
    syncWindowStateFromInstance(key, browserWindow);
    broadcastState();
  });

  browserWindow.on("resized", () => {
    syncWindowStateFromInstance(key, browserWindow);
    broadcastState();
  });

  browserWindow.on("always-on-top-changed", () => {
    syncWindowStateFromInstance(key, browserWindow);
    broadcastState();
  });

  browserWindow.on("close", () => {
    const state = getManagedWindowState(key);
    state.open = false;
    state.bounds = normalizeBounds(browserWindow.getBounds());
    state.displayId = screen.getDisplayMatching(browserWindow.getBounds())?.id ?? state.displayId;
    state.opacity = clampOpacity(browserWindow.getOpacity());
    state.alwaysOnTop = browserWindow.isAlwaysOnTop();
    saveLayoutState();
  });

  browserWindow.on("closed", () => {
    managedWindows.delete(key);
    broadcastState();
  });

  browserWindow.loadURL(`${frontendBaseUrl}${definition.route}`);

  return browserWindow;
}

async function openManagedWindow(key) {
  const windowState = getManagedWindowState(key);
  windowState.open = true;
  saveLayoutState();

  const browserWindow = createManagedWindow(key);
  if (browserWindow.isMinimized()) {
    browserWindow.restore();
  }
  browserWindow.show();
  browserWindow.focus();

  return broadcastState();
}

async function focusManagedWindow(key) {
  const instance = managedWindows.get(key);

  if (instance && !instance.isDestroyed()) {
    if (instance.isMinimized()) {
      instance.restore();
    }
    instance.show();
    instance.focus();
    return broadcastState();
  }

  return openManagedWindow(key);
}

async function closeManagedWindow(key) {
  const instance = managedWindows.get(key);
  const windowState = getManagedWindowState(key);
  windowState.open = false;
  saveLayoutState();

  if (instance && !instance.isDestroyed()) {
    instance.close();
  }

  return broadcastState();
}

function moveWindowToDisplay(instance, key, displayId) {
  const display = resolveDisplay(displayId);
  const existingBounds = normalizeBounds(instance.getBounds()) ?? resolveWindowBounds(key);
  const centeredBounds = clampBoundsToDisplay(
    {
      ...existingBounds,
      x: display.workArea.x + Math.round((display.workArea.width - existingBounds.width) / 2),
      y: display.workArea.y + Math.round((display.workArea.height - existingBounds.height) / 2)
    },
    display
  );

  instance.setBounds(centeredBounds);
}

async function updateManagedWindow(key, patch) {
  const windowState = getManagedWindowState(key);
  const nextDisplayId =
    Object.prototype.hasOwnProperty.call(patch, "displayId") && patch.displayId !== undefined
      ? patch.displayId
      : windowState.displayId;

  if (Object.prototype.hasOwnProperty.call(patch, "alwaysOnTop")) {
    windowState.alwaysOnTop = !!patch.alwaysOnTop;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "opacity")) {
    windowState.opacity = clampOpacity(patch.opacity);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "displayId")) {
    windowState.displayId = nextDisplayId === null ? null : Number(nextDisplayId);
  }

  const instance = managedWindows.get(key);
  if (instance && !instance.isDestroyed()) {
    instance.setAlwaysOnTop(windowState.alwaysOnTop);
    instance.setOpacity(windowState.opacity);

    if (Object.prototype.hasOwnProperty.call(patch, "displayId")) {
      moveWindowToDisplay(instance, key, windowState.displayId);
    }

    syncWindowStateFromInstance(key, instance);
  } else {
    saveLayoutState();
  }

  return broadcastState();
}

async function resetLayout() {
  layoutState = loadLayoutState();

  for (const definition of managedWindowDefinitions) {
    layoutState.windows[definition.key] = createDefaultWindowState(definition.key);
  }

  saveLayoutState();

  for (const [key, instance] of managedWindows.entries()) {
    if (instance && !instance.isDestroyed()) {
      instance.close();
    }
    managedWindows.delete(key);
  }

  return broadcastState();
}

function createControlCenterWindow() {
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) {
    return controlCenterWindow;
  }

  controlCenterWindow = new BrowserWindow({
    width: 1280,
    height: 920,
    minWidth: 960,
    minHeight: 720,
    show: false,
    backgroundColor: "#1f2331",
    title: getInterfaceCopy().controlCenterWindowTitle,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#36394c",
      symbolColor: "#f8fafc",
      height: 40
    },
    ...(desktopIconPath ? { icon: desktopIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  controlCenterWindow.on("ready-to-show", () => {
    controlCenterWindow.show();
    broadcastState();
  });

  controlCenterWindow.setMenuBarVisibility(false);

  controlCenterWindow.on("closed", () => {
    controlCenterWindow = null;
  });

  controlCenterWindow.loadURL(`${frontendBaseUrl}/desktop`);

  return controlCenterWindow;
}

async function showControlCenter() {
  const windowInstance = createControlCenterWindow();

  if (windowInstance.isMinimized()) {
    windowInstance.restore();
  }

  windowInstance.show();
  windowInstance.focus();
}

function getSignalOverlayState() {
  return signalOverlayState;
}

function clearSignalOverlayHideTimer() {
  if (signalOverlayHideTimer !== null) {
    clearTimeout(signalOverlayHideTimer);
    signalOverlayHideTimer = null;
  }
}

function getSignalOverlayBounds(display, preferences) {
  const workArea = display?.workArea ?? display?.bounds ?? screen.getPrimaryDisplay().workArea;
  const normalizedPreferences = normalizeSignalBillboardSettings(preferences);
  const referenceHeight = Math.min(workArea.height, 1080);
  const height = Math.min(
    Math.max(
      Math.round((referenceHeight * normalizedPreferences.frameHeightPercent) / 100),
      56
    ),
    108
  );

  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height
  };
}

function resolveSignalOverlayDisplay(preferredDisplayId, sourceWindow) {
  if (Number.isInteger(preferredDisplayId)) {
    return resolveDisplay(preferredDisplayId);
  }

  const candidateWindow =
    sourceWindow && !sourceWindow.isDestroyed()
      ? sourceWindow
      : BrowserWindow.getFocusedWindow();

  if (candidateWindow && !candidateWindow.isDestroyed()) {
    return screen.getDisplayMatching(candidateWindow.getBounds());
  }

  const dashboardWindow = managedWindows.get("dashboard");
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    return screen.getDisplayMatching(dashboardWindow.getBounds());
  }

  return screen.getPrimaryDisplay();
}

function broadcastSignalOverlayState() {
  if (signalOverlayWindow && !signalOverlayWindow.isDestroyed()) {
    signalOverlayWindow.webContents.send(
      "desktop-shell:signal-overlay-state-changed",
      signalOverlayState
    );
  }
}

function createSignalOverlayWindow() {
  if (signalOverlayWindow && !signalOverlayWindow.isDestroyed()) {
    return signalOverlayWindow;
  }

  signalOverlayWindow = new BrowserWindow({
    ...getSignalOverlayBounds(screen.getPrimaryDisplay(), alertMonitorSettings.signalBillboard),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: "#00000000",
    title: getInterfaceCopy().signalOverlayWindowTitle,
    ...(desktopIconPath ? { icon: desktopIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  signalOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  signalOverlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  signalOverlayWindow.setIgnoreMouseEvents(true, {
    forward: true
  });

  signalOverlayWindow.on("ready-to-show", () => {
    if (signalOverlayState) {
      signalOverlayWindow.showInactive();
    }
  });

  signalOverlayWindow.webContents.on("did-finish-load", () => {
    broadcastSignalOverlayState();
  });

  signalOverlayWindow.on("closed", () => {
    signalOverlayWindow = null;
  });

  signalOverlayWindow.loadURL(`${frontendBaseUrl}/desktop/signal`);

  return signalOverlayWindow;
}

function hideSignalOverlay() {
  clearSignalOverlayHideTimer();
  signalOverlayState = null;
  broadcastSignalOverlayState();

  if (signalOverlayWindow && !signalOverlayWindow.isDestroyed()) {
    signalOverlayWindow.hide();
  }
}

function showSignalOverlay(sourceWindow, payload) {
  const eventId = typeof payload?.eventId === "string" ? payload.eventId.trim() : "";
  const symbol = typeof payload?.symbol === "string" ? payload.symbol.trim() : "";
  const bias = payload?.bias;
  const severity = payload?.severity;
  const preferences = payload?.preferences;

  if (
    !eventId ||
    !symbol ||
    (bias !== "LONG" && bias !== "SHORT") ||
    (severity !== "info" && severity !== "high" && severity !== "critical") ||
    !preferences ||
    typeof preferences !== "object"
  ) {
    return;
  }

  const now = Date.now();
  if (
    eventId === lastSignalOverlayEventId &&
    now - lastSignalOverlayShownAt <= signalOverlayDedupWindowMs
  ) {
    return;
  }

  const display = resolveSignalOverlayDisplay(payload?.displayId ?? null, sourceWindow);
  const overlayWindow = createSignalOverlayWindow();

  signalOverlayState = {
    id: `${eventId}-${now}`,
    eventId,
    symbol,
    bias,
    severity,
    preferences: {
      topBandSize: Number(preferences.topBandSize),
      bottomBandSize: Number(preferences.bottomBandSize),
      frameHeightPercent: Number(preferences.frameHeightPercent),
      topBandOpacity: Number(preferences.topBandOpacity),
      bottomBandOpacity: Number(preferences.bottomBandOpacity)
    }
  };

  lastSignalOverlayEventId = eventId;
  lastSignalOverlayShownAt = now;

  overlayWindow.setBounds(getSignalOverlayBounds(display, signalOverlayState.preferences));
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  broadcastSignalOverlayState();

  if (!overlayWindow.webContents.isLoadingMainFrame()) {
    overlayWindow.showInactive();
  }

  clearSignalOverlayHideTimer();
  signalOverlayHideTimer = setTimeout(() => {
    hideSignalOverlay();
  }, signalOverlayLifetimeMs);
}

function resetAlertMonitorHistory() {
  alertMonitorSeenAlertIds = new Set();
  alertMonitorSeenVolumeMilestoneIds = new Set();
  alertMonitorSeenVolumeThresholdMilestoneIds = new Set();
  alertMonitorFrame = null;
  alertMonitorPrimedHistory = false;
  alertMonitorPrimedVolumeMilestonesHistory = false;
  alertMonitorPrimedVolumeThresholdMilestonesHistory = false;
}

function clearAlertMonitorReconnectTimer() {
  if (alertMonitorReconnectTimer !== null) {
    clearTimeout(alertMonitorReconnectTimer);
    alertMonitorReconnectTimer = null;
  }
}

function clearAlertMonitorPingTimer() {
  if (alertMonitorPingTimer !== null) {
    clearInterval(alertMonitorPingTimer);
    alertMonitorPingTimer = null;
  }
}

function hasVisibleUserWindow() {
  const windows = [
    controlCenterWindow,
    ...Array.from(managedWindows.values())
  ].filter((windowInstance) => windowInstance && !windowInstance.isDestroyed());

  return windows.some(
    (windowInstance) => windowInstance.isVisible() && !windowInstance.isMinimized()
  );
}

function isLiquidationAlert(alert) {
  return typeof alert?.reason === "string" && alert.reason.toLowerCase().includes("liquidation");
}

function isEligibleBackgroundAlert(alert) {
  if (!alert || typeof alert !== "object") {
    return false;
  }

  if (isLiquidationAlert(alert)) {
    return alertMonitorSettings.notifications.liquidationSignals;
  }

  return alertMonitorSettings.notifications.tradeSignals;
}

function formatPairLabel(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/(USDT|USDC|BUSD|FDUSD)$/i, " $1")
    .trim();
}

function buildBackgroundAlertTitle(alert) {
  const copy = getInterfaceCopy();
  const severityLabel =
    alert.severity === "critical"
      ? copy.critical
      : alert.severity === "high"
        ? copy.highPriority
        : copy.info;
  const signalKind = isLiquidationAlert(alert) ? copy.liquidation : copy.signal;

  return `${formatPairLabel(alert.symbol)} | ${severityLabel} ${signalKind}`;
}

function buildBackgroundAlertBody(alert) {
  const copy = getInterfaceCopy();
  const direction =
    alert.bias === "LONG" ? copy.longBias : alert.bias === "SHORT" ? copy.shortBias : null;
  const reason = typeof alert.reason === "string" ? alert.reason.trim() : "";
  const body = [direction, reason].filter(Boolean).join(" | ");

  return body || copy.newMarketAlert;
}

function showBackgroundAlertNotification(alert) {
  if (typeof Notification.isSupported === "function" && !Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: buildBackgroundAlertTitle(alert),
    body: buildBackgroundAlertBody(alert),
    silent: !(alertMonitorSettings.soundEnabled && alertMonitorSettings.signalSoundEnabled),
    ...(desktopIconPath ? { icon: desktopIconPath } : {})
  });

  notification.on("click", () => {
    void focusManagedWindow("alerts");
  });

  notification.show();
}

function surfaceBackgroundAlert(alert) {
  if (!isEligibleBackgroundAlert(alert) || hasVisibleUserWindow()) {
    return;
  }

  if (
    alertMonitorSettings.signalAnimationEnabled &&
    (alert.bias === "LONG" || alert.bias === "SHORT")
  ) {
    showSignalOverlay(null, {
      eventId: alert.id,
      symbol: formatPairLabel(alert.symbol),
      bias: alert.bias,
      severity: alert.severity,
      preferences: alertMonitorSettings.signalBillboard
    });
  }

  showBackgroundAlertNotification(alert);
}

function normalizeSocketMessage(data) {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return "";
}

function collectFreshBackgroundAlerts(frame) {
  if (!Array.isArray(frame?.alerts)) {
    return [];
  }

  let freshAlerts;

  if (!alertMonitorPrimedHistory) {
    const now = Date.now();
    freshAlerts = frame.alerts
      .filter(
        (alert) =>
          Number.isFinite(alert?.createdAt) &&
          alert.createdAt <= now + 5_000 &&
          now - alert.createdAt <= initialAlertReplayWindowMs
      )
      .slice(0, initialAlertReplayLimit);
    alertMonitorSeenAlertIds = new Set(frame.alerts.map((alert) => alert.id));
    alertMonitorPrimedHistory = true;
  } else {
    freshAlerts = frame.alerts.filter((alert) => !alertMonitorSeenAlertIds.has(alert.id));
  }

  for (const alert of frame.alerts) {
    alertMonitorSeenAlertIds.add(alert.id);
  }

  if (alertMonitorSeenAlertIds.size > 400) {
    alertMonitorSeenAlertIds = new Set(frame.alerts.map((alert) => alert.id));
  }

  return [...freshAlerts].reverse();
}

function collectFreshVolumeMilestones(frame) {
  if (!Array.isArray(frame?.volumeMilestones)) {
    return [];
  }

  let freshItems;

  if (!alertMonitorPrimedVolumeMilestonesHistory) {
    freshItems = [];
    alertMonitorSeenVolumeMilestoneIds = new Set(
      frame.volumeMilestones.map((item) => item?.id).filter(Boolean)
    );
    alertMonitorPrimedVolumeMilestonesHistory = true;
  } else {
    freshItems = frame.volumeMilestones.filter(
      (item) => item?.id && !alertMonitorSeenVolumeMilestoneIds.has(item.id)
    );
  }

  for (const item of frame.volumeMilestones) {
    if (item?.id) {
      alertMonitorSeenVolumeMilestoneIds.add(item.id);
    }
  }

  if (alertMonitorSeenVolumeMilestoneIds.size > 400) {
    alertMonitorSeenVolumeMilestoneIds = new Set(
      frame.volumeMilestones.map((item) => item?.id).filter(Boolean)
    );
  }

  return [...freshItems].reverse();
}

function collectFreshVolumeThresholdMilestones(frame) {
  if (!Array.isArray(frame?.volumeThresholdMilestones)) {
    return [];
  }

  let freshItems;

  if (!alertMonitorPrimedVolumeThresholdMilestonesHistory) {
    freshItems = [];
    alertMonitorSeenVolumeThresholdMilestoneIds = new Set(
      frame.volumeThresholdMilestones.map((item) => item?.id).filter(Boolean)
    );
    alertMonitorPrimedVolumeThresholdMilestonesHistory = true;
  } else {
    freshItems = frame.volumeThresholdMilestones.filter(
      (item) => item?.id && !alertMonitorSeenVolumeThresholdMilestoneIds.has(item.id)
    );
  }

  for (const item of frame.volumeThresholdMilestones) {
    if (item?.id) {
      alertMonitorSeenVolumeThresholdMilestoneIds.add(item.id);
    }
  }

  if (alertMonitorSeenVolumeThresholdMilestoneIds.size > 1200) {
    alertMonitorSeenVolumeThresholdMilestoneIds = new Set(
      frame.volumeThresholdMilestones.map((item) => item?.id).filter(Boolean)
    );
  }

  return [...freshItems].reverse();
}

function surfaceVolumeMilestoneWindow() {
  return;
}

function surfaceVolumeThresholdMilestoneWindow() {
  return;
}

function handleAlertMonitorMessage(rawData) {
  try {
    const message = JSON.parse(normalizeSocketMessage(rawData));
    let frame = null;

    if (message.type === "snapshot") {
      alertMonitorFrame = message.frame;
      frame = alertMonitorFrame;
    } else if (message.type === "frame_patch") {
      alertMonitorFrame = alertMonitorFrame
        ? { ...alertMonitorFrame, ...message.changed }
        : message.changed;
      frame = alertMonitorFrame;
    } else if (message.type === "frame") {
      alertMonitorFrame = message;
      frame = message;
    }

    if (!frame) {
      return;
    }

    const alerts = collectFreshBackgroundAlerts(frame);
    const volumeMilestones = collectFreshVolumeMilestones(frame);
    const volumeThresholdMilestones = collectFreshVolumeThresholdMilestones(frame);

    surfaceVolumeMilestoneWindow(volumeMilestones);
    surfaceVolumeThresholdMilestoneWindow(volumeThresholdMilestones);

    for (const alert of alerts) {
      surfaceBackgroundAlert(alert);
    }
  } catch {
    // Ignore malformed socket payloads and keep the monitor alive.
  }
}

function disconnectAlertMonitorSocket() {
  clearAlertMonitorPingTimer();

  if (!alertMonitorSocket) {
    return;
  }

  const socket = alertMonitorSocket;
  alertMonitorSocket = null;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  try {
    socket.close();
  } catch {
    // Ignore close failures while swapping connections.
  }
}

function scheduleAlertMonitorReconnect() {
  if (runtimeStopping || alertMonitorReconnectTimer !== null) {
    return;
  }

  alertMonitorReconnectTimer = setTimeout(() => {
    alertMonitorReconnectTimer = null;
    connectAlertMonitor();
  }, alertMonitorReconnectDelayMs);
}

function connectAlertMonitor() {
  if (runtimeStopping) {
    return;
  }

  const targetWsUrl = withBackendWsClientMarker(
    normalizeBackendWsUrl(alertMonitorSettings.backendWsUrl, backendWsUrl),
    "desktop-alert-monitor"
  );

  if (
    alertMonitorSocket &&
    (alertMonitorSocket.readyState === WebSocket.OPEN ||
      alertMonitorSocket.readyState === WebSocket.CONNECTING) &&
    alertMonitorSocket.url === targetWsUrl
  ) {
    return;
  }

  disconnectAlertMonitorSocket();

  let socket;

  try {
    socket = new WebSocket(targetWsUrl);
  } catch (error) {
    console.error("Desktop alert monitor failed to connect", error);
    scheduleAlertMonitorReconnect();
    return;
  }

  alertMonitorSocket = socket;

  socket.onopen = () => {
    if (alertMonitorSocket !== socket) {
      return;
    }

    socket.send(JSON.stringify({ type: "hello" }));
    socket.send(
      JSON.stringify({
        type: "visible_sections",
        sections: ["alerts", "volumeMilestones", "volumeThresholdMilestones"]
      })
    );
    socket.send(JSON.stringify({ type: "request_snapshot" }));
    clearAlertMonitorPingTimer();
    alertMonitorPingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "ping",
            payload: {
              sentAt: Date.now()
            }
          })
        );
      }
    }, 15_000);
  };

  socket.onmessage = (event) => {
    if (alertMonitorSocket !== socket) {
      return;
    }

    handleAlertMonitorMessage(event.data);
  };

  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      // Ignore close failures after socket errors.
    }
  };

  socket.onclose = () => {
    if (alertMonitorSocket === socket) {
      alertMonitorSocket = null;
    }

    clearAlertMonitorPingTimer();

    if (!runtimeStopping) {
      scheduleAlertMonitorReconnect();
    }
  };
}

function restartAlertMonitorConnection() {
  resetAlertMonitorHistory();
  clearAlertMonitorReconnectTimer();
  disconnectAlertMonitorSocket();
  connectAlertMonitor();
}

function stopAlertMonitor() {
  clearAlertMonitorReconnectTimer();
  resetAlertMonitorHistory();
  disconnectAlertMonitorSocket();
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveStaticPath(urlPathname) {
  const normalizedPathname = decodeURIComponent(urlPathname);
  const sanitizedSegments = normalizedPathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "." && segment !== "..");
  const targetPath = path.join(frontendDir, ...sanitizedSegments);

  if (!path.resolve(targetPath).startsWith(path.resolve(frontendDir))) {
    return null;
  }

  if (normalizedPathname === "/") {
    return path.join(frontendDir, "index.html");
  }

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    return targetPath;
  }

  return path.join(targetPath, "index.html");
}

function startFrontendServer() {
  return new Promise((resolve, reject) => {
    frontendServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const filePath = resolveStaticPath(requestUrl.pathname);

      if (!filePath || !fs.existsSync(filePath)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      try {
        response.writeHead(200, {
          "content-type": getContentType(filePath),
          "cache-control": requestUrl.pathname.startsWith("/_next/")
            ? "public, max-age=31536000, immutable"
            : "no-cache"
        });
        fs.createReadStream(filePath).pipe(response);
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : "Static server error");
      }
    });

    frontendServer.once("error", (error) => reject(error));
    frontendServer.listen(0, "127.0.0.1", () => {
      const address = frontendServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve frontend server port."));
        return;
      }

      frontendBaseUrl = `http://127.0.0.1:${address.port}`;
      resolve(frontendBaseUrl);
    });
  });
}

async function startBackendRuntime() {
  const bundledBackend = require(backendBundlePath);

  if (
    !bundledBackend ||
    typeof bundledBackend.startScalpStationBackend !== "function" ||
    typeof bundledBackend.stopScalpStationBackend !== "function"
  ) {
    throw new Error("Bundled backend exports are missing.");
  }

  backendLifecycle = bundledBackend;
  bundledBackend.startScalpStationBackend().catch((error) => {
    console.error(`${appName} backend failed to start`, error);
  });
}

function registerIpcHandlers() {
  ipcMain.handle("desktop-shell:get-state", () => getStateSnapshot());
  ipcMain.handle("desktop-shell:open-window", (_event, key) => openManagedWindow(key));
  ipcMain.handle("desktop-shell:close-window", (_event, key) => closeManagedWindow(key));
  ipcMain.handle("desktop-shell:focus-window", (_event, key) => focusManagedWindow(key));
  ipcMain.handle("desktop-shell:update-window", (_event, key, patch) =>
    updateManagedWindow(key, patch ?? {})
  );
  ipcMain.handle("desktop-shell:update-alert-monitor-settings", (_event, patch) => {
    updateAlertMonitorSettings(patch ?? {});
  });
  ipcMain.handle("desktop-shell:reset-layout", () => resetLayout());
  ipcMain.handle("desktop-shell:show-control-center", async () => {
    await showControlCenter();
  });
  ipcMain.handle("desktop-shell:show-signal-overlay", (event, payload) => {
    showSignalOverlay(BrowserWindow.fromWebContents(event.sender), payload ?? {});
  });
  ipcMain.handle("desktop-shell:hide-signal-overlay", () => {
    hideSignalOverlay();
  });
  ipcMain.handle("desktop-shell:get-signal-overlay-state", () => getSignalOverlayState());
}

async function stopRuntime() {
  runtimeStopping = true;
  saveAlertMonitorSettings();
  stopAlertMonitor();
  clearSignalOverlayHideTimer();

  if (signalOverlayWindow && !signalOverlayWindow.isDestroyed()) {
    signalOverlayWindow.destroy();
    signalOverlayWindow = null;
  }

  if (appTray) {
    appTray.destroy();
    appTray = null;
  }

  if (frontendServer) {
    await new Promise((resolve) => frontendServer.close(resolve));
    frontendServer = null;
  }

  if (backendLifecycle?.stopScalpStationBackend) {
    try {
      await backendLifecycle.stopScalpStationBackend();
    } catch (error) {
      console.error(`${appName} backend stop failed`, error);
    }
  }
}

app.whenReady().then(async () => {
  createTray();
  refreshApplicationChrome();
  registerIpcHandlers();
  await startFrontendServer();
  await startBackendRuntime();
  connectAlertMonitor();
  void openManagedWindow("dashboard");
  broadcastState();
});

app.on("window-all-closed", () => {
  // Keep the desktop runtime alive in the tray so background alerts still work.
});

app.on("before-quit", () => {
  runtimeStopping = true;
  saveLayoutState();
  saveAlertMonitorSettings();
});

app.on("will-quit", (event) => {
  event.preventDefault();
  stopRuntime()
    .catch((error) => {
      console.error("Desktop runtime shutdown failed", error);
    })
    .finally(() => {
      app.exit(0);
    });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void openManagedWindow("dashboard");
  } else {
    void focusManagedWindow("dashboard");
  }
});
