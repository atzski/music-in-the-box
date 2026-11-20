import { create } from "zustand";

/**
 * Manettes : version réduite de celle d'iBox. Le panneau reçoit la manette lue en natif
 * (XInput, `music://pad`), d'où une famille Xbox par défaut pour les pictogrammes.
 */
export type PadFamily = "xbox" | "playstation" | "nintendo" | "generic";
export type ConfirmSide = "auto" | "south" | "east";

/** Bouton de validation effectif. */
export function confirmButton(family: PadFamily, side: ConfirmSide): "south" | "east" {
  if (side !== "auto") return side;
  return family === "nintendo" ? "east" : "south";
}

export const useGamepad = create<{ family: PadFamily }>(() => ({ family: "xbox" }));

/** Change la valeur d'un champ comme le ferait l'utilisateur (React voit l'événement). */
export function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** Conteneur qui défile autour de l'élément actif (sinon le premier grand conteneur de l'écran). */
export function scrollerOf(el: Element | null): HTMLElement | null {
  const scrolls = (n: HTMLElement) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4;
  for (let node = el instanceof HTMLElement ? el : null; node && node !== document.body; node = node.parentElement) {
    if (scrolls(node)) return node;
  }
  const roots = document.querySelectorAll<HTMLElement>("[data-nav-root]");
  const root = roots[roots.length - 1];
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>("div, section, main")).find((n) => n.clientHeight > 200 && scrolls(n)) ?? null;
}
