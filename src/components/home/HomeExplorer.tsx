import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Folder,
  Search,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  List,
  Music,
  X,
  ArrowUpDown,
  ArrowDownAZ,
  Clock,
  CalendarPlus,
  Timer,
  Check,
  FolderPlus,
  FilePlus,
  Mic,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { AppActionButtons } from "@/components/hud/AppActionButtons";
import { SongPreviewCard } from "@/components/home/SongPreviewCard";
import { SongListRow } from "@/components/home/SongListRow";
import { useViewStore } from "@/stores/useViewStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore, cancelCountIn } from "@/stores/usePlaybackStore";
import { isMac } from "@/types/shortcuts";
import { playbackClock } from "@/engine/playbackClock";
import {
  loadSong,
  toggleFavorite as apiToggleFavorite,
  audioLoadSong,
  audioPlay,
  createLibraryFolder,
  renameLibraryFolder,
  deleteLibraryFolder,
  pickMidiFiles,
  importMidiFiles,
  revealInFileManager,
} from "@/services/tauriApi";
import type { SongSummary } from "@/types/midi";

const SORT_OPTIONS: Array<{
  id: "name" | "recent" | "added" | "duration";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
    { id: "name", label: "Name", icon: ArrowDownAZ },
    { id: "recent", label: "Recently Played", icon: Clock },
    { id: "added", label: "Date Added", icon: CalendarPlus },
    { id: "duration", label: "Length", icon: Timer },
  ];

export const HomeExplorer: React.FC = () => {
  const rootFolder = useLibraryStore((s) => s.rootFolder);
  const songs = useLibraryStore((s) => s.songs);
  const libraryFolders = useLibraryStore((s) => s.folders);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const setActiveSong = useLibraryStore((s) => s.setActiveSong);
  const setIsLoadingSong = useLibraryStore((s) => s.setIsLoadingSong);
  const updateFavorite = useLibraryStore((s) => s.updateFavorite);
  const touchLastPlayed = useLibraryStore((s) => s.touchLastPlayed);
  const selectFolder = useLibraryStore((s) => s.selectFolder);

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [folderContext, setFolderContext] = useState<{
    name: string;
    relPath: string;
    x: number;
    y: number;
  } | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<{
    name: string;
    relPath: string;
  } | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);

  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{
    name: string;
    relPath: string;
  } | null>(null);
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFocusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("aurelia:focus-library-search", handleFocusSearch);
    return () => window.removeEventListener("aurelia:focus-library-search", handleFocusSearch);
  }, []);

  // Playback setters
  const setDurationSec = usePlaybackStore((s) => s.setDurationSec);
  const setInitialBpm = usePlaybackStore((s) => s.setInitialBpm);
  const setTempoScale = usePlaybackStore((s) => s.setTempoScale);
  const setLoopEnabled = usePlaybackStore((s) => s.setLoopEnabled);
  const setLoopPoints = usePlaybackStore((s) => s.setLoopPoints);
  const setSplitPointMidi = usePlaybackStore((s) => s.setSplitPointMidi);
  const setUseSplitPoint = usePlaybackStore((s) => s.setUseSplitPoint);
  const setTrackHands = usePlaybackStore((s) => s.setTrackHands);
  const setDisplayTimeSec = usePlaybackStore((s) => s.setDisplayTimeSec);
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);

  // View state
  const currentFolderPath = useViewStore((s) => s.currentFolderPath);
  const setCurrentFolderPath = useViewStore((s) => s.setCurrentFolderPath);
  const layoutMode = useViewStore((s) => s.layoutMode);
  const setLayoutMode = useViewStore((s) => s.setLayoutMode);
  const sortBy = useViewStore((s) => s.sortBy);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const navigateToFolder = useViewStore((s) => s.navigateToFolder);
  const setViewMode = useViewStore((s) => s.setViewMode);

  // Pick new root MIDI directory via Tauri dialog
  const handleSelectFolder = async () => {
    await selectFolder();
  };

  // Pick and copy .mid/.midi files into the currently viewed folder
  const handleAddMidi = async () => {
    if (!rootFolder) return;
    try {
      const selectedPaths = await pickMidiFiles();
      if (selectedPaths.length === 0) return;
      const imported = await importMidiFiles(selectedPaths, currentFolderPath);
      if (imported.length > 0) {
        useToastStore.getState().showToast({
          id: "midi-imported",
          title: imported.length === 1 ? "Added MIDI File" : `Added ${imported.length} MIDI Files`,
          description: currentFolderPath
            ? `Added to ${currentFolderPath}`
            : `Added to ${rootFolderName}`,
          durationMs: 2200,
        });
      }
    } catch (err) {
      useToastStore.getState().showToast({
        id: "midi-import-error",
        title: "Failed to Add MIDI",
        description: err instanceof Error ? err.message : String(err),
        durationMs: 3000,
      });
    }
  };

  const handleSongSelect = async (song: SongSummary) => {
    try {
      setIsLoadingSong(true);
      const [parsed, settings] = await loadSong(song.filePath);
      cancelCountIn();
      touchLastPlayed(song.contentHash);
      setActiveSong(parsed, settings);
      await audioLoadSong(song.filePath, settings);

      setDurationSec(parsed.durationSec);
      setInitialBpm(parsed.initialBpm);
      setTempoScale(settings.tempoScale);
      usePlaybackStore.getState().setTransposeSemitones(settings.transposeSemitones ?? 0);
      setLoopEnabled(settings.loopEnabled);
      setLoopPoints(settings.loopStartSec, settings.loopEndSec);
      setSplitPointMidi(settings.splitPointMidi);
      setUseSplitPoint(settings.useSplitPoint);
      setTrackHands(settings.trackHands);
      setDisplayTimeSec(0);
      playbackClock.seekLocal(0);

      setViewMode("song");
      setIsPlaying(true);
      playbackClock.syncFromRust(0, true, settings.tempoScale);
      await audioPlay();
    } catch (err) {
      console.error("Failed to load MIDI file:", err);
    } finally {
      setIsLoadingSong(false);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, contentHash: string) => {
    e.stopPropagation();
    try {
      const newFav = await apiToggleFavorite(contentHash);
      updateFavorite(contentHash, newFav);
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  // Breadcrumbs parsing
  const breadcrumbs = useMemo(() => {
    if (!currentFolderPath) return [];
    return currentFolderPath.split("/").filter(Boolean);
  }, [currentFolderPath]);

  // Root folder display name
  const rootFolderName = useMemo(() => {
    if (!rootFolder) return "Select Folder";
    const parts = rootFolder.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || rootFolder;
  }, [rootFolder]);

  // Sorting function (pinned items first, then by selected sort criterion)
  const sortSongs = (list: SongSummary[]): SongSummary[] => {
    return [...list].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      if (sortBy === "recent") {
        const diff = (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
        if (diff !== 0) return diff;
      } else if (sortBy === "added") {
        const diff = (b.addedAt ?? 0) - (a.addedAt ?? 0);
        if (diff !== 0) return diff;
      } else if (sortBy === "duration") {
        const diff = b.durationSec - a.durationSec;
        if (diff !== 0) return diff;
      }
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    });
  };

  // Derive child folders & songs at current folder level
  const { immediateFolders, folderSongs, searchResults } = useMemo(() => {
    const normCurrent = currentFolderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

    // Search query results (matches anywhere recursively)
    const q = searchQuery.trim().toLowerCase();
    const searchRes = q
      ? songs.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.folder.toLowerCase().includes(q) ||
          s.relativePath.toLowerCase().includes(q)
      )
      : [];

    // Songs located directly inside current folder
    const directSongs = songs.filter((s) => {
      const songFolder = s.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      return songFolder === normCurrent;
    });

    // Immediate child folders relative to normCurrent (include empty folders from disk)
    const folderMap = new Map<string, number>(); // immediate folder name -> total recursive count
    for (const rel of libraryFolders) {
      const cleanRel = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!cleanRel) continue;
      if (!normCurrent) {
        const topFolder = cleanRel.split("/")[0];
        if (!folderMap.has(topFolder)) folderMap.set(topFolder, 0);
      } else if (cleanRel.startsWith(normCurrent + "/")) {
        const sub = cleanRel.slice(normCurrent.length + 1);
        const childFolder = sub.split("/")[0];
        if (!folderMap.has(childFolder)) folderMap.set(childFolder, 0);
      }
    }
    for (const s of songs) {
      const songFolder = s.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!songFolder) continue;

      if (!normCurrent) {
        // At root: first path segment is immediate child folder
        const topFolder = songFolder.split("/")[0];
        folderMap.set(topFolder, (folderMap.get(topFolder) ?? 0) + 1);
      } else if (songFolder.startsWith(normCurrent + "/")) {
        // Inside subfolder: next path segment after normCurrent
        const sub = songFolder.slice(normCurrent.length + 1);
        const childFolder = sub.split("/")[0];
        folderMap.set(childFolder, (folderMap.get(childFolder) ?? 0) + 1);
      }
    }

    const folders = Array.from(folderMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (!normCurrent) {
          if (a.name === "Recordings") return -1;
          if (b.name === "Recordings") return 1;
        }
        return a.name.localeCompare(b.name);
      });

    return {
      immediateFolders: folders,
      folderSongs: directSongs,
      searchResults: searchRes,
    };
  }, [songs, libraryFolders, currentFolderPath, searchQuery]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingFolder || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    setNewFolderError(null);
    try {
      await createLibraryFolder(currentFolderPath, newFolderName.trim());
      setNewFolderOpen(false);
      setNewFolderName("");
      useToastStore.getState().showToast({
        id: "folder-created",
        title: "Folder Created",
        description: newFolderName.trim(),
        durationMs: 2000,
      });
    } catch (err) {
      setNewFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleConfirmRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameFolderTarget || isRenamingFolder || !renameFolderValue.trim()) return;
    setIsRenamingFolder(true);
    setRenameFolderError(null);
    try {
      await renameLibraryFolder(renameFolderTarget.relPath, renameFolderValue.trim());
      setRenameFolderTarget(null);
      useToastStore.getState().showToast({
        id: "folder-renamed",
        title: "Folder Renamed",
        description: renameFolderValue.trim(),
        durationMs: 2000,
      });
    } catch (err) {
      setRenameFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRenamingFolder(false);
    }
  };

  const handleConfirmDeleteFolder = async () => {
    if (!deleteFolderTarget || isDeletingFolder) return;
    setIsDeletingFolder(true);
    setDeleteFolderError(null);
    try {
      await deleteLibraryFolder(deleteFolderTarget.relPath);
      const deletedName = deleteFolderTarget.name;
      setDeleteFolderTarget(null);
      useToastStore.getState().showToast({
        id: "folder-deleted",
        title: "Folder Deleted",
        description: deletedName,
        durationMs: 2200,
      });
    } catch (err) {
      setDeleteFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const hasSearch = searchQuery.trim().length > 0;

  const libraryControls = (
    <div className="flex items-center gap-1 shrink-0">
      {/* Sort Dropdown (Lightweight Ghost) */}
      <Popover open={sortDropdownOpen} onOpenChange={setSortDropdownOpen}>
        <PopoverTrigger asChild>
          <button
            className={`h-6 px-2 rounded-md flex items-center gap-1 text-[11px] transition-colors cursor-pointer ${sortDropdownOpen
              ? "text-zinc-100 bg-white/[0.06]"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
              }`}
            aria-label="Sort pieces"
          >
            <ArrowUpDown className="w-3 h-3 text-zinc-500" />
            <span className="font-medium">
              {SORT_OPTIONS.find((o) => o.id === sortBy)?.label ?? "Sort"}
            </span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-44 p-1 space-y-0.5 liquid-glass-popover rounded-xl shadow-xl"
        >
          {SORT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setSortBy(opt.id);
                  setSortDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${isSelected
                  ? "liquid-glass-segment-active text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]"
                  }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-primary" : "text-zinc-400"}`} />
                  <span>{opt.label}</span>
                </div>
                {isSelected && <Check className="w-3 h-3 text-primary" />}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* List / Grid Layout Toggle (Lightweight Ghost) */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setLayoutMode("list")}
          className={`w-6 h-6 flex items-center justify-center rounded-md cursor-pointer transition-colors ${layoutMode === "list"
            ? "text-primary bg-white/[0.06]"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          aria-label="List View"
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setLayoutMode("grid")}
          className={`w-6 h-6 flex items-center justify-center rounded-md cursor-pointer transition-colors ${layoutMode === "grid"
            ? "text-primary bg-white/[0.06]"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          aria-label="Grid View"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[18vh] z-10 bg-gradient-to-b from-[#09090b]/84 via-[#09090b]/78 to-[#09090b]/58 flex flex-col select-none overflow-hidden">
      {/* Transparent Floating Topbar */}
      <div className="relative h-12 px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
        {/* Left: Root Folder Breadcrumbs & Dedicated Add MIDI / New Folder Buttons */}
        <div className="flex items-center gap-1.5 min-w-0 z-10">
          {rootFolder && (
            <>
              {breadcrumbs.length > 0 ? (
                <>
                  <button
                    onClick={() => setCurrentFolderPath("")}
                    className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer truncate max-w-[120px] shrink-0"
                  >
                    {rootFolderName}
                  </button>

                  {breadcrumbs.length > 2 && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <button
                        onClick={() =>
                          setCurrentFolderPath(breadcrumbs.slice(0, breadcrumbs.length - 2).join("/"))
                        }
                        className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
                        title={breadcrumbs.slice(0, breadcrumbs.length - 2).join(" / ")}
                      >
                        …
                      </button>
                    </>
                  )}

                  {breadcrumbs.length >= 2 && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <button
                        onClick={() =>
                          setCurrentFolderPath(breadcrumbs.slice(0, breadcrumbs.length - 1).join("/"))
                        }
                        className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer truncate max-w-[110px]"
                      >
                        {breadcrumbs[breadcrumbs.length - 2]}
                      </button>
                    </>
                  )}

                  <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                  <span className="text-xs text-zinc-100 font-medium truncate max-w-[120px]">
                    {breadcrumbs[breadcrumbs.length - 1]}
                  </span>
                </>
              ) : (
                <span className="text-xs font-medium text-zinc-200 truncate max-w-[180px]">
                  {rootFolderName}
                </span>
              )}

              {!hasSearch && (
                <>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500 shrink-0">
                    ({folderSongs.length})
                  </span>

                  <span aria-hidden="true" className="h-3 w-px bg-white/[0.08] mx-0.5 shrink-0" />

                  <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={`w-6 h-6 rounded-lg liquid-glass-accent text-primary flex items-center justify-center cursor-pointer shrink-0 ${
                              addMenuOpen ? "brightness-110" : ""
                            }`}
                            aria-label="Add MIDI or New Folder"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <span>Add MIDI or Folder</span>
                      </TooltipContent>
                    </Tooltip>

                    <PopoverContent
                      side="bottom"
                      align="start"
                      className="w-44 p-1 space-y-0.5 liquid-glass-popover rounded-xl shadow-xl"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAddMenuOpen(false);
                          void handleAddMidi();
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.05] cursor-pointer transition-colors"
                      >
                        <FilePlus className="w-3.5 h-3.5 text-primary" />
                        <span>Add MIDI…</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setNewFolderName("");
                          setNewFolderError(null);
                          setNewFolderOpen(true);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.05] cursor-pointer transition-colors"
                      >
                        <FolderPlus className="w-3.5 h-3.5 text-primary" />
                        <span>New Folder…</span>
                      </button>
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </>
          )}
        </div>

        {/* Center: Search Pieces */}
        <div className="absolute left-1/2 -translate-x-1/2 w-56 sm:w-72 md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search pieces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (searchQuery) {
                  setSearchQuery("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
            className="w-full h-8 pl-8 pr-8 text-xs rounded-full liquid-glass-input text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: Studio Action Buttons */}
        <div className="z-10">
          <AppActionButtons mode="home" />
        </div>
      </div>

      {/* Main Scrollable Library Explorer */}
      <ScrollArea className="flex-1 px-4 sm:px-6 py-0">
        <div className="max-w-[1600px] mx-auto pb-12 space-y-2">
          {/* Empty State: No MIDI Folder */}
          {!rootFolder || songs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl liquid-glass-btn flex items-center justify-center text-zinc-400">
                <Music className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-zinc-100">
                  No MIDI Files Found
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm">
                  Select a directory containing .mid or .midi files to start exploring your music library.
                </p>
              </div>
              <div className="flex items-center gap-2.5 mt-2">
                {rootFolder && (
                  <button
                    onClick={handleAddMidi}
                    className="px-4 py-2 rounded-xl liquid-glass-accent text-xs font-medium text-primary flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95"
                  >
                    <FilePlus className="w-4 h-4 text-primary" />
                    <span>Add MIDI</span>
                  </button>
                )}
                <button
                  onClick={handleSelectFolder}
                  className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95 ${rootFolder
                    ? "liquid-glass-btn text-zinc-200 hover:text-white"
                    : "liquid-glass-accent text-primary"
                    }`}
                >
                  <FolderOpen className={`w-4 h-4 ${rootFolder ? "text-zinc-400" : "text-primary"}`} />
                  <span>{rootFolder ? "Change Folder" : "Select MIDI Folder"}</span>
                </button>
              </div>
            </div>
          ) : hasSearch ? (
            /* Search Results View */
            <section className="space-y-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase shrink-0">
                    SEARCH RESULTS ({searchResults.length})
                  </span>
                  <div className="flex-1 h-px bg-white/[0.07]" />
                </div>
                {libraryControls}
                <div className="h-px bg-white/[0.07]" />
              </div>

              {searchResults.length === 0 ? (
                <p className="text-xs text-zinc-500 py-8 text-center">
                  No pieces matched &ldquo;{searchQuery}&rdquo;
                </p>
              ) : layoutMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {sortSongs(searchResults).map((song) => (
                    <SongPreviewCard
                      key={song.contentHash}
                      song={song}
                      onSelect={handleSongSelect}
                      onToggleFavorite={handleToggleFavorite}
                      showFolderBadge
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sortSongs(searchResults).map((song) => (
                    <SongListRow
                      key={song.contentHash}
                      song={song}
                      onSelect={handleSongSelect}
                      onToggleFavorite={handleToggleFavorite}
                      showFolderBadge
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            /* Normal Folder Navigation View */
            <section className="space-y-3">
              {/* Centered Sort & View Controls under search */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 ">
                <div className="h-px bg-white/[0.07]" />
                {libraryControls}
                <div className="h-px bg-white/[0.07]" />
              </div>

              {/* Compact Horizontal Folder Chips Strip */}
              {immediateFolders.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {immediateFolders.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => navigateToFolder(f.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const relPath = currentFolderPath
                          ? `${currentFolderPath}/${f.name}`
                          : f.name;
                        setFolderContext({
                          name: f.name,
                          relPath,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      className="group -mt-3 h-7 px-2.5 rounded-full liquid-glass-btn flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white hover:border-white/20 transition-all cursor-pointer active:scale-95"
                    >
                      {!currentFolderPath && f.name === "Recordings" ? (
                        <Mic className="w-3 h-3 text-rose-400 shrink-0" />
                      ) : (
                        <Folder className="w-3 h-3 text-primary fill-primary/20 shrink-0" />
                      )}
                      <span className="font-medium truncate max-w-[160px]">{f.name}</span>
                      <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Pieces Grid / List */}
              {folderSongs.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-xs text-zinc-500">
                    {immediateFolders.length > 0
                      ? "No pieces directly in this folder."
                      : "This folder is empty."}
                  </p>
                  <button
                    type="button"
                    onClick={handleAddMidi}
                    className="px-3.5 py-1.5 rounded-xl liquid-glass-accent text-xs font-medium text-primary inline-flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-primary" />
                    <span>Add MIDI</span>
                  </button>
                </div>
              ) : layoutMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {sortSongs(folderSongs).map((song) => (
                    <SongPreviewCard
                      key={song.contentHash}
                      song={song}
                      onSelect={handleSongSelect}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sortSongs(folderSongs).map((song) => (
                    <SongListRow
                      key={song.contentHash}
                      song={song}
                      onSelect={handleSongSelect}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </ScrollArea>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <form onSubmit={handleCreateFolder}>
            <DialogHeader>
              <DialogTitle>New Folder</DialogTitle>
              <DialogDescription>
                Create a folder inside{" "}
                <span className="text-zinc-200 font-medium">
                  {currentFolderPath || rootFolderName}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                className="w-full h-9 px-3 rounded-xl bg-black/30 border border-white/[0.12] text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60"
              />
              {newFolderError && (
                <p className="text-xs text-rose-300">{newFolderError}</p>
              )}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary cursor-pointer disabled:opacity-50"
              >
                {isCreatingFolder ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Folder Right-Click Context Menu */}
      <Popover
        open={folderContext !== null}
        onOpenChange={(open) => {
          if (!open) setFolderContext(null);
        }}
      >
        {folderContext && (
          <PopoverAnchor asChild>
            <div
              style={{
                position: "fixed",
                left: folderContext.x,
                top: folderContext.y,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
          </PopoverAnchor>
        )}
        <PopoverContent
          side="bottom"
          align="start"
          className="w-44 p-1.5 space-y-0.5 liquid-glass-popover rounded-xl shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              if (!folderContext) return;
              const target = { name: folderContext.name, relPath: folderContext.relPath };
              setFolderContext(null);
              setRenameFolderValue(target.name);
              setRenameFolderError(null);
              setRenameFolderTarget(target);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-zinc-400" />
            <span>Rename Folder…</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!folderContext) return;
              const targetRel = folderContext.relPath;
              setFolderContext(null);
              void revealInFileManager(targetRel, true).catch((err) => {
                useToastStore.getState().showToast({
                  id: "reveal-folder-error",
                  title: "Could Not Reveal Folder",
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
          <button
            type="button"
            onClick={() => {
              if (!folderContext) return;
              const target = { name: folderContext.name, relPath: folderContext.relPath };
              setFolderContext(null);
              setDeleteFolderError(null);
              setDeleteFolderTarget(target);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 cursor-pointer transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete Folder…</span>
          </button>
        </PopoverContent>
      </Popover>

      {/* Rename Folder Dialog */}
      <Dialog
        open={renameFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameFolderTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={handleConfirmRenameFolder}>
            <DialogHeader>
              <DialogTitle>Rename Folder</DialogTitle>
              <DialogDescription>
                Enter a new name for{" "}
                <span className="text-zinc-200 font-medium">
                  {renameFolderTarget?.name}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <input
                type="text"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                autoFocus
                className="w-full h-9 px-3 rounded-xl bg-black/30 border border-white/[0.12] text-sm text-zinc-100 focus:outline-none focus:border-primary/60"
              />
              {renameFolderError && (
                <p className="text-xs text-rose-300">{renameFolderError}</p>
              )}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setRenameFolderTarget(null)}
                className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenamingFolder || !renameFolderValue.trim()}
                className="h-8 px-3.5 rounded-xl liquid-glass-accent text-xs font-semibold text-primary cursor-pointer disabled:opacity-50"
              >
                {isRenamingFolder ? "Renaming…" : "Rename"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation Dialog */}
      <Dialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Delete folder{" "}
              <span className="text-zinc-200 font-medium">
                &ldquo;{deleteFolderTarget?.name}&rdquo;
              </span>{" "}
              and all pieces inside it from disk? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteFolderError && (
            <p className="text-xs text-rose-300">{deleteFolderError}</p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteFolderTarget(null)}
              disabled={isDeletingFolder}
              className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDeleteFolder}
              disabled={isDeletingFolder}
              className="h-8 px-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 cursor-pointer disabled:opacity-50"
            >
              {isDeletingFolder ? "Deleting…" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
