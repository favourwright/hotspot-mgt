"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * The one configured GSAP instance.
 *
 * Every animated component imports from here rather than from `gsap`
 * directly, so plugin registration and global config happen exactly once
 * and cannot drift between call sites. Registering the same plugin twice is
 * harmless, but *configuring* it twice is not, and the config below is the
 * kind of thing that silently stops being true if a second entry point
 * forgets it.
 *
 * Guarded on `window` because this module is reachable from a client
 * component's server render, where ScrollTrigger has no document to measure.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);

  ScrollTrigger.config({
    // On mobile, scrolling collapses the URL bar, which fires a `resize`,
    // which refreshes every ScrollTrigger and recomputes its start/end mid
    // scroll. The page then jumps under the thumb. This ignores the
    // height-only resize that the URL bar produces; a real orientation
    // change still has a width delta and still refreshes.
    ignoreMobileResize: true,
  });

  // Positions measured before the webfont swaps are measured against
  // fallback metrics, so every trigger tied to a block of text starts a few
  // pixels off and stays off. One refresh once the real font is in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

export { gsap, ScrollTrigger };
