import base from "./vitest.config.mts";
export default {
  ...base,
  test: {
    ...base.test,
    include: ["../../tests/apps/web/**/*.live.ts"],
    testTimeout: 20000,
  },
};
