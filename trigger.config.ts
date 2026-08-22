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
  build: {
    // pdf-parse fica FORA do bundle (instalado como pacote na imagem): é CJS
    // antigo com um pdf.js embutido que, empacotado pelo esbuild, matava o
    // worker do coletor-imea no boot — runs TIMED_OUT com zero attempts e
    // nenhuma mensagem (22/08/2026).
    external: ["pdf-parse"],
    // Chromium headless na imagem de deploy, para o robô fotografar o site.
    // A versão do browser segue o `playwright` pinado no package.json — a
    // extensão a detecta pelos externals do build.
    extensions: [playwright({ browsers: ["chromium"] })],
  },
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
});
