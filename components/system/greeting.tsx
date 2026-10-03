"use client";

import { useEffect, useState } from "react";

/**
 * Boundaries are deliberately coarse. "Evening" runs through the small
 * hours rather than switching to "Good night", which is a farewell.
 */
function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The time-of-day greeting, resolved in the *viewer's* timezone.
 *
 * It has to settle after mount rather than during render: on the server
 * `new Date()` is the VPS's clock (UTC), so a Lagos visitor at 9am would be
 * served "Good morning" only by luck, and any server-computed value would
 * mismatch the client's and trip a hydration error. Returning `null` until
 * mounted lets the caller render a stable placeholder for the first paint.
 */
export function useGreeting(): string | null {
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setGreeting(greetingForHour(new Date().getHours()));
    update();
    // A portal left open on a phone shouldn't still say "morning" at 3pm.
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  return greeting;
}

interface GreetingProps {
  /** Appended as "Good morning, Ada" when present. */
  name?: string | null;
  /** Shown until the viewer's local time is known. */
  fallback?: string;
}

export function Greeting({ name, fallback = "Hello" }: GreetingProps) {
  const greeting = useGreeting() ?? fallback;
  return <>{name ? `${greeting}, ${name}!` : `${greeting}!`}</>;
}
