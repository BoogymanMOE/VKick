/// <reference types="vite/client" />
import type * as React from "react";

/** Adsgram's inline Task ad unit (docs.adsgram.ai), registered by their SDK. */
declare global {
  /** Injected by vite.config `define` — the package.json version at build time. */
  const __APP_VERSION__: string;
  /**
   * Injected by vite.config `define` from the plain `ADGRAM_ENABLED` environment
   * variable — the banner-ads kill switch under the name the deploy sets.
   * Inlined at build time; see src/lib/ads.ts.
   */
  const __ADGRAM_ENABLED__: string;

  interface ImportMetaEnv {
    /** The Vite-native spelling of the same switch (`VITE_ADGRAM_ENABLED`). */
    readonly VITE_ADGRAM_ENABLED?: string;
    /** Adsgram Task block id (see src/lib/ads.ts). */
    readonly VITE_ADSGRAM_TASK_BLOCK_ID?: string;
  }

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
