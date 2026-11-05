/**
 * The characters generated voucher codes are drawn from. Its own file, with
 * no imports, so the settings page can show how guessable a format is
 * without pulling Node's crypto into the browser bundle.
 *
 * No 0/O, 1/I/L in the lettered sets: a code is read off paper and typed
 * into a phone, and every ambiguous pair is a support call. Digit-only
 * codes keep every digit, because a keypad has no such confusion and the
 * code space is small enough already.
 */
export const CODE_ALPHABETS = {
  alnum: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
  letters: "ABCDEFGHJKMNPQRSTUVWXYZ",
  digits: "0123456789",
} as const;

export type CodeCharset = keyof typeof CODE_ALPHABETS;

/** log2 of the code space: what a guesser has to search, per code. */
export function codeSpaceBits(format: { length: number; charset: CodeCharset }): number {
  return format.length * Math.log2(CODE_ALPHABETS[format.charset].length);
}
