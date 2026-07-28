import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Captura a query SemanticQuery do Power BI do IDARON.
 *
 * PRECISA rodar num ambiente com acesso a *.analysis.windows.net (o cluster
 * wabi-brazil-south). A máquina de desenvolvimento atual bloqueia esse host
 * (TLS reset), então rode isto no servidor de deploy ou numa rede sem o bloqueio.
 *
 * Uso: npx tsx scripts/descobrir-consulta-ro.ts
 * Depois, cole o corpo capturado em montarConsulta() de src/coletores/ro.ts,
 * trocando os literais de ano e mês por interpolação.
 */
const RELATORIO =
  "https://app.powerbi.com/view?r=eyJrIjoiMzFjN2IwZjYtNWVkZS00MzU4LWJlMzUtYjhmYzQ5YWMwYWIxIiwidCI6IjJhOWFiYjFhLTVmMzYtNDA1Ny1hNzVjLTIwYjQyOTZjNTg0MiJ9";

const navegador = await chromium.launch({ headless: false });
const pagina = await navegador.newPage();
const capturadas: unknown[] = [];

pagina.on("request", (req) => {
  if (req.url().includes("querydata")) {
    capturadas.push({ url: req.url(), headers: req.headers(), body: req.postData() });
  }
});

await pagina.goto(RELATORIO, { waitUntil: "networkidle", timeout: 120_000 });
console.log("Selecione BOVINO, ABATE e o mês/ano desejado. 90s para interagir.");
await pagina.waitForTimeout(90_000);

await writeFile("scripts/ro-consultas-capturadas.json", JSON.stringify(capturadas, null, 2));
console.log(`capturadas: ${capturadas.length}`);
await navegador.close();
