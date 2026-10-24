import { useEffect, useRef, useState } from "react";

type Anchor = {
  /** `performance.now()` when this server value was received. */
  at: number;
  /** Seconds remaining, as the server measured them. */
  seconds: number;
};

/**
 * Counts down the stock hold using the server's number of seconds remaining.
 *
 * The counter's own clock can be several minutes wrong, so the deadline is
 * never computed from `expiresAt` against the local wall clock. Instead the
 * server's `expiresInSeconds` is anchored to `performance.now()` at the
 * moment the response arrived, and the displayed value is that number minus
 * the monotonic time elapsed since. `performance.now()` is immune both to a
 * badly set clock and to an NTP correction landing mid-countdown.
 *
 * Every poll that reports a different number re-anchors, so the browser also
 * self-corrects for its own timer drift and for time spent suspended.
 */
export function useHoldCountdown(
  expiresInSeconds: number | undefined,
): number {
  const anchorRef = useRef<Anchor | null>(null);
  const [ticked, setTicked] = useState<number | null>(null);

  useEffect(() => {
    if (expiresInSeconds === undefined) return;

    anchorRef.current = {
      at: performance.now(),
      seconds: expiresInSeconds,
    };
  }, [expiresInSeconds]);

  useEffect(() => {
    // 250ms, not 1000ms: a one-second tick drifts visibly against the
    // anchor and can appear to skip or repeat a second.
    const timer = window.setInterval(() => {
      const anchor = anchorRef.current;

      if (!anchor) return;

      const elapsedSeconds = (performance.now() - anchor.at) / 1000;

      setTicked(Math.max(0, Math.ceil(anchor.seconds - elapsedSeconds)));
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  // Before the first tick, show the server's number as-is.
  return ticked ?? expiresInSeconds ?? 0;
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
