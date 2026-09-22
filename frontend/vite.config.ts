import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../src/data_loom/web/static", emptyOutDir: true },
  server: { fs: { allow: [".."] } },
});
