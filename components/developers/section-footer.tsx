"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * The end of every docs section, as in the reference designs: "Was this
 * helpful?", counted per section (lib/docs-feedback.ts), and links to the
 * neighbouring pages in sidebar order.
 *
 * An answer is remembered in this browser, so the buttons do not invite a
 * second press, and are not a vote anyone can stuff: the route is
 * rate-limited per address as well.
 */
export function SectionFooter({
  sectionId,
  prev,
  next,
}: {
  sectionId: string;
  prev: { href: string; title: string } | null;
  next: { href: string; title: string } | null;
}) {
  const storageKey = `docs-feedback:${sectionId}`;
  // Read from storage the hydration-safe way: the server and the first
  // client render both see "not answered", then the stored value applies.
  const stored = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(storageKey),
    () => null
  );
  const [justAnswered, setJustAnswered] = useState(false);
  const answered = stored !== null || justAnswered;
  const [sending, setSending] = useState(false);

  const answer = async (helpful: boolean) => {
    setSending(true);
    try {
      await fetch("/api/developers/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: sectionId, helpful }),
      });
    } finally {
      window.localStorage.setItem(storageKey, helpful ? "yes" : "no");
      setJustAnswered(true);
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 pt-8">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {answered ? (
          <span className="text-muted-foreground">Thanks for the feedback.</span>
        ) : (
          <>
            <span className="text-muted-foreground">Was this helpful?</span>
            <button
              type="button"
              disabled={sending}
              onClick={() => answer(true)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 hover:bg-muted"
            >
              <ThumbsUp className="size-3.5" />
              Yes
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => answer(false)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 hover:bg-muted"
            >
              <ThumbsDown className="size-3.5" />
              No
            </button>
          </>
        )}
      </div>
      {(prev || next) && (
        <div className="grid grid-cols-2 gap-3">
          {prev ? (
            <Link href={prev.href} className="flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm hover:bg-muted">
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Previous</span>
                <span className="block truncate font-medium">{prev.title}</span>
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={next.href}
              className="flex items-center justify-end gap-2 rounded-2xl border border-border px-4 py-3 text-right text-sm hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Next</span>
                <span className="block truncate font-medium">{next.title}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

