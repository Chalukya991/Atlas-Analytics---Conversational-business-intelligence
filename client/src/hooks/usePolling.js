import { useEffect, useRef } from 'react';

/**
 * Poll `fn` while `active` is true. Interval backs off from `interval` to
 * `maxInterval` after `backoffAfterMs`, pauses when the tab is hidden, stops
 * after `maxDurationMs` (calling `onTimeout`) and always cleans up on unmount.
 */
export function usePolling(fn, { active, interval = 2000, maxInterval = 5000, backoffAfterMs = 30000, maxDurationMs = 15 * 60 * 1000, onTimeout } = {}) {
  const fnRef = useRef(fn);
  const timeoutRef = useRef(onTimeout);
  fnRef.current = fn;
  timeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        try {
          await fnRef.current();
        } catch {
          /* transient; keep polling */
        }
      }
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > maxDurationMs) {
        timeoutRef.current?.();
        return;
      }
      const wait = elapsed > backoffAfterMs ? maxInterval : interval;
      timer = setTimeout(tick, wait);
    };

    timer = setTimeout(tick, interval);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, interval, maxInterval, backoffAfterMs, maxDurationMs]);
}
