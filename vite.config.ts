import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset URLs relative, so the built app works when hosted
// on GitHub Pages under a repo subpath (https://<user>.github.io/<repo>/).
export default defineConfig({
  plugins: [react()],
  base: "./",
});