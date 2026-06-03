import type { SignalSoundId } from "./types";

interface SignalTone {
  duration: number;
  frequency: number;
  start: number;
  type?: OscillatorType;
}

export interface SignalSoundPreset {
  detail: string;
  id: SignalSoundId;
  label: string;
  tones: SignalTone[];
}

export const defaultSignalSoundId: SignalSoundId = "classic-chime";

export const signalSoundPresets: SignalSoundPreset[] = [
  {
    id: "classic-chime",
    label: "Classic Chime",
    detail: "Bright three-note confirmation",
    tones: [
      { frequency: 880, start: 0, duration: 0.18, type: "sine" },
      { frequency: 1174.66, start: 0.13, duration: 0.22, type: "sine" },
      { frequency: 1567.98, start: 0.29, duration: 0.28, type: "sine" }
    ]
  },
  {
    id: "radar-ping",
    label: "Radar Ping",
    detail: "Focused dual ping for fast scans",
    tones: [
      { frequency: 740, start: 0, duration: 0.12, type: "triangle" },
      { frequency: 1244.51, start: 0.18, duration: 0.16, type: "triangle" },
      { frequency: 932.33, start: 0.42, duration: 0.12, type: "triangle" }
    ]
  },
  {
    id: "market-sweep",
    label: "Market Sweep",
    detail: "Softer rising sweep for momentum shifts",
    tones: [
      { frequency: 523.25, start: 0, duration: 0.16, type: "sawtooth" },
      { frequency: 659.25, start: 0.12, duration: 0.18, type: "sawtooth" },
      { frequency: 783.99, start: 0.24, duration: 0.2, type: "sawtooth" },
      { frequency: 1046.5, start: 0.4, duration: 0.24, type: "sawtooth" }
    ]
  }
];

const signalSoundPresetMap = new Map(
  signalSoundPresets.map((preset) => [preset.id, preset] as const)
);

export const normalizeSignalSoundId = (
  signalSoundId: string | null | undefined
): SignalSoundId =>
  signalSoundPresetMap.has(signalSoundId as SignalSoundId)
    ? (signalSoundId as SignalSoundId)
    : defaultSignalSoundId;

export const getSignalSoundPreset = (
  signalSoundId: string | null | undefined
): SignalSoundPreset =>
  signalSoundPresetMap.get(normalizeSignalSoundId(signalSoundId)) ?? signalSoundPresets[0];

export const playSignalSound = (
  signalSoundId: string | null | undefined,
  audioContextRef: { current: AudioContext | null }
): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

  try {
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;

    if (context.state === "suspended") {
      void context.resume();
    }

    const preset = getSignalSoundPreset(signalSoundId);
    const master = context.createGain();

    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.92);
    master.connect(context.destination);

    for (const tone of preset.tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + tone.start;
      const endAt = startAt + tone.duration;

      oscillator.type = tone.type ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(1, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.04);
    }

    return true;
  } catch {
    return false;
  }
};

export const playCriticalAlertSound = (
  audioContextRef: { current: AudioContext | null }
): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

  try {
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;

    if (context.state === "suspended") {
      void context.resume();
    }

    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.48, context.currentTime + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.55);
    master.connect(context.destination);

    const tones: SignalTone[] = [
      { frequency: 880, start: 0, duration: 0.18, type: "square" },
      { frequency: 440, start: 0.16, duration: 0.22, type: "sawtooth" },
      { frequency: 1046.5, start: 0.42, duration: 0.18, type: "square" },
      { frequency: 523.25, start: 0.58, duration: 0.25, type: "sawtooth" },
      { frequency: 1318.51, start: 0.9, duration: 0.28, type: "square" }
    ];

    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + tone.start;
      const endAt = startAt + tone.duration;

      oscillator.type = tone.type ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(1, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.04);
    }

    return true;
  } catch {
    return false;
  }
};
