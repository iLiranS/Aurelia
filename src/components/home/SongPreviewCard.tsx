import React, { useEffect, useMemo, useRef, useState } from "react";
import { Star, Music2 } from "lucide-react";
import type { SongSummary } from "@/types/midi";
import { useThemeStore } from "@/stores/useThemeStore";
import { audioStartPreview, audioStopPreview } from "@/services/tauriApi";
import { getCachedPreviewNotes } from "@/engine/previewCache";

interface KeyLayoutInfo {
  midi: number;
  isBlack: boolean;
  normX: number;
  normWidth: number;
}

// Precompute 88-key piano geometry (A0=21 .. C8=108) normalized to [0..1]
const KEY_LAYOUT: KeyLayoutInfo[] = (() => {
  const whiteKeyPattern = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B
  const isWhite = (m: number) => whiteKeyPattern.includes(m % 12);

  let whiteCount = 0;
  const whiteIndices: number[] = new Array(128).fill(0);
  for (let m = 21; m <= 108; m++) {
    if (isWhite(m)) {
      whiteIndices[m] = whiteCount++;
    }
  }

  const totalWhite = whiteCount; // exactly 52
  const whiteWidth = 1 / totalWhite;
  const blackWidth = whiteWidth * 0.65;

  const layout: KeyLayoutInfo[] = [];
  for (let m = 21; m <= 108; m++) {
    const black = !isWhite(m);
    if (!black) {
      layout.push({
        midi: m,
        isBlack: false,
        normX: whiteIndices[m] * whiteWidth,
        normWidth: whiteWidth,
      });
    } else {
      // Sits between previous white key and next white key
      const prevWhiteIdx = whiteIndices[m - 1];
      const normX = (prevWhiteIdx + 1) * whiteWidth - blackWidth / 2;
      layout.push({
        midi: m,
        isBlack: true,
        normX,
        normWidth: blackWidth,
      });
    }
  }
  return layout;
})();

const KEY_BY_MIDI = new Map<number, KeyLayoutInfo>(
  KEY_LAYOUT.map((k) => [k.midi, k])
);

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SongPreviewCardProps {
  song: SongSummary;
  onSelect: (song: SongSummary) => void;
  onToggleFavorite: (e: React.MouseEvent, contentHash: string) => void;
}

export const SongPreviewCard: React.FC<SongPreviewCardProps> = ({
  song,
  onSelect,
  onToggleFavorite,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const previewAnchorRef = useRef<{ sec: number; perfMs: number }>({
    sec: 0,
    perfMs: 0,
  });
  const isDraggingProgressRef = useRef(false);
  const lastAudioSeekMsRef = useRef(0);
  const [isHovered, setIsHovered] = useState(false);

  const rightHandColor = useThemeStore((s) => s.rightHandColor);
  const leftHandColor = useThemeStore((s) => s.leftHandColor);
  const previewStartMode = useThemeStore((s) => s.previewStartMode);
  const previewAudioEnabled = useThemeStore((s) => s.previewAudioEnabled);

  // Parse compact preview tuples [midi, relStartMs, durMs, hand] (hand: 1=R, 2=L)
  const snippetNotes = useMemo<Array<[number, number, number, number]>>(() => {
    const raw =
      previewStartMode === "peak"
        ? song.previewPeakJson
        : song.previewStartJson;
    if (!raw || raw === "[]") return [];
    try {
      return JSON.parse(raw) as Array<[number, number, number, number]>;
    } catch {
      return [];
    }
  }, [song.previewPeakJson, song.previewStartJson, previewStartMode]);

  // Binary search helper to find the earliest note overlapping the visible lookahead window
  const findStartIndex = (
    noteList: Array<[number, number, number, number]>,
    minTimeSec: number
  ): number => {
    let low = 0;
    let high = noteList.length - 1;
    let result = 0;
    const targetMs = minTimeSec * 1000;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (noteList[mid][1] >= targetMs) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  };

  // Draw 2D canvas frame
  const drawFrame = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tSec: number,
    noteList: Array<[number, number, number, number]>,
    isAbsolute: boolean
  ) => {
    ctx.clearRect(0, 0, width, height);

    // Subtle dark gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#0e1017");
    bgGrad.addColorStop(1, "#07080d");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const keyboardY = height * 0.74;
    const keyboardHeight = height * 0.26;
    const LOOKAHEAD = 1.8; // seconds

    // Track active keys at current tSec
    const activeKeys = new Map<number, string>(); // midi -> color

    // 1. Draw falling notes
    // Look back up to 8s for notes with long sustain that started before tSec
    const startIdx = isAbsolute ? findStartIndex(noteList, tSec - 8.0) : 0;
    const maxLookaheadSec = tSec + LOOKAHEAD;

    for (let i = startIdx; i < noteList.length; i++) {
      const [midi, startMs, durMs, hand] = noteList[i];
      const noteStartSec = startMs / 1000;

      // When sorted by start time, we can break once notes are above the visible canvas
      if (isAbsolute && noteStartSec > maxLookaheadSec) {
        break;
      }

      const durSec = Math.max(0.08, durMs / 1000);
      const color = hand === 2 ? leftHandColor : rightHandColor;

      // Note hit time calculation
      const noteBottomY = keyboardY - (noteStartSec - tSec) * (keyboardY / LOOKAHEAD);
      const noteHeight = (durSec / LOOKAHEAD) * keyboardY;
      const noteTopY = noteBottomY - noteHeight;

      if (noteBottomY < 0 || noteTopY > keyboardY) {
        if (tSec >= noteStartSec && tSec <= noteStartSec + durSec) {
          activeKeys.set(midi, color);
        }
        continue;
      }

      const keyInfo = KEY_BY_MIDI.get(midi);
      if (!keyInfo) continue;

      const keyX = keyInfo.normX * width;
      const keyW = keyInfo.normWidth * width;
      const renderTop = Math.max(0, noteTopY);
      const renderBottom = Math.min(keyboardY, noteBottomY);
      const renderHeight = Math.max(2, renderBottom - renderTop);

      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(keyX + 0.5, renderTop, Math.max(2, keyW - 1), renderHeight, 2.5);
      } else {
        ctx.rect(keyX + 0.5, renderTop, Math.max(2, keyW - 1), renderHeight);
      }
      ctx.fill();
      ctx.restore();

      // Check if key is actively struck
      if (tSec >= noteStartSec && tSec <= noteStartSec + durSec) {
        activeKeys.set(midi, color);
      }
    }

    // 2. Draw mini 88-key piano strip
    // White keys first
    for (let i = 0; i < KEY_LAYOUT.length; i++) {
      const k = KEY_LAYOUT[i];
      if (k.isBlack) continue;
      const x = k.normX * width;
      const w = k.normWidth * width;
      const activeColor = activeKeys.get(k.midi);

      if (activeColor) {
        ctx.fillStyle = activeColor;
      } else {
        ctx.fillStyle = "#1e1e24";
      }
      ctx.fillRect(x, keyboardY, w, keyboardHeight);

      // Key separator hairline
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, keyboardY, w, keyboardHeight);
    }

    // Black keys next
    for (let i = 0; i < KEY_LAYOUT.length; i++) {
      const k = KEY_LAYOUT[i];
      if (!k.isBlack) continue;
      const x = k.normX * width;
      const w = k.normWidth * width;
      const blackH = keyboardHeight * 0.62;
      const activeColor = activeKeys.get(k.midi);

      if (activeColor) {
        ctx.fillStyle = activeColor;
      } else {
        ctx.fillStyle = "#09090b";
      }
      ctx.fillRect(x, keyboardY, w, blackH);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, keyboardY, w, blackH);
    }

    // 3. Render subtle strike glow on active keys
    if (activeKeys.size > 0) {
      ctx.save();
      for (const [midi, color] of activeKeys.entries()) {
        const k = KEY_BY_MIDI.get(midi);
        if (!k) continue;
        const centerX = (k.normX + k.normWidth / 2) * width;
        const radius = Math.max(16, width * 0.045);

        const glow = ctx.createRadialGradient(
          centerX,
          keyboardY,
          1,
          centerX,
          keyboardY,
          radius
        );
        glow.addColorStop(0, color);
        glow.addColorStop(1, "transparent");

        ctx.globalAlpha = 0.45;
        ctx.fillStyle = glow;
        ctx.fillRect(centerX - radius, keyboardY - radius * 0.6, radius * 2, radius * 1.6);
      }
      ctx.restore();
    }
  };

  // Manage static vs continuous hover loop + 300ms hover-intent audio preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number | null = null;
    let audioTimer: ReturnType<typeof setTimeout> | null = null;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    if (!isHovered) {
      // Idle: draw ONE static frame showing active notes mid-fall from SQLite snippet
      drawFrame(ctx, w, h, 1.2, snippetNotes, false);
      if (progressFillRef.current) {
        progressFillRef.current.style.width = "0%";
      }
      return;
    }

    const firstNoteSec = snippetNotes.length > 0 ? snippetNotes[0][1] / 1000 : 0.0;
    const startSec = previewStartMode === "peak" ? song.peakStartSec : Math.max(0.0, firstNoteSec);
    previewAnchorRef.current = { sec: startSec, perfMs: performance.now() };

    // Lazily fetch full notes for continuous playback
    let fullNotes: Array<[number, number, number, number]> | null = null;
    getCachedPreviewNotes(song.filePath)
      .then((notes) => {
        fullNotes = notes;
      })
      .catch(() => {});

    // Hovered: Start 300ms hover-intent audio preview
    if (previewAudioEnabled) {
      audioTimer = setTimeout(() => {
        const anchor = previewAnchorRef.current;
        const currentSec = Math.min(
          song.durationSec,
          anchor.sec + (performance.now() - anchor.perfMs) / 1000
        );
        audioStartPreview(song.filePath, currentSec, 0.42).catch(() => {});
      }, 300);
    }

    // Hovered: Smooth continuous animation loop until end of song
    const loop = (now: number) => {
      const anchor = previewAnchorRef.current;
      const songTime = Math.min(
        song.durationSec,
        Math.max(0, anchor.sec + (now - anchor.perfMs) / 1000)
      );

      if (progressFillRef.current && song.durationSec > 0) {
        const pct = Math.min(100, Math.max(0, (songTime / song.durationSec) * 100));
        progressFillRef.current.style.width = `${pct}%`;
      }

      if (fullNotes) {
        drawFrame(ctx, w, h, songTime, fullNotes, true);
      } else {
        // While full notes are loading, draw snippet using relative time
        drawFrame(ctx, w, h, Math.max(0, songTime - startSec), snippetNotes, false);
      }

      if (songTime < song.durationSec) {
        animId = requestAnimationFrame(loop);
      }
    };

    animId = requestAnimationFrame(loop);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
      if (audioTimer !== null) clearTimeout(audioTimer);
      audioStopPreview().catch(() => {});
    };
  }, [
    isHovered,
    snippetNotes,
    rightHandColor,
    leftHandColor,
    previewAudioEnabled,
    previewStartMode,
    song.filePath,
    song.peakStartSec,
    song.durationSec,
  ]);

  const handleClick = () => {
    audioStopPreview().catch(() => {});
    onSelect(song);
  };

  const seekPreviewToClientX = (clientX: number, forceAudioSync: boolean) => {
    if (!progressBarRef.current || song.durationSec <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetSec = pct * song.durationSec;

    previewAnchorRef.current = { sec: targetSec, perfMs: performance.now() };
    if (progressFillRef.current) {
      progressFillRef.current.style.width = `${pct * 100}%`;
    }

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

  const folderName = song.folder
    ? song.folder.split("/").pop() || song.folder
    : "Library";

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        isDraggingProgressRef.current = false;
        setIsHovered(false);
      }}
      className="group relative flex flex-col gap-2.5 p-2 rounded-2xl liquid-glass-btn cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5"
      style={{
        boxShadow: isHovered
          ? `0 10px 28px -6px ${rightHandColor}28, inset 0 1px 0 0 rgba(255, 255, 255, 0.16)`
          : undefined,
      }}
    >
      {/* 16:10 Thumbnail container */}
      <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden bg-black/60 border border-white/[0.08] transition-all duration-300 group-hover:border-white/20">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
        />

        {/* Floating Pin / Star button in top right */}
        <button
          onClick={(e) => onToggleFavorite(e, song.contentHash)}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer backdrop-blur-md ${
            song.isFavorite
              ? "bg-amber-500/20 text-amber-400 border border-amber-400/40 opacity-100"
              : "bg-black/50 text-zinc-400 border border-white/[0.10] opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-black/80"
          }`}
          aria-label={song.isFavorite ? "Unpin song" : "Pin song"}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              song.isFavorite ? "fill-amber-400" : ""
            }`}
          />
        </button>

        {/* Mini music icon badge in top left (hover-only for clean resting cards) */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-md border border-white/[0.10] flex items-center gap-1 opacity-0 group-hover:opacity-95 transition-opacity">
          <Music2 className="w-3 h-3 text-primary" />
          <span className="text-[10px] text-zinc-300 font-mono">
            {song.trackCount} trk
          </span>
        </div>

        {/* Interactive Hover Progress Bar along bottom of thumbnail */}
        <div
          ref={progressBarRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerUp}
          onPointerCancel={handleProgressPointerUp}
          className="group/prog absolute bottom-0 left-0 right-0 h-4 flex items-end cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
          aria-label="Preview progress"
        >
          <div className="w-full h-1 group-hover/prog:h-1.5 bg-black/60 backdrop-blur-sm transition-all duration-150 overflow-hidden">
            <div
              ref={progressFillRef}
              className="h-full bg-primary shadow-[0_0_8px_var(--theme-color,#f5c26b)]"
              style={{ width: "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Clean Studio Typography */}
      <div className="px-1 pb-0.5 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <h3
            title={song.title}
            className="text-sm font-medium text-zinc-100 truncate group-hover:text-primary transition-colors"
          >
            {song.title}
          </h3>
          <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
            {formatDuration(song.durationSec)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="truncate max-w-[160px] text-[11px] text-zinc-400">
            {folderName}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-500 shrink-0">
            {Math.round(song.initialBpm)} BPM
          </span>
        </div>
      </div>
    </div>
  );
};
