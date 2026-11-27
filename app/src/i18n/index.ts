import { EN } from "./en";

/**
 * Traduction de l'interface. Le français est la langue source : chaque texte
 * affiché (nœuds de texte et attributs lisibles : placeholder, aria-label,
 * title, alt) est remplacé par sa traduction au moment où il apparaît, grâce à
 * un MutationObserver. Les composants n'ont pas à changer ; les gabarits
 * (« {0} jeux ») couvrent les textes variables.
 *
 * Changer de langue recharge la fenêtre : on repart toujours du français.
 */
export type Lang = "fr" | "en";

const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);

const exact = new Map<string, string>();
interface Pattern {
  re: RegExp;
  out: string;
  /** Plus long morceau fixe : test rapide avant l'expression régulière. */
  hint: string;
  /** Longueur totale du texte fixe (départage). */
  fixed: number;
}
const patterns: Pattern[] = [];
for (const [fr, en] of Object.entries(EN)) {
  const key = fr.trim();
  if (!/\{\d+\}/.test(key)) {
    exact.set(key, en);
    continue;
  }
  const parts = key.split(/\{\d+\}/);
  // Un marqueur collé à la fin d'un mot (« jour{1} ») n'est qu'une marque de pluriel : il ne
  // capture que quelques lettres, sinon « Mises à jour automatiques » devenait « Mises à days ».
  const escape = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = parts
    .map((p, i) => (i === 0 ? "" : /[A-Za-zÀ-ÿ]$/.test(parts[i - 1]) ? "([a-zàâçéèêëîïôûùü]{0,3})" : "(.*?)") + escape(p))
    .join("");
  const re = new RegExp(`^${source}$`, "s");
  const hint = parts.reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "");
  patterns.push({ re, out: en, hint, fixed: parts.join("").length });
}
// les gabarits les plus précis d'abord (à égalité, celui qui a le plus de texte fixe :
// « Associer {0} jeu{1}… » avant « Associer {0} »)
patterns.sort((a, b) => b.hint.length - a.hint.length || b.fixed - a.fixed);

/** Longueur maximale d'une partie variable de gabarit (un titre de jeu, un nom, un nombre). */
const MAX_SLOT = 120;

const misses = new Set<string>();
// outil de développement seulement : mieux vaut un faux positif qu'un texte français oublié
const FRENCH_HINT =
  /[àâçéèêëîïôûùüœ’«»]|\b(le|la|les|des|du|une|un|vos|votre|pour|avec|dans|sur|est|pas|aucun|aucune|jeux?|et|ou|ce|cette|ces|au|aux|vous|nous|plus|tous|toutes?|sans|par|qui|que|mes|mon|ma|son|sa|ses|leur|encore|ici|choisir|ouvrir|fermer|ajouter|joueurs?|manettes?|partie|compte|réglages)\b/i;

/** Traduit un texte (null si inconnu). Les parties variables sont traduites elles aussi. */
export function translate(text: string, depth = 0): string | null {
  const core = text.trim();
  if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return null;
  let out = exact.get(core);
  if (out === undefined) {
    for (const p of patterns) {
      if (p.hint && !core.includes(p.hint)) continue;
      const m = p.re.exec(core);
      // Une partie variable très longue est un texte libre (description de jeu, message) et non
      // un libellé à trous : « {0} de {1} » y remplaçait chaque « de » par « of ».
      if (!m || m.slice(1).some((v) => (v?.length ?? 0) > MAX_SLOT)) continue;
      out = p.out.replace(/\{(\d+)(?:\?([^}]*))?\}/g, (_, i: string, word?: string) => {
        const v = m[Number(i) + 1] ?? "";
        if (word !== undefined) return v ? word : "";
        return depth < 2 ? (translate(v, depth + 1) ?? v) : v;
      });
      break;
    }
  }
  if (out === undefined) {
    if (import.meta.env.DEV && depth === 0 && core.length < 1000 && FRENCH_HINT.test(core)) misses.add(core);
    return null;
  }
  return out === core ? null : text.replace(core, out);
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || SKIP.has(parent.tagName) || parent.closest("[data-no-i18n],[contenteditable]")) return;
    const t = translate(node.nodeValue ?? "");
    if (t !== null) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP.has(el.tagName) && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
  if (el.closest("[data-no-i18n]")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const t = translate(v);
      if (t !== null) el.setAttribute(a, t);
    }
  }
  if (SKIP.has(el.tagName)) return;
  for (const child of Array.from(el.childNodes)) translateNode(child);
}

let observer: MutationObserver | null = null;

/** Active la traduction pour toute la page (à appeler une fois au démarrage). */
export function startTranslation(lang: Lang) {
  document.documentElement.lang = lang;
  if (lang === "fr" || observer) return;
  translateNode(document.body);
  observer = new MutationObserver((records, activeObserver) => {
    // Les écritures de traduction ne doivent pas déclencher une seconde traduction.
    activeObserver.disconnect();
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes") translateNode(r.target);
      else r.addedNodes.forEach(translateNode);
    }
    activeObserver.observe(document.body, options);
  });
  const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] };
  observer.observe(document.body, options);
  const title = translate(document.title);
  if (title) document.title = title;
  // outil de vérification : textes français affichés sans traduction
  (window as unknown as Record<string, unknown>).__i18nMisses = () => [...misses];
}

/** Traduction ponctuelle (textes hors page : notifications système, menus…). */
export function tr(text: string, lang: Lang): string {
  return lang === "en" ? (translate(text) ?? text) : text;
}

/** Langue proposée à la première ouverture : celle de Windows. */
export function defaultLang(): Lang {
  return typeof navigator !== "undefined" && !/^fr\b/i.test(navigator.language) ? "en" : "fr";
}
