import React from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppActionButtons } from "@/components/hud/AppActionButtons";
import { FreeplayToolbar } from "@/components/hud/FreeplayToolbar";
import { PieceActionsMenu } from "@/components/hud/PieceActionsMenu";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useRecordingStore } from "@/stores/useRecordingStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { useViewStore } from "@/stores/useViewStore";
import { playbackClock } from "@/engine/playbackClock";
import { audioPause, audioStopPreview } from "@/services/tauriApi";

export const TopBar: React.FC = () => {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const displayTimeSec = usePlaybackStore((s) => s.displayTimeSec);
  const tempoScale = usePlaybackStore((s) => s.tempoScale);

  const viewMode = useViewStore((s) => s.viewMode);
  const setViewMode = useViewStore((s) => s.setViewMode);
  const activeSong = useLibraryStore((s) => s.activeSong);

  const libraryShortcut = useShortcutStore((s) => s.getFormattedBinding("view.library"));

  const handleReturnToLibrary = async () => {
    if (useRecordingStore.getState().status === "recording") {
      const take = useRecordingStore.getState().stopRecording(false);
      if (take) {
        return;
      }
    }
    if (isPlaying) {
      setIsPlaying(false);
      playbackClock.syncFromRust(displayTimeSec, false, tempoScale);
      await audioPause().catch(() => { });
    }
    await audioStopPreview().catch(() => { });
    setViewMode("home");
  };

  // Home renders its own unified single-row header
  if (viewMode === "home") {
    return null;
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-10 z-20 flex items-center justify-between px-4 pointer-events-none select-none">
      {/* Left section: Return to Library / Free Play Indicator */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleReturnToLibrary}
              className="h-7 px-2.5 rounded-lg liquid-glass-btn text-zinc-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer text-xs shadow-sm active:scale-95"
              aria-label="Return to Library"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
              <span>Library</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            <span>Return to Library ({libraryShortcut})</span>
          </TooltipContent>
        </Tooltip>

        {viewMode === "freeplay" && (
          <Badge
            variant="outline"
            className="text-[10px] py-0.5 px-2 text-zinc-400 bg-white/[0.04] border-white/[0.08]"
          >
            Free Play
          </Badge>
        )}

        {viewMode === "song" && activeSong && (
          <PieceActionsMenu
            filePath={activeSong.filePath}
            title={activeSong.title}
            isActiveSong
            triggerClassName="h-7 w-7 rounded-lg liquid-glass-btn text-zinc-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
          />
        )}
      </div>

      {/* Center section: Free Play Studio Toolbar */}
      {viewMode === "freeplay" && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
          <FreeplayToolbar />
        </div>
      )}

      {/* Right section: Action Buttons */}
      <AppActionButtons mode={viewMode} />
    </header>
  );
};
