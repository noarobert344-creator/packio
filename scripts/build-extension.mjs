/**
 * Construit la version publique de Packio Connect pour le Chrome Web Store :
 * l'adresse du site Packio est intégrée (aucune saisie pour le client) et la
 * connexion se fait en un clic depuis « Ventes et comptes liés ».
 *
 *   npm run extension:build -- https://packio.onrender.com
 *
 * Résultat : dist/packio-connect/ (dossier) et dist/packio-connect-<version>.zip
 * (à envoyer sur https://chrome.google.com/webstore/devconsole).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32 } from "node:zlib";

const raw = process.argv[2] || process.env.PACKIO_URL || process.env.APP_URL;
if (!raw) {
  console.error("Indiquez l'adresse publique de Packio : npm run extension:build -- https://packio.onrender.com");
  process.exit(1);
}
let origin;
try {
  origin = new URL(raw).origin;
} catch {
  console.error(`Adresse invalide : ${raw}`);
  process.exit(1);
}
if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
  console.error("L'adresse doit être en https:// (ou http://localhost pour un essai local).");
  process.exit(1);
}

const SRC = "extension";
const OUT_DIR = "dist";
const OUT = join(OUT_DIR, "packio-connect");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true, filter: (p) => !/(^|\/)(README\.md|store)(\/|$)/.test(relative(SRC, p)) });

writeFileSync(
  join(OUT, "config.js"),
  `/** Adresse du site Packio (version publique, générée par scripts/build-extension.mjs). */\nexport const PACKIO_URL = ${JSON.stringify(origin)};\n`,
);

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
manifest.host_permissions = [...new Set([...manifest.host_permissions, `${origin}/*`])];
delete manifest.optional_host_permissions;
manifest.content_scripts = [{ matches: [`${origin}/client/ventes*`], js: ["connect.js"], run_at: "document_idle" }];
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Archive ZIP (méthode « stocké »), acceptée par le Chrome Web Store.
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
const parts = [];
const central = [];
let offset = 0;
const files = listFiles(OUT).sort();
for (const file of files) {
  const name = Buffer.from(relative(OUT, file).split("\\").join("/"), "utf8");
  const data = readFileSync(file);
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, data);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  central.push(header, name);
  offset += 30 + name.length + data.length;
}
const centralSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
const zipPath = join(OUT_DIR, `packio-connect-${manifest.version}.zip`);
writeFileSync(zipPath, Buffer.concat([...parts, ...central, end]));

console.log(`✓ Packio Connect ${manifest.version} pour ${origin}`);
console.log(`  Dossier : ${OUT}`);
console.log(`  Archive à envoyer sur le Chrome Web Store : ${zipPath} (${files.length} fichiers)`);
if (!existsSync(join(OUT, "connect.js"))) console.warn("⚠ connect.js manquant");
