import { createRoot } from "react-dom/client";
import "@fontsource-variable/nunito";
import "@fontsource-variable/fredoka";
import "./styles/global.css";
import { startTranslation } from "./i18n";
import { appLang } from "./services/lang";
import { SETTINGS_KEY, useSettings } from "./services/settings";

/**
 * Deux fenêtres partagent cette interface :
 * - `music` : le panneau par-dessus le jeu (Alt+C, Vue + Y) ;
 * - `main` : la fenêtre de réglages (zone de notification).
 * Elles relisent les réglages changés dans l'autre.
 */
const label = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
const isMusic = label === "music";

window.addEventListener("storage", (e) => {
  if (e.key === SETTINGS_KEY) void useSettings.persist.rehydrate();
});

document.documentElement.dataset.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";

const root = createRoot(document.getElementById("root")!);
// langue lue avant le premier affichage : le texte français ne clignote jamais en anglais
void appLang().then(({ lang }) => {
  startTranslation(lang);
  if (isMusic) {
    document.documentElement.classList.add("ibox-transparent-window");
    void import("./components/music/MusicWindow").then(({ MusicWindow }) => root.render(<MusicWindow />));
  } else {
    void import("./components/SettingsWindow").then(({ SettingsWindow }) => root.render(<SettingsWindow />));
  }
});
