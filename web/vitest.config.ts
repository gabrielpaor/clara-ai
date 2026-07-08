import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → "./src/*" so tests import production code
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
