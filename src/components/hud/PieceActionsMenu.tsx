import React, { useEffect, useState } from "react";
import {
  FileAudio,
  FolderInput,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Music,
  Pencil,
  Trash2,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToastStore } from "@/components/ui/toast";
import {
  audioPause,
  deleteLibrarySong,
  exportMidiCopy,
  exportSongAudio,
  moveLibrarySong,
  renameLibrarySong,
  revealInFileManager,
} from "@/services/tauriApi";
import { isMac } from "@/types/shortcuts";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useViewStore } from "@/stores/useViewStore";

interface PieceActionsMenuProps {
  filePath: string;
  title: string;
  isActiveSong?: boolean;
  triggerClassName?: string;
  triggerContent?: React.ReactNode;
  align?: "start" | "center" | "end";
  contextPos?: { x: number; y: number } | null;
  onContextPosClear?: () => void;
}

export const PieceActionsMenu: React.FC<PieceActionsMenuProps> = ({
  filePath,
  title,
  isActiveSong = false,
  triggerClassName,
  triggerContent,
  align = "end",
  contextPos = null,
  onContextPosClear,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (contextPos) {
      setMenuOpen(true);
    }
  }, [contextPos]);

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      onContextPosClear?.();
    }
  };
  const [exportingFormat, setExportingFormat] = useState<"mp3" | "wav" | "mid" | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [newFolderInput, setNewFolderInput] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const folders = useLibraryStore((s) => s.folders);

  const handleExportAudio = async (format: "mp3" | "wav") => {
    if (exportingFormat !== null) return;
    setMenuOpen(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const label = format.toUpperCase();
      const outputPath = await save({
        defaultPath: `${title}.${format}`,
        filters: [{ name: `${label} Audio`, extensions: [format] }],
        title: `Export ${label}`,
      });
      if (typeof outputPath !== "string" || !outputPath) return;

      setExportingFormat(format);
      useToastStore.getState().showToast({
        id: "audio-exporting",
        title: `Rendering ${label}…`,
        description: title,
        icon: "spinner",
        durationMs: 0,
      });

      await exportSongAudio(filePath, outputPath, format);
      const filename = outputPath.split(/[/\\]/).pop() || `${title}.${format}`;
      useToastStore.getState().showToast({
        id: "audio-exporting",
        title: `${label} Exported`,
        description: filename,
        icon: "check",
        durationMs: 2600,
      });
    } catch (err) {
      useToastStore.getState().showToast({
        id: "audio-exporting",
        title: "Export Failed",
        description: err instanceof Error ? err.message : String(err),
        durationMs: 3200,
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportMidi = async () => {
    if (exportingFormat !== null) return;
    setMenuOpen(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const outputPath = await save({
        defaultPath: `${title}.mid`,
        filters: [{ name: "MIDI", extensions: ["mid", "midi"] }],
        title: "Export MIDI Copy",
      });
      if (typeof outputPath !== "string" || !outputPath) return;

      setExportingFormat("mid");
      await exportMidiCopy(filePath, outputPath);
      const filename = outputPath.split(/[/\\]/).pop() || `${title}.mid`;
      useToastStore.getState().showToast({
        id: "midi-exported",
        title: "MIDI Exported",
        description: filename,
        durationMs: 2400,
      });
    } catch (err) {
      useToastStore.getState().showToast({
        id: "midi-exported",
        title: "MIDI Export Failed",
        description: err instanceof Error ? err.message : String(err),
        durationMs: 3200,
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const openRenameDialog = () => {
    setMenuOpen(false);
    setRenameValue(title);
    setRenameError(null);
    setRenameOpen(true);
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRenaming) return;
    setIsRenaming(true);
    setRenameError(null);
    try {
      const newPath = await renameLibrarySong(filePath, renameValue);
      if (isActiveSong) {
        const lib = useLibraryStore.getState();
        if (lib.activeSong) {
          const cleanName = renameValue.trim().replace(/\.(mid|midi)$/i, "") || lib.activeSong.title;
          lib.setActiveSong(
            { ...lib.activeSong, filePath: newPath, title: cleanName },
            lib.activeSongSettings
          );
        }
      }
      setRenameOpen(false);
      useToastStore.getState().showToast({
        id: "piece-renamed",
        title: "Piece Renamed",
        description: renameValue.trim(),
        durationMs: 2200,
      });
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRenaming(false);
    }
  };

  const openMoveDialog = () => {
    setMenuOpen(false);
    setSelectedFolder("");
    setNewFolderInput("");
    setMoveError(null);
    setMoveOpen(true);
  };

  const handleConfirmMove = async () => {
    if (isMoving) return;
    setIsMoving(true);
    setMoveError(null);
    try {
      const target = newFolderInput.trim() || selectedFolder;
      const newPath = await moveLibrarySong(filePath, target);
      if (isActiveSong) {
        const lib = useLibraryStore.getState();
        if (lib.activeSong) {
          lib.setActiveSong(
            { ...lib.activeSong, filePath: newPath },
            lib.activeSongSettings
          );
        }
      }
      setMoveOpen(false);
      useToastStore.getState().showToast({
        id: "piece-moved",
        title: "Piece Moved",
        description: target ? `Moved to ${target}` : "Moved to Library Root",
        durationMs: 2200,
      });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMoving(false);
    }
  };

  const openDeleteDialog = () => {
    setMenuOpen(false);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteLibrarySong(filePath);
      setDeleteOpen(false);

      const wasActive =
        isActiveSong || useLibraryStore.getState().activeSong?.filePath === filePath;
      if (wasActive) {
        usePlaybackStore.getState().setIsPlaying(false);
        await audioPause().catch(() => {});
        useLibraryStore.getState().setActiveSong(null, null);
        if (useViewStore.getState().viewMode === "song") {
          useViewStore.getState().setViewMode("home");
        }
      }

      useToastStore.getState().showToast({
        id: "piece-deleted",
        title: "Piece Deleted",
        description: title,
        durationMs: 2200,
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={handleMenuOpenChange}>
        {contextPos && (
          <PopoverAnchor asChild>
            <div
              style={{
                position: "fixed",
                left: contextPos.x,
                top: contextPos.y,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
          </PopoverAnchor>
        )}
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContextPosClear?.();
            }}
            className={`${
              triggerClassName ??
              "w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer backdrop-blur-md bg-black/50 text-zinc-300 border border-white/[0.10] hover:text-white hover:bg-black/80"
            }${exportingFormat !== null || menuOpen ? " !opacity-100" : ""}`}
            aria-label="Piece actions"
          >
            {exportingFormat ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
            ) : triggerContent ? (
              triggerContent
            ) : (
              <MoreHorizontal className="w-3.5 h-3.5" />
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align={align}
          onClick={(e) => e.stopPropagation()}
          className="w-48 p-1.5 space-y-0.5 liquid-glass-popover rounded-xl shadow-2xl"
        >
          <button
            type="button"
            onClick={() => handleExportAudio("mp3")}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <FileAudio className="w-3.5 h-3.5 text-zinc-400" />
            <span>Export MP3…</span>
          </button>
          <button
            type="button"
            onClick={() => handleExportAudio("wav")}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <FileAudio className="w-3.5 h-3.5 text-zinc-400" />
            <span>Export WAV…</span>
          </button>
          <button
            type="button"
            onClick={handleExportMidi}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <Music className="w-3.5 h-3.5 text-zinc-400" />
            <span>Export MIDI Copy…</span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={openRenameDialog}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-zinc-400" />
            <span>Rename…</span>
          </button>
          <button
            type="button"
            onClick={openMoveDialog}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <FolderInput className="w-3.5 h-3.5 text-zinc-400" />
            <span>Move to Folder…</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleMenuOpenChange(false);
              void revealInFileManager(filePath, false).catch((err) => {
                useToastStore.getState().showToast({
                  id: "reveal-error",
                  title: "Could Not Reveal File",
                  description: err instanceof Error ? err.message : String(err),
                  durationMs: 3000,
                });
              });
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>{isMac ? "Reveal in Finder" : "Show in Explorer"}</span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={openDeleteDialog}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 cursor-pointer transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete Piece…</span>
          </button>
        </PopoverContent>
      </Popover>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <form onSubmit={handleConfirmRename}>
            <DialogHeader>
              <DialogTitle>Rename Piece</DialogTitle>
              <DialogDescription>
                Enter a new name for this MIDI file.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                className="w-full h-9 px-3 rounded-xl bg-black/30 border border-white/[0.12] text-sm text-zinc-100 focus:outline-none focus:border-primary/60"
              />
              {renameError && (
                <p className="text-xs text-rose-300">{renameError}</p>
              )}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenaming || !renameValue.trim()}
                className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary cursor-pointer disabled:opacity-50"
              >
                {isRenaming ? "Renaming…" : "Rename"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
            <DialogDescription>
              Choose an existing library folder or type a new folder path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedFolder("");
                  setNewFolderInput("");
                }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                  selectedFolder === "" && !newFolderInput.trim()
                    ? "liquid-glass-accent text-primary font-medium"
                    : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                }`}
              >
                Library Root
              </button>
              {folders.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => {
                    setSelectedFolder(folder);
                    setNewFolderInput("");
                  }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate ${
                    selectedFolder === folder && !newFolderInput.trim()
                      ? "liquid-glass-accent text-primary font-medium"
                      : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                  }`}
                >
                  {folder}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-zinc-400">
                Or create new folder path
              </label>
              <input
                type="text"
                value={newFolderInput}
                onChange={(e) => setNewFolderInput(e.target.value)}
                placeholder="e.g. Classical/Chopin"
                className="w-full h-8 px-3 rounded-xl bg-black/30 border border-white/[0.12] text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60"
              />
            </div>

            {moveError && <p className="text-xs text-rose-300">{moveError}</p>}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setMoveOpen(false)}
              className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmMove}
              disabled={isMoving}
              className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary cursor-pointer disabled:opacity-50"
            >
              {isMoving ? "Moving…" : "Move"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete Piece</DialogTitle>
            <DialogDescription>
              Delete <span className="text-zinc-200 font-medium">&ldquo;{title}&rdquo;</span> from disk? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-xs text-rose-300">{deleteError}</p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
              className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="h-8 px-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 cursor-pointer disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
