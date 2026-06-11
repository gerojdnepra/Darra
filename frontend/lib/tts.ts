import type { SpeechProviderId, VoiceProfileId } from "./types";
import { resolveBackendHttpBaseUrl } from "./backend-url";
import { getVoiceProfilePreset } from "./voice-profiles";

export { resolveBackendHttpBaseUrl };

export interface TtsModelSummary {
  id: string;
  label: string;
  detail: string;
  locale: string;
  gender: "Female" | "Male";
  multilingual: boolean;
}

interface TtsModelsResponse {
  provider?: string;
  defaultModelId?: string;
  models?: TtsModelSummary[];
}

interface TtsErrorResponse {
  message?: string;
}

export interface LoadTtsModelsResult {
  defaultModelId: string;
  models: TtsModelSummary[];
}

export interface RequestTtsAudioOptions {
  backendWsUrl: string;
  text: string;
  voiceId: string;
  lang: string;
  rate: string;
  pitch: string;
  signal?: AbortSignal;
}

export const defaultSpeechProviderId: SpeechProviderId = "edge";

const speechProviderIds: SpeechProviderId[] = ["system", "edge"];
const speechProviderIdSet = new Set<string>(speechProviderIds);

const voiceProfileModelHints: Record<VoiceProfileId, string[]> = {
  default: [
    "en-US-AriaNeural",
    "en-US-AvaNeural",
    "en-US-JennyNeural",
    "en-US-MichelleNeural",
    "en-US-EmmaNeural",
    "en-US-AvaMultilingualNeural",
    "en-US-AndrewMultilingualNeural"
  ],
  russian: [
    "en-US-AvaMultilingualNeural",
    "en-US-EmmaMultilingualNeural",
    "en-AU-WilliamMultilingualNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-BrianMultilingualNeural"
  ],
  analyst: [
    "en-GB-RyanNeural",
    "en-GB-ThomasNeural",
    "en-GB-LibbyNeural",
    "en-GB-MaisieNeural",
    "en-GB-SoniaNeural",
    "en-AU-WilliamMultilingualNeural",
    "en-US-ChristopherNeural",
    "en-US-SteffanNeural"
  ],
  builder: [
    "en-US-AvaNeural",
    "en-US-JennyNeural",
    "en-US-AriaNeural",
    "en-US-AnaNeural",
    "en-US-MichelleNeural",
    "en-US-EmmaNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-AvaMultilingualNeural"
  ],
  announcer: [
    "en-US-BrianNeural",
    "en-US-SteffanNeural",
    "en-US-GuyNeural",
    "en-GB-ThomasNeural",
    "en-US-BrianMultilingualNeural",
    "en-AU-WilliamMultilingualNeural",
    "en-GB-RyanNeural"
  ],
  engineer: [
    "en-US-AndrewNeural",
    "en-US-ChristopherNeural",
    "en-US-GuyNeural",
    "en-US-SteffanNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-BrianMultilingualNeural",
    "en-AU-WilliamMultilingualNeural",
    "en-US-BrianNeural"
  ]
};

const getLanguagePrefix = (lang: string): string =>
  lang.trim().toLowerCase().split(/[-_]/)[0] ?? "";

export const normalizeSpeechProviderId = (
  speechProviderId: string | null | undefined
): SpeechProviderId =>
  speechProviderIdSet.has(speechProviderId ?? "")
    ? (speechProviderId as SpeechProviderId)
    : defaultSpeechProviderId;

export const buildTtsApiUrl = (backendWsUrl: string, path: string): string => {
  const baseUrl = resolveBackendHttpBaseUrl(backendWsUrl);

  if (!baseUrl) {
    return "";
  }

  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
};

const normalizeTtsModelSummary = (value: unknown): TtsModelSummary | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const model = value as Partial<TtsModelSummary>;

  if (
    typeof model.id !== "string" ||
    typeof model.label !== "string" ||
    typeof model.detail !== "string" ||
    typeof model.locale !== "string" ||
    (model.gender !== "Female" && model.gender !== "Male") ||
    typeof model.multilingual !== "boolean"
  ) {
    return null;
  }

  return {
    id: model.id,
    label: model.label,
    detail: model.detail,
    locale: model.locale,
    gender: model.gender,
    multilingual: model.multilingual
  };
};

export const loadTtsModels = async (backendWsUrl: string): Promise<LoadTtsModelsResult> => {
  const apiUrl = buildTtsApiUrl(backendWsUrl, "/api/tts/models");

  if (!apiUrl) {
    return {
      defaultModelId: "",
      models: []
    };
  }

  const response = await fetch(apiUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Could not load TTS models (${response.status}).`);
  }

  const payload = (await response.json()) as TtsModelsResponse;
  const models = Array.isArray(payload.models)
    ? payload.models
        .map((model) => normalizeTtsModelSummary(model))
        .filter((model): model is TtsModelSummary => model !== null)
    : [];

  return {
    defaultModelId:
      typeof payload.defaultModelId === "string" && payload.defaultModelId.trim()
        ? payload.defaultModelId
        : models[0]?.id ?? "",
    models
  };
};

export const requestTtsAudio = async ({
  backendWsUrl,
  text,
  voiceId,
  lang,
  rate,
  pitch,
  signal
}: RequestTtsAudioOptions): Promise<Blob> => {
  const apiUrl = buildTtsApiUrl(backendWsUrl, "/api/tts/synthesize");

  if (!apiUrl) {
    throw new Error("Backend HTTP URL is not available for TTS.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      voiceId,
      lang,
      rate,
      pitch
    }),
    signal
  });

  if (!response.ok) {
    let message = `Speech synthesis failed (${response.status}).`;

    try {
      const payload = (await response.json()) as TtsErrorResponse;
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // Keep the default message when the backend didn't return JSON.
    }

    throw new Error(message);
  }

  const audioBlob = await response.blob();

  if (audioBlob.size <= 0) {
    throw new Error("Speech synthesis returned empty audio.");
  }

  return audioBlob;
};

export const toEdgeRate = (rate: number): string => {
  const delta = Math.round((rate - 1) * 100);
  return delta === 0 ? "default" : `${delta > 0 ? "+" : ""}${delta}%`;
};

export const toEdgePitch = (pitch: number): string => {
  const deltaHz = Math.round((pitch - 1) * 120);
  return deltaHz === 0 ? "default" : `${deltaHz > 0 ? "+" : ""}${deltaHz}Hz`;
};

export const filterTtsModelsForVoiceProfile = (
  models: TtsModelSummary[],
  voiceProfileId: VoiceProfileId
): TtsModelSummary[] => {
  if (models.length === 0) {
    return [];
  }

  const preset = getVoiceProfilePreset(voiceProfileId);
  const targetLanguagePrefix = getLanguagePrefix(preset.lang);

  if (targetLanguagePrefix === "ru") {
    const multilingualModels = models.filter((model) => model.multilingual);
    return multilingualModels.length > 0 ? multilingualModels : models;
  }

  const exactLocaleModels = models.filter((model) => model.locale === preset.lang);
  if (exactLocaleModels.length > 0) {
    return exactLocaleModels;
  }

  const matchingPrefixModels = models.filter(
    (model) => getLanguagePrefix(model.locale) === targetLanguagePrefix
  );
  if (matchingPrefixModels.length > 0) {
    return matchingPrefixModels;
  }

  const englishModels = models.filter((model) => getLanguagePrefix(model.locale) === "en");
  return englishModels.length > 0 ? englishModels : models;
};

const scoreTtsModel = (model: TtsModelSummary, voiceProfileId: VoiceProfileId): number => {
  const preset = getVoiceProfilePreset(voiceProfileId);
  const targetLanguagePrefix = getLanguagePrefix(preset.lang);
  const modelLanguagePrefix = getLanguagePrefix(model.locale);
  const hints = voiceProfileModelHints[voiceProfileId];
  let score = 0;

  if (targetLanguagePrefix === "ru") {
    if (model.multilingual) {
      score += 16;
    }
    if (model.locale === "en-US") {
      score += 6;
    } else if (modelLanguagePrefix === "en") {
      score += 4;
    }
  } else if (model.locale === preset.lang) {
    score += 12;
  } else if (modelLanguagePrefix === targetLanguagePrefix) {
    score += 8;
  } else if (model.multilingual) {
    score += 2;
  }

  const hintIndex = hints.indexOf(model.id);
  if (hintIndex >= 0) {
    score += Math.max(10 - hintIndex * 2, 4);
  }

  if (model.gender === "Male" && ["analyst", "announcer", "engineer"].includes(voiceProfileId)) {
    score += 2;
  }

  if (model.gender === "Female" && ["default", "builder", "russian"].includes(voiceProfileId)) {
    score += 2;
  }

  return score;
};

export const pickTtsModel = (
  models: TtsModelSummary[],
  voiceProfileId: VoiceProfileId,
  preferredModelId: string | null | undefined = null
): TtsModelSummary | null => {
  const candidates = filterTtsModelsForVoiceProfile(models, voiceProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (preferredModelId) {
    const preferredModel = candidates.find((model) => model.id === preferredModelId);
    if (preferredModel) {
      return preferredModel;
    }
  }

  return [...candidates].sort(
    (left, right) => scoreTtsModel(right, voiceProfileId) - scoreTtsModel(left, voiceProfileId)
  )[0];
};
