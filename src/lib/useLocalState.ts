import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State that survives a reload. Stands in for the API until the backend exists —
 * ratings, pins, comments and predictions all persist locally so the UI behaves
 * like a real app on a dev machine.
 */
export function useLocalState<T>(key: string, initial: T) {
  const initialRef = useRef(initial);

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialRef.current;
    } catch {
      return initialRef.current;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / quota */
    }
  }, [key, value]);

  const reset = useCallback(() => setValue(initialRef.current), []);

  return [value, setValue, reset] as const;
}
