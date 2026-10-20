/**
 * Browser-side harness for tests/useLocalState.test.ts: mounts the real
 * `useLocalState` hook through a real React root (StrictMode off here — the
 * app's own wrapper adds it; the dirty-flag write rule must hold either way)
 * and runs the three contract cases:
 *
 *   1. defaultUntouched — a key never written stays ABSENT after mount
 *   2. togglePersist    — a setter change is persisted
 *   3. storedWins       — an existing stored value beats the default AND the
 *                         mount effect never rewrites it
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Probe } from "./useLocalState.probe";

function mount(keyId: string, initial: boolean, onValue: (value: boolean) => void, runAfterMount = false, runDelay = 30) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(createElement(Probe, { keyId, initial, onValue, runAfterMount, runDelay }));
  return host;
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function defaultUntouched(key: string) {
  localStorage.removeItem(key);
  const values: boolean[] = [];
  mount(key, false, (value) => values.push(value));
  await tick(120);
  return { stored: localStorage.getItem(key), values };
}

export async function togglePersist(key: string) {
  localStorage.removeItem(key);
  const values: boolean[] = [];
  mount(key, false, (value) => values.push(value), true, 30);
  await tick(250);
  return { stored: localStorage.getItem(key), values };
}

export async function storedWins(key: string, initial: boolean) {
  localStorage.removeItem(key);
  localStorage.setItem(key, JSON.stringify(true));
  const values: boolean[] = [];
  mount(key, initial, (value) => values.push(value));
  await tick(150);
  const stored = localStorage.getItem(key);
  return { stored, values };
}
