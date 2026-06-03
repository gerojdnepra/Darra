"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SignalBillboardOverlay } from "@/components/signal-billboard-overlay";
import { createGuestSession } from "@/lib/cabinet";
import {
  getDesktopBridge,
  type DesktopDisplaySnapshot,
  type DesktopManagedWindowKey,
  type DesktopShellState,
  type DesktopWindowSnapshot
} from "@/lib/desktop-shell";
import {
  loadCabinetProfileRecord,
  loadCabinetSession,
  loadPersistedState,
  saveCabinetProfileRecord,
  savePersistedState
} from "@/lib/indexed-db";
import {
  defaultInterfaceLanguage,
  interfaceLanguageOptions,
  normalizeInterfaceLanguage
} from "@/lib/interface-language";
import { desktopModuleSections, getDesktopModuleLabel } from "@/lib/module-sections";
import {
  createRuntimeSyncSourceId,
  runtimeSyncChannelName,
  type RuntimeSyncPayload
} from "@/lib/runtime-sync";
import {
  computeSignalBillboardFrameHeightPx,
  signalBillboardBottomSizeRange,
  signalBillboardFrameHeightRange,
  signalBillboardOpacityRange,
  signalBillboardTopSizeRange
} from "@/lib/signal-billboard";
import {
  defaultSignalSoundId,
  playSignalSound,
  signalSoundPresets
} from "@/lib/signal-sounds";
import type {
  CabinetProfile,
  CabinetSession,
  InterfaceLanguage,
  PersistedState,
  ScreenerFrame,
  ServerMessage,
  SignalSoundId,
  SpeechProviderId,
  VoiceProfileId
} from "@/lib/types";
import {
  getVoiceProfilePreset,
  normalizeVoiceProfileId,
  voiceProfilePresets
} from "@/lib/voice-profiles";
import {
  loadTtsModels,
  normalizeSpeechProviderId,
  pickTtsModel,
  requestTtsAudio,
  toEdgePitch,
  toEdgeRate,
  type TtsModelSummary
} from "@/lib/tts";
import { getPersistableState, useScreenerStore } from "@/store/use-screener-store";

const voiceProfileTranslations: Record<
  InterfaceLanguage,
  Record<VoiceProfileId, { label: string; badgeLabel: string; detail: string }>
> = {
  en: {
    default: {
      label: "System",
      badgeLabel: "system",
      detail: "Default browser voice"
    },
    russian: {
      label: "Russian",
      badgeLabel: "ru",
      detail: "Prefer natural ru-RU voices available on this device"
    },
    analyst: {
      label: "Satoshi",
      badgeLabel: "satoshi",
      detail: "Bitcoin-creator style preset with calm, lower delivery"
    },
    builder: {
      label: "Vitalik",
      badgeLabel: "vitalik",
      detail: "Builder style preset with lighter, faster tempo"
    },
    announcer: {
      label: "Trump",
      badgeLabel: "trump",
      detail: "Emphatic announcement preset for major signals"
    },
    engineer: {
      label: "Elon",
      badgeLabel: "elon",
      detail: "Lower-pitch founder preset with measured pacing"
    }
  },
  ru: {
    default: {
      label: "Системный",
      badgeLabel: "сист",
      detail: "Стандартный голос браузера"
    },
    russian: {
      label: "Русский",
      badgeLabel: "рус",
      detail: "Приоритет естественным ru-RU голосам, доступным на этом устройстве"
    },
    analyst: {
      label: "Сатоши",
      badgeLabel: "сатоши",
      detail: "Спокойный, более низкий пресет в духе создателя Bitcoin"
    },
    builder: {
      label: "Виталик",
      badgeLabel: "виталик",
      detail: "Более лёгкий и быстрый пресет для режима builder"
    },
    announcer: {
      label: "Трамп",
      badgeLabel: "трамп",
      detail: "Акцентированный пресет для крупных сигналов"
    },
    engineer: {
      label: "Илон",
      badgeLabel: "илон",
      detail: "Более низкий голос с размеренной подачей"
    }
  }
};

const signalSoundTranslations: Record<
  InterfaceLanguage,
  Record<SignalSoundId, { label: string; detail: string }>
> = {
  en: {
    "classic-chime": {
      label: "Classic Chime",
      detail: "Bright three-note confirmation"
    },
    "radar-ping": {
      label: "Radar Ping",
      detail: "Focused dual ping for fast scans"
    },
    "market-sweep": {
      label: "Market Sweep",
      detail: "Softer rising sweep for momentum shifts"
    }
  },
  ru: {
    "classic-chime": {
      label: "Классический звон",
      detail: "Яркое подтверждение из трёх нот"
    },
    "radar-ping": {
      label: "Радарный пинг",
      detail: "Сфокусированный двойной пинг для быстрых сканов"
    },
    "market-sweep": {
      label: "Рыночный свип",
      detail: "Более мягкий восходящий свип для смены импульса"
    }
  }
};

const controlCenterCopy = {
  en: {
    fallbackEyebrow: "Desktop Control",
    fallbackTitle: "Open this page inside Scalp Station Desktop",
    fallbackDescription:
      "The control center works only inside the Windows desktop shell. It manages module windows, sound, signal animation, Binance status and live desktop layout.",
    heroEyebrow: "Scalp Station Desktop",
    heroTitle: "Windows control center",
    heroDescription:
      "Open separate module windows, spread them across monitors, pin them above other apps and tune desktop signal behavior live. Window positions are saved automatically and are restored on the next launch.",
    interfaceLanguage: "Interface language",
    resetLayout: "Reset layout",
    desktopActionFailed: "Desktop action failed.",
    positionOnFirstOpen: "Position will be set on first open",
    anyScreen: "Any screen",
    unknownScreen: "Unknown screen",
    openAt: "at",
    statusLive: "live",
    statusDisconnected: "disconnected",
    statusSessionOverride: "session override",
    statusServerEnv: "server env",
    statusNotConnected: "not connected",
    statusRiskOn: "Risk On",
    statusRiskOff: "Risk Off",
    statusBalanced: "Balanced",
    statusWaiting: "Waiting",
    statusBooting: "booting",
    statusDisabled: "disabled",
    statusPending: "pending",
    statusConnecting: "connecting",
    statusOpen: "open",
    statusClosed: "closed",
    runtimeGuest: "guest",
    runtimeAuthenticated: "authenticated",
    summaryScreens: "Desktop screens",
    summaryFrontend: "Local frontend",
    summaryBackend: "Bundled backend",
    summaryMood: "Market mood",
    summaryBinance: "Binance stream",
    loadingScreens: "Loading screens",
    frontendDetail: "Served from the bundled desktop runtime",
    backendDetail: "Desktop shell launches the local websocket feed automatically",
    pulseLabel: "Pulse",
    waitingSnapshot: "Waiting for snapshot",
    signalEyebrow: "Signal Settings",
    signalTitle: "Animation, sound and voice",
    signalDescription:
      "These controls sync with the dashboard windows and the module pages that already use desktop sound settings.",
    masterSoundLabel: "Master sound",
    masterSoundDetail: "Enable or disable all voice, chime and notification audio.",
    animationLabel: "Signal animation",
    animationDetail: "Animated signal banner when fresh opportunities hit the feed.",
    animationPreviewTitle: "Animation preview",
    animationPreviewDetail: "Quick test for the signal flyover without waiting for a live alert.",
    preview: "Preview",
    previewReady: "Preview ready",
    overlayBandsTitle: "Overlay bands",
    overlayBandsDetail:
      "Separate size and transparency for the top and bottom AIMP-style bars.",
    overlayHeightCompact: "height",
    overlayTopCompact: "top",
    overlayBottomCompact: "bottom",
    overlayHeight: "Overlay height",
    overlayTopBandSize: "Top band size",
    overlayBottomBandSize: "Bottom band size",
    overlayTopOpacity: "Top opacity",
    overlayBottomOpacity: "Bottom opacity",
    voiceProfileTitle: "Voice profile",
    currentLabel: "Current",
    edgeNeural: "Edge Neural",
    systemVoice: "System voice",
    loadingModel: "Loading model",
    autoMatch: "Auto match",
    neuralModel: "Neural model",
    loadingModels: "Loading models...",
    autoBestMatch: "Auto / best match",
    backendModelListLoading: "Backend neural model list is still loading.",
    previewVoice: "Preview voice",
    signalSoundTitle: "Signal sound",
    currentPreset: "Current preset",
    signalSoundDetail: "Separate chime control for alerts while voice remains enabled.",
    signalChimeLabel: "Signal chime",
    signalChimeDetail: "Play the selected chime before the spoken signal callout.",
    stateActive: "active",
    stateReady: "ready",
    marketEyebrow: "Market / Binance",
    marketTitle: "Live desktop status",
    marketDescription:
      "Read-only market snapshot plus quick Binance session connect from the control center.",
    statLatency: "Latency",
    statMarketPulse: "Market pulse",
    statOpenPositions: "Open positions",
    accountKeyPrefix: "key",
    apiKeyLabel: "Binance API Key",
    apiKeyPlaceholder: "Paste read-only futures key",
    apiSecretLabel: "Binance API Secret",
    apiSecretPlaceholder: "Paste matching secret",
    envCredentialsNotice:
      "`.env` credentials are active right now. Keys entered here override them only for the current backend session.",
    connectingBinance: "Connecting...",
    updateSessionKeys: "Update Session Keys",
    connectBinance: "Connect Binance",
    disconnectingBinance: "Disconnecting...",
    disconnectSession: "Disconnect Session",
    backendNotConnected: "Connection is not ready yet.",
    couldNotOpenBackendWebsocket: "Could not open backend websocket.",
    enterBinanceCredentials: "Enter Binance API key and secret.",
    accountStatusFallback: "Connect Binance to see positions and stream health.",
    windowsDashboardTitle: "Dashboard",
    windowsDashboardDetail: "Full board with all cards in one window.",
    windowsModuleDetail:
      "Separate module window with its own position, transparency and pin state.",
    windowsRoute: "Route",
    windowsOpen: "open",
    windowsClosed: "closed",
    windowsReopen: "Reopen",
    windowsOpenButton: "Open",
    windowsFocus: "Focus",
    windowsClose: "Close",
    windowsScreen: "Screen",
    windowsBounds: "Bounds",
    windowsPinned: "Pinned above apps",
    windowsEnabled: "Enabled",
    windowsDisabled: "Disabled",
    windowsOpacity: "Opacity",
    windowsTargetScreen: "Target screen",
    windowsAutoCurrentScreen: "Auto / current screen",
    windowsAlwaysOnTop: "Always on top",
    modelMultilingual: "multilingual",
    couldNotLoadTtsModels: "Could not load TTS models."
  },
  ru: {
    fallbackEyebrow: "Управление десктопом",
    fallbackTitle: "Откройте эту страницу в Scalp Station Desktop",
    fallbackDescription:
      "Центр управления работает только внутри Windows-оболочки. Здесь управляются окна модулей, звук, анимация сигналов, статус Binance и живая раскладка десктопа.",
    heroEyebrow: "Scalp Station Desktop",
    heroTitle: "Центр управления Windows",
    heroDescription:
      "Открывайте отдельные окна модулей, раскладывайте их по мониторам, закрепляйте поверх других приложений и настраивайте поведение десктопных сигналов в реальном времени. Позиции окон сохраняются автоматически и восстанавливаются при следующем запуске.",
    interfaceLanguage: "Язык интерфейса",
    resetLayout: "Сбросить раскладку",
    desktopActionFailed: "Не удалось выполнить действие в десктопе.",
    positionOnFirstOpen: "Позиция будет задана при первом открытии",
    anyScreen: "Любой экран",
    unknownScreen: "Неизвестный экран",
    openAt: "в",
    statusLive: "в сети",
    statusDisconnected: "отключён",
    statusSessionOverride: "ключи сеанса",
    statusServerEnv: "переменные сервера",
    statusNotConnected: "не подключено",
    statusRiskOn: "Risk On",
    statusRiskOff: "Risk Off",
    statusBalanced: "Баланс",
    statusWaiting: "Ожидание",
    statusBooting: "запуск",
    statusDisabled: "выключен",
    statusPending: "ожидание",
    statusConnecting: "подключение",
    statusOpen: "открыто",
    statusClosed: "закрыто",
    runtimeGuest: "гость",
    runtimeAuthenticated: "авторизован",
    summaryScreens: "Экраны десктопа",
    summaryFrontend: "Локальный frontend",
    summaryBackend: "Встроенный backend",
    summaryMood: "Режим рынка",
    summaryBinance: "Поток Binance",
    loadingScreens: "Загрузка экранов",
    frontendDetail: "Раздаётся из встроенного desktop runtime",
    backendDetail: "Desktop shell автоматически поднимает локальный websocket feed",
    pulseLabel: "Пульс",
    waitingSnapshot: "Ожидание снимка",
    signalEyebrow: "Настройки сигналов",
    signalTitle: "Анимация, звук и голос",
    signalDescription:
      "Эти настройки синхронизируются с окнами дашборда и страницами модулей, которые уже используют desktop sound settings.",
    masterSoundLabel: "Главный звук",
    masterSoundDetail: "Включает или отключает весь голос, chime и звук уведомлений.",
    animationLabel: "Анимация сигнала",
    animationDetail: "Анимированный баннер сигнала, когда в ленту приходит новая возможность.",
    animationPreviewTitle: "Предпросмотр анимации",
    animationPreviewDetail: "Быстрый тест пролёта сигнала без ожидания живого алерта.",
    preview: "Проверить",
    previewReady: "Предпросмотр готов",
    overlayBandsTitle: "Полосы overlay",
    overlayBandsDetail:
      "Отдельные размер и прозрачность для верхней и нижней полосы в стиле AIMP.",
    overlayHeightCompact: "высота",
    overlayTopCompact: "верх",
    overlayBottomCompact: "низ",
    overlayHeight: "Высота overlay",
    overlayTopBandSize: "Размер верхней полосы",
    overlayBottomBandSize: "Размер нижней полосы",
    overlayTopOpacity: "Прозрачность сверху",
    overlayBottomOpacity: "Прозрачность снизу",
    voiceProfileTitle: "Голосовой профиль",
    currentLabel: "Текущий",
    edgeNeural: "Edge Neural",
    systemVoice: "Системный голос",
    loadingModel: "Загрузка модели",
    autoMatch: "Автоподбор",
    neuralModel: "Neural-модель",
    loadingModels: "Загрузка моделей...",
    autoBestMatch: "Авто / лучший вариант",
    backendModelListLoading: "Список backend neural-моделей ещё загружается.",
    previewVoice: "Проверить голос",
    signalSoundTitle: "Звук сигнала",
    currentPreset: "Текущий пресет",
    signalSoundDetail: "Отдельное управление chime для алертов, пока голос остаётся включён.",
    signalChimeLabel: "Сигнальный chime",
    signalChimeDetail: "Проигрывать выбранный chime перед озвучкой сигнала.",
    stateActive: "активен",
    stateReady: "готов",
    marketEyebrow: "Рынок / Binance",
    marketTitle: "Живой статус десктопа",
    marketDescription:
      "Снимок рынка только для чтения плюс быстрое подключение сеанса Binance прямо из центра управления.",
    statLatency: "Задержка",
    statMarketPulse: "Пульс рынка",
    statOpenPositions: "Открытые позиции",
    accountKeyPrefix: "ключ",
    apiKeyLabel: "Binance API Key",
    apiKeyPlaceholder: "Вставьте read-only futures key",
    apiSecretLabel: "Binance API Secret",
    apiSecretPlaceholder: "Вставьте соответствующий secret",
    envCredentialsNotice:
      "Сейчас активны креды из `.env`. Ключи, введённые здесь, переопределяют их только для текущего backend-сеанса.",
    connectingBinance: "Подключение...",
    updateSessionKeys: "Обновить ключи сеанса",
    connectBinance: "Подключить Binance",
    disconnectingBinance: "Отключение...",
    disconnectSession: "Отключить сеанс",
    backendNotConnected: "Подключение ещё не готово.",
    couldNotOpenBackendWebsocket: "Не удалось открыть backend websocket.",
    enterBinanceCredentials: "Введите Binance API key и secret.",
    accountStatusFallback: "Подключите Binance, чтобы видеть позиции и состояние потока.",
    windowsDashboardTitle: "Дашборд",
    windowsDashboardDetail: "Полная доска со всеми карточками в одном окне.",
    windowsModuleDetail:
      "Отдельное окно модуля со своей позицией, прозрачностью и закреплением поверх окон.",
    windowsRoute: "Маршрут",
    windowsOpen: "открыто",
    windowsClosed: "закрыто",
    windowsReopen: "Открыть заново",
    windowsOpenButton: "Открыть",
    windowsFocus: "Фокус",
    windowsClose: "Закрыть",
    windowsScreen: "Экран",
    windowsBounds: "Границы",
    windowsPinned: "Поверх приложений",
    windowsEnabled: "Включено",
    windowsDisabled: "Выключено",
    windowsOpacity: "Прозрачность",
    windowsTargetScreen: "Целевой экран",
    windowsAutoCurrentScreen: "Авто / текущий экран",
    windowsAlwaysOnTop: "Всегда поверх",
    modelMultilingual: "мультиязык",
    couldNotLoadTtsModels: "Не удалось загрузить TTS-модели."
  }
} as const;

const getVoiceProfileMeta = (
  voiceProfileId: VoiceProfileId,
  interfaceLanguage: InterfaceLanguage
) => voiceProfileTranslations[interfaceLanguage][voiceProfileId];

const getSignalSoundMeta = (
  signalSoundId: SignalSoundId,
  interfaceLanguage: InterfaceLanguage
) => signalSoundTranslations[interfaceLanguage][signalSoundId];

const speechQualityBoostHints = [
  "natural",
  "neural",
  "neural2",
  "online",
  "premium",
  "enhanced",
  "studio",
  "wavenet",
  "google",
  "microsoft",
  "desktop",
  "samsung"
];

const speechQualityPenaltyHints = [
  "espeak",
  "pico",
  "festival",
  "speech dispatcher",
  "robot",
  "compact"
];

const formatBounds = (
  bounds: DesktopWindowSnapshot["bounds"],
  interfaceLanguage: InterfaceLanguage
): string => {
  const text = controlCenterCopy[interfaceLanguage];

  if (!bounds) {
    return text.positionOnFirstOpen;
  }

  return `${bounds.width}x${bounds.height} ${text.openAt} ${bounds.x}, ${bounds.y}`;
};

const formatDisplayLabel = (
  displayId: number | null,
  displays: DesktopDisplaySnapshot[],
  interfaceLanguage: InterfaceLanguage
): string => {
  const text = controlCenterCopy[interfaceLanguage];

  if (displayId === null) {
    return text.anyScreen;
  }

  return displays.find((display) => display.id === displayId)?.label ?? text.unknownScreen;
};

const getErrorMessage = (
  error: unknown,
  interfaceLanguage: InterfaceLanguage
): string =>
  error instanceof Error ? error.message : controlCenterCopy[interfaceLanguage].desktopActionFailed;

const marketMoodLabel = (
  regime: ScreenerFrame["overview"]["dominantRegime"] | null | undefined,
  interfaceLanguage: InterfaceLanguage
): string => {
  const text = controlCenterCopy[interfaceLanguage];

  if (regime === "risk-on") {
    return text.statusRiskOn;
  }

  if (regime === "risk-off") {
    return text.statusRiskOff;
  }

  if (regime === "balanced") {
    return text.statusBalanced;
  }

  return text.statusWaiting;
};

const connectionStateLabel = (
  connectionState: "connecting" | "open" | "closed",
  interfaceLanguage: InterfaceLanguage
): string => {
  const text = controlCenterCopy[interfaceLanguage];

  if (connectionState === "open") {
    return text.statusOpen;
  }

  if (connectionState === "closed") {
    return text.statusClosed;
  }

  return text.statusConnecting;
};

const localizeModelGender = (
  value: string,
  interfaceLanguage: InterfaceLanguage
): string => {
  if (interfaceLanguage !== "ru") {
    return value;
  }

  if (value === "Male") {
    return "Мужской";
  }

  if (value === "Female") {
    return "Женский";
  }

  return value;
};

const marketMoodClasses = (
  regime: ScreenerFrame["overview"]["dominantRegime"] | null | undefined
): string => {
  if (regime === "risk-on") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (regime === "risk-off") {
    return "border-rose-400/25 bg-rose-500/10 text-rose-100";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const getLanguagePrefix = (lang: string): string =>
  lang.trim().toLowerCase().split(/[-_]/)[0] ?? "";

const normalizeVoiceMatchText = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .trim();

const getSpeechVoiceId = (voice: SpeechSynthesisVoice): string => voice.voiceURI || voice.name;

const isVoiceCompatibleWithLanguage = (
  voice: SpeechSynthesisVoice,
  targetLanguage: string
): boolean => getLanguagePrefix(voice.lang) === getLanguagePrefix(targetLanguage);

const scoreSpeechVoice = (
  voice: SpeechSynthesisVoice,
  targetVoiceProfileId: VoiceProfileId
): number => {
  const preset = getVoiceProfilePreset(targetVoiceProfileId);
  const name = normalizeVoiceMatchText(`${voice.name} ${voice.voiceURI}`);
  const lang = normalizeVoiceMatchText(voice.lang);
  const targetLang = normalizeVoiceMatchText(preset.lang);
  const targetLanguagePrefix = getLanguagePrefix(targetLang);
  let score = 0;

  if (lang === targetLang) {
    score += 14;
  } else if (getLanguagePrefix(lang) === targetLanguagePrefix) {
    score += 10;
  } else if (targetLanguagePrefix !== "en" && lang.startsWith("en")) {
    score += 2;
  }

  if (voice.default) {
    score += 1;
  }

  if (voice.localService) {
    score += 3;
  } else {
    score -= 1;
  }

  for (const hint of preset.preferredNames) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score += 5;
    }
  }

  for (const hint of preset.avoidedNames ?? []) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score -= 4;
    }
  }

  for (const hint of speechQualityBoostHints) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score += 3;
    }
  }

  for (const hint of speechQualityPenaltyHints) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score -= 6;
    }
  }

  return score;
};

const pickSpeechVoice = (
  voices: SpeechSynthesisVoice[],
  voiceProfileId: VoiceProfileId,
  preferredVoiceUri: string | null = null
): SpeechSynthesisVoice | null => {
  const preset = getVoiceProfilePreset(voiceProfileId);
  const targetLanguagePrefix = getLanguagePrefix(preset.lang);
  const matchingLanguageVoices = voices.filter(
    (voice) => getLanguagePrefix(voice.lang) === targetLanguagePrefix
  );
  const candidates = matchingLanguageVoices.length > 0 ? matchingLanguageVoices : voices;

  if (candidates.length === 0) {
    return null;
  }

  if (preferredVoiceUri) {
    const preferredVoice = candidates.find((voice) => getSpeechVoiceId(voice) === preferredVoiceUri);

    if (preferredVoice) {
      return preferredVoice;
    }
  }

  if (voiceProfileId === "default") {
    return candidates.find((voice) => voice.default) ?? candidates[0];
  }

  return [...candidates].sort(
    (left, right) =>
      scoreSpeechVoice(right, voiceProfileId) - scoreSpeechVoice(left, voiceProfileId)
  )[0];
};

export function DesktopControlCenter() {
  const bridge = getDesktopBridge();
  const {
    backendWsUrl,
    uiPreferences,
    hydratePersistedState,
    setBackendWsUrl,
    setInterfaceLanguage,
    setSoundEnabled,
    setSignalAnimationEnabled,
    setSignalSoundEnabled,
    setSignalBillboardPreference,
    setSelectedSignalSoundId,
    setVoiceProfile,
    setSpeechProvider,
    setSelectedSpeechVoiceUri,
    setSelectedTtsModelId
  } = useScreenerStore();
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [runtimeSession, setRuntimeSession] = useState<CabinetSession>(createGuestSession());
  const [activeProfile, setActiveProfile] = useState<CabinetProfile | null>(null);
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [availableTtsModels, setAvailableTtsModels] = useState<TtsModelSummary[]>([]);
  const [ttsModelsLoading, setTtsModelsLoading] = useState(false);
  const [ttsModelsError, setTtsModelsError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<ScreenerFrame | null>(null);
  const [binanceApiKeyDraft, setBinanceApiKeyDraft] = useState("");
  const [binanceApiSecretDraft, setBinanceApiSecretDraft] = useState("");
  const [accountActionPending, setAccountActionPending] = useState<"connect" | "disconnect" | null>(
    null
  );
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [animationPreviewVisible, setAnimationPreviewVisible] = useState(false);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const skipNextPersistenceSyncRef = useRef(false);
  const syncSourceIdRef = useRef("");
  const preferLocalInterfaceLanguageRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const animationPreviewTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const backendWsUrlRef = useRef(backendWsUrl);
  const interfaceLanguageRef = useRef<InterfaceLanguage>(
    normalizeInterfaceLanguage(uiPreferences.interfaceLanguage)
  );
  const speechProviderRef = useRef<SpeechProviderId>(
    normalizeSpeechProviderId(uiPreferences.speechProvider)
  );
  const selectedTtsModelIdRef = useRef<string | null>(uiPreferences.selectedTtsModelId ?? null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);

  const interfaceLanguage = normalizeInterfaceLanguage(
    uiPreferences.interfaceLanguage ?? shellState?.interfaceLanguage ?? defaultInterfaceLanguage
  );
  const text = controlCenterCopy[interfaceLanguage];
  const currentBackendWsUrl = (shellState?.backendWsUrl ?? backendWsUrl).trim();
  const currentVoiceProfileId = normalizeVoiceProfileId(uiPreferences.voiceProfile);
  const currentSpeechProviderId = normalizeSpeechProviderId(uiPreferences.speechProvider);
  const currentVoiceProfile = getVoiceProfilePreset(currentVoiceProfileId);
  const currentVoiceProfileMeta = getVoiceProfileMeta(currentVoiceProfileId, interfaceLanguage);
  const currentSignalSoundId = (uiPreferences.selectedSignalSoundId ??
    defaultSignalSoundId) as SignalSoundId;
  const signalBillboardPreferences = uiPreferences.signalBillboard;
  const currentSignalSoundMeta = getSignalSoundMeta(currentSignalSoundId, interfaceLanguage);
  const selectedSpeechVoiceUri = uiPreferences.selectedSpeechVoiceUri ?? null;
  const selectedTtsModelId = uiPreferences.selectedTtsModelId ?? null;
  const accountStream = frame?.status.accountStream ?? null;
  const accountCredentialSource = accountStream?.credentialSource ?? "none";
  const accountStatusMessage = accountStream?.message ?? text.accountStatusFallback;
  const accountStatusError = accountStream?.error ?? null;
  const accountKeyLabel = accountStream?.keyLabel ?? null;
  const marketMood = frame?.overview.dominantRegime ?? null;
  const marketPulse = frame?.overview.marketPulse ?? null;
  const runtimeModeLabel =
    runtimeSession.mode === "authenticated" ? text.runtimeAuthenticated : text.runtimeGuest;

  if (!syncSourceIdRef.current) {
    syncSourceIdRef.current = createRuntimeSyncSourceId();
  }

  const orderedWindows = useMemo(
    () => [
      {
        key: "dashboard" as const,
        title: text.windowsDashboardTitle,
        detail: text.windowsDashboardDetail
      },
      ...desktopModuleSections.map((section) => ({
        key: section,
        title: getDesktopModuleLabel(section, interfaceLanguage),
        detail: text.windowsModuleDetail
      }))
    ],
    [interfaceLanguage, text.windowsDashboardDetail, text.windowsDashboardTitle, text.windowsModuleDetail]
  );

  const windowsByKey = useMemo(
    () => new Map((shellState?.windows ?? []).map((windowState) => [windowState.key, windowState])),
    [shellState]
  );

  useEffect(() => {
    backendWsUrlRef.current = backendWsUrl;
  }, [backendWsUrl]);

  useEffect(() => {
    interfaceLanguageRef.current = normalizeInterfaceLanguage(uiPreferences.interfaceLanguage);
  }, [uiPreferences.interfaceLanguage]);

  const voiceCandidates = useMemo(() => {
    const matchingVoices = availableSpeechVoices.filter((voice) =>
      isVoiceCompatibleWithLanguage(voice, currentVoiceProfile.lang)
    );

    return matchingVoices.length > 0 ? matchingVoices : availableSpeechVoices;
  }, [availableSpeechVoices, currentVoiceProfile.lang]);

  const selectedSpeechVoice = useMemo(
    () =>
      availableSpeechVoices.find((voice) => getSpeechVoiceId(voice) === selectedSpeechVoiceUri) ??
      null,
    [availableSpeechVoices, selectedSpeechVoiceUri]
  );
  const visibleTtsModels = useMemo(
    () =>
      availableTtsModels.filter((model) =>
        currentVoiceProfileId === "russian" ? model.multilingual : true
      ),
    [availableTtsModels, currentVoiceProfileId]
  );
  const selectedTtsModel = useMemo(
    () => availableTtsModels.find((model) => model.id === selectedTtsModelId) ?? null,
    [availableTtsModels, selectedTtsModelId]
  );
  const suggestedTtsModel = useMemo(
    () => pickTtsModel(availableTtsModels, currentVoiceProfileId, selectedTtsModelId),
    [availableTtsModels, currentVoiceProfileId, selectedTtsModelId]
  );

  const runAction = async (
    token: string,
    action: () => Promise<DesktopShellState | void>
  ): Promise<void> => {
    if (!bridge) {
      return;
    }

    setBusyToken(token);
    setError(null);

    try {
      const nextState = await action();

      if (nextState) {
        setShellState(nextState);
      }
    } catch (actionError) {
      setError(getErrorMessage(actionError, interfaceLanguage));
    } finally {
      setBusyToken(null);
    }
  };

  const handleInterfaceLanguageSelect = (value: InterfaceLanguage) => {
    preferLocalInterfaceLanguageRef.current = true;
    interfaceLanguageRef.current = value;
    setInterfaceLanguage(value);
  };

  const persistCurrentState = async (
    snapshot: PersistedState = getPersistableState(),
    session: CabinetSession = runtimeSession,
    profile: CabinetProfile | null = activeProfile
  ): Promise<void> => {
    if (session.mode === "authenticated" && profile) {
      await saveCabinetProfileRecord({
        profile: {
          ...profile,
          updatedAt: Date.now()
        },
        state: snapshot
      });
      return;
    }

    await savePersistedState(snapshot);
  };

  const broadcastRuntimeState = (
    snapshot: PersistedState = getPersistableState(),
    session: CabinetSession = runtimeSession,
    profile: CabinetProfile | null = activeProfile
  ): void => {
    syncChannelRef.current?.postMessage({
      type: "state",
      sourceId: syncSourceIdRef.current,
      profile,
      session,
      state: snapshot
    } satisfies RuntimeSyncPayload);
  };

  const syncSpeechVoices = (): SpeechSynthesisVoice[] => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setAvailableSpeechVoices([]);
      return [];
    }

    const seenVoiceIds = new Set<string>();
    const nextVoices = window.speechSynthesis.getVoices().filter((voice) => {
      const voiceId = getSpeechVoiceId(voice);

      if (seenVoiceIds.has(voiceId)) {
        return false;
      }

      seenVoiceIds.add(voiceId);
      return true;
    });

    setAvailableSpeechVoices(nextVoices);
    return nextVoices;
  };

  const stopSystemSpeechSynthesis = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
  };

  const stopEdgePreviewPlayback = () => {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;

    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      previewAudioRef.current = null;
    }

    const audioUrl = previewAudioUrlRef.current;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      previewAudioUrlRef.current = null;
    }
  };

  const resolvePreferredTtsModelId = (
    voiceProfileId: VoiceProfileId,
    preferredModelId: string | null | undefined = selectedTtsModelIdRef.current
  ): string | null => {
    const model = pickTtsModel(availableTtsModels, voiceProfileId, preferredModelId ?? null);
    return model?.id ?? null;
  };

  const previewVoiceProfile = (
    voiceProfileId: VoiceProfileId = currentVoiceProfileId,
    preferredVoiceUri: string | null = selectedSpeechVoiceUri,
    preferredModelId: string | null = selectedTtsModelIdRef.current
  ) => {
    if (typeof window === "undefined" || !uiPreferences.soundEnabled) {
      return;
    }

    const preset = getVoiceProfilePreset(voiceProfileId);

    if (speechProviderRef.current === "edge") {
      const selectedModel = pickTtsModel(availableTtsModels, voiceProfileId, preferredModelId);

      if (!selectedModel) {
        speechProviderRef.current = "system";
        setSpeechProvider("system");
        previewVoiceProfile(voiceProfileId, preferredVoiceUri, preferredModelId);
        return;
      }

      stopSystemSpeechSynthesis();
      stopEdgePreviewPlayback();

      const abortController = new AbortController();
      previewAbortControllerRef.current = abortController;

      void (async () => {
        try {
          const audioBlob = await requestTtsAudio({
            backendWsUrl: currentBackendWsUrl,
            text: preset.previewText,
            voiceId: selectedModel.id,
            lang: preset.lang,
            rate: toEdgeRate(preset.rate),
            pitch: toEdgePitch(preset.pitch),
            signal: abortController.signal
          });

          if (abortController.signal.aborted) {
            return;
          }

          const objectUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(objectUrl);

          previewAudioRef.current = audio;
          previewAudioUrlRef.current = objectUrl;

          const finalize = () => {
            if (previewAudioRef.current === audio) {
              previewAudioRef.current = null;
            }

            if (previewAudioUrlRef.current === objectUrl) {
              URL.revokeObjectURL(objectUrl);
              previewAudioUrlRef.current = null;
            }

            if (previewAbortControllerRef.current === abortController) {
              previewAbortControllerRef.current = null;
            }
          };

          audio.onended = finalize;
          audio.onerror = finalize;
          await audio.play();
        } catch {
          if (abortController.signal.aborted) {
            return;
          }

          stopEdgePreviewPlayback();
          if (!("speechSynthesis" in window)) {
            return;
          }

          const voices =
            availableSpeechVoices.length > 0 ? availableSpeechVoices : syncSpeechVoices();
          const fallbackVoice = pickSpeechVoice(voices, voiceProfileId, preferredVoiceUri);
          const voiceMatchesTargetLanguage =
            fallbackVoice !== null &&
            getLanguagePrefix(fallbackVoice.lang) === getLanguagePrefix(preset.lang);
          const utterance = new SpeechSynthesisUtterance(preset.previewText);

          utterance.lang = voiceMatchesTargetLanguage ? fallbackVoice.lang : preset.lang;
          utterance.rate = preset.rate;
          utterance.pitch = preset.pitch;
          utterance.volume = 1;

          if (
            fallbackVoice &&
            (voiceProfileId === "default" || voiceMatchesTargetLanguage)
          ) {
            utterance.voice = fallbackVoice;
          }

          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      })();

      return;
    }

    if (!("speechSynthesis" in window)) {
      return;
    }

    const voices = availableSpeechVoices.length > 0 ? availableSpeechVoices : syncSpeechVoices();
    const selectedVoice = pickSpeechVoice(voices, voiceProfileId, preferredVoiceUri);
    const voiceMatchesTargetLanguage =
      selectedVoice !== null &&
      getLanguagePrefix(selectedVoice.lang) === getLanguagePrefix(preset.lang);
    const utterance = new SpeechSynthesisUtterance(preset.previewText);

    utterance.lang = voiceMatchesTargetLanguage ? selectedVoice.lang : preset.lang;
    utterance.rate = preset.rate;
    utterance.pitch = preset.pitch;
    utterance.volume = 1;

    if (selectedVoice && (voiceProfileId === "default" || voiceMatchesTargetLanguage)) {
      utterance.voice = selectedVoice;
    }

    stopEdgePreviewPlayback();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceProfileSelect = (voiceProfileId: VoiceProfileId) => {
    const voices = availableSpeechVoices.length > 0 ? availableSpeechVoices : syncSpeechVoices();
    const autoPickedVoice = pickSpeechVoice(voices, voiceProfileId, selectedSpeechVoiceUri);
    const nextVoiceUri = autoPickedVoice ? getSpeechVoiceId(autoPickedVoice) : null;
    const nextModelId =
      speechProviderRef.current === "edge" ? resolvePreferredTtsModelId(voiceProfileId) : null;

    setVoiceProfile(voiceProfileId);
    setSelectedSpeechVoiceUri(nextVoiceUri);

    if (speechProviderRef.current === "edge") {
      selectedTtsModelIdRef.current = nextModelId;
      setSelectedTtsModelId(nextModelId);
    }

    previewVoiceProfile(voiceProfileId, nextVoiceUri, nextModelId);
  };

  const handleSpeechVoiceSelect = (voiceUri: string) => {
    const nextVoiceUri = voiceUri || null;

    speechProviderRef.current = "system";
    setSpeechProvider("system");
    setSelectedSpeechVoiceUri(nextVoiceUri);
    previewVoiceProfile(currentVoiceProfileId, nextVoiceUri);
  };

  const handleSpeechProviderSelect = (provider: SpeechProviderId) => {
    speechProviderRef.current = provider;
    setSpeechProvider(provider);

    if (provider === "edge") {
      const nextModelId = resolvePreferredTtsModelId(currentVoiceProfileId);
      selectedTtsModelIdRef.current = nextModelId;
      setSelectedTtsModelId(nextModelId);
      previewVoiceProfile(currentVoiceProfileId, selectedSpeechVoiceUri, nextModelId);
      return;
    }

    previewVoiceProfile(currentVoiceProfileId, selectedSpeechVoiceUri, selectedTtsModelIdRef.current);
  };

  const handleTtsModelSelect = (modelId: string | null) => {
    const nextModelId = modelId ?? resolvePreferredTtsModelId(currentVoiceProfileId, null);

    speechProviderRef.current = "edge";
    setSpeechProvider("edge");
    selectedTtsModelIdRef.current = nextModelId;
    setSelectedTtsModelId(nextModelId);
    previewVoiceProfile(currentVoiceProfileId, selectedSpeechVoiceUri, nextModelId);
  };

  const handleSignalSoundPreview = (signalSoundId: SignalSoundId = currentSignalSoundId) => {
    if (!uiPreferences.soundEnabled) {
      return;
    }

    playSignalSound(signalSoundId, audioContextRef);
  };

  const handleSignalSoundSelect = (signalSoundId: SignalSoundId) => {
    setSelectedSignalSoundId(signalSoundId);
    handleSignalSoundPreview(signalSoundId);
  };

  const handleAnimationPreview = () => {
    if (typeof window === "undefined" || !uiPreferences.signalAnimationEnabled) {
      return;
    }

    if (bridge) {
      void bridge.showSignalOverlay({
        eventId: `desktop-preview-${Date.now()}`,
        symbol: "BTC USDT",
        bias: "LONG",
        severity: "high",
        preferences: signalBillboardPreferences
      });
    }

    if (animationPreviewTimerRef.current !== null) {
      window.clearTimeout(animationPreviewTimerRef.current);
      animationPreviewTimerRef.current = null;
    }

    setAnimationPreviewVisible(false);
    window.requestAnimationFrame(() => {
      setAnimationPreviewVisible(true);
    });

    animationPreviewTimerRef.current = window.setTimeout(() => {
      setAnimationPreviewVisible(false);
      animationPreviewTimerRef.current = null;
    }, 2_400);
  };

  const sendSocketMessage = (payload: Record<string, unknown>): boolean => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setAccountFormError(text.backendNotConnected);
      return false;
    }

    socketRef.current.send(JSON.stringify(payload));
    return true;
  };

  const handleBinanceConnect = () => {
    const apiKey = binanceApiKeyDraft.trim();
    const apiSecret = binanceApiSecretDraft.trim();

    if (!apiKey || !apiSecret) {
      setAccountFormError(text.enterBinanceCredentials);
      return;
    }

    setAccountFormError(null);

    if (
      !sendSocketMessage({
        type: "connect_binance_account",
        payload: {
          apiKey,
          apiSecret
        }
      })
    ) {
      return;
    }

    setAccountActionPending("connect");
  };

  const handleBinanceDisconnect = () => {
    setAccountFormError(null);

    if (
      !sendSocketMessage({
        type: "disconnect_binance_account"
      })
    ) {
      return;
    }

    setAccountActionPending("disconnect");
  };

  useEffect(() => {
    if (!bridge) {
      return;
    }

    let cancelled = false;
    const syncShellState = (snapshot: DesktopShellState) => {
      if (cancelled) {
        return;
      }

      setShellState(snapshot);

      if (!storageHydrated && !preferLocalInterfaceLanguageRef.current) {
        const nextInterfaceLanguage = normalizeInterfaceLanguage(snapshot.interfaceLanguage);

        if (nextInterfaceLanguage !== interfaceLanguageRef.current) {
          interfaceLanguageRef.current = nextInterfaceLanguage;
          setInterfaceLanguage(nextInterfaceLanguage);
        }
      }

      if (snapshot.backendWsUrl && snapshot.backendWsUrl !== backendWsUrlRef.current) {
        backendWsUrlRef.current = snapshot.backendWsUrl;
        setBackendWsUrl(snapshot.backendWsUrl);
      }
    };

    bridge
      .getState()
      .then(syncShellState)
      .catch((loadError) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError, interfaceLanguageRef.current));
        }
      });

    const unsubscribe = bridge.onStateChanged(syncShellState);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, setBackendWsUrl, setInterfaceLanguage, storageHydrated]);

  useEffect(() => {
    if (!bridge) {
      return;
    }

    void bridge.updateAlertMonitorSettings({
      backendWsUrl,
      interfaceLanguage,
      soundEnabled: uiPreferences.soundEnabled,
      signalSoundEnabled: uiPreferences.signalSoundEnabled,
      signalAnimationEnabled: uiPreferences.signalAnimationEnabled,
      signalBillboard: uiPreferences.signalBillboard,
      notifications: uiPreferences.notifications
    });
  }, [
    backendWsUrl,
    bridge,
    interfaceLanguage,
    uiPreferences.notifications,
    uiPreferences.signalAnimationEnabled,
    uiPreferences.signalBillboard,
    uiPreferences.signalSoundEnabled,
    uiPreferences.soundEnabled
  ]);

  useEffect(() => {
    let cancelled = false;

    const hydrateRuntimeState = async () => {
      try {
        const storedSession = await loadCabinetSession();
        const nextSession = storedSession ?? createGuestSession();

        if (nextSession.mode === "authenticated" && nextSession.profileId) {
          const record = await loadCabinetProfileRecord(nextSession.profileId);

          if (cancelled) {
            return;
          }

          if (record) {
            hydratePersistedState(record.state);
            setRuntimeSession(nextSession);
            setActiveProfile(record.profile);
            setStorageHydrated(true);
            return;
          }
        }

        const guestState = await loadPersistedState();

        if (cancelled) {
          return;
        }

        hydratePersistedState(guestState);
        setRuntimeSession(createGuestSession());
        setActiveProfile(null);
        setStorageHydrated(true);
      } catch {
        if (!cancelled) {
          setStorageHydrated(true);
        }
      }
    };

    void hydrateRuntimeState();

    return () => {
      cancelled = true;
    };
  }, [hydratePersistedState]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return;
    }

    const channel = new BroadcastChannel(runtimeSyncChannelName);
    syncChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<RuntimeSyncPayload>) => {
      const payload = event.data;

      if (
        !storageHydrated ||
        payload?.type !== "state" ||
        payload.sourceId === syncSourceIdRef.current
      ) {
        return;
      }

      skipNextPersistenceSyncRef.current = true;
      hydratePersistedState(payload.state);
      setRuntimeSession(payload.session);
      setActiveProfile(payload.profile);
    };

    return () => {
      channel.close();

      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
    };
  }, [hydratePersistedState, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated || typeof window === "undefined") {
      return;
    }

    const handle = window.setTimeout(() => {
      if (skipNextPersistenceSyncRef.current) {
        skipNextPersistenceSyncRef.current = false;
        return;
      }

      const snapshot = getPersistableState();

      void persistCurrentState(snapshot)
        .then(() => {
          broadcastRuntimeState(snapshot);
        })
        .catch(() => undefined);
    }, 150);

    return () => {
      window.clearTimeout(handle);
    };
  }, [activeProfile, backendWsUrl, runtimeSession, storageHydrated, uiPreferences]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const synthesis = window.speechSynthesis;
    const syncAvailableVoices = () => {
      syncSpeechVoices();
    };

    syncAvailableVoices();
    synthesis.addEventListener("voiceschanged", syncAvailableVoices);

    return () => {
      synthesis.removeEventListener("voiceschanged", syncAvailableVoices);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!currentBackendWsUrl) {
      setAvailableTtsModels([]);
      setTtsModelsError(null);
      setTtsModelsLoading(false);
      return;
    }

    setTtsModelsLoading(true);

    void loadTtsModels(currentBackendWsUrl)
      .then(({ defaultModelId, models }) => {
        if (cancelled) {
          return;
        }

        setAvailableTtsModels(models);
        setTtsModelsError(null);

        const resolvedModelId =
          pickTtsModel(
            models,
            currentVoiceProfileId,
            selectedTtsModelIdRef.current ?? defaultModelId ?? null
          )?.id ??
          defaultModelId ??
          null;

        if (resolvedModelId !== selectedTtsModelIdRef.current) {
          selectedTtsModelIdRef.current = resolvedModelId;
          setSelectedTtsModelId(resolvedModelId);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setAvailableTtsModels([]);
        setTtsModelsError(
          error instanceof Error ? error.message : text.couldNotLoadTtsModels
        );
      })
      .finally(() => {
        if (!cancelled) {
          setTtsModelsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentBackendWsUrl, currentVoiceProfileId, setSelectedTtsModelId]);

  useEffect(() => {
    speechProviderRef.current = normalizeSpeechProviderId(uiPreferences.speechProvider);
    selectedTtsModelIdRef.current = uiPreferences.selectedTtsModelId ?? null;

    if (!uiPreferences.soundEnabled) {
      stopSystemSpeechSynthesis();
      stopEdgePreviewPlayback();
    }
  }, [uiPreferences.soundEnabled, uiPreferences.speechProvider, uiPreferences.selectedTtsModelId]);

  useEffect(() => {
    return () => {
      stopSystemSpeechSynthesis();
      stopEdgePreviewPlayback();
    };
  }, []);

  useEffect(() => {
    if (!uiPreferences.signalAnimationEnabled) {
      setAnimationPreviewVisible(false);

      if (animationPreviewTimerRef.current !== null) {
        window.clearTimeout(animationPreviewTimerRef.current);
        animationPreviewTimerRef.current = null;
      }

      if (bridge) {
        void bridge.hideSignalOverlay();
      }
    }
  }, [bridge, uiPreferences.signalAnimationEnabled]);

  useEffect(() => {
    if (!currentBackendWsUrl) {
      setConnectionState("closed");
      setLatencyMs(null);
      setFrame(null);
      return;
    }

    let disposed = false;

    const openSocket = () => {
      if (disposed) {
        return;
      }

      setConnectionState("connecting");

      let socket: WebSocket;

      try {
        socket = new WebSocket(currentBackendWsUrl);
      } catch (socketError) {
        setConnectionState("closed");
        setAccountFormError(
          socketError instanceof Error
            ? `${text.couldNotOpenBackendWebsocket} ${socketError.message}`
            : text.couldNotOpenBackendWebsocket
        );
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }

        setAccountFormError(null);
        setConnectionState("open");
        socket.send(JSON.stringify({ type: "hello" }));
        socket.send(JSON.stringify({ type: "request_snapshot" }));
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "pong") {
            setLatencyMs(Math.max(message.receivedAt - message.sentAt, 0));
            return;
          }

          if (message.type === "frame") {
            setFrame(message);
          }
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }

        setConnectionState("closed");
        reconnectTimerRef.current = window.setTimeout(openSocket, 2_000);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    openSocket();

    pingTimerRef.current = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "ping",
            payload: {
              sentAt: Date.now()
            }
          })
        );
      }
    }, 15_000);

    return () => {
      disposed = true;

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [currentBackendWsUrl]);

  useEffect(() => {
    if (!accountActionPending || !accountStream) {
      return;
    }

    const connectCompleted =
      accountActionPending === "connect" &&
      (accountCredentialSource === "session" || accountStatusError !== null);
    const disconnectCompleted =
      accountActionPending === "disconnect" &&
      (accountCredentialSource !== "session" || accountStatusError !== null);

    if (!connectCompleted && !disconnectCompleted) {
      return;
    }

    setAccountActionPending(null);
  }, [accountActionPending, accountCredentialSource, accountStatusError, accountStream]);

  useEffect(() => {
    if (connectionState === "open") {
      return;
    }

    setAccountActionPending(null);
  }, [connectionState]);

  useEffect(() => {
    if (accountCredentialSource !== "session" || accountStatusError) {
      return;
    }

    setBinanceApiKeyDraft("");
    setBinanceApiSecretDraft("");
    setAccountFormError(null);
  }, [accountCredentialSource, accountStatusError]);

  useEffect(() => {
    return () => {
      if (animationPreviewTimerRef.current !== null) {
        window.clearTimeout(animationPreviewTimerRef.current);
      }
    };
  }, []);

  if (!bridge) {
    return (
      <main className="min-h-screen bg-[#09111a] px-6 py-10 text-slate-100">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-white/10 bg-[#0f1a26] p-8 shadow-2xl shadow-black/30">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[#89d7ff]">
            {text.fallbackEyebrow}
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-white">{text.fallbackTitle}</h1>
          <p className="mt-4 max-w-2xl text-sm text-slate-400">{text.fallbackDescription}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(180deg,_#071018,_#0e1722_52%,_#111b27)] px-4 py-6 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[#8ae5ff]">
                {text.heroEyebrow}
              </div>
              <h1 className="mt-3 text-3xl font-semibold text-white">{text.heroTitle}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">{text.heroDescription}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-white/10 bg-white/5 p-1">
                <div className="mb-1 px-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  {text.interfaceLanguage}
                </div>
                <div className="flex gap-1">
                  {interfaceLanguageOptions.map((option) => {
                    const active = option.value === interfaceLanguage;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleInterfaceLanguageSelect(option.value)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          active
                            ? "bg-[#8ae5ff] text-[#061019]"
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void runAction("reset-layout", () => bridge.resetLayout())}
                disabled={busyToken === "reset-layout"}
                className="rounded-full border border-[#8ae5ff]/30 bg-[#8ae5ff]/10 px-4 py-2 text-sm font-medium text-[#8ae5ff] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {text.resetLayout}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label={text.summaryScreens}
              value={shellState ? String(shellState.displays.length) : "--"}
              detail={
                shellState
                  ? shellState.displays.map((display) => display.label).join(" | ")
                  : text.loadingScreens
              }
            />
            <SummaryCard
              label={text.summaryMood}
              value={marketMoodLabel(marketMood, interfaceLanguage)}
              detail={
                marketPulse !== null
                  ? `${text.pulseLabel} ${marketPulse.toFixed(1)}`
                  : text.waitingSnapshot
              }
            />
            <SummaryCard
              label="Tracked"
              value={String(frame?.status.universeSize ?? 0)}
              detail={`${frame?.status.focusSymbols.length ?? 0} focus coins`}
            />
            <SummaryCard
              label={text.statOpenPositions}
              value={String(frame?.status.accountStream.activePositions.length ?? 0)}
              detail={runtimeModeLabel}
            />
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <section className="rounded-[24px] border border-white/10 bg-[#0d1620]/85 p-5 shadow-lg shadow-black/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#8ae5ff]">
                    {text.signalEyebrow}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-white">{text.signalTitle}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">{text.signalDescription}</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                  {activeProfile ? activeProfile.binanceHandle : runtimeModeLabel}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)]">
                <div className="space-y-3">
                  <SettingToggleRow
                    label={text.masterSoundLabel}
                    detail={text.masterSoundDetail}
                    checked={uiPreferences.soundEnabled}
                    onChange={(checked) => setSoundEnabled(checked)}
                  />
                  <SettingToggleRow
                    label={text.animationLabel}
                    detail={text.animationDetail}
                    checked={uiPreferences.signalAnimationEnabled}
                    onChange={(checked) => setSignalAnimationEnabled(checked)}
                  />
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {text.animationPreviewTitle}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {text.animationPreviewDetail}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAnimationPreview()}
                        disabled={!uiPreferences.signalAnimationEnabled}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition ${
                          uiPreferences.signalAnimationEnabled
                            ? "border-caution/40 bg-caution/10 text-caution hover:border-caution/60"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        {text.preview}
                      </button>
                    </div>
                    <div
                      className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#04070b]"
                      style={{
                        height: `${computeSignalBillboardFrameHeightPx(signalBillboardPreferences, {
                          referenceHeight: 860,
                          minPx: 56,
                          maxPx: 96
                        })}px`
                      }}
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.12),transparent_62%)]" />
                      <div
                        className={`absolute inset-0 transition-all duration-500 ${
                          animationPreviewVisible
                            ? "translate-y-0 opacity-100"
                            : "pointer-events-none translate-y-2 opacity-0"
                        }`}
                      >
                        <SignalBillboardOverlay
                          symbol="BTC USDT"
                          bias="LONG"
                          severity="high"
                          preferences={signalBillboardPreferences}
                          interfaceLanguage={interfaceLanguage}
                          className="absolute inset-0"
                        />
                      </div>
                      {!animationPreviewVisible ? (
                        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[11px] uppercase tracking-[0.24em] text-slate-500">
                          {text.previewReady}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {text.overlayBandsTitle}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{text.overlayBandsDetail}</div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                        {text.overlayHeightCompact} {signalBillboardPreferences.frameHeightPercent}% |{" "}
                        {text.overlayTopCompact} {signalBillboardPreferences.topBandSize}% |{" "}
                        {text.overlayBottomCompact}{" "}
                        {signalBillboardPreferences.bottomBandSize}%
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm text-slate-300 sm:col-span-2">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.overlayHeight}</span>
                          <span>{signalBillboardPreferences.frameHeightPercent}%</span>
                        </span>
                        <input
                          type="range"
                          min={signalBillboardFrameHeightRange.min}
                          max={signalBillboardFrameHeightRange.max}
                          step="1"
                          value={signalBillboardPreferences.frameHeightPercent}
                          onChange={(event) =>
                            setSignalBillboardPreference(
                              "frameHeightPercent",
                              Number(event.target.value)
                            )
                          }
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.overlayTopBandSize}</span>
                          <span>{signalBillboardPreferences.topBandSize}%</span>
                        </span>
                        <input
                          type="range"
                          min={signalBillboardTopSizeRange.min}
                          max={signalBillboardTopSizeRange.max}
                          step="1"
                          value={signalBillboardPreferences.topBandSize}
                          onChange={(event) =>
                            setSignalBillboardPreference("topBandSize", Number(event.target.value))
                          }
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.overlayBottomBandSize}</span>
                          <span>{signalBillboardPreferences.bottomBandSize}%</span>
                        </span>
                        <input
                          type="range"
                          min={signalBillboardBottomSizeRange.min}
                          max={signalBillboardBottomSizeRange.max}
                          step="1"
                          value={signalBillboardPreferences.bottomBandSize}
                          onChange={(event) =>
                            setSignalBillboardPreference(
                              "bottomBandSize",
                              Number(event.target.value)
                            )
                          }
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.overlayTopOpacity}</span>
                          <span>{signalBillboardPreferences.topBandOpacity}%</span>
                        </span>
                        <input
                          type="range"
                          min={signalBillboardOpacityRange.min}
                          max={signalBillboardOpacityRange.max}
                          step="1"
                          value={signalBillboardPreferences.topBandOpacity}
                          onChange={(event) =>
                            setSignalBillboardPreference(
                              "topBandOpacity",
                              Number(event.target.value)
                            )
                          }
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.overlayBottomOpacity}</span>
                          <span>{signalBillboardPreferences.bottomBandOpacity}%</span>
                        </span>
                        <input
                          type="range"
                          min={signalBillboardOpacityRange.min}
                          max={signalBillboardOpacityRange.max}
                          step="1"
                          value={signalBillboardPreferences.bottomBandOpacity}
                          onChange={(event) =>
                            setSignalBillboardPreference(
                              "bottomBandOpacity",
                              Number(event.target.value)
                            )
                          }
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {text.voiceProfileTitle}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">
                      {text.currentLabel}: {currentVoiceProfileMeta.label} |{" "}
                      {currentSpeechProviderId === "edge" ? text.edgeNeural : text.systemVoice}
                      {currentSpeechProviderId === "edge"
                        ? selectedTtsModel
                          ? ` | ${selectedTtsModel.label}`
                          : suggestedTtsModel
                            ? ` | ${text.autoBestMatch} ${suggestedTtsModel.label}`
                            : ` | ${text.loadingModel}`
                        : selectedSpeechVoice
                          ? ` | ${selectedSpeechVoice.name}`
                          : ` | ${text.autoMatch}`}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleSpeechProviderSelect("edge")}
                      disabled={!uiPreferences.soundEnabled}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        uiPreferences.soundEnabled
                          ? currentSpeechProviderId === "edge"
                            ? "border-accent/50 bg-accent/10 text-white"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:bg-accent/5"
                          : "border-white/10 bg-white/5 text-slate-500"
                      }`}
                    >
                      {text.edgeNeural}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSpeechProviderSelect("system")}
                      disabled={!uiPreferences.soundEnabled}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        uiPreferences.soundEnabled
                          ? currentSpeechProviderId === "system"
                            ? "border-accent/50 bg-accent/10 text-white"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:bg-accent/5"
                          : "border-white/10 bg-white/5 text-slate-500"
                      }`}
                    >
                      {text.systemVoice}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {voiceProfilePresets.map((profile) => {
                      const profileMeta = getVoiceProfileMeta(profile.id, interfaceLanguage);

                      return (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => handleVoiceProfileSelect(profile.id)}
                          disabled={!uiPreferences.soundEnabled}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            uiPreferences.soundEnabled
                              ? profile.id === currentVoiceProfileId
                                ? "border-accent/50 bg-accent/10 text-white"
                                : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:bg-accent/5"
                              : "border-white/10 bg-white/5 text-slate-500"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium">{profileMeta.label}</div>
                            <div className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                              {profileMeta.badgeLabel}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{profileMeta.detail}</div>
                        </button>
                      );
                    })}
                  </div>
                  {currentSpeechProviderId === "edge" ? (
                    <label className="block text-sm text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {text.neuralModel}
                      </span>
                      <select
                        value={selectedTtsModelId ?? ""}
                        onChange={(event) => handleTtsModelSelect(event.target.value || null)}
                        disabled={!uiPreferences.soundEnabled || ttsModelsLoading}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#081018] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#8ae5ff]/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">
                          {ttsModelsLoading ? text.loadingModels : text.autoBestMatch}
                        </option>
                        {visibleTtsModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} | {model.locale} |{" "}
                            {model.multilingual
                              ? text.modelMultilingual
                              : localizeModelGender(model.gender, interfaceLanguage)}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-xs text-slate-500">
                        {ttsModelsError
                          ? ttsModelsError
                          : selectedTtsModel
                            ? selectedTtsModel.detail
                            : suggestedTtsModel
                              ? suggestedTtsModel.detail
                              : text.backendModelListLoading}
                      </div>
                    </label>
                  ) : (
                    <label className="block text-sm text-slate-300">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {text.systemVoice}
                      </span>
                      <select
                        value={selectedSpeechVoiceUri ?? ""}
                        onChange={(event) => handleSpeechVoiceSelect(event.target.value)}
                        disabled={!uiPreferences.soundEnabled}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#081018] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#8ae5ff]/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{text.autoBestMatch}</option>
                        {voiceCandidates.map((voice) => {
                          const voiceId = getSpeechVoiceId(voice);
                          return (
                            <option key={voiceId} value={voiceId}>
                              {voice.name} | {voice.lang}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      previewVoiceProfile(
                        currentVoiceProfileId,
                        selectedSpeechVoiceUri,
                        selectedTtsModelIdRef.current
                      )
                    }
                    disabled={!uiPreferences.soundEnabled}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                      uiPreferences.soundEnabled
                        ? "border-[#8ae5ff]/30 bg-[#8ae5ff]/10 text-[#8ae5ff] hover:border-[#8ae5ff]/60 hover:text-white"
                        : "border-white/10 bg-white/5 text-slate-500"
                    }`}
                  >
                    {text.previewVoice}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {text.signalSoundTitle}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">
                      {text.currentPreset}: {currentSignalSoundMeta.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{text.signalSoundDetail}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSignalSoundPreview(currentSignalSoundId)}
                    disabled={!uiPreferences.soundEnabled || !uiPreferences.signalSoundEnabled}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition ${
                      uiPreferences.soundEnabled && uiPreferences.signalSoundEnabled
                        ? "border-accent/40 bg-accent/10 text-accent hover:border-accent/60 hover:text-white"
                        : "border-white/10 bg-white/5 text-slate-500"
                    }`}
                  >
                    {text.preview}
                  </button>
                </div>

                <div className="mt-3">
                  <SettingToggleRow
                    label={text.signalChimeLabel}
                    detail={text.signalChimeDetail}
                    checked={uiPreferences.signalSoundEnabled}
                    onChange={(checked) => setSignalSoundEnabled(checked)}
                  />
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {signalSoundPresets.map((preset) => {
                    const presetMeta = getSignalSoundMeta(preset.id, interfaceLanguage);

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSignalSoundSelect(preset.id)}
                        disabled={!uiPreferences.soundEnabled}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          uiPreferences.soundEnabled
                            ? preset.id === currentSignalSoundId
                              ? "border-emerald-400/35 bg-emerald-500/10 text-white"
                              : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-400/30 hover:text-white"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{presetMeta.label}</div>
                          <div className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                            {preset.id === currentSignalSoundId ? text.stateActive : text.stateReady}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{presetMeta.detail}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-white/10 bg-[#0d1620]/85 p-5 shadow-lg shadow-black/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#8ae5ff]">
                    {text.marketEyebrow}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-white">{text.marketTitle}</h2>
                  <p className="mt-2 text-sm text-slate-400">{text.marketDescription}</p>
                </div>
                <div
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${marketMoodClasses(
                    marketMood
                  )}`}
                >
                  {marketMoodLabel(marketMood, interfaceLanguage)}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <StatChip
                  label={text.statMarketPulse}
                  value={marketPulse !== null ? marketPulse.toFixed(1) : "--"}
                />
                <StatChip label="Tracked" value={String(frame?.status.universeSize ?? 0)} />
                <StatChip label="Focus" value={String(frame?.status.focusSymbols.length ?? 0)} />
                <StatChip
                  label={text.statOpenPositions}
                  value={String(frame?.status.accountStream.activePositions.length ?? 0)}
                />
              </div>

              <div
                className={`mt-4 rounded-2xl border px-4 py-4 text-sm ${
                  accountStatusError
                    ? "border-rose-400/25 bg-rose-500/10"
                    : accountStream?.connected
                      ? "border-emerald-400/25 bg-emerald-500/10"
                      : accountStream?.enabled
                        ? "border-amber-400/25 bg-amber-500/10"
                        : "border-white/10 bg-white/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-medium text-slate-100">
                    {accountStatusError ?? accountStatusMessage}
                  </div>
                  {accountKeyLabel ? (
                    <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                      {text.accountKeyPrefix} {accountKeyLabel}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-slate-400">{text.apiKeyLabel}</span>
                  <input
                    value={binanceApiKeyDraft}
                    onChange={(event) => setBinanceApiKeyDraft(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={text.apiKeyPlaceholder}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-slate-100 outline-none transition focus:border-[#8ae5ff]/60"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-slate-400">{text.apiSecretLabel}</span>
                  <input
                    type="password"
                    value={binanceApiSecretDraft}
                    onChange={(event) => setBinanceApiSecretDraft(event.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={text.apiSecretPlaceholder}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-slate-100 outline-none transition focus:border-[#8ae5ff]/60"
                  />
                </label>
              </div>

              {accountFormError ? (
                <p className="mt-3 text-sm text-rose-200">{accountFormError}</p>
              ) : null}

              {accountCredentialSource === "env" ? (
                <p className="mt-3 text-xs text-slate-500">{text.envCredentialsNotice}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleBinanceConnect}
                  disabled={accountActionPending !== null || connectionState !== "open"}
                  className="rounded-xl border border-[#f0b90b]/30 bg-[#f0b90b]/10 px-3 py-2 text-sm font-medium text-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accountActionPending === "connect"
                    ? text.connectingBinance
                    : accountCredentialSource === "session"
                      ? text.updateSessionKeys
                      : text.connectBinance}
                </button>

                {accountCredentialSource === "session" ? (
                  <button
                    type="button"
                    onClick={handleBinanceDisconnect}
                    disabled={accountActionPending !== null || connectionState !== "open"}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {accountActionPending === "disconnect"
                      ? text.disconnectingBinance
                      : text.disconnectSession}
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-2">
            {orderedWindows.map((definition) => {
              const windowState =
                windowsByKey.get(definition.key) ??
                ({
                  key: definition.key,
                  title: definition.title,
                  route: definition.key === "dashboard" ? "/" : `/module/${definition.key}`,
                  open: false,
                  alwaysOnTop: false,
                  opacity: 1,
                  displayId: null,
                  bounds: null
                } satisfies DesktopWindowSnapshot);

              const busyPrefix = `${definition.key}:`;
              const isBusy = busyToken?.startsWith(busyPrefix) ?? false;

              return (
                <section
                  key={definition.key}
                  className="rounded-[24px] border border-white/10 bg-[#0d1620]/85 p-5 shadow-lg shadow-black/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold text-white">{definition.title}</h2>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${
                            windowState.open
                              ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                              : "border border-white/10 bg-white/5 text-slate-400"
                          }`}
                        >
                          {windowState.open ? text.windowsOpen : text.windowsClosed}
                        </span>
                      </div>
                      <p className="mt-2 max-w-xl text-sm text-slate-400">{definition.detail}</p>
                      <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {text.windowsRoute}: {windowState.route}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(`${definition.key}:open`, () =>
                            bridge.openWindow(definition.key)
                          )
                        }
                        disabled={isBusy}
                        className="rounded-full border border-[#8ae5ff]/30 bg-[#8ae5ff]/10 px-3.5 py-2 text-sm font-medium text-[#8ae5ff] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {windowState.open ? text.windowsReopen : text.windowsOpenButton}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(`${definition.key}:focus`, () =>
                            bridge.focusWindow(definition.key)
                          )
                        }
                        disabled={isBusy || !windowState.open}
                        className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {text.windowsFocus}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(`${definition.key}:close`, () =>
                            bridge.closeWindow(definition.key)
                          )
                        }
                        disabled={isBusy || !windowState.open}
                        className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {text.windowsClose}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatChip
                          label={text.windowsScreen}
                          value={
                            shellState
                              ? formatDisplayLabel(
                                  windowState.displayId,
                                  shellState.displays,
                                  interfaceLanguage
                                )
                              : "--"
                          }
                        />
                        <StatChip
                          label={text.windowsBounds}
                          value={formatBounds(windowState.bounds, interfaceLanguage)}
                        />
                        <StatChip
                          label={text.windowsPinned}
                          value={windowState.alwaysOnTop ? text.windowsEnabled : text.windowsDisabled}
                        />
                        <StatChip
                          label={text.windowsOpacity}
                          value={`${Math.round(windowState.opacity * 100)}%`}
                        />
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <label className="block text-sm text-slate-300">
                        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          {text.windowsTargetScreen}
                        </span>
                        <select
                          value={windowState.displayId ?? ""}
                          onChange={(event) => {
                            const nextDisplayId = event.target.value
                              ? Number(event.target.value)
                              : null;

                            void runAction(`${definition.key}:display`, () =>
                              bridge.updateWindow(definition.key, { displayId: nextDisplayId })
                            );
                          }}
                          disabled={isBusy}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#081018] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#8ae5ff]/60 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">{text.windowsAutoCurrentScreen}</option>
                          {shellState?.displays.map((display) => (
                            <option key={display.id} value={display.id}>
                              {display.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
                        <span>{text.windowsAlwaysOnTop}</span>
                        <input
                          type="checkbox"
                          checked={windowState.alwaysOnTop}
                          onChange={(event) => {
                            void runAction(`${definition.key}:top`, () =>
                              bridge.updateWindow(definition.key, {
                                alwaysOnTop: event.target.checked
                              })
                            );
                          }}
                          disabled={isBusy}
                          className="h-4 w-4 rounded border-white/20 bg-black/20"
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span>{text.windowsOpacity}</span>
                          <span>{Math.round(windowState.opacity * 100)}%</span>
                        </span>
                        <input
                          type="range"
                          min="35"
                          max="100"
                          step="5"
                          value={Math.round(windowState.opacity * 100)}
                          onChange={(event) => {
                            const nextOpacity = Number(event.target.value) / 100;

                            void runAction(`${definition.key}:opacity`, () =>
                              bridge.updateWindow(definition.key, { opacity: nextOpacity })
                            );
                          }}
                          disabled={isBusy}
                          className="mt-3 w-full accent-[#8ae5ff]"
                        />
                      </label>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#081018]/80 p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 break-all text-lg font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{detail}</div>
    </div>
  );
}

function StatChip({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  );
}

function SettingToggleRow({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
      <div>
        <div className="text-sm font-medium text-slate-100">{label}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20"
      />
    </label>
  );
}
