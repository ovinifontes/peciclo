import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";

export default defineConfig({
  // Ref do projeto no Trigger.dev. Fixo aqui (não é segredo) para o deploy via
  // GitHub encontrá-lo sem depender de variável de ambiente no build.
  project: "proj_xfpkwsjmqadhzfdcndsx",
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
