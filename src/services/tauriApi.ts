import { invoke } from "@tauri-apps/api/core";
import type { HandRole, MidiDeviceInfo, ParsedSong, SongSettings, SongSummary, SoundProfile, SoundFontInfo } from "@/types/midi";
import type { RecordedNoteEvent, RecordedSustainEvent } from "@/stores/useRecordingStore";

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

export async function audioSetSongVolume(volume: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_song_volume", { volume });
}

export async function audioSetLiveVolume(volume: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_live_volume", { volume });
}

export async function audioSetTempo(tempoScale: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_tempo", { tempoScale });
}

export async function audioSetLoop(
  enabled: boolean,
  startSec?: number | null,
  endSec?: number | null,
  pauseOnWrap: boolean = false
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_loop", {
    enabled,
    startSec: startSec ?? null,
    endSec: endSec ?? null,
    pauseOnWrap,
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

export async function audioSetStudyRange(
  skipOutOfRange: boolean,
  minMidi: number,
  maxMidi: number
): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_study_range", { skipOutOfRange, minMidi, maxMidi });
}

export async function audioSetTranspose(semitones: number): Promise<void> {
  if (!isTauri) return;
  await invoke("audio_set_transpose", { semitones });
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

export async function deleteSoundfont(path: string): Promise<string | null> {
  if (!isTauri) return null;
  return await invoke<string | null>("delete_soundfont", { path });
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

export async function pickMidiFiles(): Promise<string[]> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: true,
      title: "Add MIDI Files",
      filters: [{ name: "MIDI Files", extensions: ["mid", "midi"] }],
    });
    if (Array.isArray(selected)) {
      return selected.filter((p): p is string => typeof p === "string");
    }
    if (selected && typeof selected === "string") {
      return [selected];
    }
  } catch (err) {
    console.warn("MIDI file picker error:", err);
  }
  return [];
}

// Recording & Export APIs
export interface FreeplayRecordingPayload {
  title: string;
  bpm: number;
  notes: RecordedNoteEvent[];
  sustainEvents: RecordedSustainEvent[];
}

export interface SavedRecordingResult {
  filePath: string;
  folder: string;
  filename: string;
}

export async function saveFreeplayMidi(
  title: string,
  payload: FreeplayRecordingPayload,
  customPath?: string | null
): Promise<SavedRecordingResult> {
  return await invoke<SavedRecordingResult>("save_freeplay_midi", {
    title,
    payload,
    customPath: customPath ?? null,
  });
}

export async function exportMidiCopy(
  sourcePath: string,
  destPath: string
): Promise<void> {
  await invoke("export_midi_copy", { sourcePath, destPath });
}

export async function exportSongAudio(
  midiPath: string,
  outputPath: string,
  format: "mp3" | "wav"
): Promise<void> {
  await invoke("export_song_audio", { midiPath, outputPath, format });
}

export async function exportFreeplayAudio(
  payload: FreeplayRecordingPayload,
  outputPath: string,
  format: "mp3" | "wav"
): Promise<void> {
  await invoke("export_freeplay_audio", { payload, outputPath, format });
}

// Library File & Folder Management APIs
export async function deleteLibrarySong(filePath: string): Promise<void> {
  if (!isTauri) return;
  await invoke("delete_library_song", { filePath });
}

export async function listLibraryFolders(): Promise<string[]> {
  if (!isTauri) return [];
  return await invoke<string[]>("list_library_folders");
}

export async function createLibraryFolder(
  parentRelativePath: string,
  folderName: string
): Promise<string> {
  return await invoke<string>("create_library_folder", {
    parentRelativePath,
    folderName,
  });
}

export async function moveLibrarySong(
  filePath: string,
  targetFolderRelative: string
): Promise<string> {
  return await invoke<string>("move_library_song", {
    filePath,
    targetFolderRelative,
  });
}

export async function renameLibrarySong(
  filePath: string,
  newTitle: string
): Promise<string> {
  return await invoke<string>("rename_library_song", {
    filePath,
    newTitle,
  });
}

export async function renameLibraryFolder(
  relativePath: string,
  newName: string
): Promise<string> {
  return await invoke<string>("rename_library_folder", {
    relativePath,
    newName,
  });
}

export async function deleteLibraryFolder(relativePath: string): Promise<void> {
  await invoke("delete_library_folder", { relativePath });
}

export async function importMidiFiles(
  sourcePaths: string[],
  targetFolderRelative: string
): Promise<string[]> {
  if (!isTauri || sourcePaths.length === 0) return [];
  return await invoke<string[]>("import_midi_files", {
    sourcePaths,
    targetFolderRelative,
  });
}

export async function revealInFileManager(
  path: string,
  isRelativeFolder = false
): Promise<void> {
  if (!isTauri) return;
  await invoke("reveal_in_file_manager", {
    path,
    isRelativeFolder,
  });
}
