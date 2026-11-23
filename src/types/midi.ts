export type HandRole = 'right' | 'left' | 'both' | 'none';

export interface MidiNote {
  id: number;
  midi: number;         // 21 (A0) .. 108 (C8)
  startSec: number;
  durationSec: number;
  velocity: number;     // 0 .. 127
  trackIndex: number;
  channel: number;
  defaultHand: 'right' | 'left';
}

export interface MidiTrackInfo {
  trackIndex: number;
  name: string;
  noteCount: number;
  avgPitch: number;
  defaultHand: HandRole;
}

export interface PedalEvent {
  timeSec: number;
  value: number;        // 0 .. 127 (>= 64 = down)
}

export interface ParsedSong {
  contentHash: string;
  filePath: string;
  title: string;
  durationSec: number;
  initialBpm: number;
  tracks: MidiTrackInfo[];
  notes: MidiNote[];
  pedalEvents: PedalEvent[];
}

export interface SongSummary {
  contentHash: string;
  relativePath: string;
  filePath: string;
  title: string;
  folder: string;
  durationSec: number;
  initialBpm: number;
  trackCount: number;
  isFavorite: boolean;
  lastPlayedAt: number | null;
  addedAt: number;
  peakStartSec: number;
  previewPeakJson: string;
  previewStartJson: string;
}

export interface SongSettings {
  contentHash: string;
  trackHands: Record<number, HandRole>; // trackIndex -> HandRole
  splitPointMidi: number;               // default 60 (C4)
  useSplitPoint: boolean;
  tempoScale: number;                   // 0.25 .. 2.0, default 1.0
  loopEnabled: boolean;
  loopStartSec: number | null;
  loopEndSec: number | null;
}

export type TouchPreset = 'soft' | 'balanced' | 'strong';

export interface SoundProfile {
  reverbMix: number; // 0.0 .. 0.45
  touch: TouchPreset;
}

export interface SoundFontInfo {
  id: string;
  name: string;
  path: string;
  sizeMb: number;
  isBundled: boolean;
}

export interface MidiDeviceInfo {
  name: string;
  suggestedKeyCount: number | null;
}

export interface MidiLiveEventPayload {
  kind: 'noteOn' | 'noteOff' | 'sustain';
  midi: number;
  velocity: number;
}
