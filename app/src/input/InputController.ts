import { pickNext, type NavDirection } from "./spatial";
import { scrollerOf } from "./gamepad";
import { sound } from "@/services/sound";

// Navigation d'iBox (clavier, manette), reprise telle quelle pour le panneau ; le menu
// rapide, la recherche globale et l'accueil d'iBox n'existent pas ici.

/**
 * Actions abstraites. Le clavier et la manette produisent exactement les mêmes,
 * quel que soit le nom des boutons de chaque modèle.
 *  - `pagePrev` / `pageNext` : une page plus haut / plus bas (Page préc. / suiv., gâchettes)
 *  - `first` / `last` : début / fin de la liste (Début / Fin, clic des sticks)
 *  - `menu` : menu rapide (F1, Start) ; `search` : recherche (/, Select) ; `home` : accueil
 */
export type InputAction =
  | NavDirection | "confirm" | "back" | "tabPrev" | "tabNext"
  | "pagePrev" | "pageNext" | "first" | "last" | "menu" | "search" | "home";

/**
 * Conventions DOM (lisibles dans le JSX) :
 *  - `data-focusable`           : élément atteignable par la navigation spatiale
 *  - `data-autofocus`           : focus initial d'un écran
 *  - `data-nav-root`            : racine de l'écran actif
 *  - `data-nav-capture="x"|"xy"`: l'élément consomme lui-même ces directions
 *                                 (carrousel 3D, visionneuse de boîtier…)
 *  - `data-nav-group`           : mémorise le dernier élément focalisé du groupe
 */
/** `"quiet"` : action traitée, l'écran joue lui-même son propre son. */
type BackHandler = () => boolean | "quiet";
type TabHandler = (delta: -1 | 1) => void | "quiet";

const KEYMAP: Record<string, InputAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "back",
  Backspace: "back",
  q: "tabPrev",
  Q: "tabPrev",
  e: "tabNext",
  E: "tabNext",
  PageUp: "pagePrev",
  PageDown: "pageNext",
  Home: "first",
  End: "last",
  F1: "menu",
  "/": "search",
  BrowserHome: "home",
};

/** Saut horizontal d'une page dans une rangée (étagères de l'accueil, consoles…). */
const ROW_PAGE = 6;

class InputControllerImpl {
  private backHandlers: BackHandler[] = [];
  private tabHandler: TabHandler | null = null;
  private groupMemory = new Map<string, HTMLElement>();

  /** Le dernier gestionnaire enregistré est prioritaire (modales, sous-vues). */
  onBack(handler: BackHandler): () => void {
    this.backHandlers.push(handler);
    return () => {
      this.backHandlers = this.backHandlers.filter((h) => h !== handler);
    };
  }

  onTab(handler: TabHandler): () => void {
    this.tabHandler = handler;
    return () => {
      if (this.tabHandler === handler) this.tabHandler = null;
    };
  }

  root(): HTMLElement | null {
    const roots = document.querySelectorAll<HTMLElement>("[data-nav-root]");
    return roots[roots.length - 1] ?? null;
  }

  focusables(): HTMLElement[] {
    const root = this.root();
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-focusable]")).filter(
      (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && el.getAttribute("aria-hidden") !== "true",
    );
  }

  focus(el: HTMLElement, opts: { sound?: boolean; instant?: boolean } = {}): void {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: opts.instant || document.documentElement.dataset.motion === "reduced" ? "instant" : "smooth" });
    const group = el.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    if (group) this.groupMemory.set(group, el);
    if (opts.sound) sound.play("move");
  }

  /** Focus initial d'un écran : élément mémorisé, sinon `data-autofocus`, sinon le premier. */
  focusInitial(preferId?: string): void {
    const root = this.root();
    if (!root) return;
    const remembered = preferId
      ? root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(preferId)}"]`)
      : null;
    const el = remembered ?? root.querySelector<HTMLElement>("[data-autofocus]") ?? this.focusables()[0];
    if (el) this.focus(el, { instant: true });
  }

  /** L'écran principal est au premier plan (aucune fenêtre modale par-dessus). */
  isMainRoot(): boolean {
    return !!this.root()?.hasAttribute("data-nav-main");
  }

  dispatch(action: InputAction): boolean {
    switch (action) {
      case "menu":
      case "search":
      case "home":
        return false;
      case "pagePrev":
      case "pageNext":
        return this.page(action === "pagePrev" ? -1 : 1);
      case "first":
      case "last":
        return this.edge(action === "first" ? -1 : 1);
      case "back":
        for (let i = this.backHandlers.length - 1; i >= 0; i--) {
          const handled = this.backHandlers[i]();
          if (handled) {
            if (handled !== "quiet") sound.play("back");
            return true;
          }
        }
        return false;
      case "tabPrev":
      case "tabNext":
        // une fenêtre ouverte par-dessus garde la main : l'écran derrière ne change pas d'onglet
        if (!this.tabHandler || !this.isMainRoot()) return false;
        if (this.tabHandler(action === "tabPrev" ? -1 : 1) !== "quiet") sound.play("tab");
        return true;
      case "confirm": {
        const el = document.activeElement as HTMLElement | null;
        if (el && el.matches("[data-focusable]")) {
          el.click();
          return true;
        }
        return false;
      }
      default:
        return this.move(action);
    }
  }

  move(dir: NavDirection): boolean {
    const items = this.focusables();
    if (items.length === 0) return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !items.includes(active)) {
      this.focusInitial();
      return true;
    }
    const others = items.filter((el) => el !== active);
    // D'abord dans le même groupe (une grille qui défile) : sinon un élément visible
    // ailleurs à l'écran « volerait » le déplacement vers une rangée hors champ.
    // Puis dans les groupes parents, du plus proche au plus large (une grille dans
    // une page de réglages : on reste dans la page avant de rejoindre le menu).
    let target: HTMLElement | null = null;
    for (let g = active.closest<HTMLElement>("[data-nav-group]"); g && !target; g = g.parentElement?.closest<HTMLElement>("[data-nav-group]") ?? null) {
      const inGroup = others.filter((el) => g!.contains(el));
      const i = inGroup.length ? pickNext(toRect(active), inGroup.map(toRect), dir) : -1;
      if (i >= 0) target = inGroup[i];
    }
    if (!target) {
      const idx = pickNext(toRect(active), others.map(toRect), dir);
      if (idx < 0) return false;
      target = others[idx];
    }
    // En entrant dans un groupe, on retrouve l'élément mémorisé
    const group = target.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    const activeGroup = active.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    if (group && group !== activeGroup) {
      const remembered = this.groupMemory.get(group);
      if (remembered && remembered.isConnected && items.includes(remembered)) target = remembered;
    }
    this.focus(target, { sound: true });
    return true;
  }

  /** Éléments du même groupe que l'élément actif (la liste qu'on parcourt). */
  private pool(active: HTMLElement, items: HTMLElement[]): HTMLElement[] {
    const group = active.closest<HTMLElement>("[data-nav-group]");
    return group ? items.filter((el) => group.contains(el)) : items;
  }

  /**
   * Défilement rapide : saute d'une page dans la liste (même colonne si c'est une
   * grille) ; dans une rangée horizontale, saute plusieurs éléments d'un coup.
   */
  page(sign: -1 | 1): boolean {
    const items = this.focusables();
    const active = document.activeElement as HTMLElement | null;
    if (!active || !items.includes(active)) {
      if (!items.length) return false;
      this.focusInitial();
      return true;
    }
    const pool = this.pool(active, items);
    const a = toRect(active);
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const center = (el: HTMLElement) => {
      const r = toRect(el);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    };
    const ahead = pool.filter((el) => el !== active && (sign > 0 ? center(el).y > acy + a.h * 0.4 : center(el).y < acy - a.h * 0.4));
    let target: HTMLElement | undefined;
    if (ahead.length) {
      const scroller = scrollerOf(active);
      const pageH = Math.max(160, (scroller?.clientHeight ?? window.innerHeight) * 0.8);
      const ty = acy + sign * pageH;
      let best = Infinity;
      for (const el of ahead) {
        const c = center(el);
        // ne dépasse pas la page visée si une rangée plus proche existe ; reste dans la colonne
        const overshoot = sign > 0 ? Math.max(0, c.y - ty) : Math.max(0, ty - c.y);
        const score = Math.abs(c.y - ty) + overshoot + Math.abs(c.x - acx) * 0.6;
        if (score < best) {
          best = score;
          target = el;
        }
      }
    } else {
      const sameRow = pool.every((el) => {
        const r = toRect(el);
        return r.y < a.y + a.h && r.y + r.h > a.y;
      });
      const i = pool.indexOf(active);
      const j = sameRow ? Math.max(0, Math.min(pool.length - 1, i + sign * ROW_PAGE)) : sign > 0 ? pool.length - 1 : 0;
      target = pool[j];
    }
    // déjà au bout de la liste
    if (!target || target === active) return true;
    this.focus(target, { sound: true });
    return true;
  }

  /** Début / fin de la liste. */
  edge(sign: -1 | 1): boolean {
    const items = this.focusables();
    const active = document.activeElement as HTMLElement | null;
    if (!items.length) return false;
    const pool = active && items.includes(active) ? this.pool(active, items) : items;
    const target = sign < 0 ? pool[0] : pool[pool.length - 1];
    if (!target || target === active) return true;
    this.focus(target, { sound: true });
    return true;
  }

  /** Branche le clavier. Renvoie la fonction de nettoyage. */
  attachKeyboard(): () => void {
    const html = document.documentElement;
    html.dataset.input = "pointer";

    const onKey = (e: KeyboardEvent) => {
      // déjà traitée par un élément (étagère 3D, clavier virtuel…)
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      if (e.key === "Tab" || e.key.startsWith("Arrow")) html.dataset.input = "keyboard";

      const action = KEYMAP[e.key];
      if (!action) return;

      // touches venues de la manette (non « fiables ») : pas de saisie possible, on navigue normalement
      if (typing && e.isTrusted) {
        // Dans un champ texte : seules ↑ ↓ et Échap quittent le champ
        if (action === "back" && e.key === "Escape") {
          target!.blur();
          this.focusInitial();
          e.preventDefault();
          return;
        }
        if (action !== "up" && action !== "down") return;
      }

      // Les éléments « capturants » gèrent eux-mêmes certaines directions
      const capture = target?.closest<HTMLElement>("[data-nav-capture]")?.dataset.navCapture ?? "";
      if ((action === "left" || action === "right") && capture.includes("x")) return;
      if ((action === "up" || action === "down") && capture.includes("y")) return;

      if (this.dispatch(action)) {
        e.preventDefault();
        html.dataset.input = "keyboard";
      }
    };

    const onPointer = () => {
      if (html.dataset.input !== "pointer") html.dataset.input = "pointer";
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }
}

function toRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export const input = new InputControllerImpl();
