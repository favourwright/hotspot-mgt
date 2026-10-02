import { cn } from "@/lib/utils";

interface MaskedValueProps extends React.ComponentProps<"span"> {
  value: string;
  /** How many trailing characters stay visible. */
  reveal?: number;
}

/**
 * A partially hidden value -- an account number, a key.
 *
 * The mask is drawn as elements, not as repeated `*` or `•` characters: a
 * glyph standing in for a graphic is the thing this design language avoids,
 * and a row of typed bullets also reads badly to a screen reader. The dots
 * are `aria-hidden` and the visible tail is announced with context.
 */
export function MaskedValue({
  value,
  reveal = 4,
  className,
  ...props
}: MaskedValueProps) {
  const tail = value.slice(-reveal);
  const hidden = Math.max(value.length - tail.length, 0);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: hidden }).map((_, i) => (
          <span
            key={i}
            className="size-[5px] rounded-full bg-current opacity-40"
          />
        ))}
      </span>
      <span className="sr-only">Ending in </span>
      <span className="tabular-nums" {...props}>
        {tail}
      </span>
    </span>
  );
}
