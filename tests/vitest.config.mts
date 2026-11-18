import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL("../apps/web/", import.meta.url)),
  resolve: {
    dedupe: ["vitest"],
    alias: {
      "server-only": fileURLToPath(
        new URL("./support/server-only.mts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["../../tests/apps/web/**/*.test.ts"],
    environment: "node",
    watch: false,
  },
};
