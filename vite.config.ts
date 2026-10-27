import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

/**
 * The commit this bundle was built from, short form.
 *
 * Render exports RENDER_GIT_COMMIT for every push deploy, which is the exact
 * answer and needs no shell. Elsewhere (local `npm run build`) ask git; a
 * tarball or a dirty tree without git still has to build, so "dev" is the
 * honest last resort rather than failing the build over a build stamp.
 */
function gitCommitShort(): string {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Single source of truth for the app version (package.json) — surfaced in
    // Profile and usable anywhere via the global below.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // "Which build is this?". A stale Telegram webview and a fresh deploy
      // look identical from the inside, so Profile states the commit and the
      // build time outright instead of leaving it to be guessed.
      __APP_COMMIT__: JSON.stringify(gitCommitShort()),
      __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
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
