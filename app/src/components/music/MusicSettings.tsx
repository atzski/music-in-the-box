import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { Group, Row, Toggle } from "@/components/settings-ui";
import { Button } from "@/components/ui/Button";
import { ShortcutField } from "@/components/ui/ShortcutField";
import { useSettings } from "@/services/settings";
import { DEFAULT_KEYS, useShortcuts } from "@/services/shortcuts";
import { DEFAULT_POSITION, music } from "@/services/musicBox";
import { Logo } from "./Logo";

/**
 * Réglages de Music in the Box (fenêtre de réglages de l’app autonome) :
 * raccourci, position du mini-lecteur, manette, compte YouTube Music.
 */
export function MusicSettings() {
  const keys = useSettings((s) => s.musicKeys ?? DEFAULT_KEYS.music);
  const position = useSettings((s) => s.musicPosition ?? DEFAULT_POSITION);
  const set = useSettings((s) => s.set);
  const taken = useShortcuts((s) => s.musicTaken);
  const stayOpen = useSettings((s) => s.musicStayOpen === true);
  return (
    <>
      <Group title="Ouvrir le lecteur" icon="key">
        <Row label="Raccourci clavier" note="Ouvre ou ferme le mini-lecteur, en jeu ou non.">
          <ShortcutField label="Raccourci clavier" value={keys} defaultValue={DEFAULT_KEYS.music} taken={taken} onChange={(v) => set("musicKeys", v)} />
        </Row>
        <Row label="Manette" note="Maintenez Vue et Y une demi-seconde, sur n’importe quelle manette.">
          <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-3 py-1.5 text-[0.85rem] font-bold text-ink">Vue + Y</span>
        </Row>
      </Group>
      <Group title="Pendant le jeu" icon="gamepad">
        <Row
          label="Rester affiché pendant le jeu"
          note={stayOpen ? "Le lecteur reste à l’écran pendant que vous jouez : le jeu garde le clavier et la manette, et les clics à côté du lecteur vont au jeu. Le raccourci le referme." : "Le lecteur se referme tout seul dès que vous cliquez ailleurs ou revenez au jeu."}
        >
          <Toggle checked={stayOpen} onChange={(v) => set("musicStayOpen", v)} label="Rester affiché pendant le jeu" />
        </Row>
      </Group>
      <Group title="Position à l’écran" icon="grid" note="Faites glisser le lecteur où vous voulez. Il reste à cet endroit quand il s’agrandit pour les playlists ou la recherche, sans jamais sortir de l’écran.">
        <PositionPicker value={position} onChange={(p) => set("musicPosition", p)} />
      </Group>
      <Group title="YouTube Music" icon="user">
        <Row label="Compte" note="Connectez-vous une fois dans la fenêtre YouTube Music : la session reste sur ce PC, dans un dossier à part.">
          <Button icon="open" onClick={() => void music.connect()}>
            Ouvrir YouTube Music
          </Button>
        </Row>
      </Group>
    </>
  );
}

/** Écran miniature (16:9) où l'on fait glisser le mini-lecteur. Aimanté aux bords et au centre. */
function PositionPicker({ value, onChange }: { value: { x: number; y: number }; onChange: (p: { x: number; y: number }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const pos = drag ?? value;
  // proportions d'un écran 1920×1080 : carte de 392×340, marges de 24
  const CARD_W = 392 / 1920, CARD_H = 340 / 1080, M_X = 24 / 1920, M_Y = 24 / 1080;
  const snap = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    for (const s of [0, 0.5, 1]) if (Math.abs(c - s) < 0.05) return s;
    return Math.round(c * 1000) / 1000;
  };
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current!.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width - CARD_W / 2;
    const fy = (e.clientY - r.top) / r.height - CARD_H / 2;
    return { x: snap((fx - M_X) / (1 - 2 * M_X - CARD_W)), y: snap((fy - M_Y) / (1 - 2 * M_Y - CARD_H)) };
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    onChange({ x: snap(value.x + d[0]), y: snap(value.y + d[1]) });
  };
  const left = `${(M_X + pos.x * (1 - 2 * M_X - CARD_W)) * 100}%`;
  const top = `${(M_Y + pos.y * (1 - 2 * M_Y - CARD_H)) * 100}%`;
  return (
    <div className="flex flex-col items-center gap-3 py-3">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        data-focusable
        data-nav-capture="xy"
        aria-label="Position du mini-lecteur"
        aria-valuetext={`${Math.round(pos.x * 100)} % depuis la gauche, ${Math.round(pos.y * 100)} % depuis le haut`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e));
        }}
        onPointerMove={(e) => drag && setDrag(at(e))}
        onPointerUp={() => {
          if (drag) onChange(drag);
          setDrag(null);
        }}
        className="ibox-focusable relative aspect-video w-full max-w-[34rem] cursor-grab touch-none overflow-hidden rounded-[var(--radius-md)] bg-[linear-gradient(135deg,#2b3550,#141a2b)] shadow-[var(--shadow-sm)] [--ring-radius:var(--radius-md)] active:cursor-grabbing"
      >
        {/* repères : bords et centre, où le lecteur s'aimante */}
        <div aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <motion.div
          aria-hidden="true"
          className="absolute flex items-start gap-1.5 rounded-[14%_14%_14%_14%/16%_16%_16%_16%] bg-[rgba(20,24,40,0.86)] p-[1.2%] ring-1 ring-white/20 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.8)]"
          style={{ width: `${CARD_W * 100}%`, height: `${CARD_H * 100}%` }}
          animate={{ left, top, scale: drag ? 1.06 : 1 }}
          transition={drag ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 30 }}
        >
          <Logo size={16} still />
          <div className="mt-[4%] flex flex-1 flex-col gap-1">
            <div className="h-1 w-3/4 rounded-full bg-white/50" />
            <div className="h-1 w-1/2 rounded-full bg-white/25" />
          </div>
        </motion.div>
      </div>
      <div className="flex items-center gap-2">
        {[
          { label: "Gauche", p: { x: 0, y: 0.5 } },
          { label: "Centre", p: { x: 0.5, y: 0.5 } },
          { label: "Droite", p: { x: 1, y: 0.5 } },
        ].map((o) => (
          <Button key={o.label} variant={pos.x === o.p.x && pos.y === o.p.y ? "primary" : "soft"} onClick={() => onChange(o.p)}>
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
