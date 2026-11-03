import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  // false: the desktop app is not the Thunderbird add-on (src/httpsOnly.ts).
  define: { __ADDON__: "false" },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
