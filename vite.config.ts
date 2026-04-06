import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("monaco-editor") || id.includes("@monaco-editor")) {
            return "monaco-editor";
          }

          if (id.includes("@xterm")) {
            return "terminal-vendor";
          }
        }
      }
    }
  },
  server: {
    port: 1420,
    strictPort: true
  }
});
