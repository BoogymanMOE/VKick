/**
 * The component under test for tests/useLocalState.harness.tsx, in its own
 * file so the harness module exports only functions (React Fast Refresh
 * requires a module to export components and nothing else).
 */
import { useEffect } from "react";
import { createElement } from "react";
import { useLocalState } from "../src/lib/useLocalState";

export function Probe({
  keyId,
  initial,
  onValue,
  runAfterMount,
  runDelay,
}: {
  keyId: string;
  initial: boolean;
  onValue: (value: boolean) => void;
  runAfterMount: boolean;
  runDelay: number;
}) {
  const [value, setValue] = useLocalState<boolean>(keyId, initial);
  useEffect(() => {
    onValue(value);
  }, [value, onValue]);
  useEffect(() => {
    if (!runAfterMount) return;
    const id = setTimeout(() => setValue(true), runDelay);
    return () => clearTimeout(id);
    // runAfterMount fires once per mount by design ("targets a key once").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createElement(
    "div",
    { "data-testid": `probe-${keyId}`, "data-value": String(value) },
    String(value),
  );
}
