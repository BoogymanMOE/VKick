/// <reference types="vite/client" />
export {};

declare global {
  /** Injected by vite.config `define` — the package.json version at build time. */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    /** The Vite-native spelling of the same switch (`VITE_ADS_ENABLED`). */
    readonly VITE_ADS_ENABLED?: string;
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
}
