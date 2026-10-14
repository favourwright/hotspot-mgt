/**
 * The single source of truth for horizontal measure.
 *
 * The nav bar and the page content are separate elements in separate
 * components, so without a shared constant they drift the moment one page
 * wants a narrower column -- and a nav that doesn't line up with the content
 * under it is the fastest way to make a layout look broken. Everything that
 * caps width imports from here.
 */
export const CONTENT_WIDTHS = {
  /** The system default. Past this the bento grid stops reading as a
   *  composition and starts reading as scattered cards. */
  default: "max-w-[1400px]",
  /** Long-form reading measure -- FAQ, docs, terms. */
  prose: "max-w-3xl",
  /** Single-object screens: a sign-in card, a confirmation panel. */
  narrow: "max-w-2xl",
  /** Edge to edge: full-bleed tables, maps. */
  full: "max-w-none",
} as const;

export type ContentWidth = keyof typeof CONTENT_WIDTHS;
