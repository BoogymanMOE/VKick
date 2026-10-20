import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/**
 * State that survives a reload. Stands in for the API until the backend exists —
 * ratings, pins, comments and predictions all persist locally so the UI behaves
 * like a real app on a dev machine.
 *
 * Only real choices are persisted: the value is read once at mount (stored
 * beats `initial`) and the write effect is armed by the setters. That skip
 * matters because the mount effect used to run immediately and would persist a
 * COMPUTED DEFAULT the user never chose (a `defaultOpen` derived from data) —
 * the next mount then pinned that default as if it were a saved choice, even
 * after the underlying data changed. The armed flag also survives React
 * StrictMode's dev double-invoke of mount effects: neither run persists
 * anything until an actual setter fires.
 */
export function useLocalState<T>(key: string, initial: T) {
  const initialRef = useRef(initial);
  const dirtyRef = useRef(false);

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialRef.current;
    } catch {
      return initialRef.current;
    }
  });

  const write = useCallback((action: SetStateAction<T>) => {
    dirtyRef.current = true;
    setValue(action);
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / quota */
    }
  }, [key, value]);

  const reset = useCallback(() => {
    dirtyRef.current = true;
    setValue(initialRef.current);
  }, []);

  return [value, write, reset] as const;
}
