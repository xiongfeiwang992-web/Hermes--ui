import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "renderer",
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.PORT || 8787}`,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
  },
});
