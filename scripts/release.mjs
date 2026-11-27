// Publication du plugin (sur demande explicite seulement, comme pour iBox) :
//   1. tests et paquet signé (pack.mjs) ;
//   2. Release GitHub v<version> sur atzski/music-in-the-box avec le paquet ;
//   3. entrée du catalogue écrite dans ../ibox/services/inetbox/src/plugins.ts.
// Ensuite : déployer iNetbox selon sa procédure habituelle (copie vers atzski/inetbox-server, push).
//   NOTES="… (anglais)" NOTES_FR="… (français)" node scripts/release.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dry = process.argv.includes("--dry-run");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: cmd === "npm" && process.platform === "win32" });
const { id, version, name } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const repo = `atzski/${id}`;
if (!process.env.NOTES) throw new Error("NOTES requis (notes de version affichées dans iBox).");
if (!process.env.NOTES_FR) throw new Error("NOTES_FR requis : NOTES en anglais (langue par défaut), NOTES_FR en français.");

run("npm", ["test"]);
run("node", ["scripts/pack.mjs"]);
const entry = JSON.parse(readFileSync(join(root, "dist", "catalog-entry.json"), "utf8"));
const file = join(root, "dist", `${id}-${version}.iboxplugin`);

if (dry) {
  console.log(`--dry-run : Release ${repo} v${version} et catalogue non modifiés.`);
  process.exit(0);
}
run("gh", ["release", "create", `v${version}`, file, "--repo", repo, "--title", `${name} ${version}`, "--notes", process.env.NOTES]);

const catalog = join(root, "..", "ibox", "services", "inetbox", "src", "plugins.ts");
const src = readFileSync(catalog, "utf8");
// fin de ligne LF ou CRLF (la copie de travail Windows d'iBox peut être en CRLF)
const m = src.match(/export const PLUGINS: PluginEntry\[\] = (\[[\s\S]*?\]);(\r?\n)/);
if (!m) throw new Error("PLUGINS introuvable dans plugins.ts");
const list = JSON.parse(m[1]).filter((e) => e.id !== id).concat(entry);
writeFileSync(catalog, src.replace(m[0], `export const PLUGINS: PluginEntry[] = ${JSON.stringify(list, null, 2).replace(/\n/g, m[2])};${m[2]}`));
console.log(`Release ${repo} v${version} publiée ; catalogue iNetbox mis à jour (à déployer).`);
