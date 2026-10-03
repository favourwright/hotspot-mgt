"use client";

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/system/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "hotspot:live-updates";

/**
 * Remembers the choice per viewer. Someone who turns polling off does not
 * want it back on every time they switch tabs or come back tomorrow.
 * Wrapped in try/catch because storage throws in private windows.
 */
export function useLivePreference(defaultValue: boolean) {
  const [live, setLive] = useState(defaultValue);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setLive(stored === "true");
    } catch {
      // Keep the default; this is a convenience, not state we depend on.
    }
  }, []);

  const update = useCallback((next: boolean) => {
    setLive(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore - the toggle still works for this session.
    }
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

      <label className="flex items-center gap-2 text-sm">
        <span
          className={cn("size-2 rounded-full animate-pulse", DOT_TONE[state])}
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
