import { cn } from "@/lib/utils";

/**
 * Splits a leading currency symbol off a formatted value so it can be
 * de-emphasised -- the number is the hero, the unit is context.
 * `\p{Sc}` is the Unicode currency category, so this covers ₦ from
 * `formatNaira` as well as $, € and £ without hardcoding any of them.
 */
export function splitCurrency(value: string | number) {
  if (typeof value !== "string") return { symbol: null, rest: String(value) };
  const match = value.match(/^(\p{Sc})\s*(.+)$/u);
  return match
    ? { symbol: match[1], rest: match[2] }
    : { symbol: null, rest: value };
}

interface AmountProps extends React.ComponentProps<"span"> {
  value: string | number;
  /** Class for the currency symbol; defaults to the muted tone. */
  symbolClassName?: string;
}

/** A monetary value with its currency symbol held back from the number. */
export function Amount({
  value,
  className,
  symbolClassName,
  ...props
}: AmountProps) {
  const { symbol, rest } = splitCurrency(value);
  return (
    <span className={cn("tabular-nums", className)} {...props}>
      {symbol && (
        <span className={cn("text-muted-foreground", symbolClassName)}>
          {symbol}
        </span>
      )}
      {rest}
    </span>
  );
}
