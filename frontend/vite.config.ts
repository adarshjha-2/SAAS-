/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// The dev server proxies API and WebSocket traffic to the backend so the
// browser only ever talks to one origin. Secrets never live in the frontend:
// only VITE_-prefixed variables are bundled, and none of them are secret.
const backendUrl = process.env.NEXUS_DEV_BACKEND_URL ?? "http://127.0.0.1:8000";

const proxy: Record<string, ProxyOptions> = {
  "/api": { target: backendUrl },
  "/ws": { target: backendUrl.replace(/^http/, "ws"), ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
