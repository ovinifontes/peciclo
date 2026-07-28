import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { baixarArquivoDrive, parsearPa } from "./src/coletores/pa.js";
import { abrirColeta, fecharColeta } from "./src/dados/coletas.js";
import { gravarRegistros } from "./src/dados/registros.js";
import { rollupJanela, lerAbateMensal } from "./src/dados/mensal.js";

const antes = await lerAbateMensal();
console.log("baixando PA/2025 (155 MB)...");
const t0 = Date.now();
const buf = await baixarArquivoDrive("1vuaU22DNiVZijCVGaEhT4aqJewC6QBbR");
console.log(`baixado ${(buf.length/1048576).toFixed(0)} MB em ${((Date.now()-t0)/1000).toFixed(0)}s`);
const hash = createHash("sha256").update(buf).digest("hex");
const tmp = join(tmpdir(), `pa2025-${hash.slice(0,12)}.xlsx`);
await writeFile(tmp, buf);
console.log("parseando...");
const t1 = Date.now();
const registros = await parsearPa(tmp);
console.log(`${registros.length} registros em ${((Date.now()-t1)/1000).toFixed(0)}s`);
const janela = { inicio: "2025-01-01", fim: "2025-12-31" };
const id = await abrirColeta({ uf: "PA", tipo: "mensal", janela });
console.log("gravando...");
const g = await gravarRegistros(registros, id);
await rollupJanela({ uf: "PA", janela, coletaId: id });
await fecharColeta({ id, status: "ok", arquivoHash: hash, linhasAfetadas: g });
const depois = await lerAbateMensal();
console.log("\n=== PA 2025: OFICIAL vs manual ===");
for (let mes = 1; mes <= 12; mes++) {
  const q = (src:any[], s:string) => src.find(x=>x.uf==="PA"&&x.ano===2025&&x.mes===mes&&x.sexo===s)?.quantidade;
  console.log(`  ${String(mes).padStart(2)}/2025: oficial F=${q(depois,"FEMEA") ?? "—"} M=${q(depois,"MACHO") ?? "—"}  |  manual F=${q(antes,"FEMEA") ?? "—"} M=${q(antes,"MACHO") ?? "—"}`);
}
console.log("=== PA2025 CONCLUIDO ===");
