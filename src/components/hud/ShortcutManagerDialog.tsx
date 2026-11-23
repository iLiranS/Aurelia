import React, { useState, useEffect } from "react";
import {
  Keyboard,
  RotateCcw,
  Search,
  AlertTriangle,
  ArrowRightLeft,
  Check,
  X,
  Undo2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useShortcutStore } from "@/stores/useShortcutStore";
import {
  SHORTCUT_DEFINITIONS,
  type ShortcutCategory,
  type ShortcutDefinition,
  eventToBinding,
  formatBindingForDisplay,
} from "@/types/shortcuts";

const CATEGORIES: ShortcutCategory[] = ["Playback", "Practice", "View", "App"];

export const ShortcutManagerDialog: React.FC = () => {
  const dialogOpen = useShortcutStore((s) => s.dialogOpen);
  const setDialogOpen = useShortcutStore((s) => s.setDialogOpen);
  const bindings = useShortcutStore((s) => s.bindings);
  const recordingActionId = useShortcutStore((s) => s.recordingActionId);
  const conflictActionId = useShortcutStore((s) => s.conflictActionId);
  const conflictPendingBinding = useShortcutStore((s) => s.conflictPendingBinding);

  const startRecording = useShortcutStore((s) => s.startRecording);
  const stopRecording = useShortcutStore((s) => s.stopRecording);
  const setConflict = useShortcutStore((s) => s.setConflict);
  const findConflict = useShortcutStore((s) => s.findConflict);
  const setBinding = useShortcutStore((s) => s.setBinding);
  const swapBinding = useShortcutStore((s) => s.swapBinding);
  const reassignBinding = useShortcutStore((s) => s.reassignBinding);
  const resetToDefaults = useShortcutStore((s) => s.resetToDefaults);

  const [searchQuery, setSearchQuery] = useState("");

  // Global keydown recording handler when an action is being recorded
  useEffect(() => {
    if (!dialogOpen || !recordingActionId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        stopRecording();
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        setBinding(recordingActionId, null);
        return;
      }

      const binding = eventToBinding(e);
      if (!binding) return;

      const conflict = findConflict(binding, recordingActionId);
      if (conflict) {
        setConflict(conflict, binding);
      } else {
        setBinding(recordingActionId, binding);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [
    dialogOpen,
    recordingActionId,
    findConflict,
    setBinding,
    setConflict,
    stopRecording,
  ]);

  const conflictingDef = conflictActionId
    ? SHORTCUT_DEFINITIONS.find((d) => d.id === conflictActionId)
    : null;

  const filteredDefinitions = SHORTCUT_DEFINITIONS.filter((def) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const binding = bindings[def.id] ?? "";
    const display = formatBindingForDisplay(binding).toLowerCase();
    return (
      def.label.toLowerCase().includes(query) ||
      def.description.toLowerCase().includes(query) ||
      def.category.toLowerCase().includes(query) ||
      display.includes(query)
    );
  });

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 space-y-2">
          <div className="flex items-center justify-between pr-6 ">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl liquid-glass-accent flex items-center justify-center text-primary">
                <Keyboard className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle>Keyboard Shortcuts</DialogTitle>
                <DialogDescription className="text-zinc-400 mt-0.5">
                  Click any keybind pill to record a custom combination
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={resetToDefaults}
              className="px-2.5 py-1 rounded-lg liquid-glass-btn text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Reset all shortcuts to factory defaults"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Defaults</span>
            </button>
          </div>

          {/* Search Filter */}
          <div className="relative pt-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none mt-1" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions or shortcuts…"
              className="pl-8 h-8 text-xs"
            />
          </div>
        </DialogHeader>

        {/* Action List Grouped by Category */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="space-y-6 pb-2">
            {CATEGORIES.map((cat) => {
              const catDefs = filteredDefinitions.filter(
                (d) => d.category === cat
              );
              if (catDefs.length === 0) return null;

              return (
                <div key={cat} className="space-y-2">
                  <h3 className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400 px-1">
                    {cat}
                  </h3>

                  <div className="space-y-1.5">
                    {catDefs.map((def: ShortcutDefinition) => {
                      const isRecordingThis = recordingActionId === def.id;
                      const hasConflictThis =
                        isRecordingThis &&
                        conflictActionId !== null &&
                        conflictPendingBinding !== null;
                      const currentBinding = bindings[def.id];

                      return (
                        <div
                          key={def.id}
                          className="rounded-xl p-2.5 bg-white/[0.02] border border-white/[0.06] transition-colors hover:bg-white/[0.04] space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-zinc-200">
                                {def.label}
                              </p>
                              <p className="text-[10px] text-zinc-400 leading-tight truncate">
                                {def.description}
                              </p>
                            </div>

                            {/* Shortcut Pill */}
                            <div className="shrink-0 flex items-center gap-1.5">
                              {/* Reset individual modified shortcut to default */}
                              {!isRecordingThis && currentBinding !== def.defaultBinding && (
                                <button
                                  onClick={() => setBinding(def.id, def.defaultBinding)}
                                  className="w-6 h-6 rounded-lg liquid-glass-btn text-zinc-400 hover:text-primary hover:border-primary/30 flex items-center justify-center transition-all cursor-pointer"
                                  title={`Reset to default (${formatBindingForDisplay(def.defaultBinding)})`}
                                  aria-label={`Reset ${def.label} to default`}
                                >
                                  <Undo2 className="w-3 h-3" />
                                </button>
                              )}

                              {isRecordingThis ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono liquid-glass-accent text-primary font-semibold animate-pulse shadow-sm">
                                    Press keys…
                                  </span>
                                  <button
                                    onClick={stopRecording}
                                    className="w-6 h-6 rounded-lg liquid-glass-btn text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-all cursor-pointer"
                                    title="Cancel recording (Esc)"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startRecording(def.id)}
                                  className={`min-w-[56px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer text-center ${
                                    currentBinding !== def.defaultBinding
                                      ? "liquid-glass-btn text-primary border-primary/30 hover:border-primary/50"
                                      : "liquid-glass-btn text-zinc-300 hover:text-white"
                                  }`}
                                  title="Click to rebind"
                                >
                                  {formatBindingForDisplay(currentBinding)}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Inline Conflict Warning & Resolution Banner */}
                          {hasConflictThis && conflictingDef && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-in fade-in-0 duration-150">
                              <div className="flex items-center gap-1.5 text-xs">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                                <span>
                                  Already bound to{" "}
                                  <strong className="text-white font-semibold">
                                    {conflictingDef.label}
                                  </strong>
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                                <button
                                  onClick={() =>
                                    swapBinding(def.id, conflictActionId!)
                                  }
                                  className="px-2 py-0.5 rounded-md bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                                  title="Swap bindings between these two actions"
                                >
                                  <ArrowRightLeft className="w-2.5 h-2.5" />
                                  <span>Swap</span>
                                </button>

                                <button
                                  onClick={() =>
                                    reassignBinding(
                                      def.id,
                                      conflictPendingBinding!
                                    )
                                  }
                                  className="px-2 py-0.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                                  title="Reassign to this action and leave the other unbound"
                                >
                                  <Check className="w-2.5 h-2.5" />
                                  <span>Reassign</span>
                                </button>

                                <button
                                  onClick={stopRecording}
                                  className="px-2 py-0.5 rounded-md text-zinc-400 hover:text-zinc-200 text-[10px] transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
