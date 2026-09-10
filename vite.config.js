import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base под GitHub Pages в подпапке проекта: losevarb-hash.github.io/coros-dashboard/
export default defineConfig({
  base: "/coros-dashboard/",
  plugins: [react()],
});
