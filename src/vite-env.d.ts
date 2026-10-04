/// <reference types="vite/client" />
import type * as React from "react";

/** Adsgram's inline Task ad unit (docs.adsgram.ai), registered by their SDK. */
declare global {
  /** Injected by vite.config `define` — the package.json version at build time. */
  const __APP_VERSION__: string;

  interface Window {
    /**
     * Set by the inline boot script in index.html once the Telegram SDK has
     * loaded, failed, or hit its 1.5s deadline. The app mounts on it so
     * AuthProvider always sees initData when it exists, without ever making
     * a blocked telegram.org hold the boot splash hostage.
     */
    __tgSdkSettled?: boolean;
  }
  namespace JSX {
    interface IntrinsicElements {
      "adsgram-task": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
