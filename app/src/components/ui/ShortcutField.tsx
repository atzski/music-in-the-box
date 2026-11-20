import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "./Button";
import { comboFromEvent, comboParts, suspendShortcuts } from "@/services/shortcuts";
import { sound } from "@/services/sound";

/**
 * Choix d'un raccourci global (Paramètres) : les touches actuelles, « Modifier » puis la
 * combinaison voulue, « Par défaut ». Pendant la saisie, les raccourcis d'iBox sont libérés
 * (sinon Windows les intercepterait avant cette page). Échap annule.
 */
export function ShortcutField({ value, defaultValue, taken, onChange, label }: { value: string; defaultValue: string; taken?: boolean; onChange: (combo: string) => void; label: string }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    suspendShortcuts(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        sound.play("back");
        setRecording(false);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      sound.play("select");
      setRecording(false);
      onChange(combo);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      suspendShortcuts(false);
    };
  }, [recording, onChange]);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {recording ? (
          <motion.span
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-3 py-1.5 text-[0.82rem] font-bold text-ink"
          >
            Appuyez sur la combinaison… (Échap : annuler)
          </motion.span>
        ) : (
          <span className="flex items-center gap-1" aria-label={`${label} : ${value}`}>
            {comboParts(value).map((k, i) => (
              <kbd key={`${k}-${i}`} className="min-w-8 rounded-[0.6rem] bg-white px-2.5 py-1 text-center text-[0.85rem] font-extrabold text-ink shadow-[var(--shadow-xs),inset_0_-2px_0_color-mix(in_srgb,var(--ibox-ink)_14%,transparent)]">
                {k}
              </kbd>
            ))}
          </span>
        )}
        <Button size="md" icon="key" onClick={() => setRecording((r) => !r)} cue={null}>
          {recording ? "Annuler" : "Modifier"}
        </Button>
        {!recording && value !== defaultValue && (
          <Button variant="ghost" icon="reset" onClick={() => onChange(defaultValue)}>
            Par défaut
          </Button>
        )}
      </div>
      {taken && !recording && <span className="text-[0.78rem] font-bold text-[var(--tone-red-ink)]">Déjà utilisé par une autre application : choisissez une autre combinaison.</span>}
    </div>
  );
}
