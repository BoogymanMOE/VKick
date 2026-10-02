/// <reference types="vite/client" />
import type * as React from "react";

/** Adsgram's inline Task ad unit (docs.adsgram.ai), registered by their SDK. */
declare global {
  /** Injected by vite.config `define` — the package.json version at build time. */
  const __APP_VERSION__: string;
  namespace JSX {
    interface IntrinsicElements {
      "adsgram-task": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
