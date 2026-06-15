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
const backendBetterSqliteBindingPath = path.join(
  bundleDir,
  "backend",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
const preloadPath = path.join(rootDir, "preload.cjs");
const restoreStressWindowCountEnv = process.env.SCALPSTATION_RESTORE_STRESS_WINDOW_COUNT;
const restoreStressHarnessEnabled =
  !app.isPackaged && restoreStressWindowCountEnv !== undefined;
const restoreStressRunId = restoreStressHarnessEnabled
  ? `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  : null;

if (restoreStressHarnessEnabled) {
  const restoreStressUserDataDir = path.resolve(
    process.env.SCALPSTATION_RESTORE_STRESS_USER_DATA_DIR ||
      path.join(rootDir, "..", "tmp", "restore-stress", restoreStressRunId, "UserData")
  );

  fs.mkdirSync(restoreStressUserDataDir, { recursive: true });
  app.setPath("userData", restoreStressUserDataDir);
  process.env.SCALPSTATION_RESTORE_STRESS_USER_DATA_DIR = restoreStressUserDataDir;
}

const layoutPath = path.join(app.getPath("userData"), "desktop-layout.json");
const savedLayoutsPath = path.join(app.getPath("userData"), "desktop-saved-layouts.json");
const monitorProfilesPath = path.join(app.getPath("userData"), "desktop-monitor-profiles.json");
const windowGroupsPath = path.join(app.getPath("userData"), "desktop-window-groups.json");
const alertMonitorStatePath = path.join(app.getPath("userData"), "desktop-alert-monitor.json");
const desktopBackendLogPath = path.join(app.getPath("userData"), "desktop-backend.log");
const savedLayoutsRegistryVersion = 1;
const monitorProfilesRegistryVersion = 1;
const windowGroupsRegistryVersion = 1;
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
      dashboard: "Advanced Legacy Workspace",
      overview: "Overview",
      filters: "Filters",
      screener: "Signal",
      account: "Execution",
      activeTrades: "Positions",
      riskCenter: "Risk Center",
      correlationHeatmap: "Correlation Heatmap",
      varPanel: "VaR",
      fundingBasis: "Funding/Basis",
      marketFlow: "Market Flow",
      chartPanel: "Context",
      decisionStack: "Decision Pipeline",
      symbolDetailRail: "Why This Matters Now",
      marketStory: "Signal Story",
      signalIntelligence: "Advanced Signal Intelligence",
      metaRegimeGovernor: "Advanced Meta Regime Governor",
      positionRiskOrchestrator: "Position Risk",
      regimeMemory: "Advanced Regime Memory",
      regimePrediction: "Advanced Regime Prediction",
      regimeFeedbackCalibration: "Advanced Regime Feedback Calibration",
      pnlAttribution: "PnL Attribution",
      signalStatistics: "Review Statistics",
      learningCenter: "Experimental Research",
      tradeJournal: "Review",
      knowledgeWorkspace: "Trader Knowledge",
      watchlist: "Watchlist",
      volumeMilestones: "100M Volume",
      volumeThresholdMilestones: "1-100M Volume",
      alerts: "Decision",
      frameTelemetry: "Experimental Frame Telemetry",
      renderTelemetry: "Experimental Render Telemetry",
      health: "Feed Health",
      replay: "Decision Replay"
    },
    controlCenter: "Control Center",
    controlCenterWindowTitle: `${appName} - Desktop Terminal`,
    signalOverlayWindowTitle: `${appName} - Signal Overlay`,
    appMenu: appName,
    windowsMenu: "Windows",
    openControlCenter: "Open Control Center",
    openDashboard: "Open Advanced Legacy Workspace",
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
        chartPanel: "Context",
        decisionStack: "Decision Pipeline",
        symbolDetailRail: "Why This Matters Now",
        marketStory: "Signal Story",
        signalIntelligence: "Advanced Signal Intelligence",
        metaRegimeGovernor: "Advanced Meta Regime Governor",
        positionRiskOrchestrator: "Position Risk",
        regimeMemory: "Advanced Regime Memory",
        regimePrediction: "Advanced Regime Prediction",
        regimeFeedbackCalibration: "Advanced Regime Feedback Calibration",
        pnlAttribution: "PnL Attribution",
        signalStatistics: "Review Statistics",
        learningCenter: "Experimental Research",
        tradeJournal: "Review",
        knowledgeWorkspace: "Trader Knowledge",
        frameTelemetry: "Experimental Frame Telemetry",
        renderTelemetry: "Experimental Render Telemetry",
        replay: "Decision Replay",
      dashboard: "Advanced Legacy Workspace",
      overview: "Обзор",
      filters: "Фильтры",
      screener: "Signal",
      account: "Execution",
      activeTrades: "Positions",
      watchlist: "Лист наблюдения",
      alerts: "Decision",
      health: "Состояние фида"
    },
    controlCenter: "Центр управления",
    controlCenterWindowTitle: `${appName} - Рабочий стол`,
    signalOverlayWindowTitle: `${appName} - Signal Overlay`,
    appMenu: appName,
    windowsMenu: "Окна",
    openControlCenter: "Открыть центр управления",
    openDashboard: "Open Advanced Legacy Workspace",
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
  { key: "chartPanel", route: "/module/chartPanel" },
  { key: "decisionStack", route: "/module/decisionStack" },
  { key: "symbolDetailRail", route: "/module/symbolDetailRail" },
  { key: "marketStory", route: "/module/marketStory" },
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
  { key: "knowledgeWorkspace", route: "/module/knowledgeWorkspace" },
  { key: "watchlist", route: "/module/watchlist" },
  { key: "volumeMilestones", route: "/module/volumeMilestones" },
  { key: "volumeThresholdMilestones", route: "/module/volumeThresholdMilestones" },
  { key: "alerts", route: "/module/alerts" },
  { key: "frameTelemetry", route: "/module/frameTelemetry" },
  { key: "renderTelemetry", route: "/module/renderTelemetry" },
  { key: "health", route: "/module/health" },
  { key: "replay", route: "/module/replay" }
];

const scenarioWorkspaceDefinitions = [
  {
    id: "beta",
    windows: ["screener", "alerts", "chartPanel", "account", "activeTrades", "tradeJournal"]
  },
  {
    id: "scalping",
    windows: [
      "alerts",
      "screener",
      "watchlist",
      "chartPanel",
      "decisionStack",
      "symbolDetailRail",
      "account",
      "activeTrades",
      "riskCenter",
      "positionRiskOrchestrator"
    ]
  },
  {
    id: "swing",
    windows: [
      "screener",
      "watchlist",
      "chartPanel",
      "marketStory",
      "marketFlow",
      "fundingBasis",
      "decisionStack",
      "account",
      "activeTrades",
      "riskCenter"
    ]
  },
  {
    id: "review",
    windows: [
      "tradeJournal",
      "replay",
      "knowledgeWorkspace",
      "signalStatistics",
      "learningCenter",
      "pnlAttribution",
      "signalIntelligence",
      "regimeMemory",
      "regimePrediction",
      "regimeFeedbackCalibration",
      "volumeThresholdMilestones"
    ]
  },
  {
    id: "research",
    windows: [
      "knowledgeWorkspace",
      "signalStatistics",
      "learningCenter",
      "signalIntelligence",
      "marketStory",
      "pnlAttribution",
      "frameTelemetry",
      "renderTelemetry",
      "health"
    ]
  }
];

const windowDefinitionsByKey = new Map(
  managedWindowDefinitions.map((definition) => [definition.key, definition])
);
const managedWindows = new Map();
const supportedWorkspaceOpenModes = new Set(["merge", "open-missing-only"]);
const monitorProfileRoles = ["primary", "chart", "execution", "risk", "review"];
const windowGroupColors = ["blue", "green", "amber", "rose", "violet", "slate"];
const windowGroupContextModes = ["shared", "locked"];
const managedWindowMonitorRoles = {
  chartPanel: "chart",
  symbolDetailRail: "chart",
  marketStory: "chart",
  marketFlow: "chart",
  fundingBasis: "chart",
  watchlist: "chart",
  account: "execution",
  activeTrades: "execution",
  alerts: "execution",
  screener: "execution",
  decisionStack: "execution",
  overview: "execution",
  filters: "execution",
  riskCenter: "risk",
  positionRiskOrchestrator: "risk",
  correlationHeatmap: "risk",
  varPanel: "risk",
  metaRegimeGovernor: "risk",
  regimeMemory: "risk",
  regimePrediction: "risk",
  regimeFeedbackCalibration: "risk",
  volumeMilestones: "risk",
  volumeThresholdMilestones: "risk",
  tradeJournal: "review",
  replay: "review",
  knowledgeWorkspace: "review",
  signalStatistics: "review",
  learningCenter: "review",
  signalIntelligence: "review",
  pnlAttribution: "review",
  frameTelemetry: "review",
  renderTelemetry: "review",
  health: "review"
};

function collectDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return [...duplicates];
}

function getManagedWindowRegistryIssues() {
  const issues = [];
  const managedKeys = managedWindowDefinitions.map((definition) => definition.key);
  const duplicateManagedKeys = collectDuplicateValues(managedKeys);

  for (const key of duplicateManagedKeys) {
    issues.push(`Duplicate managed window definition key: ${key}`);
  }

  const duplicateManagedRoutes = collectDuplicateValues(
    managedWindowDefinitions.map((definition) => definition.route)
  );

  for (const route of duplicateManagedRoutes) {
    issues.push(`Duplicate managed window route: ${route}`);
  }

  for (const definition of scenarioWorkspaceDefinitions) {
    if (!definition || typeof definition.id !== "string") {
      issues.push("Scenario workspace definition is missing a valid id.");
      continue;
    }

    if (!Array.isArray(definition.windows) || definition.windows.length === 0) {
      issues.push(`Scenario workspace "${definition.id}" is missing managed windows.`);
      continue;
    }

    const duplicateWorkspaceKeys = collectDuplicateValues(definition.windows);
    for (const key of duplicateWorkspaceKeys) {
      issues.push(`Scenario workspace "${definition.id}" contains duplicate window key: ${key}`);
    }

    for (const key of definition.windows) {
      if (key === "dashboard") {
        issues.push(`Scenario workspace "${definition.id}" cannot include dashboard.`);
        continue;
      }

      if (!windowDefinitionsByKey.has(key)) {
        issues.push(`Scenario workspace "${definition.id}" references unknown window key: ${key}`);
      }
    }
  }

  for (const key of Object.keys(managedWindowMonitorRoles)) {
    if (!windowDefinitionsByKey.has(key)) {
      issues.push(`Monitor role mapping references unknown window key: ${key}`);
    }
  }

  return issues;
}

const managedWindowRegistryIssues = getManagedWindowRegistryIssues();
if (!app.isPackaged && managedWindowRegistryIssues.length > 0) {
  console.error(
    "[desktop-shell] Managed window registry issues detected:\n" +
      managedWindowRegistryIssues.map((issue) => `- ${issue}`).join("\n")
  );
}

function requireManagedWindowDefinition(key) {
  const definition = windowDefinitionsByKey.get(key);
  if (!definition) {
    throw new Error(`Unknown managed window: ${key}`);
  }

  return definition;
}

function normalizeScenarioWorkspaceDefinition(definition) {
  if (!definition || typeof definition.id !== "string") {
    throw new Error("Scenario workspace definition is missing a valid id.");
  }

  if (!Array.isArray(definition.windows) || definition.windows.length === 0) {
    throw new Error(`Scenario workspace "${definition.id}" is missing managed windows.`);
  }

  const seen = new Set();
  const windows = [];

  for (const key of definition.windows) {
    if (key === "dashboard") {
      throw new Error(`Scenario workspace "${definition.id}" cannot include dashboard.`);
    }

    requireManagedWindowDefinition(key);

    if (!seen.has(key)) {
      seen.add(key);
      windows.push(key);
    }
  }

  return {
    id: definition.id,
    windows
  };
}

const normalizedScenarioWorkspaceDefinitions = scenarioWorkspaceDefinitions.map((definition) =>
  normalizeScenarioWorkspaceDefinition(definition)
);
const scenarioWorkspaceDefinitionsById = new Map(
  normalizedScenarioWorkspaceDefinitions.map((definition) => [definition.id, definition])
);

function requireScenarioWorkspaceDefinition(id) {
  const definition = scenarioWorkspaceDefinitionsById.get(id);
  if (!definition) {
    throw new Error(`Unknown scenario workspace: ${id}`);
  }

  return definition;
}

function requireScenarioWorkspaceOpenMode(mode) {
  if (!supportedWorkspaceOpenModes.has(mode)) {
    throw new Error(`Unsupported workspace open mode: ${mode}`);
  }

  return mode;
}

// ------------------------------------------------------------
// Single Instance Lock
// ------------------------------------------------------------
// Ensure only one instance of the desktop shell runs. If a second
// instance is launched we focus the existing managed window (if any)
// or open the dashboard window. This logic must run after the
// `managedWindows` map is created so we can reference it safely.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance already holds the lock – exit this process.
  app.quit();
} else {
  // When a second instance is started, focus the existing window.
  app.on('second-instance', () => {
    // Find any existing managed window.
    for (const [, instance] of managedWindows.entries()) {
      if (instance && !instance.isDestroyed()) {
        if (instance.isMinimized()) {
          instance.restore();
        }
        instance.show();
        instance.focus();
        return;
      }
    }
    // No managed window exists – surface the window manager as a safe fallback.
    void showControlCenter();
  });
}

let controlCenterWindow = null;
let signalOverlayWindow = null;
let frontendServer = null;
let frontendBaseUrl = "";
let backendLifecycle = null;
let appTray = null;
let layoutState = createEmptyLayoutState();
let windowGroupsRegistry = createEmptyWindowGroupsRegistry();
let alertMonitorSettings = loadAlertMonitorSettings();
let alertMonitorSocket = null;
let alertMonitorReconnectTimer = null;
let alertMonitorPingTimer = null;
let alertMonitorSeenAlertIds = new Set();
let alertMonitorSeenVolumeMilestoneIds = new Set();
let alertMonitorSeenVolumeThresholdMilestoneIds = new Set();
let alertMonitorFrame = null;
let alertMonitorTransportState = { lastFrameSeq: null, awaitingSnapshot: false };
let alertMonitorPrimedHistory = false;
let alertMonitorPrimedVolumeMilestonesHistory = false;
let alertMonitorPrimedVolumeThresholdMilestonesHistory = false;
let runtimeStopping = false;
let signalOverlayState = null;
let signalOverlayHideTimer = null;
let lastSignalOverlayEventId = null;
let lastSignalOverlayShownAt = 0;
let layoutSaveTimer = null;
let stateBroadcastTimer = null;
const metrics = {
  windowsOpened: 0,
  windowsClosed: 0,
  broadcastCount: 0,
  broadcastPayloadSize: 0,
  skippedAlreadyOpen: 0,
  skippedBecauseUnavailable: 0,
  restoreStartTime: null,
  restoreEndTime: null,
  lastRestoreWindowCount: 0,
  windowLifecycleEvents: [],
  currentRunId: null,
  lastRunStartedAt: null,
  lastRunEndedAt: null,
  lastRunDurationMs: null,
  lastRunOptions: null,
  lastRunMetricsDelta: null
};
let restoreStressHarnessErrors = [];
let isRestoringManagedWindows = false;
let restoreLayoutSavePending = false;
let restoreBroadcastPending = false;
let didBroadcastAfterManagedWindowRestore = false;

const initialAlertReplayWindowMs = 120_000;
const initialAlertReplayLimit = 3;
const alertMonitorReconnectDelayMs = 2_500;
const signalOverlayLifetimeMs = 2_600;
const signalOverlayDedupWindowMs = 900;
const startupVolumeWindowAutoOpenSuppressMs = 20_000;
const noisyDesktopStateSyncDebounceMs = 120;

const desktopRuntimeStartedAt = Date.now();

function appendDesktopBackendLog(level, message, detail = null) {
  try {
    fs.mkdirSync(path.dirname(desktopBackendLogPath), { recursive: true });
    const normalizedDetail =
      detail instanceof Error
        ? detail.stack || detail.message
        : typeof detail === "string"
          ? detail
          : detail
            ? JSON.stringify(detail, null, 2)
            : "";
    fs.appendFileSync(
      desktopBackendLogPath,
      `[${new Date().toISOString()}] [${level}] ${message}${normalizedDetail ? `\n${normalizedDetail}` : ""}\n`,
      "utf8"
    );
  } catch {
    // Logging must never prevent the desktop shell from starting.
  }
}

function installDesktopBackendConsoleLogCapture() {
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);

    console[level] = (...args) => {
      original(...args);
      appendDesktopBackendLog(
        level,
        args
          .map((arg) =>
            arg instanceof Error
              ? arg.stack || arg.message
              : typeof arg === "string"
                ? arg
                : JSON.stringify(arg)
          )
          .join(" ")
      );
    };
  }
}

installDesktopBackendConsoleLogCapture();

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
        path.resolve(process.cwd(), "..", ".env.testnet"),
        path.resolve(process.cwd(), "backend", ".env.testnet"),
        path.resolve(process.cwd(), "desktop", ".env.testnet"),
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "..", ".env"),
        path.resolve(process.cwd(), "backend", ".env"),
        path.resolve(process.cwd(), "desktop", ".env"),
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

function createEmptyLayoutState() {
  const windows = {};

  for (const definition of managedWindowDefinitions) {
    windows[definition.key] = createDefaultWindowState(definition.key);
  }

  return { windows };
}

function readLayoutStateSource() {
  let source;

  try {
    source = fs.readFileSync(layoutPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Failed to read desktop layout state at ${layoutPath}. Falling back to defaults.`, error);
    }

    return null;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    console.warn(`Desktop layout state at ${layoutPath} contained a UTF-8 BOM. Stripping it before parse.`);
    source = source.slice(1);
  }

  return source;
}

function loadLayoutState() {
  const defaults = createEmptyLayoutState().windows;
  const source = readLayoutStateSource();

  if (!source) {
    return {
      windows: defaults
    };
  }

  if (!source.trim()) {
    console.warn(`Desktop layout state at ${layoutPath} is empty. Falling back to defaults.`);
    return {
      windows: defaults
    };
  }

  try {
    const parsed = JSON.parse(source);
    const savedWindows = parsed?.windows ?? {};

    if (!savedWindows || typeof savedWindows !== "object") {
      console.warn(`Desktop layout state at ${layoutPath} is missing a valid windows registry. Falling back to defaults.`);
      return {
        windows: defaults
      };
    }

    for (const definition of managedWindowDefinitions) {
      if (!savedWindows[definition.key] || typeof savedWindows[definition.key] !== "object") {
        continue;
      }

      defaults[definition.key] = normalizeWindowState(
        definition.key,
        savedWindows[definition.key]
      );
    }
  } catch (error) {
    console.warn(`Failed to parse desktop layout state at ${layoutPath}. Falling back to defaults.`, error);
  }

  return {
    windows: defaults
  };
}

function createEmptySavedLayoutsRegistry() {
  return {
    version: savedLayoutsRegistryVersion,
    layouts: {}
  };
}

function readSavedLayoutsRegistrySource() {
  let source;

  try {
    source = fs.readFileSync(savedLayoutsPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        `Failed to read desktop saved layouts registry at ${savedLayoutsPath}. Falling back to an empty registry.`,
        error
      );
    }

    return null;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    console.warn(
      `Desktop saved layouts registry at ${savedLayoutsPath} contained a UTF-8 BOM. Stripping it before parse.`
    );
    source = source.slice(1);
  }

  return source;
}

function readMonitorProfilesRegistrySource() {
  let source;

  try {
    source = fs.readFileSync(monitorProfilesPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        `Failed to read desktop monitor profiles registry at ${monitorProfilesPath}. Falling back to an empty registry.`,
        error
      );
    }

    return null;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    console.warn(
      `Desktop monitor profiles registry at ${monitorProfilesPath} contained a UTF-8 BOM. Stripping it before parse.`
    );
    source = source.slice(1);
  }

  return source;
}

function readWindowGroupsRegistrySource() {
  let source;

  try {
    source = fs.readFileSync(windowGroupsPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        `Failed to read desktop window groups registry at ${windowGroupsPath}. Falling back to an empty registry.`,
        error
      );
    }

    return null;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    console.warn(
      `Desktop window groups registry at ${windowGroupsPath} contained a UTF-8 BOM. Stripping it before parse.`
    );
    source = source.slice(1);
  }

  return source;
}

function writeJsonFileAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const retryDelaysMs = [5, 15, 35, 75];
  const retryableRenameErrorCodes = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);
  const nextCounter = ((writeJsonFileAtomically.writeCounter ?? 0) + 1) % Number.MAX_SAFE_INTEGER;
  writeJsonFileAtomically.writeCounter = nextCounter;
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${nextCounter.toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 10)}.tmp`;
  const sleepSync = (delayMs) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  };

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));

    for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex += 1) {
      try {
        fs.renameSync(temporaryPath, filePath);
        break;
      } catch (error) {
        if (
          !retryableRenameErrorCodes.has(error?.code) ||
          attemptIndex === retryDelaysMs.length
        ) {
          throw error;
        }

        sleepSync(retryDelaysMs[attemptIndex]);
      }
    }
  } finally {
    if (fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup for failed atomic writes.
      }
    }
  }
}

function createSavedLayoutLookupKey(name) {
  return normalizeSavedLayoutName(name).toLowerCase();
}

function normalizeSavedLayoutName(value) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!normalized) {
    throw new Error("Layout name is required.");
  }

  if (normalized.length > 80) {
    throw new Error("Layout name must be 80 characters or fewer.");
  }

  return normalized;
}

function normalizeSavedLayoutTimestamp(value, fallback) {
  const timestamp =
    typeof value === "string" || typeof value === "number" ? new Date(value) : null;

  return timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : fallback;
}

function cloneNormalizedWindowRegistry(sourceWindows) {
  const normalizedWindows = createEmptyLayoutState().windows;

  for (const definition of managedWindowDefinitions) {
    normalizedWindows[definition.key] = normalizeWindowState(
      definition.key,
      sourceWindows?.[definition.key] ?? {}
    );
  }

  return normalizedWindows;
}

function normalizeSavedLayoutPayload(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Saved layout payload must be an object.");
  }

  if (value.version !== undefined && value.version !== savedLayoutsRegistryVersion) {
    throw new Error(
      `Unsupported saved layout version: ${value.version}. Expected ${savedLayoutsRegistryVersion}.`
    );
  }

  const fallbackTimestamp = new Date().toISOString();

  return {
    name: normalizeSavedLayoutName(value.name),
    createdAt: normalizeSavedLayoutTimestamp(value.createdAt, fallbackTimestamp),
    updatedAt: normalizeSavedLayoutTimestamp(value.updatedAt, fallbackTimestamp),
    windows: cloneNormalizedWindowRegistry(value.windows)
  };
}

function loadSavedLayoutsRegistry() {
  const emptyRegistry = createEmptySavedLayoutsRegistry();
  const source = readSavedLayoutsRegistrySource();

  if (!source) {
    return emptyRegistry;
  }

  if (!source.trim()) {
    console.warn(
      `Desktop saved layouts registry at ${savedLayoutsPath} is empty. Falling back to an empty registry.`
    );
    return emptyRegistry;
  }

  try {
    const parsed = JSON.parse(source);
    const savedLayouts = parsed?.layouts;

    if (parsed?.version !== undefined && parsed.version !== savedLayoutsRegistryVersion) {
      console.warn(
        `Desktop saved layouts registry at ${savedLayoutsPath} uses unsupported version ${parsed.version}. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    if (savedLayouts && typeof savedLayouts !== "object") {
      console.warn(
        `Desktop saved layouts registry at ${savedLayoutsPath} is missing a valid layouts map. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    const normalizedLayouts = {};

    for (const entry of Object.values(savedLayouts ?? {})) {
      try {
        const normalizedEntry = normalizeSavedLayoutPayload(entry);
        const lookupKey = createSavedLayoutLookupKey(normalizedEntry.name);

        if (normalizedLayouts[lookupKey]) {
          console.warn(
            `Desktop saved layouts registry at ${savedLayoutsPath} contains a duplicate layout name: ${normalizedEntry.name}. Skipping the duplicate entry.`
          );
          continue;
        }

        normalizedLayouts[lookupKey] = normalizedEntry;
      } catch (error) {
        console.warn(
          `Skipping invalid saved layout entry in ${savedLayoutsPath}.`,
          error
        );
      }
    }

    return {
      version: savedLayoutsRegistryVersion,
      layouts: normalizedLayouts
    };
  } catch (error) {
    console.warn(
      `Failed to parse desktop saved layouts registry at ${savedLayoutsPath}. Falling back to an empty registry.`,
      error
    );
    return emptyRegistry;
  }
}

function saveSavedLayoutsRegistry(registry) {
  const normalizedLayouts = {};

  for (const entry of Object.values(registry?.layouts ?? {})) {
    const normalizedEntry = normalizeSavedLayoutPayload(entry);
    const lookupKey = createSavedLayoutLookupKey(normalizedEntry.name);

    if (normalizedLayouts[lookupKey]) {
      throw new Error(`Duplicate saved layout name: ${normalizedEntry.name}`);
    }

    normalizedLayouts[lookupKey] = normalizedEntry;
  }

  const nextRegistry = {
    version: savedLayoutsRegistryVersion,
    layouts: normalizedLayouts
  };

  writeJsonFileAtomically(savedLayoutsPath, nextRegistry);
  return nextRegistry;
}

function createEmptyMonitorProfilesRegistry() {
  return {
    version: monitorProfilesRegistryVersion,
    profiles: {}
  };
}

function createMonitorProfileLookupKey(name) {
  return normalizeMonitorProfileName(name).toLowerCase();
}

function createMonitorProfileIdBase(name) {
  return (
    normalizeMonitorProfileName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "monitor-profile"
  );
}

function createMonitorProfileId(name, profiles) {
  const baseId = createMonitorProfileIdBase(name);
  let nextId = baseId;
  let suffix = 2;

  while (profiles?.[nextId]) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function normalizeMonitorProfileName(value) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!normalized) {
    throw new Error("Monitor profile name is required.");
  }

  if (normalized.length > 80) {
    throw new Error("Monitor profile name must be 80 characters or fewer.");
  }

  return normalized;
}

function normalizeMonitorProfileId(value, fallbackName) {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";

  return normalized || createMonitorProfileIdBase(fallbackName);
}

function normalizeMonitorProfileTimestamp(value, fallback) {
  const timestamp =
    typeof value === "string" || typeof value === "number" ? new Date(value) : null;

  return timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : fallback;
}

function normalizeMonitorProfileRoleAssignment(value) {
  if (!value || typeof value !== "object") {
    return { displayId: null };
  }

  if (value.displayId === null || value.displayId === undefined || value.displayId === "") {
    return { displayId: null };
  }

  const displayId = Number(value.displayId);
  return {
    displayId: Number.isInteger(displayId) ? displayId : null
  };
}

function normalizeMonitorProfileRoles(value) {
  const roles = {};

  for (const role of monitorProfileRoles) {
    roles[role] = normalizeMonitorProfileRoleAssignment(value?.[role]);
  }

  return roles;
}

function cloneMonitorProfileRoles(sourceRoles) {
  return normalizeMonitorProfileRoles(sourceRoles);
}

function normalizeDisplayRectangle(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(Math.round(width), 0),
    height: Math.max(Math.round(height), 0)
  };
}

function normalizeCapturedDisplaySnapshot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = Number(value.id);
  const bounds = normalizeDisplayRectangle(value.bounds);
  const workArea = normalizeDisplayRectangle(value.workArea);

  if (!Number.isInteger(id) || !bounds || !workArea) {
    return null;
  }

  return {
    id,
    label: typeof value.label === "string" ? value.label : "",
    primary: !!value.primary,
    scaleFactor: Number.isFinite(Number(value.scaleFactor)) ? Number(value.scaleFactor) : 1,
    bounds,
    workArea
  };
}

function normalizeCapturedDisplays(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeCapturedDisplaySnapshot(entry))
    .filter((entry) => entry !== null);
}

function normalizeMonitorProfilePayload(value, options = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("Monitor profile payload must be an object.");
  }

  if (value.version !== undefined && value.version !== monitorProfilesRegistryVersion) {
    throw new Error(
      `Unsupported monitor profile version: ${value.version}. Expected ${monitorProfilesRegistryVersion}.`
    );
  }

  const fallbackTimestamp = options.timestamp ?? new Date().toISOString();
  const name = normalizeMonitorProfileName(value.name);
  const id = normalizeMonitorProfileId(options.id ?? value.id, name);

  return {
    id,
    name,
    createdAt: normalizeMonitorProfileTimestamp(value.createdAt, fallbackTimestamp),
    updatedAt: normalizeMonitorProfileTimestamp(value.updatedAt, fallbackTimestamp),
    roles: normalizeMonitorProfileRoles(value.roles),
    capturedDisplays: normalizeCapturedDisplays(value.capturedDisplays)
  };
}

function loadMonitorProfilesRegistry() {
  const emptyRegistry = createEmptyMonitorProfilesRegistry();
  const source = readMonitorProfilesRegistrySource();

  if (!source) {
    return emptyRegistry;
  }

  if (!source.trim()) {
    console.warn(
      `Desktop monitor profiles registry at ${monitorProfilesPath} is empty. Falling back to an empty registry.`
    );
    return emptyRegistry;
  }

  try {
    const parsed = JSON.parse(source);
    const profiles = parsed?.profiles;

    if (parsed?.version !== undefined && parsed.version !== monitorProfilesRegistryVersion) {
      console.warn(
        `Desktop monitor profiles registry at ${monitorProfilesPath} uses unsupported version ${parsed.version}. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    if (profiles && typeof profiles !== "object") {
      console.warn(
        `Desktop monitor profiles registry at ${monitorProfilesPath} is missing a valid profiles map. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    const normalizedProfiles = {};
    const profileNames = new Set();

    for (const [profileId, entry] of Object.entries(profiles ?? {})) {
      try {
        const normalizedEntry = normalizeMonitorProfilePayload(entry, { id: profileId });
        const lookupKey = createMonitorProfileLookupKey(normalizedEntry.name);

        if (normalizedProfiles[normalizedEntry.id]) {
          console.warn(
            `Desktop monitor profiles registry at ${monitorProfilesPath} contains a duplicate profile id: ${normalizedEntry.id}. Skipping the duplicate entry.`
          );
          continue;
        }

        if (profileNames.has(lookupKey)) {
          console.warn(
            `Desktop monitor profiles registry at ${monitorProfilesPath} contains a duplicate profile name: ${normalizedEntry.name}. Skipping the duplicate entry.`
          );
          continue;
        }

        profileNames.add(lookupKey);
        normalizedProfiles[normalizedEntry.id] = normalizedEntry;
      } catch (error) {
        console.warn(
          `Skipping invalid monitor profile entry in ${monitorProfilesPath}.`,
          error
        );
      }
    }

    return {
      version: monitorProfilesRegistryVersion,
      profiles: normalizedProfiles
    };
  } catch (error) {
    console.warn(
      `Failed to parse desktop monitor profiles registry at ${monitorProfilesPath}. Falling back to an empty registry.`,
      error
    );
    return emptyRegistry;
  }
}

function saveMonitorProfilesRegistry(registry) {
  const normalizedProfiles = {};
  const profileNames = new Set();

  for (const entry of Object.values(registry?.profiles ?? {})) {
    const normalizedEntry = normalizeMonitorProfilePayload(entry);
    const lookupKey = createMonitorProfileLookupKey(normalizedEntry.name);

    if (normalizedProfiles[normalizedEntry.id]) {
      throw new Error(`Duplicate monitor profile id: ${normalizedEntry.id}`);
    }

    if (profileNames.has(lookupKey)) {
      throw new Error(`Duplicate monitor profile name: ${normalizedEntry.name}`);
    }

    profileNames.add(lookupKey);
    normalizedProfiles[normalizedEntry.id] = normalizedEntry;
  }

  const nextRegistry = {
    version: monitorProfilesRegistryVersion,
    profiles: normalizedProfiles
  };

  writeJsonFileAtomically(monitorProfilesPath, nextRegistry);
  return nextRegistry;
}

function createEmptyWindowGroupsRegistry() {
  return {
    version: windowGroupsRegistryVersion,
    groups: {},
    assignments: {}
  };
}

function normalizeWindowGroupLabel(value) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!normalized) {
    throw new Error("Window group label is required.");
  }

  if (normalized.length > 80) {
    throw new Error("Window group label must be 80 characters or fewer.");
  }

  return normalized;
}

function createWindowGroupIdBase(label) {
  const normalizedLabel = normalizeWindowGroupLabel(label);
  const slug = normalizedLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutGroupSuffix = slug.endsWith("-group") ? slug.slice(0, -6) : slug;

  return withoutGroupSuffix || slug || "window-group";
}

function normalizeWindowGroupId(value, fallbackLabel) {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";

  return normalized || createWindowGroupIdBase(fallbackLabel);
}

function createWindowGroupId(label, groups) {
  const baseId = createWindowGroupIdBase(label);
  let nextId = baseId;
  let suffix = 2;

  while (groups?.[nextId]) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function normalizeWindowGroupTimestamp(value, fallback) {
  const timestamp =
    typeof value === "string" || typeof value === "number" ? new Date(value) : null;

  return timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : fallback;
}

function normalizeWindowGroupSymbol(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, "").trim().toUpperCase() : "";

  if (!normalized) {
    return null;
  }

  if (normalized.length > 40) {
    throw new Error("Window group symbol must be 40 characters or fewer.");
  }

  return normalized;
}

function normalizeWindowGroupColor(value) {
  return windowGroupColors.includes(value) ? value : "blue";
}

function normalizeWindowGroupContextMode(value) {
  return windowGroupContextModes.includes(value) ? value : "shared";
}

function normalizeWindowGroupPayload(value, options = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("Window group payload must be an object.");
  }

  if (value.version !== undefined && value.version !== windowGroupsRegistryVersion) {
    throw new Error(
      `Unsupported window group version: ${value.version}. Expected ${windowGroupsRegistryVersion}.`
    );
  }

  const fallbackTimestamp = options.timestamp ?? new Date().toISOString();
  const label = normalizeWindowGroupLabel(value.label);
  const groupId = normalizeWindowGroupId(options.groupId ?? value.groupId, label);

  return {
    groupId,
    label,
    symbol: normalizeWindowGroupSymbol(value.symbol),
    color: normalizeWindowGroupColor(value.color),
    contextMode: normalizeWindowGroupContextMode(value.contextMode),
    createdAt: normalizeWindowGroupTimestamp(value.createdAt, fallbackTimestamp),
    updatedAt: normalizeWindowGroupTimestamp(value.updatedAt, fallbackTimestamp)
  };
}

function cloneWindowGroup(entry) {
  return normalizeWindowGroupPayload(entry, { groupId: entry?.groupId });
}

function normalizeWindowGroupAssignments(value, groups) {
  const normalizedAssignments = {};

  if (!value || typeof value !== "object") {
    return normalizedAssignments;
  }

  for (const [key, groupId] of Object.entries(value)) {
    if (!windowDefinitionsByKey.has(key)) {
      console.warn(
        `Desktop window groups registry at ${windowGroupsPath} contains an assignment for unknown managed window "${key}". Ignoring it.`
      );
      continue;
    }

    if (groupId === null || groupId === undefined || groupId === "") {
      continue;
    }

    const normalizedGroupId =
      typeof groupId === "string"
        ? groupId
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        : "";

    if (!normalizedGroupId || !groups[normalizedGroupId]) {
      console.warn(
        `Desktop window groups registry at ${windowGroupsPath} assigns "${key}" to a missing group "${groupId}". Ignoring it.`
      );
      continue;
    }

    normalizedAssignments[key] = normalizedGroupId;
  }

  return normalizedAssignments;
}

function loadWindowGroupsRegistry() {
  const emptyRegistry = createEmptyWindowGroupsRegistry();
  const source = readWindowGroupsRegistrySource();

  if (!source) {
    return emptyRegistry;
  }

  if (!source.trim()) {
    console.warn(
      `Desktop window groups registry at ${windowGroupsPath} is empty. Falling back to an empty registry.`
    );
    return emptyRegistry;
  }

  try {
    const parsed = JSON.parse(source);
    const groups = parsed?.groups;

    if (parsed?.version !== undefined && parsed.version !== windowGroupsRegistryVersion) {
      console.warn(
        `Desktop window groups registry at ${windowGroupsPath} uses unsupported version ${parsed.version}. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    if (groups && typeof groups !== "object") {
      console.warn(
        `Desktop window groups registry at ${windowGroupsPath} is missing a valid groups map. Falling back to an empty registry.`
      );
      return emptyRegistry;
    }

    const normalizedGroups = {};
    const groupLabels = new Set();

    for (const [groupId, entry] of Object.entries(groups ?? {})) {
      try {
        const normalizedEntry = normalizeWindowGroupPayload(entry, { groupId });
        const labelKey = normalizedEntry.label.toLowerCase();

        if (normalizedGroups[normalizedEntry.groupId]) {
          console.warn(
            `Desktop window groups registry at ${windowGroupsPath} contains a duplicate group id: ${normalizedEntry.groupId}. Skipping the duplicate entry.`
          );
          continue;
        }

        if (groupLabels.has(labelKey)) {
          console.warn(
            `Desktop window groups registry at ${windowGroupsPath} contains a duplicate group label: ${normalizedEntry.label}. Skipping the duplicate entry.`
          );
          continue;
        }

        groupLabels.add(labelKey);
        normalizedGroups[normalizedEntry.groupId] = normalizedEntry;
      } catch (error) {
        console.warn(
          `Skipping invalid window group entry in ${windowGroupsPath}.`,
          error
        );
      }
    }

    return {
      version: windowGroupsRegistryVersion,
      groups: normalizedGroups,
      assignments: normalizeWindowGroupAssignments(parsed?.assignments, normalizedGroups)
    };
  } catch (error) {
    console.warn(
      `Failed to parse desktop window groups registry at ${windowGroupsPath}. Falling back to an empty registry.`,
      error
    );
    return emptyRegistry;
  }
}

function saveWindowGroupsRegistry(registry) {
  const normalizedGroups = {};
  const groupLabels = new Set();

  for (const entry of Object.values(registry?.groups ?? {})) {
    const normalizedEntry = normalizeWindowGroupPayload(entry);
    const labelKey = normalizedEntry.label.toLowerCase();

    if (normalizedGroups[normalizedEntry.groupId]) {
      throw new Error(`Duplicate window group id: ${normalizedEntry.groupId}`);
    }

    if (groupLabels.has(labelKey)) {
      throw new Error(`Duplicate window group label: ${normalizedEntry.label}`);
    }

    groupLabels.add(labelKey);
    normalizedGroups[normalizedEntry.groupId] = normalizedEntry;
  }

  const nextRegistry = {
    version: windowGroupsRegistryVersion,
    groups: normalizedGroups,
    assignments: normalizeWindowGroupAssignments(registry?.assignments, normalizedGroups)
  };

  writeJsonFileAtomically(windowGroupsPath, nextRegistry);
  windowGroupsRegistry = nextRegistry;
  return nextRegistry;
}

function createWindowGroupsState(registry = windowGroupsRegistry) {
  const groups = {};
  const assignments = {};

  for (const [groupId, entry] of Object.entries(registry?.groups ?? {})) {
    groups[groupId] = cloneWindowGroup(entry);
  }

  for (const definition of managedWindowDefinitions) {
    const assignedGroupId = registry?.assignments?.[definition.key] ?? null;
    assignments[definition.key] =
      assignedGroupId && groups[assignedGroupId] ? assignedGroupId : null;
  }

  return {
    groups,
    assignments
  };
}

function listWindowGroups() {
  return createWindowGroupsState(windowGroupsRegistry);
}

function createWindowGroup(payload) {
  const normalizedLabel = normalizeWindowGroupLabel(payload?.label);
  const labelKey = normalizedLabel.toLowerCase();

  for (const entry of Object.values(windowGroupsRegistry.groups)) {
    if (entry.label.toLowerCase() === labelKey) {
      throw new Error(`Window group "${normalizedLabel}" already exists.`);
    }
  }

  const timestamp = new Date().toISOString();
  const groupId = createWindowGroupId(normalizedLabel, windowGroupsRegistry.groups);
  windowGroupsRegistry.groups[groupId] = normalizeWindowGroupPayload({
    groupId,
    label: normalizedLabel,
    symbol: payload?.symbol ?? null,
    color: payload?.color ?? "blue",
    contextMode: payload?.contextMode ?? "shared",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  saveWindowGroupsRegistry(windowGroupsRegistry);
  return listWindowGroups();
}

function updateWindowGroupSymbol(groupId, symbol) {
  const normalizedGroupId = normalizeWindowGroupId(groupId, "window-group");
  const group = windowGroupsRegistry.groups[normalizedGroupId];

  if (!group) {
    throw new Error(`Window group "${normalizedGroupId}" was not found.`);
  }

  windowGroupsRegistry.groups[normalizedGroupId] = {
    ...group,
    symbol: normalizeWindowGroupSymbol(symbol),
    updatedAt: new Date().toISOString()
  };

  saveWindowGroupsRegistry(windowGroupsRegistry);
  return listWindowGroups();
}

function assignWindowToGroup(key, groupId) {
  requireManagedWindowDefinition(key);
  const normalizedGroupId = normalizeWindowGroupId(groupId, "window-group");

  if (!windowGroupsRegistry.groups[normalizedGroupId]) {
    throw new Error(`Window group "${normalizedGroupId}" was not found.`);
  }

  windowGroupsRegistry.assignments[key] = normalizedGroupId;
  saveWindowGroupsRegistry(windowGroupsRegistry);
  return listWindowGroups();
}

function unassignWindowFromGroup(key) {
  requireManagedWindowDefinition(key);
  delete windowGroupsRegistry.assignments[key];
  saveWindowGroupsRegistry(windowGroupsRegistry);
  return listWindowGroups();
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

/**
 * Normalizes a saved window bounds object.
 *
 * The function performs three validation steps:
 *   1. Ensure the input is an object with finite numeric properties.
 *   2. Clamp width/height to the minimum allowed values (320 × 240).
 *   3. Verify that the resulting rectangle intersects at least one display's
 *      workArea. If it does not intersect any display, the bounds are
 *      considered invalid and `null` is returned, causing the caller to fall
 *      back to default bounds.
 *
 * This logic satisfies the P0.6 patch requirement to validate restored bounds
 * against `screen.getAllDisplays()` without mutating persisted layout data or
 * clamping the saved coordinates.
 */
function normalizeBounds(bounds) {
  // Step 1: basic shape validation.
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

  // Step 2: enforce minimum size constraints.
  const normalized = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(Math.round(width), 320),
    height: Math.max(Math.round(height), 240)
  };

  // Step 3: ensure the bounds intersect at least one display workArea.
  const displays = screen.getAllDisplays();
  const intersects = displays.some((display) => {
    const wa = display.workArea;
    return (
      normalized.x < wa.x + wa.width &&
      normalized.x + normalized.width > wa.x &&
      normalized.y < wa.y + wa.height &&
      normalized.y + normalized.height > wa.y
    );
  });

  return intersects ? normalized : null;
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
  if (isRestoringManagedWindows) {
    restoreLayoutSavePending = true;
    return;
  }

  writeJsonFileAtomically(layoutPath, layoutState);
}

function clearScheduledLayoutStateSave() {
  if (layoutSaveTimer !== null) {
    clearTimeout(layoutSaveTimer);
    layoutSaveTimer = null;
  }
}

function scheduleLayoutStateSave() {
  if (isRestoringManagedWindows) {
    restoreLayoutSavePending = true;
    return;
  }

  clearScheduledLayoutStateSave();

  layoutSaveTimer = setTimeout(() => {
    layoutSaveTimer = null;
    saveLayoutState();
  }, noisyDesktopStateSyncDebounceMs);
}

function flushLayoutStateSave() {
  clearScheduledLayoutStateSave();
  saveLayoutState();
}

function getManagedWindowState(key) {
  if (!layoutState.windows[key]) {
    layoutState.windows[key] = createDefaultWindowState(key);
  }

  return layoutState.windows[key];
}

function persistManagedWindowStateOnClose(key, instance) {
  const state = getManagedWindowState(key);
  const nextBounds = browserWindowBoundsToSavedBounds(instance);

  state.bounds = nextBounds;
  state.displayId = screen.getDisplayMatching(instance.getBounds())?.id ?? state.displayId;
  state.opacity = clampOpacity(instance.getOpacity());
  state.alwaysOnTop = instance.isAlwaysOnTop();

  if (!runtimeStopping) {
    state.open = false;
  }

  saveLayoutState();
}

function browserWindowBoundsToSavedBounds(instance) {
  return normalizeBounds(instance.getBounds());
}

function syncManagedWindowsIntoLayoutState() {
  for (const [key, instance] of managedWindows.entries()) {
    if (instance && !instance.isDestroyed()) {
      syncWindowStateFromInstance(key, instance, { deferSave: true });
    }
  }

  flushLayoutStateSave();
}

function getSavedLayoutEntry(registry, name) {
  const normalizedName = normalizeSavedLayoutName(name);
  const lookupKey = createSavedLayoutLookupKey(normalizedName);
  const entry = registry.layouts[lookupKey];

  if (!entry) {
    throw new Error(`Saved layout "${normalizedName}" was not found.`);
  }

  return {
    lookupKey,
    entry
  };
}

function createSavedLayoutSummary(entry) {
  return {
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    openWindowCount: managedWindowDefinitions.reduce(
      (count, definition) => count + (entry.windows?.[definition.key]?.open ? 1 : 0),
      0
    )
  };
}

function listSavedLayouts() {
  const registry = loadSavedLayoutsRegistry();

  return Object.values(registry.layouts)
    .sort((left, right) => {
      const timeDiff =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();

      return timeDiff !== 0 ? timeDiff : left.name.localeCompare(right.name);
    })
    .map((entry) => createSavedLayoutSummary(entry));
}

function saveCurrentLayout(name) {
  const normalizedName = normalizeSavedLayoutName(name);
  const registry = loadSavedLayoutsRegistry();
  const lookupKey = createSavedLayoutLookupKey(normalizedName);

  if (registry.layouts[lookupKey]) {
    throw new Error(`Saved layout "${normalizedName}" already exists.`);
  }

  syncManagedWindowsIntoLayoutState();

  const timestamp = new Date().toISOString();
  registry.layouts[lookupKey] = {
    name: normalizedName,
    createdAt: timestamp,
    updatedAt: timestamp,
    windows: cloneNormalizedWindowRegistry(layoutState.windows)
  };

  saveSavedLayoutsRegistry(registry);
  return listSavedLayouts();
}

function applyLayoutState(nextLayoutState) {
  clearScheduledLayoutStateSave();
  layoutState = {
    windows: cloneNormalizedWindowRegistry(nextLayoutState.windows)
  };
  saveLayoutState();

  for (const definition of managedWindowDefinitions) {
    const instance = managedWindows.get(definition.key);
    const windowState = getManagedWindowState(definition.key);

    if (!windowState.open) {
      if (instance && !instance.isDestroyed()) {
        instance.close();
      }
      continue;
    }

    if (instance && !instance.isDestroyed()) {
      const nextBounds = resolveManagedWindowBounds(definition.key);

      instance.setAlwaysOnTop(windowState.alwaysOnTop);
      instance.setOpacity(windowState.opacity);
      instance.setBounds(nextBounds);

      if (instance.isMinimized()) {
        instance.restore();
      }

      instance.show();
      syncWindowStateFromInstance(definition.key, instance);
      continue;
    }

    const restoredWindow = createManagedWindow(definition.key);
    restoredWindow.setAlwaysOnTop(windowState.alwaysOnTop);
    restoredWindow.setOpacity(windowState.opacity);
    restoredWindow.setBounds(resolveManagedWindowBounds(definition.key));
  }
}

function loadSavedLayout(name) {
  const registry = loadSavedLayoutsRegistry();
  const { entry } = getSavedLayoutEntry(registry, name);
  applyLayoutState({
    windows: cloneNormalizedWindowRegistry(entry.windows)
  });
  return broadcastState();
}

function deleteSavedLayout(name) {
  const registry = loadSavedLayoutsRegistry();
  const { lookupKey } = getSavedLayoutEntry(registry, name);

  delete registry.layouts[lookupKey];
  saveSavedLayoutsRegistry(registry);
  return listSavedLayouts();
}

function exportSavedLayout(name) {
  const registry = loadSavedLayoutsRegistry();
  const { entry } = getSavedLayoutEntry(registry, name);

  return {
    version: savedLayoutsRegistryVersion,
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    windows: cloneNormalizedWindowRegistry(entry.windows)
  };
}

function importSavedLayout(jsonSource) {
  if (typeof jsonSource !== "string") {
    throw new Error("Saved layout import payload must be a JSON string.");
  }

  const source = jsonSource.charCodeAt(0) === 0xfeff ? jsonSource.slice(1) : jsonSource;

  if (!source.trim()) {
    throw new Error("Saved layout import payload is empty.");
  }

  let parsed;

  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Failed to parse saved layout import JSON: ${error.message}`);
  }

  const normalizedEntry = normalizeSavedLayoutPayload(parsed);
  const registry = loadSavedLayoutsRegistry();
  const lookupKey = createSavedLayoutLookupKey(normalizedEntry.name);

  if (registry.layouts[lookupKey]) {
    throw new Error(`Saved layout "${normalizedEntry.name}" already exists.`);
  }

  registry.layouts[lookupKey] = normalizedEntry;
  saveSavedLayoutsRegistry(registry);
  return listSavedLayouts();
}

function getDisplaySnapshots() {
  const copy = getInterfaceCopy();

  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.primary ? copy.primaryDisplay : `${copy.display} ${index + 1}`,
    primary: display.primary,
    scaleFactor: display.scaleFactor,
    bounds: display.bounds,
    workArea: display.workArea
  }));
}

function listDisplays() {
  return getDisplaySnapshots();
}

function createMonitorProfileSummary(entry) {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    roles: cloneMonitorProfileRoles(entry.roles),
    capturedDisplays: normalizeCapturedDisplays(entry.capturedDisplays)
  };
}

function listMonitorProfiles() {
  const registry = loadMonitorProfilesRegistry();

  return Object.values(registry.profiles)
    .sort((left, right) => {
      const timeDiff =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();

      return timeDiff !== 0 ? timeDiff : left.name.localeCompare(right.name);
    })
    .map((entry) => createMonitorProfileSummary(entry));
}

function saveMonitorProfile(profile) {
  const registry = loadMonitorProfilesRegistry();
  const normalizedName = normalizeMonitorProfileName(profile?.name);
  const lookupKey = createMonitorProfileLookupKey(normalizedName);

  for (const entry of Object.values(registry.profiles)) {
    if (createMonitorProfileLookupKey(entry.name) === lookupKey) {
      throw new Error(`Monitor profile "${normalizedName}" already exists.`);
    }
  }

  const timestamp = new Date().toISOString();
  const id = createMonitorProfileId(normalizedName, registry.profiles);
  registry.profiles[id] = normalizeMonitorProfilePayload({
    id,
    name: normalizedName,
    createdAt: timestamp,
    updatedAt: timestamp,
    roles: profile?.roles,
    capturedDisplays: getDisplaySnapshots()
  });

  saveMonitorProfilesRegistry(registry);
  return listMonitorProfiles();
}

function getMonitorProfileEntry(registry, profileId) {
  const id = typeof profileId === "string" ? profileId.trim() : "";
  const entry = id ? registry.profiles[id] : null;

  if (!entry) {
    throw new Error(`Monitor profile "${id || "unknown"}" was not found.`);
  }

  return entry;
}

function getManagedWindowMonitorRole(key) {
  const role = managedWindowMonitorRoles[key];
  return monitorProfileRoles.includes(role) ? role : "primary";
}

function logDisplayResolution(message) {
  if (!app.isPackaged) {
    console.log(`[desktop-shell] ${message}`);
  }
}

function getDisplayTopologyRelation(display, primaryDisplay) {
  if (!display || !primaryDisplay) {
    return "unknown";
  }

  if (display.id === primaryDisplay.id) {
    return "primary";
  }

  const dx = display.bounds.x - primaryDisplay.bounds.x;
  const dy = display.bounds.y - primaryDisplay.bounds.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }

  return dy < 0 ? "above" : "below";
}

function scoreDisplayFingerprintMatch(capturedDisplay, currentDisplay, capturedPrimary, currentPrimary) {
  let score = 0;

  if (capturedDisplay.primary === currentDisplay.primary) {
    score += 80;
  }

  const capturedWorkArea = capturedDisplay.workArea;
  const currentWorkArea = currentDisplay.workArea;
  const workAreaWidthDelta = Math.abs(capturedWorkArea.width - currentWorkArea.width);
  const workAreaHeightDelta = Math.abs(capturedWorkArea.height - currentWorkArea.height);

  if (workAreaWidthDelta === 0 && workAreaHeightDelta === 0) {
    score += 70;
  } else if (workAreaWidthDelta <= 48 && workAreaHeightDelta <= 48) {
    score += 40;
  } else if (workAreaWidthDelta <= 128 && workAreaHeightDelta <= 128) {
    score += 15;
  }

  const capturedBounds = capturedDisplay.bounds;
  const currentBounds = currentDisplay.bounds;
  const boundsWidthDelta = Math.abs(capturedBounds.width - currentBounds.width);
  const boundsHeightDelta = Math.abs(capturedBounds.height - currentBounds.height);

  if (boundsWidthDelta === 0 && boundsHeightDelta === 0) {
    score += 40;
  } else if (boundsWidthDelta <= 64 && boundsHeightDelta <= 64) {
    score += 20;
  } else if (boundsWidthDelta <= 160 && boundsHeightDelta <= 160) {
    score += 8;
  }

  const scaleFactorDelta = Math.abs(capturedDisplay.scaleFactor - currentDisplay.scaleFactor);
  if (scaleFactorDelta === 0) {
    score += 25;
  } else if (scaleFactorDelta <= 0.1) {
    score += 12;
  } else if (scaleFactorDelta <= 0.25) {
    score += 5;
  }

  const capturedRelation = getDisplayTopologyRelation(capturedDisplay, capturedPrimary);
  const currentRelation = getDisplayTopologyRelation(currentDisplay, currentPrimary);
  if (capturedRelation === currentRelation) {
    score += 18;
  }

  const positionDeltaX = Math.abs(capturedBounds.x - currentBounds.x);
  const positionDeltaY = Math.abs(capturedBounds.y - currentBounds.y);
  if (positionDeltaX === 0 && positionDeltaY === 0) {
    score += 12;
  } else if (positionDeltaX <= 128 && positionDeltaY <= 128) {
    score += 6;
  }

  return score;
}

function findBestMatchingDisplayForSnapshot(capturedDisplay, currentDisplays, capturedDisplays) {
  if (!capturedDisplay || currentDisplays.length === 0) {
    return null;
  }

  const capturedPrimary =
    capturedDisplays.find((display) => display.primary) ??
    capturedDisplays.find((display) => display.id === capturedDisplay.id) ??
    capturedDisplay;
  const currentPrimary =
    currentDisplays.find((display) => display.primary) ?? screen.getPrimaryDisplay();
  const rankedMatches = currentDisplays
    .map((display) => ({
      display,
      score: scoreDisplayFingerprintMatch(capturedDisplay, display, capturedPrimary, currentPrimary)
    }))
    .sort((left, right) => right.score - left.score);

  const [bestMatch, secondBestMatch] = rankedMatches;
  if (!bestMatch) {
    return null;
  }

  if (bestMatch.score < 90) {
    return null;
  }

  if (secondBestMatch && bestMatch.score - secondBestMatch.score < 20) {
    return null;
  }

  return bestMatch.display;
}

function resolveMonitorProfileDisplay(profile, role) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const displayId =
    profile.roles?.[role]?.displayId ?? profile.roles?.primary?.displayId ?? null;

  if (Number.isInteger(displayId)) {
    const matchedDisplay = displays.find((display) => display.id === displayId);

    if (matchedDisplay) {
      logDisplayResolution(
        `monitor profile "${profile.id}" role "${role}" resolved by exact displayId ${displayId}`
      );
      return matchedDisplay;
    }
  }

  const capturedDisplay = profile.capturedDisplays.find((display) => display.id === displayId);
  const fingerprintMatch = capturedDisplay
    ? findBestMatchingDisplayForSnapshot(capturedDisplay, displays, profile.capturedDisplays)
    : null;

  if (fingerprintMatch) {
    logDisplayResolution(
      `monitor profile "${profile.id}" role "${role}" fingerprint-remapped displayId ${displayId} -> ${fingerprintMatch.id}`
    );
    return fingerprintMatch;
  }

  logDisplayResolution(
    `monitor profile "${profile.id}" role "${role}" fell back to primary display ${primaryDisplay.id}`
  );
  return primaryDisplay;
}

function moveOpenWindowToMonitorProfileDisplay(key, instance, display) {
  const currentBounds = instance.getBounds();
  const currentWidth = Number.isFinite(Number(currentBounds.width))
    ? Math.round(Number(currentBounds.width))
    : getDefaultBounds(key, display).width;
  const currentHeight = Number.isFinite(Number(currentBounds.height))
    ? Math.round(Number(currentBounds.height))
    : getDefaultBounds(key, display).height;
  const workArea = display.workArea;
  const nextWidth = Math.min(Math.max(currentWidth, 320), workArea.width);
  const nextHeight = Math.min(Math.max(currentHeight, 240), workArea.height);
  const nextBounds = clampBoundsToDisplay(
    {
      x: workArea.x + Math.round((workArea.width - nextWidth) / 2),
      y: workArea.y + Math.round((workArea.height - nextHeight) / 2),
      width: nextWidth,
      height: nextHeight
    },
    display
  );

  instance.setBounds(nextBounds);

  const windowState = getManagedWindowState(key);
  const actualBounds = normalizeBounds(instance.getBounds()) ?? nextBounds;
  windowState.open = true;
  windowState.bounds = actualBounds;
  windowState.displayId = screen.getDisplayMatching(actualBounds)?.id ?? display.id;
  windowState.opacity = clampOpacity(instance.getOpacity());
  windowState.alwaysOnTop = instance.isAlwaysOnTop();
}

function applyMonitorProfile(profileId) {
  const registry = loadMonitorProfilesRegistry();
  const profile = getMonitorProfileEntry(registry, profileId);
  let movedCount = 0;

  clearScheduledLayoutStateSave();

  for (const definition of managedWindowDefinitions) {
    const instance = managedWindows.get(definition.key);

    if (!instance || instance.isDestroyed()) {
      continue;
    }

    const role = getManagedWindowMonitorRole(definition.key);
    const display = resolveMonitorProfileDisplay(profile, role);
    moveOpenWindowToMonitorProfileDisplay(definition.key, instance, display);
    movedCount += 1;
  }

  if (movedCount > 0) {
    saveLayoutState();
  }

  return broadcastState();
}

function getDefaultBounds(key, display) {
  const workArea = display.workArea;
  const isDashboard = key === "dashboard";
  const width = isDashboard
    ? Math.max(Math.min(Math.floor(workArea.width * 0.92), workArea.width), 1100)
    : Math.max(Math.min(Math.floor(workArea.width * 0.52), workArea.width), 720);
  const height = isDashboard
    ? Math.max(Math.min(Math.floor(workArea.height * 0.90), workArea.height), 760)
    : Math.max(Math.min(Math.floor(workArea.height * 0.72), workArea.height), 520);
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

function shouldUseDefaultWindowBounds(key, bounds, display) {
  if (!bounds) {
    return true;
  }

  const workArea = display.workArea;
  const widthRatio = bounds.width / workArea.width;
  const heightRatio = bounds.height / workArea.height;
  const areaRatio = (bounds.width * bounds.height) / (workArea.width * workArea.height);
  const isDashboard = key === "dashboard";

  if (isDashboard) {
    return widthRatio < 0.7 || heightRatio < 0.72 || areaRatio < 0.5;
  }

  return widthRatio < 0.38 || heightRatio < 0.5 || areaRatio < 0.22;
}

function resolveManagedWindowBounds(key) {
  const windowState = getManagedWindowState(key);
  const display = windowState.displayId
    ? resolveDisplay(windowState.displayId, {
        bounds: windowState.bounds,
        logContext: `managed-window-restore:${key}`
      })
    : windowState.bounds
      ? screen.getDisplayMatching(windowState.bounds)
      : screen.getPrimaryDisplay();
  const savedBounds = windowState.bounds ? clampBoundsToDisplay(windowState.bounds, display) : null;

  if (!savedBounds || shouldUseDefaultWindowBounds(key, savedBounds, display)) {
    return getDefaultBounds(key, display);
  }

  return savedBounds;
}

function resolveDisplay(displayId) {
  const displays = screen.getAllDisplays();
  const options = arguments[1] ?? {};
  const bounds = options.bounds;
  const logContext = options.logContext ? `${options.logContext} ` : "";

  if (displayId !== null) {
    const matchedDisplay = displays.find((display) => display.id === displayId);
    if (matchedDisplay) {
      logDisplayResolution(`${logContext}resolved by exact displayId ${displayId}`);
      return matchedDisplay;
    }
  }

  const normalizedBounds = normalizeBounds(bounds);
  if (normalizedBounds) {
    const matchedDisplay = screen.getDisplayMatching(normalizedBounds);
    if (matchedDisplay) {
      logDisplayResolution(
        `${logContext}resolved by bounds/display remap ${displayId ?? "null"} -> ${matchedDisplay.id}`
      );
      return matchedDisplay;
    }
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  logDisplayResolution(
    `${logContext}fell back to primary display ${primaryDisplay.id} for displayId ${displayId ?? "null"}`
  );
  return primaryDisplay;
}

function resolveWindowBounds(key) {
  return resolveManagedWindowBounds(key);
}

function syncWindowStateFromInstance(key, instance, options = {}) {
  const bounds = instance.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const windowState = getManagedWindowState(key);

  windowState.bounds = normalizeBounds(bounds);
  windowState.displayId = display?.id ?? null;
  windowState.opacity = clampOpacity(instance.getOpacity());
  windowState.alwaysOnTop = instance.isAlwaysOnTop();
  windowState.open = true;

  if (options.deferSave) {
    scheduleLayoutStateSave();
  } else {
    saveLayoutState();
  }
}

function getStateSnapshot() {
  return {
    frontendBaseUrl,
    backendWsUrl,
    interfaceLanguage: normalizeInterfaceLanguage(alertMonitorSettings.interfaceLanguage),
    displays: getDisplaySnapshots(),
    windowGroups: createWindowGroupsState(),
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

function shouldBroadcastDesktopShellState(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }

  const url = windowInstance.webContents.getURL();

  return (
    url === `${frontendBaseUrl}/desktop` ||
    url.startsWith(`${frontendBaseUrl}/desktopdaraterminal`) ||
    url.startsWith(`${frontendBaseUrl}/module/`)
  );
}

function broadcastState() {
  const snapshot = getStateSnapshot();

  if (isRestoringManagedWindows) {
    restoreBroadcastPending = true;
    return snapshot;
  }

  metrics.broadcastCount += 1;
  metrics.broadcastPayloadSize = JSON.stringify(snapshot).length;

  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (shouldBroadcastDesktopShellState(windowInstance)) {
      windowInstance.webContents.send("desktop-shell:state-changed", snapshot);
    }
  });

  return snapshot;
}

function scheduleBroadcastState() {
  if (isRestoringManagedWindows) {
    restoreBroadcastPending = true;
    return;
  }

  if (stateBroadcastTimer !== null) {
    clearTimeout(stateBroadcastTimer);
  }

  stateBroadcastTimer = setTimeout(() => {
    stateBroadcastTimer = null;
    broadcastState();
  }, noisyDesktopStateSyncDebounceMs);
}

function clearScheduledBroadcastState() {
  if (stateBroadcastTimer !== null) {
    clearTimeout(stateBroadcastTimer);
    stateBroadcastTimer = null;
  }
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

function showManagedWindowInstance(browserWindow, options = {}) {
  const shouldFocus = options.focus !== false;

  browserWindow.__scalpStationShowInactive = !shouldFocus;

  if (shouldFocus) {
    browserWindow.show();
    browserWindow.focus();
    return;
  }

  if (typeof browserWindow.showInactive === "function") {
    browserWindow.showInactive();
    return;
  }

  browserWindow.show();
}

function createManagedWindow(key) {
  const definition = requireManagedWindowDefinition(key);
  const windowTitle = getManagedWindowTitle(definition.key);

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
    title: windowTitle,
    ...(desktopIconPath ? { icon: desktopIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      spellcheck: false
    }
  });

  browserWindow.setMenuBarVisibility(false);
  browserWindow.setTitle(windowTitle);
  browserWindow.setAlwaysOnTop(windowState.alwaysOnTop);
  browserWindow.setOpacity(windowState.opacity);
  managedWindows.set(key, browserWindow);
  metrics.windowsOpened += 1;
  metrics.windowLifecycleEvents.push({
    time: Date.now(),
    event: "open",
    key
  });

  browserWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    browserWindow.setTitle(windowTitle);
  });

  browserWindow.on("ready-to-show", () => {
    browserWindow.setTitle(windowTitle);
    if (browserWindow.__scalpStationShowInactive) {
      if (typeof browserWindow.showInactive === "function") {
        browserWindow.showInactive();
      } else {
        browserWindow.show();
      }
    } else {
      browserWindow.show();
    }
    syncWindowStateFromInstance(key, browserWindow);
    broadcastState();
  });

  browserWindow.webContents.on("did-finish-load", () => {
    browserWindow.setTitle(windowTitle);
  });

  browserWindow.on("moved", () => {
    syncWindowStateFromInstance(key, browserWindow, { deferSave: true });
    scheduleBroadcastState();
  });

  browserWindow.on("resized", () => {
    syncWindowStateFromInstance(key, browserWindow, { deferSave: true });
    scheduleBroadcastState();
  });

  browserWindow.on("always-on-top-changed", () => {
    syncWindowStateFromInstance(key, browserWindow, { deferSave: true });
    scheduleBroadcastState();
  });

  browserWindow.on("close", () => {
    persistManagedWindowStateOnClose(key, browserWindow);
  });

  browserWindow.on("closed", () => {
    metrics.windowsClosed += 1;
    managedWindows.delete(key);
    broadcastState();
  });

  browserWindow.loadURL(`${frontendBaseUrl}${definition.route}`);

  return browserWindow;
}

async function openManagedWindow(key, options = {}) {
  requireManagedWindowDefinition(key);

  const windowState = getManagedWindowState(key);
  const existingInstance = managedWindows.get(key);

  if (existingInstance && !existingInstance.isDestroyed()) {
    let stateChanged = false;

    if (!windowState.open) {
      windowState.open = true;
      stateChanged = true;
    }

    if (!windowState.bounds) {
      windowState.bounds = normalizeBounds(existingInstance.getBounds()) ?? resolveManagedWindowBounds(key);
      stateChanged = true;
    }

    if (stateChanged) {
      saveLayoutState();
    } else {
      metrics.skippedAlreadyOpen += 1;
    }

    if (options.focus !== false) {
      if (existingInstance.isMinimized()) {
        existingInstance.restore();
      }

      showManagedWindowInstance(existingInstance, options);
    }

    return stateChanged ? broadcastState() : getStateSnapshot();
  }

  windowState.open = true;
  windowState.bounds = resolveManagedWindowBounds(key);
  saveLayoutState();

  const browserWindow = createManagedWindow(key);
  if (browserWindow.isMinimized()) {
    browserWindow.restore();
  }
  showManagedWindowInstance(browserWindow, options);

  return broadcastState();
}

function listWorkspaces() {
  return normalizedScenarioWorkspaceDefinitions.map((definition) => ({
    id: definition.id,
    windows: [...definition.windows],
    windowCount: definition.windows.length
  }));
}

async function openWorkspace(id, mode) {
  const definition = requireScenarioWorkspaceDefinition(id);
  const openMode = requireScenarioWorkspaceOpenMode(mode);

  for (const key of definition.windows) {
    const instance = managedWindows.get(key);
    const isOpen = !!instance && !instance.isDestroyed();

    if (isOpen) {
      continue;
    }

    await openManagedWindow(key, { focus: false });
  }

  if (openMode === "merge") {
    await focusManagedWindow(definition.windows[0]);
  }

  return broadcastState();
}

async function restoreSavedManagedWindows() {
  metrics.restoreStartTime = Date.now();
  didBroadcastAfterManagedWindowRestore = false;
  isRestoringManagedWindows = true;
  restoreLayoutSavePending = false;
  restoreBroadcastPending = false;
  let restoredCount = 0;

  try {
    for (const definition of managedWindowDefinitions) {
      if (definition.key === "dashboard") {
        continue;
      }

      const windowState = getManagedWindowState(definition.key);

      if (!windowState.open) {
        continue;
      }

      try {
        await openManagedWindow(definition.key);
        restoredCount += 1;
      } catch (error) {
        recordRestoreStressHarnessError(error, `restore:${definition.key}`);
        console.error(`Failed to restore managed window: ${definition.key}`, error);
      }
    }

  } finally {
    metrics.restoreEndTime = Date.now();
    metrics.lastRestoreWindowCount = restoredCount;
    isRestoringManagedWindows = false;

    if (restoreLayoutSavePending || restoredCount > 0) {
      try {
        flushLayoutStateSave();
      } catch (error) {
        recordRestoreStressHarnessError(error, "restore:flush-layout");
        console.error("Failed to flush restored managed window layout state", error);
      }
    }

    clearScheduledBroadcastState();

    if (restoreBroadcastPending || restoredCount > 0) {
      broadcastState();
      didBroadcastAfterManagedWindowRestore = true;
    }

    restoreLayoutSavePending = false;
    restoreBroadcastPending = false;
  }

  return restoredCount;
}

async function openInitialShellWindow() {
  const restoredCount = await restoreSavedManagedWindows();

  if (restoredCount > 0) {
    return restoredCount;
  }

  await showControlCenter();
  return 0;
}

async function focusManagedWindow(key) {
  requireManagedWindowDefinition(key);

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
  requireManagedWindowDefinition(key);

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
  const existingBounds = normalizeBounds(instance.getBounds()) ?? resolveManagedWindowBounds(key);
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
  requireManagedWindowDefinition(key);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStressHarnessWindowKeys(windowCount) {
  const managedKeys = getStressHarnessAvailableWindowKeys();

  if (!Number.isInteger(windowCount) || windowCount <= 0) {
    return [];
  }

  return managedKeys.slice(0, Math.min(windowCount, managedKeys.length));
}

function getStressHarnessAvailableWindowKeys() {
  return managedWindowDefinitions
    .map((definition) => definition.key)
    .filter((key) => key !== "dashboard");
}

function getStressDelay(delayMs) {
  if (Number.isFinite(Number(delayMs)) && Number(delayMs) >= 0) {
    return Math.round(Number(delayMs));
  }

  return 50 + Math.floor(Math.random() * 101);
}

function captureMetricsBaseline() {
  return {
    windowsOpened: metrics.windowsOpened,
    windowsClosed: metrics.windowsClosed,
    broadcastCount: metrics.broadcastCount,
    broadcastPayloadSize: metrics.broadcastPayloadSize,
    skippedAlreadyOpen: metrics.skippedAlreadyOpen,
    skippedBecauseUnavailable: metrics.skippedBecauseUnavailable,
    restoreStartTime: metrics.restoreStartTime,
    restoreEndTime: metrics.restoreEndTime,
    lastRestoreWindowCount: metrics.lastRestoreWindowCount,
    windowLifecycleEventCount: metrics.windowLifecycleEvents.length,
    capturedAt: Date.now()
  };
}

function diffMetricsFromBaseline(baseline) {
  return {
    windowsOpened: metrics.windowsOpened - baseline.windowsOpened,
    windowsClosed: metrics.windowsClosed - baseline.windowsClosed,
    broadcastCount: metrics.broadcastCount - baseline.broadcastCount,
    broadcastPayloadSize: metrics.broadcastPayloadSize,
    skippedAlreadyOpen: metrics.skippedAlreadyOpen - baseline.skippedAlreadyOpen,
    skippedBecauseUnavailable: metrics.skippedBecauseUnavailable - baseline.skippedBecauseUnavailable,
    restoreStartTime: metrics.restoreStartTime,
    restoreEndTime: metrics.restoreEndTime,
    lastRestoreWindowCount: metrics.lastRestoreWindowCount,
    windowLifecycleEventCount: metrics.windowLifecycleEvents.length - baseline.windowLifecycleEventCount
  };
}

function resetMetricsForRun() {
  if (app.isPackaged) {
    throw new Error("Metrics run reset is available in development builds only.");
  }

  metrics.currentRunId = null;
  metrics.lastRunStartedAt = null;
  metrics.lastRunEndedAt = null;
  metrics.lastRunDurationMs = null;
  metrics.lastRunOptions = null;
  metrics.lastRunMetricsDelta = null;
}

async function runStressOpenCycle(windowKeys, delayMs) {
  for (const key of windowKeys) {
    await openManagedWindow(key, { focus: false });
    await sleep(getStressDelay(delayMs));
  }
}

async function runStressCloseSubset(windowKeys, delayMs) {
  const closeKeys = windowKeys.slice(0, Math.floor(windowKeys.length / 2));

  for (const key of closeKeys) {
    await closeManagedWindow(key);
    await sleep(getStressDelay(delayMs));
  }

  return closeKeys;
}

async function runStressMoveSubset(windowKeys, delayMs) {
  const moveKeys = windowKeys.slice(0, Math.max(1, Math.floor(windowKeys.length / 2)));

  for (const key of moveKeys) {
    const instance = managedWindows.get(key);
    if (instance && !instance.isDestroyed()) {
      const bounds = instance.getBounds();
      instance.setBounds({
        x: bounds.x + 16,
        y: bounds.y + 16,
        width: bounds.width,
        height: bounds.height
      });
    }

    await updateManagedWindow(key, {
      opacity: 0.92
    });
    await sleep(getStressDelay(delayMs));
  }

  return moveKeys;
}

async function runStressTest(options = {}) {
  if (app.isPackaged) {
    throw new Error("Stress harness is available in development builds only.");
  }

  const requestedWindowCount = Number(options.windowCount);
  const cycleType = options.cycleType;
  const delayMs = options.delayMs;

  if (!Number.isInteger(requestedWindowCount) || requestedWindowCount <= 0) {
    throw new Error("Stress test windowCount must be a positive integer.");
  }

  if (!["open", "open-close", "open-move", "full-cycle"].includes(cycleType)) {
    throw new Error(`Unsupported stress cycle type: ${cycleType}`);
  }

  const availableWindowKeys = getStressHarnessAvailableWindowKeys();
  const effectiveWindowCount = Math.min(requestedWindowCount, availableWindowKeys.length);
  const skippedBecauseUnavailable = requestedWindowCount - effectiveWindowCount;
  const windowKeys = getStressHarnessWindowKeys(effectiveWindowCount);
  resetMetricsForRun();
  const runId = `stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseline = captureMetricsBaseline();
  const startedAt = Date.now();
  metrics.skippedBecauseUnavailable += skippedBecauseUnavailable;
  metrics.currentRunId = runId;
  metrics.lastRunStartedAt = startedAt;
  metrics.lastRunOptions = {
    windowCount: requestedWindowCount,
    requestedWindowCount,
    effectiveWindowCount,
    skippedBecauseUnavailable,
    cycleType,
    ...(delayMs !== undefined ? { delayMs } : {})
  };

  if (cycleType === "open") {
    await runStressOpenCycle(windowKeys, delayMs);
  } else if (cycleType === "open-close") {
    await runStressOpenCycle(windowKeys, delayMs);
    await runStressCloseSubset(windowKeys, delayMs);
  } else if (cycleType === "open-move") {
    await runStressOpenCycle(windowKeys, delayMs);
    await runStressMoveSubset(windowKeys, delayMs);
  } else if (cycleType === "full-cycle") {
    await runStressOpenCycle(windowKeys, delayMs);
    const movedKeys = await runStressMoveSubset(windowKeys, delayMs);
    const closedKeys = await runStressCloseSubset(windowKeys, delayMs);

    for (const key of closedKeys) {
      await openManagedWindow(key, { focus: false });
      await sleep(getStressDelay(delayMs));
    }

    for (const key of movedKeys.slice(0, Math.max(1, Math.floor(movedKeys.length / 2)))) {
      await updateManagedWindow(key, { opacity: 1 });
      await sleep(getStressDelay(delayMs));
    }
  }

  const endedAt = Date.now();
  const durationMs = endedAt - startedAt;
  const delta = diffMetricsFromBaseline(baseline);
  const finalMetrics = {
    ...metrics,
    windowLifecycleEvents: [...metrics.windowLifecycleEvents]
  };
  const finalState = getStateSnapshot();

  metrics.lastRunEndedAt = endedAt;
  metrics.lastRunDurationMs = durationMs;
  metrics.lastRunMetricsDelta = delta;

  const result = {
    runId,
    options: {
      windowCount: requestedWindowCount,
      requestedWindowCount,
      effectiveWindowCount,
      skippedBecauseUnavailable,
      cycleType,
      ...(delayMs !== undefined ? { delayMs } : {})
    },
    requestedWindowCount,
    effectiveWindowCount,
    skippedBecauseUnavailable,
    durationMs,
    baseline,
    finalMetrics,
    delta,
    finalOpenWindowCount: finalState.windows.filter((windowState) => windowState.open).length,
    errors: null
  };

  console.log("[desktop-shell] Stress test complete", result);
  return result;
}

function isRestoreStressHarnessEnabled() {
  return restoreStressHarnessEnabled;
}

function getRestoreStressWindowCount() {
  const windowCount = Number(restoreStressWindowCountEnv);

  if (!Number.isInteger(windowCount) || windowCount <= 0) {
    throw new Error("Restore stress window count must be a positive integer.");
  }

  return windowCount;
}

function seedRestoreStressLayout() {
  if (!isRestoreStressHarnessEnabled()) {
    return null;
  }

  const requestedWindowCount = getRestoreStressWindowCount();
  const availableWindowKeys = getStressHarnessAvailableWindowKeys();
  const effectiveWindowCount = Math.min(requestedWindowCount, availableWindowKeys.length);
  const skippedBecauseUnavailable = requestedWindowCount - effectiveWindowCount;
  const windowKeys = getStressHarnessWindowKeys(effectiveWindowCount);
  const primaryDisplay = screen.getPrimaryDisplay();
  const seededLayoutState = createEmptyLayoutState();

  for (const key of windowKeys) {
    seededLayoutState.windows[key] = {
      ...createDefaultWindowState(key),
      open: true,
      displayId: primaryDisplay.id,
      bounds: getDefaultBounds(key, primaryDisplay)
    };
  }

  writeJsonFileAtomically(layoutPath, seededLayoutState);

  return {
    runId: restoreStressRunId,
    requestedWindowCount,
    effectiveWindowCount,
    skippedBecauseUnavailable,
    seededWindowKeys: windowKeys,
    userDataDir: app.getPath("userData"),
    layoutPath
  };
}

function serializeError(error, stage) {
  return {
    stage,
    name: error?.name ?? "Error",
    message: error?.message ?? String(error)
  };
}

function recordRestoreStressHarnessError(error, stage) {
  if (!isRestoreStressHarnessEnabled()) {
    return;
  }

  restoreStressHarnessErrors.push(serializeError(error, stage));
}

function buildRestoreStressResult(seedResult, errors = []) {
  const finalState = getStateSnapshot();
  const restoreStartTime = metrics.restoreStartTime;
  const restoreEndTime = metrics.restoreEndTime;
  const durationMs =
    Number.isFinite(restoreStartTime) && Number.isFinite(restoreEndTime)
      ? restoreEndTime - restoreStartTime
      : null;

  return {
    runId: seedResult?.runId ?? restoreStressRunId,
    requestedWindowCount: seedResult?.requestedWindowCount ?? Number(restoreStressWindowCountEnv),
    effectiveWindowCount: seedResult?.effectiveWindowCount ?? null,
    skippedBecauseUnavailable: seedResult?.skippedBecauseUnavailable ?? null,
    durationMs,
    restoreStartTime,
    restoreEndTime,
    lastRestoreWindowCount: metrics.lastRestoreWindowCount,
    broadcastCount: metrics.broadcastCount,
    broadcastPayloadSize: metrics.broadcastPayloadSize,
    windowsOpened: metrics.windowsOpened,
    windowsClosed: metrics.windowsClosed,
    finalOpenWindowCount: finalState.windows.filter((windowState) => windowState.open).length,
    userDataDir: app.getPath("userData"),
    layoutPath,
    errors: errors.length > 0 ? errors : null
  };
}

function maybeReportRestoreStressResult(seedResult, errors = []) {
  if (!isRestoreStressHarnessEnabled()) {
    return;
  }

  const result = buildRestoreStressResult(seedResult, errors);
  console.log("[desktop-shell] Restore stress complete", result);

  if (process.env.SCALPSTATION_RESTORE_STRESS_AUTO_EXIT === "1") {
    setTimeout(() => {
      app.quit();
    }, 250);
  }
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
      preload: preloadPath,
      spellcheck: false
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
      preload: preloadPath,
      spellcheck: false
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
  alertMonitorTransportState = { lastFrameSeq: null, awaitingSnapshot: false };
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

function isAlertUnifiedSignal(signal) {
  return (
    signal &&
    typeof signal === "object" &&
    (signal.source === "alert" || signal.rawRef?.collection === "alerts")
  );
}

function normalizeUnifiedSignalBias(value) {
  return value === "LONG" || value === "SHORT" || value === "NEUTRAL" ? value : "NEUTRAL";
}

function normalizeUnifiedSignalSeverity(value) {
  return value === "critical" || value === "high" || value === "info" ? value : "info";
}

function mapUnifiedSignalToBackgroundAlert(signal) {
  return {
    id:
      typeof signal.rawRef?.id === "string" && signal.rawRef.id.trim()
        ? signal.rawRef.id
        : signal.id,
    symbol: typeof signal.symbol === "string" ? signal.symbol : "",
    bias: normalizeUnifiedSignalBias(signal.bias),
    reason:
      (typeof signal.reason === "string" && signal.reason) ||
      (typeof signal.description === "string" && signal.description) ||
      (typeof signal.title === "string" && signal.title) ||
      "",
    severity: normalizeUnifiedSignalSeverity(signal.severity),
    notionalUsd: Number.isFinite(signal.notionalUsd) ? signal.notionalUsd : 0,
    kind: typeof signal.kind === "string" ? signal.kind : undefined,
    createdAt: signal.createdAt
  };
}

function getBackgroundAlertSource(frame) {
  const unifiedAlerts = Array.isArray(frame?.unifiedSignals)
    ? frame.unifiedSignals
        .filter(isAlertUnifiedSignal)
        .map(mapUnifiedSignalToBackgroundAlert)
        .filter((alert) => typeof alert.id === "string" && alert.id.trim())
    : [];

  if (unifiedAlerts.length > 0) {
    return unifiedAlerts;
  }

  return Array.isArray(frame?.alerts) ? frame.alerts : [];
}

function collectFreshBackgroundAlerts(frame) {
  const alerts = getBackgroundAlertSource(frame);

  if (!Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  let freshAlerts;

  if (!alertMonitorPrimedHistory) {
    const now = Date.now();
    freshAlerts = alerts
      .filter(
        (alert) =>
          Number.isFinite(alert?.createdAt) &&
          alert.createdAt <= now + 5_000 &&
          now - alert.createdAt <= initialAlertReplayWindowMs
      )
      .slice(0, initialAlertReplayLimit);
    alertMonitorSeenAlertIds = new Set(alerts.map((alert) => alert.id));
    alertMonitorPrimedHistory = true;
  } else {
    freshAlerts = alerts.filter((alert) => !alertMonitorSeenAlertIds.has(alert.id));
  }

  for (const alert of alerts) {
    alertMonitorSeenAlertIds.add(alert.id);
  }

  if (alertMonitorSeenAlertIds.size > 400) {
    alertMonitorSeenAlertIds = new Set(alerts.map((alert) => alert.id));
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

function normalizeAlertMonitorSeq(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function buildAlertMonitorSnapshotRequest(reason, details = {}) {
  const payload = {
    reason
  };

  if (alertMonitorTransportState.lastFrameSeq !== null) {
    payload.lastSeenSeq = alertMonitorTransportState.lastFrameSeq;
  }

  if (details.expectedBaseSeq !== undefined) {
    payload.expectedBaseSeq = details.expectedBaseSeq;
  }

  if (details.receivedFrameSeq !== undefined) {
    payload.receivedFrameSeq = details.receivedFrameSeq;
  }

  return {
    type: "request_snapshot",
    payload
  };
}

function requestAlertMonitorResync(reason, details = {}) {
  alertMonitorTransportState = {
    ...alertMonitorTransportState,
    awaitingSnapshot: true
  };

  return buildAlertMonitorSnapshotRequest(reason, details);
}

function applyAlertMonitorFrameMessage(message) {
  if (message.type === "snapshot") {
    alertMonitorTransportState = {
      lastFrameSeq: normalizeAlertMonitorSeq(message.frameSeq),
      awaitingSnapshot: false
    };
    alertMonitorFrame = message.frame;

    return {
      frame: alertMonitorFrame,
      requestSnapshot: null,
      applied: true
    };
  }

  if (message.type === "frame_patch") {
    const frameSeq = normalizeAlertMonitorSeq(message.frameSeq);
    const baseSeq = normalizeAlertMonitorSeq(message.baseSeq);

    if (frameSeq === null || baseSeq === null) {
      alertMonitorFrame = alertMonitorFrame
        ? { ...alertMonitorFrame, ...message.changed }
        : message.changed;

      return {
        frame: alertMonitorFrame,
        requestSnapshot: null,
        applied: true
      };
    }

    if (alertMonitorTransportState.awaitingSnapshot) {
      return {
        frame: null,
        requestSnapshot: null,
        applied: false
      };
    }

    if (!alertMonitorFrame || alertMonitorTransportState.lastFrameSeq === null) {
      return {
        frame: null,
        requestSnapshot: requestAlertMonitorResync("missing_frame_state", {
          expectedBaseSeq: baseSeq,
          receivedFrameSeq: frameSeq
        }),
        applied: false
      };
    }

    if (frameSeq <= alertMonitorTransportState.lastFrameSeq) {
      return {
        frame: null,
        requestSnapshot: requestAlertMonitorResync("non_monotonic_seq", {
          expectedBaseSeq: alertMonitorTransportState.lastFrameSeq,
          receivedFrameSeq: frameSeq
        }),
        applied: false
      };
    }

    if (baseSeq !== alertMonitorTransportState.lastFrameSeq) {
      return {
        frame: null,
        requestSnapshot: requestAlertMonitorResync("gap_detected", {
          expectedBaseSeq: baseSeq,
          receivedFrameSeq: frameSeq
        }),
        applied: false
      };
    }

    alertMonitorFrame = {
      ...alertMonitorFrame,
      ...message.changed
    };
    alertMonitorTransportState = {
      lastFrameSeq: frameSeq,
      awaitingSnapshot: false
    };

    return {
      frame: alertMonitorFrame,
      requestSnapshot: null,
      applied: true
    };
  }

  if (message.type === "frame") {
    alertMonitorTransportState = { lastFrameSeq: null, awaitingSnapshot: false };
    alertMonitorFrame = message;

    return {
      frame: alertMonitorFrame,
      requestSnapshot: null,
      applied: true
    };
  }

  return {
    frame: null,
    requestSnapshot: null,
    applied: false
  };
}

function handleAlertMonitorMessage(rawData) {
  try {
    const message = JSON.parse(normalizeSocketMessage(rawData));
    const frameUpdate = applyAlertMonitorFrameMessage(message);

    if (frameUpdate.requestSnapshot && alertMonitorSocket?.readyState === WebSocket.OPEN) {
      alertMonitorSocket.send(JSON.stringify(frameUpdate.requestSnapshot));
    }

    if (!frameUpdate.applied || !frameUpdate.frame) {
      return;
    }

    const frame = frameUpdate.frame;
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

    alertMonitorTransportState = { lastFrameSeq: null, awaitingSnapshot: false };
    socket.send(JSON.stringify({ type: "hello" }));
    socket.send(
      JSON.stringify({
        type: "visible_sections",
        sections: ["alerts", "volumeMilestones", "volumeThresholdMilestones"]
      })
    );
    socket.send(
      JSON.stringify(buildAlertMonitorSnapshotRequest("initial_connect"))
    );
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
  appendDesktopBackendLog("info", "Starting bundled backend", {
    backendBundlePath,
    backendBetterSqliteBindingPath,
    backendWsUrl,
    dataDir: process.env.SCALPSTATION_DATA_DIR,
    sqlitePath: process.env.SCALPSTATION_SQLITE_PATH
  });

  if (!fs.existsSync(backendBundlePath)) {
    throw new Error(`Bundled backend entry is missing: ${backendBundlePath}`);
  }

  if (!fs.existsSync(backendBetterSqliteBindingPath)) {
    throw new Error(
      `better-sqlite3 native binding is missing from packaged backend: ${backendBetterSqliteBindingPath}`
    );
  }

  const bundledBackend = require(backendBundlePath);

  if (
    !bundledBackend ||
    typeof bundledBackend.startScalpStationBackend !== "function" ||
    typeof bundledBackend.stopScalpStationBackend !== "function"
  ) {
    throw new Error("Bundled backend exports are missing.");
  }

  backendLifecycle = bundledBackend;
  try {
    await bundledBackend.startScalpStationBackend();
    appendDesktopBackendLog("info", `Bundled backend started: ${backendWsUrl}`);
  } catch (error) {
    appendDesktopBackendLog("error", `${appName} backend failed to start`, error);
    throw error;
  }
}

function registerIpcHandlers() {
  ipcMain.handle("desktop-shell:get-state", () => getStateSnapshot());
  ipcMain.handle("desktop-shell:get-metrics", () => metrics);
  ipcMain.handle("desktop-shell:run-stress-test", (_event, options) => runStressTest(options ?? {}));
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
  ipcMain.handle("desktop-shell:list-workspaces", () => listWorkspaces());
  ipcMain.handle("desktop-shell:open-workspace", (_event, id, mode) =>
    openWorkspace(id, mode)
  );
  ipcMain.handle("desktop-shell:list-layouts", () => listSavedLayouts());
  ipcMain.handle("desktop-shell:save-current-layout", (_event, name) => saveCurrentLayout(name));
  ipcMain.handle("desktop-shell:load-layout", (_event, name) => loadSavedLayout(name));
  ipcMain.handle("desktop-shell:delete-layout", (_event, name) => deleteSavedLayout(name));
  ipcMain.handle("desktop-shell:export-layout", (_event, name) => exportSavedLayout(name));
  ipcMain.handle("desktop-shell:import-layout", (_event, payload) => importSavedLayout(payload));
  ipcMain.handle("desktop-shell:list-displays", () => listDisplays());
  ipcMain.handle("desktop-shell:list-monitor-profiles", () => listMonitorProfiles());
  ipcMain.handle("desktop-shell:save-monitor-profile", (_event, profile) =>
    saveMonitorProfile(profile ?? {})
  );
  ipcMain.handle("desktop-shell:apply-monitor-profile", (_event, profileId) =>
    applyMonitorProfile(profileId)
  );
  ipcMain.handle("desktop-shell:list-groups", () => listWindowGroups());
  ipcMain.handle("desktop-shell:create-group", (_event, payload) => {
    createWindowGroup(payload ?? {});
    return broadcastState();
  });
  ipcMain.handle("desktop-shell:update-group-symbol", (_event, groupId, symbol) => {
    updateWindowGroupSymbol(groupId, symbol);
    return broadcastState();
  });
  ipcMain.handle("desktop-shell:assign-window-to-group", (_event, key, groupId) => {
    assignWindowToGroup(key, groupId);
    return broadcastState();
  });
  ipcMain.handle("desktop-shell:unassign-window-from-group", (_event, key) => {
    unassignWindowFromGroup(key);
    return broadcastState();
  });
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
  clearScheduledBroadcastState();
  syncManagedWindowsIntoLayoutState();
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
  let restoreStressSeed = null;
  restoreStressHarnessErrors = [];

  if (isRestoreStressHarnessEnabled()) {
    try {
      restoreStressSeed = seedRestoreStressLayout();
    } catch (error) {
      recordRestoreStressHarnessError(error, "restore-stress-seed");
      console.error("[desktop-shell] Restore stress seed failed", error);
    }
  }

  layoutState = loadLayoutState();
  windowGroupsRegistry = loadWindowGroupsRegistry();
  createTray();
  refreshApplicationChrome();
  registerIpcHandlers();
  await startFrontendServer();
  try {
    await startBackendRuntime();
  } catch (error) {
    recordRestoreStressHarnessError(error, "backend-startup");
    console.error(`${appName} backend startup failed; see ${desktopBackendLogPath}`, error);
  }
  connectAlertMonitor();
  await openInitialShellWindow();
  if (!didBroadcastAfterManagedWindowRestore) {
    broadcastState();
  }
  maybeReportRestoreStressResult(restoreStressSeed, restoreStressHarnessErrors);
});

app.on("window-all-closed", () => {
  // Keep the desktop runtime alive in the tray so background alerts still work.
});

app.on("before-quit", () => {
  runtimeStopping = true;
  clearScheduledBroadcastState();
  clearScheduledLayoutStateSave();
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
  void showControlCenter();
});
