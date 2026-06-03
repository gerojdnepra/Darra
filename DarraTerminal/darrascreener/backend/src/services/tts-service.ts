import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EdgeTTS } from "node-edge-tts";

export interface TtsModelSummary {
  id: string;
  label: string;
  detail: string;
  locale: string;
  gender: "Female" | "Male";
  multilingual: boolean;
}

interface SynthesizeSpeechOptions {
  text: string;
  voiceId?: string | null;
  lang?: string | null;
  rate?: string | null;
  pitch?: string | null;
}

const maxSpeechTextLength = 500;
const defaultTtsModelId = "en-US-AvaMultilingualNeural";
const fallbackTtsModelId = "en-US-AndrewMultilingualNeural";
const cyrillicTextPattern = /[\u0400-\u04ff]/;

const ttsModels: TtsModelSummary[] = [
  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava Multilingual",
    detail: "Balanced female neural model for English and Russian alerts",
    locale: "en-US",
    gender: "Female",
    multilingual: true
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew Multilingual",
    detail: "Calm male neural model with clean speech for fast signals",
    locale: "en-US",
    gender: "Male",
    multilingual: true
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma Multilingual",
    detail: "Brighter female neural model with a more energetic tone",
    locale: "en-US",
    gender: "Female",
    multilingual: true
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian Multilingual",
    detail: "Deeper male neural model for punchier alert delivery",
    locale: "en-US",
    gender: "Male",
    multilingual: true
  },
  {
    id: "en-AU-WilliamMultilingualNeural",
    label: "William Multilingual",
    detail: "Crisp Australian multilingual neural model with strong clarity",
    locale: "en-AU",
    gender: "Male",
    multilingual: true
  },
  {
    id: "en-GB-RyanNeural",
    label: "Ryan",
    detail: "British male neural voice with precise, measured delivery",
    locale: "en-GB",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia",
    detail: "British female neural voice with a crisp, lighter cadence",
    locale: "en-GB",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-GB-ThomasNeural",
    label: "Thomas",
    detail: "British male neural voice with a firmer studio-style tone",
    locale: "en-GB",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-GB-LibbyNeural",
    label: "Libby",
    detail: "Smooth British female neural voice that sounds less synthetic on short alerts",
    locale: "en-GB",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-GB-MaisieNeural",
    label: "Maisie",
    detail: "Brighter British female neural voice with cleaner consonants",
    locale: "en-GB",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-AriaNeural",
    label: "Aria",
    detail: "Clear female neural voice with a polished broadcast tone",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-JennyNeural",
    label: "Jenny",
    detail: "Natural female neural voice with smooth phrasing",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-AvaNeural",
    label: "Ava",
    detail: "Neutral US female voice with softer phrasing than the multilingual model",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-AnaNeural",
    label: "Ana",
    detail: "Lighter US female voice that cuts through fast alert playback",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-EmmaNeural",
    label: "Emma",
    detail: "Warm US female voice with slightly fuller intonation",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-MichelleNeural",
    label: "Michelle",
    detail: "Steadier US female voice with a clear desk-speaker feel",
    locale: "en-US",
    gender: "Female",
    multilingual: false
  },
  {
    id: "en-US-GuyNeural",
    label: "Guy",
    detail: "Confident male neural voice with strong intelligibility",
    locale: "en-US",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-US-SteffanNeural",
    label: "Steffan",
    detail: "Deeper male neural voice with a steadier, fuller tone",
    locale: "en-US",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-US-AndrewNeural",
    label: "Andrew",
    detail: "Balanced US male neural voice with cleaner articulation than the multilingual preset",
    locale: "en-US",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-US-BrianNeural",
    label: "Brian",
    detail: "Punchier US male voice for stronger high-priority callouts",
    locale: "en-US",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-US-ChristopherNeural",
    label: "Christopher",
    detail: "Lower US male voice with calmer pacing for analytical alerts",
    locale: "en-US",
    gender: "Male",
    multilingual: false
  },
  {
    id: "en-AU-NatashaNeural",
    label: "Natasha",
    detail: "Australian female neural voice with very crisp short-form delivery",
    locale: "en-AU",
    gender: "Female",
    multilingual: false
  }
];

const ttsModelMap = new Map(ttsModels.map((model) => [model.id, model] as const));
const multilingualFallbackModelIds = [
  defaultTtsModelId,
  fallbackTtsModelId,
  "en-US-EmmaMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-AU-WilliamMultilingualNeural"
];
const generalFallbackModelIds = [
  defaultTtsModelId,
  fallbackTtsModelId,
  "en-US-EmmaMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-AriaNeural",
  "en-US-JennyNeural",
  "en-US-AvaNeural",
  "en-US-AndrewNeural",
  "en-US-BrianNeural",
  "en-GB-ThomasNeural"
];

const deduplicate = <T>(values: T[]): T[] => Array.from(new Set(values));

const clampSpeechText = (value: string): string => value.trim().slice(0, maxSpeechTextLength);

const normalizeSpeechRate = (value: string | null | undefined): string =>
  value?.trim() ? value.trim() : "default";

const normalizeSpeechPitch = (value: string | null | undefined): string =>
  value?.trim() ? value.trim() : "default";

const normalizeSpeechLang = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  return trimmed || "en-US";
};

const normalizeTtsModelId = (value: string | null | undefined): string =>
  value && ttsModelMap.has(value) ? value : defaultTtsModelId;

const buildVoiceCandidates = (text: string, voiceId: string): string[] => {
  const requiresMultilingualVoice = cyrillicTextPattern.test(text);
  const candidates = [
    voiceId,
    ...(requiresMultilingualVoice ? multilingualFallbackModelIds : generalFallbackModelIds)
  ];

  return deduplicate(candidates).filter((candidate) => {
    const model = ttsModelMap.get(candidate);

    if (!model) {
      return false;
    }

    return !requiresMultilingualVoice || model.multilingual;
  });
};

const synthesizeWithVoice = async (
  text: string,
  voiceId: string,
  lang: string,
  rate: string,
  pitch: string
): Promise<Buffer> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scalpstation-tts-"));
  const tempFilePath = path.join(tempDir, `${randomUUID()}.mp3`);

  try {
    const tts = new EdgeTTS({
      voice: voiceId,
      lang,
      rate,
      pitch,
      volume: "+0%",
      timeout: 20_000
    });

    await tts.ttsPromise(text, tempFilePath);
    return await fs.readFile(tempFilePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

export const listTtsModels = (): TtsModelSummary[] => ttsModels;

export const synthesizeSpeech = async ({
  text,
  voiceId,
  lang,
  rate,
  pitch
}: SynthesizeSpeechOptions): Promise<Buffer> => {
  const normalizedText = clampSpeechText(text);

  if (!normalizedText) {
    throw new Error("Speech text is empty.");
  }

  const normalizedVoiceId = normalizeTtsModelId(voiceId);
  const normalizedLang = normalizeSpeechLang(lang);
  const normalizedRate = normalizeSpeechRate(rate);
  const normalizedPitch = normalizeSpeechPitch(pitch);
  const voiceCandidates = buildVoiceCandidates(normalizedText, normalizedVoiceId);
  let lastError: Error | null = null;

  for (const candidate of voiceCandidates) {
    try {
      const audioBuffer = await synthesizeWithVoice(
        normalizedText,
        candidate,
        normalizedLang,
        normalizedRate,
        normalizedPitch
      );

      if (audioBuffer.byteLength > 0) {
        return audioBuffer;
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Speech synthesis candidate failed.");
    }
  }

  if (lastError) {
    throw new Error(`Speech synthesis failed across all candidate voices. ${lastError.message}`);
  }

  throw new Error("Speech synthesis returned an empty audio stream.");
};
