import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "@/services/native";

/**
 * Raccourci clavier global du lecteur (voir `src-tauri/src/shortcut.rs`). Écrit comme dans
 * les réglages : « Alt+C », « Ctrl+Maj+F9 ».
 */
export const DEFAULT_KEYS = { music: "Alt+C" } as const;

interface ShortcutsState {
  music: string | null;
  musicTaken: boolean;
}

/** État réel des raccourcis (une autre application peut avoir pris une combinaison). */
export const useShortcuts = create<ShortcutsState>(() => ({ music: null, musicTaken: false }));

/** Applique la combinaison (null : désactivé) ; rend l'erreur éventuelle. */
export async function applyShortcuts(music: string | null): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    useShortcuts.setState(await invoke<ShortcutsState>("shortcuts_set", { music }));
    return null;
  } catch (e) {
    return typeof e === "string" ? e : "Raccourci invalide.";
  }
}

/** Libère tous les raccourcis le temps d'en saisir un nouveau (sinon Windows les intercepte). */
export function suspendShortcuts(suspended: boolean): void {
  if (isTauri()) void invoke("shortcuts_suspend", { suspended }).catch(() => undefined);
}

const NAMED: Record<string, string> = {
  Pause: "Pause",
  ScrollLock: "ScrollLock",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Space: "Space",
};

/**
 * Combinaison d'un appui de touche (« Alt+C »), ou null tant qu'il manque une touche, ou si
 * aucun de Ctrl, Alt, Win n'est tenu (Maj seule changerait une lettre ordinaire).
 */
export function comboFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (NAMED[c]) key = NAMED[c];
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Maj", e.metaKey && "Win", key].filter(Boolean).join("+");
}

/** Morceaux à afficher en touches (« Alt », « C »). */
export function comboParts(combo: string): string[] {
  return combo.split("+").filter(Boolean);
}
