// Paquet signé du plugin : dist/music-in-the-box-<version>.iboxplugin + dist/catalog-entry.json.
// Clé d'éditeur : IBOX_PLUGIN_KEY, sinon Documents\iBox-sauvegarde\signature\ibox-plugins.key
// (jamais dans ce dépôt). Message signé identique à iBox (src-tauri/src/plugins/trust.rs).
import { createHash, createPrivateKey, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const { id, version } = manifest;
// PACK_LOCAL=1 : paquet d'essai pour un catalogue local (adresse relative)
const local = process.env.PACK_LOCAL === "1";
if (!manifest.author?.username) throw new Error("manifest.json : author.username (compte iNetbox du créateur) manquant.");
const key = process.env.IBOX_PLUGIN_KEY ?? join(homedir(), "Documents", "iBox-sauvegarde", "signature", "ibox-plugins.key");
if (!existsSync(key)) throw new Error(`Clé de signature introuvable : ${key}`);

const stage = join(root, "dist", "pkg");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "manifest.json"), join(stage, "manifest.json"));
cpSync(join(root, "icon.png"), join(stage, "icon.png"));
cpSync(join(root, "bridge"), join(stage, "bridge"), { recursive: true, filter: (f) => !f.endsWith(".md") });

// zip aux chemins en « / » (Compress-Archive écrit des « \ », refusés par iBox)
const out = join(root, "dist", `${id}-${version}.iboxplugin`);
rmSync(out, { force: true });
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "bsdtar";
execFileSync(tar, ["-a", "-c", "-f", out.replace(/\.iboxplugin$/, ".zip"), "manifest.json", "icon.png", "bridge"], { cwd: stage });
cpSync(out.replace(/\.iboxplugin$/, ".zip"), out);
rmSync(out.replace(/\.iboxplugin$/, ".zip"));

const bytes = readFileSync(out);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const signature = sign(null, Buffer.from(`ibox-plugin-v1\n${id}\n${version}\n${sha256}`), createPrivateKey(readFileSync(key))).toString("base64");
const icon = `data:image/png;base64,${readFileSync(join(root, "icon.png")).toString("base64")}`;
const entry = {
  id, name: manifest.name, version, description: manifest.description, author: { name: manifest.author.name, username: manifest.author.username },
  url: local ? `${id}-${version}.iboxplugin` : `https://github.com/atzski/${id}/releases/download/v${version}/${id}-${version}.iboxplugin`,
  sha256, signature, publisher: "atzski", size: statSync(out).size,
  notes: process.env.NOTES ?? "", permissions: manifest.permissions, icon, ibox: manifest.ibox, platforms: manifest.platforms,
  ...translations(manifest),
};
writeFileSync(join(root, "dist", "catalog-entry.json"), JSON.stringify(entry, null, 2));
console.log(`${out}\nsha256 ${sha256}\nentrée de catalogue : dist/catalog-entry.json`);

/**
 * Textes du catalogue dans d'autres langues : `name` et `description` sont en anglais (langue
 * par défaut des plugins), `i18n` du manifeste les donne en français ; les notes françaises
 * viennent de NOTES_FR. iBox prend `i18n[langue]`, puis `i18n.en`, puis la base.
 */
function translations(m) {
  const i18n = {};
  for (const [lang, t] of Object.entries(m.i18n ?? {})) {
    const texts = Object.fromEntries(["name", "description"].filter((k) => t[k]).map((k) => [k, t[k]]));
    if (Object.keys(texts).length) i18n[lang] = texts;
  }
  if (process.env.NOTES_FR) i18n.fr = { ...i18n.fr, notes: process.env.NOTES_FR };
  return Object.keys(i18n).length ? { i18n } : {};
}
