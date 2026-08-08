import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "renderer",
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
  },
});
