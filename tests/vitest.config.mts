import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL("../apps/web/", import.meta.url)),
  resolve: { dedupe: ["vitest"] },
  test: {
    include: ["../../tests/apps/web/**/*.test.ts"],
    environment: "node",
    watch: false,
  },
};
