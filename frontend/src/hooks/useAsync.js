import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async function on mount (and whenever `deps` change), tracking
 * loading/error/data and ignoring results from a superseded call.
 *
 * Concurrent identical calls share one promise. This matters because React
 * StrictMode invokes effects twice in development: without sharing, every
 * AI-backed screen would fire two generations — double the wait and double the
 * cost — and the losing one could collide on a unique index.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);

  const callId = useRef(0);
  const inFlight = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    (...args) => {
      // Share the running promise instead of starting a second identical call.
      if (inFlight.current) return inFlight.current;

      const id = callId.current + 1;
      callId.current = id;

      setLoading(true);
      setError(null);

      const promise = (async () => {
        try {
          const result = await fn(...args);
          if (mounted.current && id === callId.current) setData(result);
          return result;
        } catch (err) {
          if (mounted.current && id === callId.current) setError(err);
          throw err;
        } finally {
          inFlight.current = null;
          if (mounted.current && id === callId.current) setLoading(false);
        }
      })();

      inFlight.current = promise;
      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    if (!immediate) return;
    run().catch(() => {
      /* surfaced through `error` */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, run, setData };
}

export default useAsync;
