import type { LegacyVoiceProfileId, VoiceProfileId } from "./types";

export interface VoiceProfilePreset {
  id: VoiceProfileId;
  label: string;
  badgeLabel: string;
  detail: string;
  previewText: string;
  lang: string;
  rate: number;
  pitch: number;
  preferredNames: string[];
  avoidedNames?: string[];
}

export const defaultVoiceProfileId: VoiceProfileId = "default";
export const russianVoiceProfileId: VoiceProfileId = "russian";

const voiceProfileIds: VoiceProfileId[] = [
  "default",
  "russian",
  "analyst",
  "builder",
  "announcer",
  "engineer"
];

const legacyVoiceProfileMap: Record<LegacyVoiceProfileId, VoiceProfileId> = {
  satoshi: "analyst",
  vitalik: "builder",
  trump: "announcer",
  elon: "engineer"
};

const voiceProfileIdSet = new Set<string>(voiceProfileIds);

export const normalizeVoiceProfileId = (
  voiceProfileId: string | null | undefined
): VoiceProfileId => {
  if (!voiceProfileId) {
    return defaultVoiceProfileId;
  }

  if (voiceProfileId in legacyVoiceProfileMap) {
    return legacyVoiceProfileMap[voiceProfileId as LegacyVoiceProfileId];
  }

  return voiceProfileIdSet.has(voiceProfileId)
    ? (voiceProfileId as VoiceProfileId)
    : defaultVoiceProfileId;
};

export const voiceProfilePresets: VoiceProfilePreset[] = [
  {
    id: "default",
    label: "System",
    badgeLabel: "system",
    detail: "Default browser voice",
    previewText: "System voice ready. Market feed live.",
    lang: "en-US",
    rate: 1,
    pitch: 1,
    preferredNames: []
  },
  {
    id: "russian",
    label: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
    badgeLabel: "\u0440\u0443\u0441",
    detail:
      "\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442 \u043d\u0430\u0442\u0443\u0440\u0430\u043b\u044c\u043d\u044b\u043c ru-RU \u0433\u043e\u043b\u043e\u0441\u0430\u043c, \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u043c \u043d\u0430 \u044d\u0442\u043e\u043c \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435",
    previewText:
      "\u0420\u0443\u0441\u0441\u043a\u0438\u0439 \u0433\u043e\u043b\u043e\u0441 \u0432\u043a\u043b\u044e\u0447\u0435\u043d. \u041a\u0430\u043d\u0430\u043b \u0441\u0438\u0433\u043d\u0430\u043b\u043e\u0432 \u0430\u043a\u0442\u0438\u0432\u0435\u043d.",
    lang: "ru-RU",
    rate: 0.92,
    pitch: 0.96,
    preferredNames: [
      "google \u0440\u0443\u0441\u0441\u043a\u0438\u0439",
      "google russian",
      "microsoft irina",
      "microsoft pavel",
      "microsoft sveta",
      "microsoft daria",
      "microsoft",
      "desktop",
      "\u0438\u0440\u0438\u043d\u0430",
      "\u043f\u0430\u0432\u0435\u043b",
      "\u0441\u0432\u0435\u0442\u0430",
      "\u0434\u0430\u0440\u044c\u044f",
      "\u0430\u043d\u043d\u0430",
      "\u043e\u043b\u044c\u0433\u0430",
      "\u043e\u043a\u0441\u0430\u043d\u0430",
      "\u0441\u0435\u0440\u0433\u0435\u0439",
      "\u0442\u0430\u0442\u044c\u044f\u043d\u0430",
      "milena",
      "yuri",
      "anna",
      "olga",
      "oksana",
      "sergey",
      "tatyana",
      "online",
      "neural",
      "russian",
      "\u0440\u0443\u0441\u0441\u043a\u0438\u0439",
      "ru-ru"
    ],
    avoidedNames: ["espeak", "pico", "festival", "speech dispatcher"]
  },
  {
    id: "analyst",
    label: "Satoshi",
    badgeLabel: "satoshi",
    detail: "Bitcoin-creator style preset with calm, lower delivery",
    previewText: "Satoshi style voice ready. Bitcoin alert channel online.",
    lang: "en-GB",
    rate: 0.94,
    pitch: 0.84,
    preferredNames: ["google uk english male", "daniel", "george", "arthur", "david", "male"],
    avoidedNames: ["female", "zira", "samantha"]
  },
  {
    id: "builder",
    label: "Vitalik",
    badgeLabel: "vitalik",
    detail: "Builder style preset with lighter, faster tempo",
    previewText: "Vitalik style voice ready. Ethereum signal engine online.",
    lang: "en-US",
    rate: 1.08,
    pitch: 1.02,
    preferredNames: ["mark", "alex", "andrew", "google us english", "male"],
    avoidedNames: ["female", "zira", "samantha"]
  },
  {
    id: "announcer",
    label: "Trump",
    badgeLabel: "trump",
    detail: "Emphatic announcement preset for major signals",
    previewText: "Trump style voice preset ready. Major signal incoming.",
    lang: "en-US",
    rate: 0.9,
    pitch: 0.78,
    preferredNames: ["david", "guy", "mark", "google uk english male", "male"],
    avoidedNames: ["female", "zira", "samantha"]
  },
  {
    id: "engineer",
    label: "Elon",
    badgeLabel: "elon",
    detail: "Lower-pitch founder preset with measured pacing",
    previewText: "Elon style voice preset ready. Launching signal monitor.",
    lang: "en-US",
    rate: 0.98,
    pitch: 0.86,
    preferredNames: ["mark", "alex", "guy", "google us english", "male"],
    avoidedNames: ["female", "zira", "samantha"]
  }
];

const voiceProfilePresetMap = new Map(
  voiceProfilePresets.map((profile) => [profile.id, profile] as const)
);

export const getVoiceProfilePreset = (
  voiceProfileId: string | null | undefined
): VoiceProfilePreset =>
  voiceProfilePresetMap.get(normalizeVoiceProfileId(voiceProfileId)) ?? voiceProfilePresets[0];
