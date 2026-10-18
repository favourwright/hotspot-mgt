import * as dylan from "@dicebear/dylan";

/**
 * Attribution for the generated avatar artwork.
 *
 * `@dicebear/dylan` is published as `MIT AND CC-BY-4.0`: the generator
 * code is MIT, the artwork is Creative Commons Attribution, and CC BY 4.0
 * requires that the creator be credited wherever the work is used. That
 * obligation did not appear when we started generating these ourselves -
 * it applied to the hosted API too - but self-hosting makes it plainly
 * ours to satisfy, so it is satisfied here.
 *
 * Read from the package's own `meta` rather than retyped as literals. A
 * credit copied into a string is a credit that silently stops being
 * correct the first time the dependency is updated and the artwork is
 * handed to somebody else.
 *
 * The brand-icon style (`@dicebear/shapes`) is plain MIT and needs no
 * attribution, which is why only this one is listed.
 */
const { title, creator, source, license } = dylan.meta;

/**
 * Every field is optional in the upstream type, and a missing one here is
 * not a rendering problem, it is an unmet licence condition. So this
 * throws rather than falling back: the module is imported by the footer,
 * so a package update that dropped the metadata would fail the build
 * instead of quietly shipping an uncredited page.
 */
if (!title || !creator || !source || !license) {
  throw new Error(
    "@dicebear/dylan no longer exposes complete attribution metadata; the CC BY 4.0 credit in the footer cannot be rendered from it"
  );
}

export const AVATAR_CREDIT = { title, creator, source, license } as const;
