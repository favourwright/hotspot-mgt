"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/system/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "hotspot:live-updates";

/**
 * Subscribers for same-tab writes. The `storage` event only fires in *other*
 * tabs, so a write here has to notify this tab's readers itself.
 */
const listeners = new Set<() => void>();

/**
 * Last value we tried to write, used as the snapshot when storage is
 * unreadable (private windows throw). Without it the toggle would appear
 * stuck for the whole session there.
 */
let fallback: string | null = null;

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
}

// Nothing is stored on the server, so the first render matches the markup
// React hydrates and the stored value is picked up right after.
function getServerSnapshot(): string | null {
  return null;
}

/**
 * Remembers the choice per viewer. Someone who turns polling off does not
 * want it back on every time they switch tabs or come back tomorrow.
 * Read through useSyncExternalStore so the stored value arrives without a
 * setState-in-effect cascade, and so a change in one tab reaches the others.
 */
export function useLivePreference(defaultValue: boolean) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const live = stored === null ? defaultValue : stored === "true";

  const update = useCallback((next: boolean) => {
    fallback = String(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, fallback);
    } catch {
      // Ignore - `fallback` still carries the toggle for this session.
    }
    for (const listener of listeners) listener();
  }, []);

  return [live, update] as const;
}

type LiveState = "polling" | "paused-hidden" | "off" | "failing";

interface LiveToggleProps {
  live: boolean;
  onChange: (live: boolean) => void;
  state: LiveState;
  lastUpdated: string | null;
  isFetching: boolean;
  onRefresh: () => void;
}

const DOT_TONE: Record<LiveState, string> = {
  polling: "bg-black",
  "paused-hidden": "bg-amber-500",
  failing: "bg-red-500",
  off: "bg-muted-foreground/40",
};

const LABEL: Record<LiveState, string> = {
  polling: "Live",
  "paused-hidden": "Paused - tab inactive",
  failing: "Not responding",
  off: "Live off",
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The indicator reports what is actually happening, not what the toggle is
 * set to - a green "Live" dot while the tab is backgrounded or the router
 * is dead would be worse than no dot at all.
 */
export function LiveToggle({
  live,
  onChange,
  state,
  lastUpdated,
  isFetching,
  onRefresh,
}: LiveToggleProps) {
  // Re-render on a timer so "2m ago" keeps up even while polling is off.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    // `justify-between` on phones, where this sits on its own full-width
    // row above the tabs: left-packed controls leave a dead gap there.
    <div className="flex items-center justify-between gap-3 sm:justify-start">
      <div className="flex max-md:flex-col md:items-center gap-1">
        {lastUpdated && (
          <span className="text-sm text-muted-foreground">
            Updated {relativeTime(lastUpdated)}
          </span>
        )}

        <Button
          tone="raised"
          size="sm"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh now"
        >
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            "size-2 rounded-full",
            live && "animate-pulse",
            DOT_TONE[state]
          )}
          aria-hidden
        />
        <span className="text-muted-foreground">{LABEL[state]}</span>
        <Switch
          checked={live}
          onCheckedChange={onChange}
          aria-label="Live updates"
        />
      </label>
    </div>
  );
}
