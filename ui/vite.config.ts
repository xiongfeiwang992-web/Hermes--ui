import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  publicDir: false,
  server: {
    port: 5173,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
