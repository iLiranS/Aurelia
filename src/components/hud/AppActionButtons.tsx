import React from "react";
import { Keyboard, Maximize2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppearancePopover } from "@/components/hud/AppearancePopover";
import { MidiDevicePopover } from "@/components/hud/MidiDevicePopover";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { useViewStore } from "@/stores/useViewStore";

interface AppActionButtonsProps {
  mode: "home" | "song" | "freeplay";
}

export const AppActionButtons: React.FC<AppActionButtonsProps> = ({ mode }) => {
  const setViewMode = useViewStore((s) => s.setViewMode);

  const setShortcutDialogOpen = useShortcutStore((s) => s.setDialogOpen);
  const freeplayShortcut = useShortcutStore((s) => s.getFormattedBinding("view.freeplay"));
  const shortcutsShortcut = useShortcutStore((s) => s.getFormattedBinding("app.shortcuts"));

  return (
    <div className="flex items-center gap-1.5 pointer-events-auto shrink-0">
      {/* Full-Screen Free-Play Button (Only visible on Home) */}
      {mode === "home" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setViewMode("freeplay")}
              className="h-7 px-2.5 rounded-lg liquid-glass-btn flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
              aria-label="Full-Screen Free-Play"
            >
              <Maximize2 className="w-3.5 h-3.5 text-primary" />
              <span className="hidden sm:inline font-medium">Free Play</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <span>Full-Screen Free-Play ({freeplayShortcut})</span>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Keyboard Shortcuts Trigger */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setShortcutDialogOpen(true)}
            className="w-7 h-7 rounded-lg liquid-glass-btn flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-all cursor-pointer shadow-sm"
            aria-label="Keyboard Shortcuts"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <span>Shortcuts ({shortcutsShortcut})</span>
        </TooltipContent>
      </Tooltip>

      {/* Hardware MIDI Keyboard Popover */}
      <MidiDevicePopover />

      {/* Studio & Appearance Popover */}
      <AppearancePopover />
    </div>
  );
};
