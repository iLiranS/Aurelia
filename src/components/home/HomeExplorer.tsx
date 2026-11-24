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
  ArrowLeft,
  ArrowUpDown,
  ArrowDownAZ,
  Clock,
  CalendarPlus,
  Timer,
  Check,
  FolderPlus,
  Mic,
  Pencil,
  Trash2,
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
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      immediateFolders: folders,
      folderSongs: directSongs,
      searchResults: searchRes,
    };
  }, [songs, libraryFolders, currentFolderPath, searchQuery]);

  const recordingsFolder = !currentFolderPath
    ? immediateFolders.find((f) => f.name === "Recordings")
    : undefined;

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
    <div className="flex items-center gap-2 shrink-0">
      {/* Sort Dropdown Pill */}
      <Popover open={sortDropdownOpen} onOpenChange={setSortDropdownOpen}>
        <PopoverTrigger asChild>
          <button
            className={`h-7 px-3 rounded-full liquid-glass-btn flex items-center gap-1.5 text-xs transition-all cursor-pointer active:scale-95 ${sortDropdownOpen ? "text-zinc-100 border-white/20" : "text-zinc-300 hover:text-white"
              }`}
            aria-label="Sort pieces"
          >
            <ArrowUpDown className="w-3 h-3 text-primary" />
            <span className="font-medium">
              {SORT_OPTIONS.find((o) => o.id === sortBy)?.label ?? "Sort"}
            </span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
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

      {/* Grid / List Layout Toggle Pill */}
      <div className="flex items-center p-0.5 rounded-full liquid-glass-btn">
        <button
          onClick={() => setLayoutMode("grid")}
          className={`w-6 h-6 flex items-center justify-center rounded-full cursor-pointer liquid-glass-segment ${layoutMode === "grid"
            ? "liquid-glass-segment-active text-primary"
            : "text-zinc-400 hover:text-zinc-200"
            }`}
          aria-label="Grid View"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setLayoutMode("list")}
          className={`w-6 h-6 flex items-center justify-center rounded-full cursor-pointer liquid-glass-segment ${layoutMode === "list"
            ? "liquid-glass-segment-active text-primary"
            : "text-zinc-400 hover:text-zinc-200"
            }`}
          aria-label="List View"
        >
          <List className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[18vh] z-10 bg-gradient-to-b from-[#09090b]/84 via-[#09090b]/78 to-[#09090b]/58 backdrop-blur-md flex flex-col select-none overflow-hidden">
      {/* Transparent Floating Topbar */}
      <div className="relative h-12 px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0">
        {/* Left: Clickable MIDI Root Folder Pill + Subfolder Breadcrumbs */}
        <div className="flex items-center gap-1.5 min-w-0 z-10">
          {breadcrumbs.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCurrentFolderPath("")}
                  className="w-7 h-7 rounded-full liquid-glass-btn flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-all cursor-pointer shrink-0"
                  aria-label="Back to Root"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>Back to Root</span>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSelectFolder}
                className="h-7 px-3 rounded-full liquid-glass-btn flex items-center gap-2 text-xs text-zinc-200 hover:text-white transition-all cursor-pointer max-w-[180px] shrink-0"
                aria-label="Change MIDI Folder"
              >
                <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate font-medium">{rootFolderName}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <span>{rootFolder ? `Change MIDI Folder (${rootFolder})` : "Select MIDI Folder"}</span>
            </TooltipContent>
          </Tooltip>

          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            const targetPath = breadcrumbs.slice(0, idx + 1).join("/");
            return (
              <React.Fragment key={targetPath}>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                <button
                  onClick={() => setCurrentFolderPath(targetPath)}
                  className={`text-xs truncate max-w-[130px] transition-colors cursor-pointer ${isLast
                    ? "text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-100"
                    }`}
                >
                  {crumb}
                </button>
              </React.Fragment>
            );
          })}

          {recordingsFolder && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCurrentFolderPath("Recordings")}
                  className="h-7 px-2.5 rounded-full liquid-glass-btn flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer shrink-0 ml-1"
                  aria-label="Open Recordings Folder"
                >
                  <Mic className="w-3 h-3 text-rose-400" />
                  <span className="font-medium">Recordings</span>
                  <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                    {recordingsFolder.count}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>Jump to Free Play Recordings</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Center: Search Pieces with Mod+K Shortcut Badge */}
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
            className="w-full h-8 pl-8 pr-12 text-xs rounded-full liquid-glass-input text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-all"
          />
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-zinc-400 leading-none">
              {isMac ? "⌘K" : "Ctrl+K"}
            </kbd>
          )}
        </div>

        {/* Right: Studio Action Buttons */}
        <div className="z-10">
          <AppActionButtons mode="home" />
        </div>
      </div>

      {/* Main Scrollable Library Explorer */}
      <ScrollArea className="flex-1 px-6 md:px-8 py-0 ">
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
              <button
                onClick={handleSelectFolder}
                className="mt-2 px-4 py-2 rounded-xl liquid-glass-accent text-xs font-medium text-primary flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95"
              >
                <FolderOpen className="w-4 h-4 text-primary" />
                <span>Select MIDI Folder</span>
              </button>
            </div>
          ) : hasSearch ? (
            /* Search Results View */
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                  SEARCH RESULTS ({searchResults.length})
                </span>
                <div className="flex-1 h-px bg-white/[0.07]" />
                {libraryControls}
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
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            /* Normal Folder Navigation View */
            <>
              {/* 1. NESTED FOLDERS TILES */}
              {immediateFolders.length > 0 && (
                <section className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                      FOLDERS
                    </span>
                    <div className="flex-1 h-px bg-white/[0.07]" />
                    <button
                      type="button"
                      onClick={() => {
                        setNewFolderName("");
                        setNewFolderError(null);
                        setNewFolderOpen(true);
                      }}
                      className="h-6 px-2.5 rounded-full liquid-glass-btn flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-95"
                    >
                      <FolderPlus className="w-3 h-3 text-primary" />
                      <span>New Folder</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                    {immediateFolders.map((f) => (
                      <button
                        key={f.name}
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
                        className="group flex items-center justify-between px-2.5 pt-1.5 pb-1 rounded-lg liquid-glass-btn cursor-pointer transition-all hover:border-white/20 active:scale-[0.98] text-left">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-md bg-black/40 border border-white/[0.08] flex items-center justify-center text-primary shrink-0 group-hover:scale-105 transition-transform">
                            <Folder className="w-3.5 h-3.5 fill-primary/20" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-medium text-zinc-200 truncate leading-tight group-hover:text-zinc-100">
                              {f.name}
                            </h4>
                            <span className="block text-[10px] font-mono tabular-nums text-zinc-500 leading-tight">
                              {f.count} {f.count === 1 ? "piece" : "pieces"}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0 ml-1" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 2. LIBRARY PIECES IN CURRENT FOLDER */}
              {folderSongs.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                      LIBRARY ({folderSongs.length})
                    </span>
                    <div className="flex-1 h-px bg-white/[0.07]" />
                    {immediateFolders.length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewFolderName("");
                          setNewFolderError(null);
                          setNewFolderOpen(true);
                        }}
                        className="h-7 px-2.5 rounded-full liquid-glass-btn flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-95"
                      >
                        <FolderPlus className="w-3.5 h-3.5 text-primary" />
                        <span>New Folder</span>
                      </button>
                    )}
                    {libraryControls}
                  </div>

                  {layoutMode === "grid" ? (
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
            </>
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
