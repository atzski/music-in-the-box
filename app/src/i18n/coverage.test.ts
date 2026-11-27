import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "./index";

/**
 * Filet contre les textes français oubliés (repris d'iBox) : tout texte de l'interface qui porte
 * une marque sûre de français (accent, guillemets, apostrophe courbe) doit avoir sa traduction
 * dans `en.ts`. L'anglais est la langue par défaut de l'app.
 */
const SURE = /[àâçéèêëîïôûùüœ«»]|[a-z]’[a-z]/i;
/** Gardés tels quels : le nom d'une langue s'écrit dans cette langue. */
const KEEP = new Set(["Français"]);

interface Found { text: string; files: string[] }

function untranslated(): Found[] {
  const extractor = join(import.meta.dirname, "..", "..", "scripts", "i18n-extract.mjs");
  const json = execFileSync(process.execPath, [extractor], { encoding: "utf8", maxBuffer: 64 << 20 });
  return (JSON.parse(json) as Found[]).filter((f) => {
    if (!SURE.test(f.text) || KEEP.has(f.text)) return false;
    if (f.files.every((p) => p.startsWith("src/i18n/"))) return false;
    // morceaux de code pris pour du texte, touches du clavier virtuel
    if (/[<>=;\\]|\{(?!\d+\})|(?<!\{\d+)\}/.test(f.text) || /[@_]/.test(f.text)) return false;
    const fill = (plural: string) => f.text.replace(/(?<=[A-Za-zÀ-ÿ])\{\d+\}/g, plural).replace(/\{\d+\}/g, "3");
    return translate(fill("")) === null && translate(fill("s")) === null;
  });
}

describe("couverture de la traduction", () => {
  it("aucun texte français sans traduction", () => {
    expect(untranslated().map((f) => `${f.text}  ← ${f.files[0]}`)).toEqual([]);
  });

  it("les réglages et le panneau sont traduits", () => {
    expect(translate("Comme Windows")).toBe("Same as Windows");
    expect(translate("Ouvrir le lecteur")).toBe("Open the player");
  });
});
