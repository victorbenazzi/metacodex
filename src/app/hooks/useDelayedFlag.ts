import { useEffect, useState } from "react";

/**
 * Mirrors `active`, but delays the true to false transition by `delayMs`. Used
 * to keep a closing element mounted through its exit animation: the flag flips
 * true immediately on open and only drops after the animation would have ended.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [flag, setFlag] = useState(active);
  useEffect(() => {
    if (active) {
      setFlag(true);
      return undefined;
    }
    const timeout = window.setTimeout(() => setFlag(false), delayMs);
    return () => window.clearTimeout(timeout);
  }, [active, delayMs]);
  return flag;
}
