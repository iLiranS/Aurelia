import React, { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopBar } from "@/components/hud/TopBar";
import { HomeExplorer } from "@/components/home/HomeExplorer";
import { TransportDock } from "@/components/hud/TransportDock";
import { PianoStage } from "@/components/stage/PianoStage";
import { ShortcutManagerDialog } from "@/components/hud/ShortcutManagerDialog";
import { RecordingReviewDialog } from "@/components/hud/RecordingReviewDialog";
import { Toaster } from "@/components/ui/toast";
import { usePersistSongSettings } from "@/hooks/usePersistSongSettings";
import { useQwertyPiano } from "@/hooks/useQwertyPiano";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { useViewStore } from "@/stores/useViewStore";
import { playbackClock } from "@/engine/playbackClock";
import { getRootFolder, getLibrarySongs, getAppSetting, audioSetSoundProfile, setAppWindowTitle, listMidiDevices } from "@/services/tauriApi";
import { useThemeStore } from "@/stores/useThemeStore";
import { useSoundStore } from "@/stores/useSoundStore";
import { useMidiStore } from "@/stores/useMidiStore";
import type { MidiDeviceInfo, MidiLiveEventPayload } from "@/types/midi";
import { activeNotes } from "@/engine/activeNotes";
import { applyAppThemeColor } from "@/themes/themeColor";
import { Piano } from "lucide-react";

interface PlaybackClockPayload {
  songTimeSec: number;
  isPlaying: boolean;
  tempoScale: number;
}

export const App: React.FC = () => {
  // Debounced SQLite auto-persistence and immediate audio sync hook
  usePersistSongSettings();
  // Optional 2-octave computer keyboard piano (QWERTY)
  useQwertyPiano();
  // Global customizable keyboard shortcuts dispatcher
  useGlobalShortcuts();

  const activeSong = useLibraryStore((s) => s.activeSong);
  const setRootFolder = useLibraryStore((s) => s.setRootFolder);
  const setSongs = useLibraryStore((s) => s.setSongs);

  const viewMode = useViewStore((s) => s.viewMode);

  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const setDisplayTimeSec = usePlaybackStore((s) => s.setDisplayTimeSec);

  const performanceMode = useThemeStore((s) => s.performanceMode);
  const setPerformanceMode = useThemeStore((s) => s.setPerformanceMode);
  const rightHandColor = useThemeStore((s) => s.rightHandColor);

  const focusEnterPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (viewMode !== "song" && performanceMode) {
      setPerformanceMode(false);
    }
  }, [viewMode, performanceMode, setPerformanceMode]);

  useEffect(() => {
    if (!performanceMode) {
      focusEnterPosRef.current = null;
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const enterPos = focusEnterPosRef.current;
      if (enterPos) {
        const dist = Math.hypot(e.clientX - enterPos.x, e.clientY - enterPos.y);
        if (dist <= 6) return;
      }
      setPerformanceMode(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [performanceMode, setPerformanceMode]);

  const handleStageClick = (e: React.MouseEvent<HTMLElement>) => {
    if (viewMode !== "song" || performanceMode) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, [role="button"], [role="region"], [role="dialog"]')) {
      return;
    }
    focusEnterPosRef.current = { x: e.clientX, y: e.clientY };
    setPerformanceMode(true);
  };

  useEffect(() => {
    applyAppThemeColor(rightHandColor);
  }, [rightHandColor]);

  // Dynamically update window title in real time (e.g., Aurelia - Song Name in song view)
  useEffect(() => {
    if (viewMode === "song" && activeSong) {
      setAppWindowTitle(`Aurelia - ${activeSong.title}`);
    } else {
      setAppWindowTitle("Aurelia");
    }
  }, [viewMode, activeSong]);

  const lastDisplayUpdateRef = useRef<number>(0);

  // Initialize SQLite library state on startup & listen for live folder changes
  useEffect(() => {
    let unlistenFolderFn: (() => void) | undefined;
    let unlistenClockFn: (() => void) | undefined;
    let unlistenStudyWaitFn: (() => void) | undefined;
    let unlistenSoundFontFn: (() => void) | undefined;
    let unlistenMidiLiveFn: (() => void) | undefined;
    let unlistenMidiDevicesFn: (() => void) | undefined;
    let unlistenMidiDisconnectedFn: (() => void) | undefined;

    async function initLibraryAndClock() {
      try {
        const root = await getRootFolder();
        if (root) {
          setRootFolder(root);
          const songs = await getLibrarySongs();
          setSongs(songs);
          await useLibraryStore.getState().refreshFolders();
        }

        // Hydrate saved studio appearance settings from SQLite
        const savedAppearance = await getAppSetting("appearance_v1");
        if (savedAppearance) {
          useThemeStore.getState().hydrateAppearance(savedAppearance);
        }

        // Hydrate saved custom shortcuts from SQLite
        const savedShortcuts = await getAppSetting("shortcuts_v1");
        if (savedShortcuts) {
          useShortcutStore.getState().hydrateShortcuts(savedShortcuts);
        }

        // Hydrate saved studio sound profile from SQLite
        const savedSoundProfile = await getAppSetting("sound_profile_v1");
        if (savedSoundProfile) {
          useSoundStore.getState().hydrateSoundProfile(savedSoundProfile);
        } else {
          const { reverbMix, touch } = useSoundStore.getState();
          audioSetSoundProfile({ reverbMix, touch }).catch(() => {});
        }

        // Hydrate active soundfont and discover available soundfonts
        const savedActiveSf = await getAppSetting("active_soundfont_v1");
        if (savedActiveSf) {
          useSoundStore.getState().setActiveSoundFontPath(savedActiveSf);
        }
        await useSoundStore.getState().fetchSoundfonts();

        // Hydrate hardware MIDI settings and auto-connect last device if present
        const savedMidiSettings = await getAppSetting("midi_hardware_v1");
        if (savedMidiSettings) {
          useMidiStore.getState().hydrateMidiSettings(savedMidiSettings);
        }
        const initialDevices = await listMidiDevices();
        useMidiStore.getState().setDevices(initialDevices);
        const lastMidiDevice = useMidiStore.getState().lastDeviceName;
        if (lastMidiDevice && initialDevices.some((d) => d.name === lastMidiDevice)) {
          await useMidiStore.getState().connectDevice(lastMidiDevice);
        }

        // Listen for hardware MIDI live events, device hot-plugs, and disconnects
        const unlistenMidiLive = await listen<MidiLiveEventPayload>(
          "midi:live-event",
          (event) => {
            useMidiStore.getState().handleMidiLiveEvent(event.payload);
          }
        );
        unlistenMidiLiveFn = unlistenMidiLive;

        const unlistenMidiDevices = await listen<MidiDeviceInfo[]>(
          "midi:devices-changed",
          (event) => {
            const devices = event.payload;
            const midiStore = useMidiStore.getState();
            midiStore.setDevices(devices);
            if (
              !midiStore.connectedDevice &&
              midiStore.lastDeviceName &&
              devices.some((d) => d.name === midiStore.lastDeviceName)
            ) {
              midiStore.connectDevice(midiStore.lastDeviceName);
            }
          }
        );
        unlistenMidiDevicesFn = unlistenMidiDevices;

        const unlistenMidiDisconnected = await listen<string>(
          "midi:disconnected",
          () => {
            activeNotes.clearAllLive();
            useMidiStore.getState().setConnectedDevice(null);
          }
        );
        unlistenMidiDisconnectedFn = unlistenMidiDisconnected;

        // Listen for soundfont change events
        const unlistenSoundFont = await listen<string>(
          "audio:soundfont-changed",
          (event) => {
            useSoundStore.getState().setActiveSoundFontPath(event.payload);
            useSoundStore.getState().setIsSwitchingSoundFont(false);
          }
        );
        unlistenSoundFontFn = unlistenSoundFont;

        // Listen for library updates (add/delete/rename)
        const unlistenFolder = await listen("library:updated", async () => {
          const updatedSongs = await getLibrarySongs();
          setSongs(updatedSongs);
          await useLibraryStore.getState().refreshFolders();
        });
        unlistenFolderFn = unlistenFolder;

        // Listen for Rust master audio playback clock
        const unlistenClock = await listen<PlaybackClockPayload>(
          "playback:clock",
          (event) => {
            const { songTimeSec, isPlaying: rustIsPlaying, tempoScale } = event.payload;
            playbackClock.syncFromRust(songTimeSec, rustIsPlaying, tempoScale);
            setIsPlaying(rustIsPlaying);

            // Throttle HUD display text update to ~10Hz
            const now = performance.now();
            if (now - lastDisplayUpdateRef.current >= 90 || !rustIsPlaying) {
              lastDisplayUpdateRef.current = now;
              setDisplayTimeSec(songTimeSec);
            }
          }
        );
        unlistenClockFn = unlistenClock;

        // Listen for Study Mode wait-for-input state changes
        const unlistenStudyWait = await listen<{
          isWaiting: boolean;
          waitingKeys: Array<{ midi: number; hand: number }>;
          songTimeSec: number;
        }>("playback:study-wait", (event) => {
          const { isWaiting, waitingKeys, songTimeSec } = event.payload;
          activeNotes.setWaitingKeys(waitingKeys);
          playbackClock.setWaiting(isWaiting, songTimeSec);
          usePlaybackStore.getState().setIsWaitingForInput(isWaiting);
        });
        unlistenStudyWaitFn = unlistenStudyWait;
      } catch (err) {
        console.warn("Tauri initialization (running in browser?):", err);
      }
    }

    initLibraryAndClock();

    return () => {
      if (unlistenFolderFn) unlistenFolderFn();
      if (unlistenClockFn) unlistenClockFn();
      if (unlistenStudyWaitFn) unlistenStudyWaitFn();
      if (unlistenSoundFontFn) unlistenSoundFontFn();
      if (unlistenMidiLiveFn) unlistenMidiLiveFn();
      if (unlistenMidiDevicesFn) unlistenMidiDevicesFn();
      if (unlistenMidiDisconnectedFn) unlistenMidiDisconnectedFn();
    };
  }, [setRootFolder, setSongs, setIsPlaying, setDisplayTimeSec]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="relative h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100 select-none">
        {/* Full-bleed 3D Stage (R3F Canvas) - Always mounted at fixed inset-0 */}
        <main
          onClick={handleStageClick}
          className="absolute inset-0 overflow-hidden"
        >
          <PianoStage />

          {/* Empty state prompt (only visible when in song view and no song is loaded) */}
          {viewMode === "song" && !activeSong && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none flex flex-col items-center text-center px-6 max-w-sm animate-in fade-in-50 duration-300">
              <div className="w-12 h-12 rounded-2xl liquid-glass-btn flex items-center justify-center mb-3 shadow-lg">
                <Piano className="w-6 h-6 text-zinc-500" />
              </div>
              <h2 className="text-sm font-medium tracking-tight text-zinc-300">
                Aurelia MIDI Visualizer
              </h2>
              <p className="text-xs text-zinc-500 leading-relaxed mt-1">
                Select a piece from the library to begin visual practice.
              </p>
            </div>
          )}
        </main>

        {/* HUD Elements (Fades out smoothly in Focus / Performance Mode) */}
        <div
          className={`transition-opacity duration-300 ${
            performanceMode ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <TopBar />
          {viewMode === "home" && <HomeExplorer />}
          {viewMode === "song" && <TransportDock />}
        </div>

        {/* Global Shortcut Manager Dialog */}
        <ShortcutManagerDialog />

        {/* Free Play Recording Review Dialog */}
        <RecordingReviewDialog />

        {/* Top-Right Floating Toasts */}
        <Toaster />
      </div>
    </TooltipProvider>
  );
};

export default App;
