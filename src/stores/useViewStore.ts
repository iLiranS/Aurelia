import { create } from "zustand";
import { listPreviewManager } from "@/engine/listPreviewDriver";
import { audioStopPreview } from "@/services/tauriApi";

export type ViewMode = "home" | "song" | "freeplay";
export type LayoutMode = "grid" | "list";
export type SortBy = "name" | "recent" | "added" | "duration";
export type FilterTab = "all" | "pinned";

interface ViewState {
  viewMode: ViewMode;
  currentFolderPath: string; // "" for root, or nested like "Anime" or "Anime/Oregairu"
  layoutMode: LayoutMode;
  sortBy: SortBy;
  filterTab: FilterTab;

  setViewMode: (mode: ViewMode) => void;
  setCurrentFolderPath: (folderPath: string) => void;
  setLayoutMode: (layout: LayoutMode) => void;
  setSortBy: (sortBy: SortBy) => void;
  setFilterTab: (filterTab: FilterTab) => void;
  navigateUp: () => void;
  navigateToFolder: (folderName: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  viewMode: "home",
  currentFolderPath: "",
  layoutMode: "grid",
  sortBy: "name",
  filterTab: "all",

  setViewMode: (viewMode) => {
    listPreviewManager.stop();
    audioStopPreview().catch(() => {});
    set({ viewMode });
  },
  setCurrentFolderPath: (currentFolderPath) => set({ currentFolderPath }),
  setLayoutMode: (layoutMode) => {
    listPreviewManager.stop();
    audioStopPreview().catch(() => {});
    set({ layoutMode });
  },
  setSortBy: (sortBy) => set({ sortBy }),
  setFilterTab: (filterTab) => set({ filterTab }),

  navigateUp: () =>
    set((state) => {
      if (!state.currentFolderPath) return state;
      const parts = state.currentFolderPath.split("/");
      parts.pop();
      return { currentFolderPath: parts.join("/") };
    }),

  navigateToFolder: (folderName: string) =>
    set((state) => {
      const trimmed = folderName.trim().replace(/^[\/\\]+|[\/\\]+$/g, "");
      if (!trimmed) return state;
      const nextPath = state.currentFolderPath
        ? `${state.currentFolderPath}/${trimmed}`
        : trimmed;
      return { currentFolderPath: nextPath };
    }),
}));
