import { defaultLang, type Lang } from "@/i18n";
import { isTauri } from "./native";

/**
 * Langue de l'app. Le français est la langue des textes du code ; l'anglais est la langue
 * par défaut : sans choix dans les réglages, l'app suit Windows (français seulement si Windows
 * est en français). Le choix est gardé côté natif (`settings.json`) pour le menu de la zone de
 * notification ; le changer recharge les fenêtres de l'interface.
 */
export interface AppLang {
  /** Choix des réglages ; null : celle de Windows. */
  choice: Lang | null;
  /** Langue en usage. */
  lang: Lang;
}

export async function appLang(): Promise<AppLang> {
  if (!isTauri()) return { choice: null, lang: defaultLang() };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AppLang>("app_lang_get");
  } catch {
    return { choice: null, lang: defaultLang() };
  }
}

export async function setAppLang(choice: Lang | null): Promise<void> {
  if (!isTauri()) {
    location.reload();
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("app_lang_set", { lang: choice });
}
