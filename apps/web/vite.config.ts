import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `bun run dev` serves on 5173 and proxies /api to the API on 3000. The `ui`
// script sets both, so copies of Banki in several worktrees run side by side.
const port = process.env["WEB_PORT"] ? Number(process.env["WEB_PORT"]) : 5173;
const apiUrl = process.env["API_URL"] || "http://localhost:3000";

export default defineConfig({
  // The router plugin has to run before the React plugin.
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port,
    proxy: {
      // xfwd sends the API X-Forwarded-For, as Caddy does in Docker, so the
      // API's rate limits and logs see each client's IP.
      "/api": { target: apiUrl, xfwd: true },
    },
  },
});
