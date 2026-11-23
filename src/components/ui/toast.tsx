import React, { useEffect } from "react";
import { create } from "zustand";
import { Volume2, Volume1, VolumeX } from "lucide-react";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  icon?: "volume-high" | "volume-low" | "volume-mute";
  durationMs?: number;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (toast: ToastItem) => void;
  dismissToast: (id: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (toast) => {
    const existingTimer = timers.get(toast.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    set((state) => {
      const idx = state.toasts.findIndex((t) => t.id === toast.id);
      if (idx >= 0) {
        const next = [...state.toasts];
        next[idx] = toast;
        return { toasts: next };
      }
      return { toasts: [...state.toasts, toast] };
    });

    const duration = toast.durationMs ?? 1500;
    const timer = setTimeout(() => {
      timers.delete(toast.id);
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== toast.id),
      }));
    }, duration);
    timers.set(toast.id, timer);
  },
  dismissToast: (id) => {
    const existingTimer = timers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export function showVolumeToast(volume: number): void {
  const pct = Math.round(volume * 100);
  const icon: ToastItem["icon"] =
    pct === 0 ? "volume-mute" : pct < 45 ? "volume-low" : "volume-high";

  useToastStore.getState().showToast({
    id: "volume",
    title: "Volume",
    description: `${pct}%`,
    icon,
    durationMs: 1400,
  });
}

const ToastIcon: React.FC<{ icon?: ToastItem["icon"] }> = ({ icon }) => {
  if (icon === "volume-mute") {
    return <VolumeX className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
  }
  if (icon === "volume-low") {
    return <Volume1 className="w-3.5 h-3.5 text-primary shrink-0" />;
  }
  if (icon === "volume-high") {
    return <Volume2 className="w-3.5 h-3.5 text-primary shrink-0" />;
  }
  return null;
};

export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  useEffect(() => {
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-12 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none select-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full liquid-glass-popover shadow-xl animate-in fade-in-0 slide-in-from-top-1 duration-150 cursor-pointer"
        >
          <ToastIcon icon={t.icon} />
          <span className="text-xs font-medium text-zinc-300">{t.title}</span>
          {t.description && (
            <span className="text-xs font-mono font-semibold tabular-nums text-primary">
              {t.description}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
