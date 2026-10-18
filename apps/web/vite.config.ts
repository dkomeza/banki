import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The router plugin has to run before the React plugin.
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // xfwd sends the API X-Forwarded-For, as Caddy does in Docker, so the
      // API's rate limits and logs see each client's IP.
      "/api": { target: "http://localhost:3000", xfwd: true },
    },
  },
});
