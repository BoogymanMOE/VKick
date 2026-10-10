import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

export default defineConfig(({ mode }) => {
  // `.env` files are not in process.env while this config is evaluated, so load
  // them explicitly. An empty prefix keeps every key (not just VITE_ ones) —
  // only the value below is exposed to the client, so nothing else leaks.
  // Real environment variables win, which is what a Render build sets.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    // Single source of truth for the app version (package.json) — surfaced in
    // Profile and usable anywhere via the global below.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // The banner-ads kill switch, under the exact name the deploy sets
      // (`ADGRAM_ENABLED`). Vite only inlines `VITE_`-prefixed vars on its own,
      // so this is what makes the un-prefixed name work; `VITE_ADGRAM_ENABLED`
      // is read natively as the alternative. Inlined at BUILD time — flipping
      // it needs a rebuild. See src/lib/ads.ts.
      __ADGRAM_ENABLED__: JSON.stringify(env.ADGRAM_ENABLED ?? ""),
    },
    build: {
      // The app runs in Telegram's webview on low-end Android, which can lag the
      // newest Chrome; Vite's "baseline widely available" default is a touch too
      // fresh there. es2019 keeps the output inside what these webviews parse.
      target: "es2019",
      cssTarget: "chrome61",
      // Routes are lazy-loaded, so the framework itself is the floor cost. Split
      // it into its own chunk (React + router, then the query client) so an app
      // code change doesn't invalidate the vendor bytes in the browser cache.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
    server: {
      // `npm run dev` then open http://localhost:5173 in a browser,
      // or expose it through a tunnel to load it inside Telegram.
      host: true,
      port: 5173,
      // Proxy API calls to the backend (`npm run server` / npm run dev:all),
      // so the frontend can just fetch("/api/...") with no CORS setup.
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
