import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const isPublicDemo = process.env.VITE_PUBLIC_DEMO === "true";

export default defineConfig({
  base: isPublicDemo ? "/concur-maigo-boshi-bot/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@configSource": path.resolve(
        __dirname,
        isPublicDemo
          ? "src/configSource.public.js"
          : "src/configSource.local.js",
      ),
    },
  },
});
