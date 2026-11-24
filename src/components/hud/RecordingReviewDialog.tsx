import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileAudio, FolderOpen, Loader2, Play, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToastStore } from "@/components/ui/toast";
import { playbackClock } from "@/engine/playbackClock";
import {
  audioLoadSong,
  audioPlay,
  exportFreeplayAudio,
  exportSongAudio,
  loadSong,
  saveFreeplayMidi,
} from "@/services/tauriApi";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useRecordingStore } from "@/stores/useRecordingStore";
import { useViewStore } from "@/stores/useViewStore";

function formatDuration(sec: number): string {
  const clamped = Math.max(0, Math.round(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const RecordingReviewDialog: React.FC = () => {
  const status = useRecordingStore((s) => s.status);
  const finishedTake = useRecordingStore((s) => s.finishedTake);
  const discardTake = useRecordingStore((s) => s.discardTake);
  const clearReview = useRecordingStore((s) => s.clearReview);

  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"mp3" | "wav" | null>(null);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOpen = status === "review" && finishedTake !== null;

  useEffect(() => {
    if (finishedTake) {
      setTitle(finishedTake.defaultTitle);
      setSavedFilePath(null);
      setSavedFilename(null);
      setErrorMsg(null);
      setIsSaving(false);
      setExportingFormat(null);
    }
  }, [finishedTake]);

  if (!finishedTake) return null;

  const cleanTitle = title.trim() || finishedTake.defaultTitle;

  const pickSavePath = async (): Promise<string | null> => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      defaultPath: `${cleanTitle}.mid`,
      filters: [{ name: "MIDI", extensions: ["mid"] }],
      title: "Save MIDI Recording",
    });
    return typeof selected === "string" ? selected : null;
  };

  const buildPayload = () => ({
    title: cleanTitle,
    bpm: finishedTake.bpm,
    notes: finishedTake.notes,
    sustainEvents: finishedTake.sustainEvents,
  });

  const handleSaveToLibrary = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const payload = buildPayload();
      let result;
      try {
        result = await saveFreeplayMidi(cleanTitle, payload);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("NO_ROOT_FOLDER")) {
          const customPath = await pickSavePath();
          if (!customPath) {
            setIsSaving(false);
            return;
          }
          result = await saveFreeplayMidi(cleanTitle, payload, customPath);
        } else {
          throw err;
        }
      }

      setSavedFilePath(result.filePath);
      setSavedFilename(result.filename);
      useToastStore.getState().showToast({
        id: "recording-saved",
        title: "Recording Saved",
        description: result.folder
          ? `${result.folder}/${result.filename}`
          : result.filename,
        durationMs: 2600,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const customPath = await pickSavePath();
      if (!customPath) {
        setIsSaving(false);
        return;
      }
      const result = await saveFreeplayMidi(cleanTitle, buildPayload(), customPath);
      setSavedFilePath(result.filePath);
      setSavedFilename(result.filename);
      useToastStore.getState().showToast({
        id: "recording-saved",
        title: "MIDI Exported",
        description: result.filename,
        durationMs: 2400,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportAudio = async (format: "mp3" | "wav") => {
    if (isSaving || exportingFormat !== null) return;
    setErrorMsg(null);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const label = format.toUpperCase();
      const outputPath = await save({
        defaultPath: `${cleanTitle}.${format}`,
        filters: [{ name: `${label} Audio`, extensions: [format] }],
        title: `Export ${label}`,
      });
      if (typeof outputPath !== "string" || !outputPath) return;

      setExportingFormat(format);
      if (savedFilePath) {
        await exportSongAudio(savedFilePath, outputPath, format);
      } else {
        await exportFreeplayAudio(buildPayload(), outputPath, format);
      }

      const exportedName = outputPath.split(/[/\\]/).pop() || `${cleanTitle}.${format}`;
      useToastStore.getState().showToast({
        id: "audio-exported",
        title: `${label} Exported`,
        description: exportedName,
        durationMs: 2600,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingFormat(null);
    }
  };

  const handleOpenPiece = async () => {
    if (!savedFilePath) return;
    const lib = useLibraryStore.getState();
    const pb = usePlaybackStore.getState();
    try {
      lib.setIsLoadingSong(true);
      const [parsed, settings] = await loadSong(savedFilePath);
      lib.touchLastPlayed(parsed.contentHash);
      lib.setActiveSong(parsed, settings);
      await audioLoadSong(savedFilePath, settings);

      pb.setDurationSec(parsed.durationSec);
      pb.setInitialBpm(parsed.initialBpm);
      pb.setTempoScale(settings.tempoScale);
      pb.setTransposeSemitones(settings.transposeSemitones ?? 0);
      pb.setLoopEnabled(settings.loopEnabled);
      pb.setLoopPoints(settings.loopStartSec, settings.loopEndSec);
      pb.setSplitPointMidi(settings.splitPointMidi);
      pb.setUseSplitPoint(settings.useSplitPoint);
      pb.setTrackHands(settings.trackHands);
      pb.setDisplayTimeSec(0);
      playbackClock.seekLocal(0);

      clearReview();
      useViewStore.getState().setViewMode("song");
      pb.setIsPlaying(true);
      playbackClock.syncFromRust(0, true, settings.tempoScale);
      await audioPlay();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      lib.setIsLoadingSong(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (savedFilePath) {
        clearReview();
      }
      // Block Escape / backdrop close while unsaved so user must click Discard or Save
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" showClose={Boolean(savedFilePath)}>
        <DialogHeader>
          <DialogTitle>Free Play Recording</DialogTitle>
          <DialogDescription>
            Review your captured performance and save it as a MIDI piece.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {finishedTake.stoppedByLimit && (
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/25 text-amber-200 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Recording stopped automatically after reaching the safety limit.
              </span>
            </div>
          )}

          {/* Take Summary Pills */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-center">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Duration
              </div>
              <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5 tabular-nums">
                {formatDuration(finishedTake.durationSec)}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-center">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Notes
              </div>
              <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5 tabular-nums">
                {finishedTake.notes.length}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-center">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Tempo
              </div>
              <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5 tabular-nums">
                {Math.round(finishedTake.bpm)} BPM
              </div>
            </div>
          </div>

          {!savedFilePath ? (
            <div className="space-y-1.5">
              <label
                htmlFor="recording-title-input"
                className="text-xs font-medium text-zinc-300"
              >
                Title
              </label>
              <input
                id="recording-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={finishedTake.defaultTitle}
                autoFocus
                className="w-full h-9 px-3 rounded-xl bg-black/30 border border-white/[0.12] text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60 transition-colors"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/25 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-emerald-100">Saved to disk</div>
                <div className="text-[11px] text-emerald-200/80 truncate">
                  {savedFilename}
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Export Studio Audio Row */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <FileAudio className="w-3.5 h-3.5 text-zinc-500" />
              <span>Export Studio Audio</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleExportAudio("mp3")}
                disabled={isSaving || exportingFormat !== null}
                className="h-7 px-2.5 rounded-lg liquid-glass-btn text-[11px] font-medium text-zinc-200 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {exportingFormat === "mp3" && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                <span>Export MP3</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportAudio("wav")}
                disabled={isSaving || exportingFormat !== null}
                className="h-7 px-2.5 rounded-lg liquid-glass-btn text-[11px] font-medium text-zinc-200 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {exportingFormat === "wav" && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                <span>Export WAV</span>
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {!savedFilePath ? (
            <>
              <button
                type="button"
                onClick={discardTake}
                disabled={isSaving}
                className="h-8 px-3 rounded-xl liquid-glass-btn text-xs font-medium text-zinc-400 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Discard</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveAs}
                  disabled={isSaving}
                  className="h-8 px-3 rounded-xl liquid-glass-btn text-xs font-medium text-zinc-200 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Save As .mid…</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveToLibrary}
                  disabled={isSaving}
                  className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary hover:brightness-110 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? "Saving…" : "Save to Library (.mid)"}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={clearReview}
                className="h-8 px-3 rounded-xl liquid-glass-btn text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
              >
                Done
              </button>
              <button
                type="button"
                onClick={handleOpenPiece}
                className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary hover:brightness-110 flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Open Piece</span>
              </button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
