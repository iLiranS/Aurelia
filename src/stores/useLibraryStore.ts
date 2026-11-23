import { create } from "zustand";
import type { ParsedSong, SongSettings, SongSummary } from "@/types/midi";
import {
  setRootFolder as apiSetRootFolder,
  listLibraryFolders,
  pickMidiFolder,
} from "@/services/tauriApi";
import { useViewStore } from "@/stores/useViewStore";

interface LibraryState {
  rootFolder: string | null;
  songs: SongSummary[];
  folders: string[];
  searchQuery: string;
  favoritesOnly: boolean;
  sidebarOpen: boolean;
  activeSong: ParsedSong | null;
  activeSongSettings: SongSettings | null;
  isLoadingSong: boolean;

  setRootFolder: (folder: string | null) => void;
  setSongs: (songs: SongSummary[]) => void;
  setFolders: (folders: string[]) => void;
  refreshFolders: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFavoritesOnly: (favOnly: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveSong: (song: ParsedSong | null, settings?: SongSettings | null) => void;
  setIsLoadingSong: (loading: boolean) => void;
  updateFavorite: (contentHash: string, isFav: boolean) => void;
  touchLastPlayed: (contentHash: string, timestampMs?: number) => void;
  selectFolder: () => Promise<string | null>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  rootFolder: null,
  songs: [],
  folders: [],
  searchQuery: "",
  favoritesOnly: false,
  sidebarOpen: true,
  activeSong: null,
  activeSongSettings: null,
  isLoadingSong: false,

  setRootFolder: (rootFolder) => set({ rootFolder }),
  setSongs: (songs) => set({ songs }),
  setFolders: (folders) => set({ folders }),
  refreshFolders: async () => {
    try {
      const folders = await listLibraryFolders();
      set({ folders });
    } catch {
      // Ignore
    }
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveSong: (activeSong, activeSongSettings = null) =>
    set({ activeSong, activeSongSettings }),
  setIsLoadingSong: (isLoadingSong) => set({ isLoadingSong }),
  updateFavorite: (contentHash, isFav) =>
    set((state) => ({
      songs: state.songs.map((song) =>
        song.contentHash === contentHash
          ? { ...song, isFavorite: isFav }
          : song
      ),
    })),
  touchLastPlayed: (contentHash, timestampMs = Date.now()) =>
    set((state) => ({
      songs: state.songs.map((song) =>
        song.contentHash === contentHash
          ? { ...song, lastPlayedAt: timestampMs }
          : song
      ),
    })),
  selectFolder: async () => {
    const selected = await pickMidiFolder();
    if (selected) {
      set({ rootFolder: selected });
      useViewStore.getState().setCurrentFolderPath("");
      const scannedSongs = await apiSetRootFolder(selected);
      const folders = await listLibraryFolders().catch(() => []);
      set({ songs: scannedSongs, folders });
      return selected;
    }
    return null;
  },
}));
