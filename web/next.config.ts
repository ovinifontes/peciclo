import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * O painel importa a lógica pura do ciclo de `../src/ciclo/leitura.ts` — na
 * raiz do repositório, fora de web/ — porque é a mesma leitura que a narrativa
 * por WhatsApp vai usar e que a suíte da raiz testa. Duplicá-la aqui criaria
 * duas verdades sobre qual é a fase do ciclo.
 *
 * O Turbopack não resolve nada fora da raiz do projeto. Com a raiz em `web/`,
 * o build falha com "Module not found: Can't resolve
 * '../../../src/ciclo/leitura'" — mesmo com o `tsc` passando, porque o
 * TypeScript segue o caminho relativo e o empacotador não.
 *
 * `outputFileTracingRoot` e `turbopack.root` são o MESMO botão no Next 16: em
 * `next/dist/server/config.js` o Next reconcilia os dois
 * (`rootDir = tracingRoot || turbopackRoot`), avisa se divergirem e força os
 * dois ao mesmo valor. Não dá para resolver na raiz do repo e rastrear só
 * web/ — verificado nas quatro combinações: só passa com os dois na raiz.
 *
 * O receio antigo (arrastar o robô para o pacote do deploy) não se confirmou:
 * o rastreamento sai com 1012 arquivos, dos quais 46 fora de web/ — todos
 * `@opentelemetry/api` e um `semver/package.json`, dependências opcionais do
 * próprio Next içadas para o node_modules da raiz. Zero arquivos de
 * `@trigger.dev` ou `exceljs`. Os dois módulos vindos da raiz são compilados
 * para dentro do bundle do servidor, não copiados como dependência.
 */
const repoRoot = join(projectRoot, "..");

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
