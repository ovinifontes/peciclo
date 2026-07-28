import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  runtime: "node-22",
  dirs: ["./src/trigger"],
  logLevel: "info",
  maxDuration: 600,
  machine: "small-2x",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 10_000,
      maxTimeoutInMs: 120_000,
      randomize: true,
    },
  },
  build: {
    external: ["playwright"],
    extensions: [playwright({ browsers: ["chromium"], headless: true })],
  },
});
