import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Réglages de Music in the Box (app autonome), gardés dans le stockage local du WebView.
 * Le panneau et la fenêtre de réglages partagent ce stockage : chacune relit les
 * changements de l'autre (événement `storage`, voir `main.tsx`). Le raccourci clavier et
 * l'écran du lecteur sont aussi gardés côté natif (`settings.json`), pour le démarrage.
 */
export interface SettingsState {
  /** Raccourci du lecteur (« Alt+C ») ; absent : celui par défaut. */
  musicKeys?: string;
  /** Position de la carte (0 à 1 dans l'espace libre de l'écran). */
  musicPosition?: { x: number; y: number };
  /** Le lecteur reste affiché pendant le jeu. */
  musicStayOpen?: boolean;
  /** Mode réduit (une barre fine : pochette, titre, précédent / pause / suivant). */
  musicCompact?: boolean;
  /** Écran du lecteur (nom Windows) ; absent : l'écran principal. */
  musicMonitor?: string;
  soundEnabled: boolean;
  soundVolume: number;
  /** Bouton de validation de la manette. */
  gamepadConfirm: "auto" | "south" | "east";
  motion: "system" | "full" | "reduced";
  set: <K extends keyof Omit<SettingsState, "set">>(key: K, value: SettingsState[K]) => void;
}

export const SETTINGS_KEY = "mitb.settings";

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      soundVolume: 0.6,
      gamepadConfirm: "auto",
      motion: "system",
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: SETTINGS_KEY, version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
