import React, { useEffect, useRef, useState } from "react";
import { Star, Play, Music } from "lucide-react";
import type { SongSummary } from "@/types/midi";
import { PieceActionsMenu } from "@/components/hud/PieceActionsMenu";
import { useThemeStore } from "@/stores/useThemeStore";
import { audioStartPreview, audioStopPreview } from "@/services/tauriApi";
import { getCachedPreviewNotes, type CompactNote } from "@/engine/previewCache";
import { listPreviewManager } from "@/engine/listPreviewDriver";

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SongListRowProps {
  song: SongSummary;
  onSelect: (song: SongSummary) => void;
  onToggleFavorite: (e: React.MouseEvent, contentHash: string) => void;
}

export const SongListRow: React.FC<SongListRowProps> = ({
  song,
  onSelect,
  onToggleFavorite,
}) => {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null);
  const hoverSessionRef = useRef<number>(0);
  const audioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const isDraggingProgressRef = useRef(false);
  const lastAudioSeekMsRef = useRef(0);
  const cachedNotesRef = useRef<CompactNote[] | null>(null);

  const previewStartMode = useThemeStore((s) => s.previewStartMode);
  const previewAudioEnabled = useThemeStore((s) => s.previewAudioEnabled);

  const stopPreview = () => {
    hoverSessionRef.current++;
    if (audioTimerRef.current) {
      clearTimeout(audioTimerRef.current);
      audioTimerRef.current = null;
    }
    isDraggingProgressRef.current = false;
    setIsPreviewing(false);
    if (progressFillRef.current) {
      progressFillRef.current.style.width = "0%";
    }
    listPreviewManager.stop(song.contentHash);
    audioStopPreview().catch(() => {});
  };

  const handleMouseEnter = () => {
    const token = ++hoverSessionRef.current;

    audioTimerRef.current = setTimeout(async () => {
      try {
        const notes = await getCachedPreviewNotes(song.filePath);
        if (hoverSessionRef.current !== token) return;
        cachedNotesRef.current = notes;

        const firstNoteSec = notes.length > 0 ? notes[0][1] / 1000 : 0.0;
        const startSec =
          previewStartMode === "peak"
            ? song.peakStartSec
            : Math.max(0.0, firstNoteSec);

        if (previewAudioEnabled) {
          await audioStartPreview(song.filePath, startSec, 0.42);
        }

        if (hoverSessionRef.current !== token) return;

        listPreviewManager.start(
          song.contentHash,
          notes,
          startSec,
          song.durationSec
        );
        setIsPreviewing(true);
      } catch (err) {
        console.warn("Failed to start list hover preview:", err);
      }
    }, 250);
  };

  useEffect(() => {
    if (!isPreviewing || song.durationSec <= 0) return;

    let rafId: number;
    const updateProgress = () => {
      const session = listPreviewManager.session;
      if (session && session.contentHash === song.contentHash && progressFillRef.current) {
        const elapsed = (performance.now() - session.startedAtPerfMs) / 1000;
        const currentSec = Math.min(song.durationSec, Math.max(0, session.startSec + elapsed));
        const pct = (currentSec / song.durationSec) * 100;
        progressFillRef.current.style.width = `${pct}%`;
      }
      rafId = requestAnimationFrame(updateProgress);
    };

    rafId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(rafId);
  }, [isPreviewing, song.contentHash, song.durationSec]);

  const seekPreviewToClientX = async (clientX: number, forceAudioSync: boolean) => {
    if (!progressBarRef.current || song.durationSec <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetSec = pct * song.durationSec;

    if (progressFillRef.current) {
      progressFillRef.current.style.width = `${pct * 100}%`;
    }

    if (audioTimerRef.current) {
      clearTimeout(audioTimerRef.current);
      audioTimerRef.current = null;
    }

    const token = hoverSessionRef.current;
    if (!cachedNotesRef.current) {
      try {
        const notes = await getCachedPreviewNotes(song.filePath);
        if (hoverSessionRef.current !== token) return;
        cachedNotesRef.current = notes;
      } catch {
        return;
      }
    }

    listPreviewManager.start(
      song.contentHash,
      cachedNotesRef.current,
      targetSec,
      song.durationSec
    );
    setIsPreviewing(true);

    if (previewAudioEnabled) {
      const now = performance.now();
      if (forceAudioSync || now - lastAudioSeekMsRef.current >= 120) {
        lastAudioSeekMsRef.current = now;
        audioStartPreview(song.filePath, targetSec, 0.42).catch(() => {});
      }
    }
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingProgressRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    seekPreviewToClientX(e.clientX, true);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingProgressRef.current) return;
    e.stopPropagation();
    seekPreviewToClientX(e.clientX, false);
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingProgressRef.current) return;
    e.stopPropagation();
    isDraggingProgressRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    seekPreviewToClientX(e.clientX, true);
  };

  const handleMouseLeave = () => {
    stopPreview();
  };

  const handleClick = () => {
    stopPreview();
    onSelect(song);
  };

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  const folderName = song.folder
    ? song.folder.split("/").pop() || song.folder
    : "Library";

  return (
    <div
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextPos({ x: e.clientX, y: e.clientY });
      }}
      className={`group relative overflow-hidden flex items-center justify-between px-3.5 py-2.5 rounded-xl liquid-glass-btn cursor-pointer transition-all select-none ${
        isPreviewing ? "border-amber-400/30 bg-white/[0.06]" : "hover:border-white/18"
      }`}
    >
      {/* Left: Star, Icon & Title */}
      <div className="flex items-center gap-3 min-w-0 pr-4">
        <button
          onClick={(e) => onToggleFavorite(e, song.contentHash)}
          className={`w-6 h-6 rounded-md flex items-center justify-center transition-all cursor-pointer ${
            song.isFavorite
              ? "text-amber-400"
              : "text-zinc-500 hover:text-amber-400 opacity-40 group-hover:opacity-100"
          }`}
          aria-label={song.isFavorite ? "Unpin song" : "Pin song"}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              song.isFavorite ? "fill-amber-400" : ""
            }`}
          />
        </button>

        <div className="w-7 h-7 rounded-lg bg-black/40 border border-white/[0.08] flex items-center justify-center text-zinc-400 group-hover:text-primary transition-colors shrink-0">
          {isPreviewing ? (
            <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5 text-primary">
              <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-2" />
              <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-3.5" />
              <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.8s_ease-in-out_infinite] h-2.5" />
            </div>
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5 fill-current opacity-70 group-hover:opacity-100" />
          )}
        </div>

        <div className="min-w-0">
          <h4
            className={`text-xs font-medium truncate transition-colors ${
              isPreviewing
                ? "text-primary"
                : "text-zinc-100 group-hover:text-primary"
            }`}
          >
            {song.title}
          </h4>
          <span className="text-[10px] text-zinc-500 truncate block">
            {folderName}
          </span>
        </div>
      </div>

      {/* Right: Metadata pills and duration */}
      <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-zinc-400 shrink-0">
        <div className="hidden sm:flex items-center gap-1 text-[11px] text-zinc-500">
          <Music className="w-3 h-3 text-zinc-600" />
          <span>{song.trackCount} trk</span>
        </div>

        <div className="hidden md:block text-[11px] text-zinc-500">
          {Math.round(song.initialBpm)} BPM
        </div>

        <span className="text-zinc-300 text-xs w-12 text-right">
          {formatDuration(song.durationSec)}
        </span>

        <PieceActionsMenu
          filePath={song.filePath}
          title={song.title}
          contextPos={contextPos}
          onContextPosClear={() => setContextPos(null)}
          triggerClassName="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] opacity-60 group-hover:opacity-100 transition-all cursor-pointer"
        />
      </div>

      {/* Interactive Hover Progress Bar along bottom edge */}
      <div
        ref={progressBarRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handleProgressPointerDown}
        onPointerMove={handleProgressPointerMove}
        onPointerUp={handleProgressPointerUp}
        onPointerCancel={handleProgressPointerUp}
        className="group/prog absolute bottom-0 left-0 right-0 h-3 flex items-end cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
        aria-label="Preview progress"
      >
        <div className="w-full h-[3px] group-hover/prog:h-[5px] bg-black/50 transition-all duration-150 overflow-hidden">
          <div
            ref={progressFillRef}
            className="h-full bg-primary shadow-[0_0_8px_var(--theme-color,#f5c26b)]"
            style={{ width: "0%" }}
          />
        </div>
      </div>
    </div>
  );
};
