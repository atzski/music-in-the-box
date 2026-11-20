import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, Row, Toggle } from "@/components/settings-ui";
import { Button } from "@/components/ui/Button";
import { MusicSettings } from "@/components/music/MusicSettings";
import { Logo } from "@/components/music/Logo";
import { isTauri } from "@/services/native";
import { useSettings } from "@/services/settings";
import { DEFAULT_KEYS, applyShortcuts } from "@/services/shortcuts";
import { input } from "@/input/InputController";

/**
 * Fenêtre de réglages de l'app autonome, ouverte depuis la zone de notification :
 * raccourci, position du lecteur, compte YouTube Music, démarrage avec Windows.
 * La fermer ne quitte pas l'app : le lecteur reste disponible (Alt+C, Vue + Y).
 */
export function SettingsWindow() {
  const keys = useSettings((s) => s.musicKeys ?? DEFAULT_KEYS.music);
  const sounds = useSettings((s) => s.soundEnabled);
  const set = useSettings((s) => s.set);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => input.attachKeyboard(), []);
  useEffect(() => void applyShortcuts(keys), [keys]);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("autostart_get").then(setAutostart, () => setAutostart(null));
    void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setVersion, () => undefined);
  }, []);

  const toggleAutostart = (on: boolean) => {
    setAutostart(on);
    void invoke<boolean>("autostart_set", { enabled: on }).then(setAutostart, () => setAutostart(!on));
  };

  return (
    <main data-nav-root data-nav-main className="min-h-screen bg-cream px-6 pt-6 pb-10 text-ink">
      <header className="mb-6 flex items-center gap-4">
        <Logo size={64} still />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.7rem] leading-tight text-ink">Music in the Box</h1>
          <p className="text-[0.9rem] font-semibold text-ink-soft">
            YouTube Music ou votre lecteur, par-dessus vos jeux. {version && <span>Version {version}</span>}
          </p>
        </div>
        <Button variant="primary" icon="play" onClick={() => void invoke("music_open").catch(() => undefined)}>
          Ouvrir le lecteur
        </Button>
      </header>
      <MusicSettings />
      <Group title="Application" icon="gear">
        <Row label="Lancer avec Windows" note="L’app démarre discrètement dans la zone de notification, prête pour Alt+C.">
          <Toggle checked={autostart === true} onChange={toggleAutostart} label="Lancer avec Windows" />
        </Row>
        <Row label="Sons de l’interface" note="Petits sons quand on navigue dans le lecteur.">
          <Toggle checked={sounds} onChange={(v) => set("soundEnabled", v)} label="Sons de l’interface" />
        </Row>
        <Row label="Quitter Music in the Box" note="Fermer cette fenêtre laisse l’app dans la zone de notification. Quitter arrête aussi YouTube Music.">
          <Button icon="power" tone="red" onClick={() => void invoke("app_quit").catch(() => undefined)}>
            Quitter
          </Button>
        </Row>
      </Group>
    </main>
  );
}
