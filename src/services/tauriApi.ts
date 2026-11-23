import { invoke } from "@tauri-apps/api/core";
import type { HandRole, MidiDeviceInfo, ParsedSong, SongSettings, SongSummary, SoundProfile, SoundFontInfo } from "@/types/midi";

const isTauri =
  typeof window !== "undefined" &&
  Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );

// Library & Database APIs
export async function getRootFolder(): Promise<string | null> {
  if (!isTauri) return null;
  return await invoke<string | null>("get_root_folder");
}

export async function setRootFolder(folderPath: string): Promise<SongSummary[]> {
  if (!isTauri) return [];
  return await invoke<SongSummary[]>("set_root_folder", { folderPath });
}

export async function getLibrarySongs(): Promise<SongSummary[]> {
  if (!isTauri) return [];
  return await invoke<SongSummary[]>("get_library_songs");
}

export async function loadSong(filePath: string): Promise<[ParsedSong, SongSettings]> {
  return await invoke<[ParsedSong, SongSettings]>("load_song", { filePath });
}

export async function saveSongSettings(settings: SongSettings): Promise<void> {
  if (!isTauri) return;
  await invoke("save_song_settings", { settings });
}

export async function toggleFavorite(contentHash: string): Promise<boolean> {
  if (!isTauri) return false;
  return await invoke<boolean>("toggle_favorite", { contentHash });
}

export async function getAppSetting(key: string): Promise<string | null> {
  if (!isTauri) return null;
  return await invoke<string | null>("get_app_setting", { key });
}

export async function getSongPreviewNotes(
  filePath: string
): Promise<Array<[number, number, number, number]>> {
  if (!isTauri) return [];
  return await invoke<Array<[number, number, number, number]>>(
    "get_song_preview_notes",
    { filePath }
  );
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!isTauri) return;
  await invoke("set_app_setting", { key, value });
}

// Audio Engine & Playback APIs
export async function audioLoadSong(
  filePath: string,
  settings: SongSettings
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_load_song", { filePath, settings });
}

export async function audioPlay(): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_play");
}

export async function audioPause(): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_pause");
}

export async function audioSeek(timeSec: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_seek", { timeSec });
}

export async function audioSetVolume(volume: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_volume", { volume });
}

export async function audioSetTempo(tempoScale: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_tempo", { tempoScale });
}

export async function audioSetLoop(
  enabled: boolean,
  startSec?: number | null,
  endSec?: number | null
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_loop", {
    enabled,
    startSec: startSec ?? null,
    endSec: endSec ?? null,
  });
}

export async function audioSetHandFilters(
  rightEnabled: boolean,
  leftEnabled: boolean,
  trackHands: Record<number, HandRole>,
  splitPointMidi: number,
  useSplitPoint: boolean
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_hand_filters", {
    rightEnabled,
    leftEnabled,
    trackHands,
    splitPointMidi,
    useSplitPoint,
  });
}

export async function audioLiveNoteOn(
  key: number,
  velocity: number = 90
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_live_note_on", { key, velocity });
}

export async function audioLiveNoteOff(key: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_live_note_off", { key });
}

export async function audioLiveAllNotesOff(): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_live_all_notes_off");
}

export async function audioSetStudyMode(
  enabled: boolean,
  waitRight: boolean,
  waitLeft: boolean
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_study_mode", { enabled, waitRight, waitLeft });
}

export async function audioStartPreview(
  filePath: string,
  startSec: number,
  volume: number = 0.4
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_start_preview", { filePath, startSec, volume });
}

export async function audioStopPreview(): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_stop_preview");
}

export async function audioSetSoundProfile(
  profile: SoundProfile
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_sound_profile", { profile });
}

export async function listSoundfonts(): Promise<SoundFontInfo[]> {
  if (!isTauri) return [];
  return await invoke<SoundFontInfo[]>("list_soundfonts");
}

export async function selectSoundfont(path: string): Promise<void> {
  if (!isTauri) return;
  await invoke("select_soundfont", { path });
}

export async function importSoundfont(
  sourcePath: string
): Promise<SoundFontInfo | null> {
  if (!isTauri) return null;
  return await invoke<SoundFontInfo>("import_soundfont", { sourcePath });
}

// Hardware MIDI Input APIs
export async function listMidiDevices(): Promise<MidiDeviceInfo[]> {
  if (!isTauri) return [];
  return await invoke<MidiDeviceInfo[]>("list_midi_devices");
}

export async function connectMidiDevice(
  portName: string
): Promise<MidiDeviceInfo | null> {
  if (!isTauri) return null;
  return await invoke<MidiDeviceInfo>("connect_midi_device", { portName });
}

export async function disconnectMidiDevice(): Promise<void> {
  if (!isTauri) return;
  await invoke("disconnect_midi_device");
}

export async function getConnectedMidiDevice(): Promise<string | null> {
  if (!isTauri) return null;
  return await invoke<string | null>("get_connected_midi_device");
}

// Window & Native Dialog Helpers
export async function setAppWindowTitle(title: string): Promise<void> {
  if (typeof document !== "undefined") {
    document.title = title;
  }
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (win && typeof win.setTitle === "function") {
      await win.setTitle(title);
    }
  } catch (err) {
    console.warn("Failed to set window title:", err);
  }
}

export async function pickMidiFolder(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select MIDI Directory",
    });
    if (selected && typeof selected === "string") {
      return selected;
    }
  } catch (err) {
    console.warn("Folder picker error or fallback:", err);
  }
  return null;
}
