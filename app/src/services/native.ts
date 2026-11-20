/** Vrai dans l'app compilée (Tauri), faux dans un simple navigateur (aperçu de développement). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
