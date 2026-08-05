import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// A raiz do repositório também tem um package-lock.json (o robô de coleta).
// Sem isto o Next elege a raiz como workspace e arrasta os arquivos do robô
// para o rastreamento do build. O app web começa e termina em web/.
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
