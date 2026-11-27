// Extrait les textes français affichés par l'interface (texte JSX, chaînes et
// gabarits ${…}) pour construire le dictionnaire de traduction.
// Analyse lexicale simple (sans compilateur) : chaînes "…", '…', `…` et texte
// entre balises JSX. Usage : node scripts/i18n-extract.mjs > strings.json
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts")) files.push(p);
  }
})(join(root, "src"));

const FRENCH = /[a-zà-ÿ]{2}/i;
function human(t) {
  if (!FRENCH.test(t) || t.length > 500) return false;
  if (/^[\w./:#@?=&%-]+$/.test(t) && !/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t)) return false; // identifiants, chemins, url
  if (/^(https?:|\/|#|\.|@\/|data:|image\/)/.test(t)) return false;
  // classes Tailwind et styles CSS
  if (/(^|\s)(flex|grid|px-|py-|text-|bg-|rounded|items-|gap-|w-|h-|mt-|mb-|font-|absolute|relative|inset|border|shadow|opacity|transition|pointer-events|overflow)/.test(t) && !/[À-ÿ]/.test(t)) return false;
  if (/^(linear|radial)-gradient|rgba?\(|^\d|cubic-bezier|^var\(/.test(t)) return false;
  if (/^[a-z]+(-[a-z]+)*$/.test(t)) return false; // clés internes : "shelf", "game-invites"
  if (/^[a-z][a-zA-Z]+$/.test(t)) return false; // camelCase
  return true;
}

const out = new Map();
const add = (raw, file, kind) => {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!human(t)) return;
  if (!out.has(t)) out.set(t, { kind, files: new Set() });
  out.get(t).files.add(relative(root, file).replace(/\\/g, "/"));
};

for (const file of files) {
  const s = readFileSync(file, "utf8");
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    // commentaires
    if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i + 2) + 2; if (i < 2) break; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = "";
      while (j < n && s[j] !== c) { if (s[j] === "\\") { v += s[j + 1]; j += 2; continue; } if (s[j] === "\n") break; v += s[j++]; }
      // import "…" / from "…" : ignoré
      const before = s.slice(Math.max(0, i - 6), i);
      if (!/from\s*$|import\s*$/.test(before)) add(v, file, "str");
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1, v = "", k = 0;
      while (j < n && s[j] !== "`") {
        if (s[j] === "\\") { v += s[j + 1]; j += 2; continue; }
        if (s[j] === "$" && s[j + 1] === "{") {
          let depth = 1; j += 2;
          while (j < n && depth) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
          v += `{${k++}}`;
          continue;
        }
        v += s[j++];
      }
      add(v, file, k ? "tpl" : "str");
      i = j + 1;
      continue;
    }
    // texte JSX : entre « > » et « < » / « { », hors code
    // (pas après « => » ; arrêt sur « " » et « ` » : une comparaison « a > b » suivie d'une
    // chaîne avalait la chaîne, et un gabarit avalé inversait tout le reste du fichier)
    if (c === ">" && file.endsWith(".tsx") && s[i - 1] !== "=") {
      let j = i + 1, v = "";
      while (j < n && s[j] !== "<" && s[j] !== "{" && s[j] !== ">" && s[j] !== "}" && s[j] !== ";" && s[j] !== "(" && s[j] !== ")" && s[j] !== "=" && s[j] !== '"' && s[j] !== "`") v += s[j++];
      if (j < n && (s[j] === "<" || s[j] === "{") && /[a-zà-ÿ]/i.test(v) && !/^\s*[\w.]+\s*$/.test(v.trim() === v ? "" : "") ) add(v, file, "jsx");
      i = j;
      continue;
    }
    i++;
  }
}
const list = [...out.entries()].map(([text, v]) => ({ text, kind: v.kind, files: [...v.files] }));
process.stdout.write(JSON.stringify(list, null, 1));
