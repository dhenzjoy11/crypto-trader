import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Development server — hot reload, proxies to backend :8000
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws":  { target: "ws://localhost:8000",  ws: true },
    },
  },
  // Production preview — serves built files, proxies to backend :8001
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: "http://localhost:8001", changeOrigin: true },
      "/ws":  { target: "ws://localhost:8001",  ws: true },
    },
  },
});
