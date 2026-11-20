import { confirmButton, type ConfirmSide, type PadFamily } from "@/input/gamepad";

/**
 * Boutons de manette dessinés comme sur la manette elle-même : lettres colorées
 * Xbox, symboles PlayStation, lettres Nintendo, croix directionnelle dont les
 * branches utiles s'allument. Sert à la barre d'aide, au menu rapide et aux
 * Paramètres › Manette.
 */
export type PadKey =
  | "confirm" | "back" | "south" | "east" | "west" | "north"
  | "lb" | "rb" | "lt" | "rt"
  | "dpad" | "dpadV" | "dpadH"
  | "ls" | "rs" | "l3" | "r3"
  | "start" | "select" | "guide";

type Face = "south" | "east" | "west" | "north";

const FACES: Record<PadFamily, Record<Face, { label: string; color: string }>> = {
  xbox: {
    south: { label: "A", color: "#6BCB2E" },
    east: { label: "B", color: "#F0504A" },
    west: { label: "X", color: "#3BA2FF" },
    north: { label: "Y", color: "#F7C631" },
  },
  playstation: {
    south: { label: "✕", color: "#8FB0FF" },
    east: { label: "○", color: "#FF7A80" },
    west: { label: "□", color: "#F29AD8" },
    north: { label: "△", color: "#4FD8BE" },
  },
  nintendo: {
    south: { label: "B", color: "#FFFFFF" },
    east: { label: "A", color: "#FFFFFF" },
    west: { label: "Y", color: "#FFFFFF" },
    north: { label: "X", color: "#FFFFFF" },
  },
  generic: {
    south: { label: "", color: "#FFFFFF" },
    east: { label: "", color: "#FFFFFF" },
    west: { label: "", color: "#FFFFFF" },
    north: { label: "", color: "#FFFFFF" },
  },
};

const SHOULDERS: Record<PadFamily, { lb: string; rb: string; lt: string; rt: string; ls: string; rs: string; l3: string; r3: string }> = {
  xbox: { lb: "LB", rb: "RB", lt: "LT", rt: "RT", ls: "L", rs: "R", l3: "LS", r3: "RS" },
  playstation: { lb: "L1", rb: "R1", lt: "L2", rt: "R2", ls: "L", rs: "R", l3: "L3", r3: "R3" },
  nintendo: { lb: "L", rb: "R", lt: "ZL", rt: "ZR", ls: "L", rs: "R", l3: "L", r3: "R" },
  generic: { lb: "L1", rb: "R1", lt: "L2", rt: "R2", ls: "L", rs: "R", l3: "L3", r3: "R3" },
};

/** Libellé texte d'un bouton (lecteurs d'écran, Paramètres). */
export function padKeyName(key: PadKey, family: PadFamily, side: ConfirmSide): string {
  const face = resolveFace(key, family, side);
  if (face) return FACES[family][face].label || { south: "Bas", east: "Droite", west: "Gauche", north: "Haut" }[face];
  if (key in SHOULDERS[family]) return SHOULDERS[family][key as keyof (typeof SHOULDERS)["xbox"]];
  return {
    dpad: "Croix", dpadV: "Croix ↑↓", dpadH: "Croix ←→",
    start: family === "playstation" ? "Options" : family === "nintendo" ? "+" : "Menu",
    select: family === "playstation" ? "Create" : family === "nintendo" ? "−" : "Vue",
    guide: "Bouton central",
  }[key as "dpad"] ?? key;
}

function resolveFace(key: PadKey, family: PadFamily, side: ConfirmSide): Face | null {
  if (key === "confirm") return confirmButton(family, side);
  if (key === "back") return confirmButton(family, side) === "east" ? "south" : "east";
  return key === "south" || key === "east" || key === "west" || key === "north" ? key : null;
}

const BODY = "#23272F";

export function PadGlyph({ k, family, side, size = 28 }: { k: PadKey; family: PadFamily; side: ConfirmSide; size?: number }) {
  const name = padKeyName(k, family, side);
  const face = resolveFace(k, family, side);
  const box = { width: size, height: size };
  const common = "inline-grid shrink-0 place-items-center font-body font-extrabold leading-none shadow-[0_2px_0_rgba(0,0,0,0.25)] outline outline-1 -outline-offset-1 outline-white/15";

  if (face) {
    if (family === "generic") {
      // position du bouton parmi les quatre : celui à presser est plein
      const pos: Record<Face, [number, number]> = { north: [12, 5], east: [19, 12], south: [12, 19], west: [5, 12] };
      return (
        <span role="img" aria-label={name} className={`${common} rounded-full`} style={{ ...box, background: BODY }}>
          <svg viewBox="0 0 24 24" width={size * 0.78} height={size * 0.78} aria-hidden>
            {(Object.keys(pos) as Face[]).map((f) => (
              <circle key={f} cx={pos[f][0]} cy={pos[f][1]} r={3.6} fill={f === face ? "#fff" : "none"} stroke="#fff" strokeOpacity={f === face ? 1 : 0.45} strokeWidth={1.4} />
            ))}
          </svg>
        </span>
      );
    }
    const f = FACES[family][face];
    const symbol = family === "playstation";
    return (
      <span role="img" aria-label={name} className={`${common} rounded-full`} style={{ ...box, background: BODY, color: f.color, fontSize: size * (symbol ? 0.62 : 0.5) }}>
        <span aria-hidden className={symbol ? "-mt-px" : ""}>{f.label}</span>
      </span>
    );
  }

  if (k === "dpad" || k === "dpadV" || k === "dpadH") {
    const v = k !== "dpadH";
    const h = k !== "dpadV";
    return (
      <span role="img" aria-label={name} className={`${common} rounded-lg`} style={{ ...box, background: BODY }}>
        <svg viewBox="0 0 24 24" width={size * 0.8} height={size * 0.8} aria-hidden>
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#4A515E" />
          {v && <path d="M9.6 3.6h4.8v5.4H9.6zM9.6 15h4.8v5.4H9.6z" fill="#fff" />}
          {h && <path d="M3.6 9.6H9v4.8H3.6zM15 9.6h5.4v4.8H15z" fill="#fff" />}
        </svg>
      </span>
    );
  }

  if (k === "lb" || k === "rb" || k === "lt" || k === "rt") {
    const trigger = k === "lt" || k === "rt";
    const left = k === "lb" || k === "lt";
    const radius = trigger ? (left ? "10px 6px 5px 5px" : "6px 10px 5px 5px") : left ? "9px 5px 5px 9px" : "5px 9px 9px 5px";
    return (
      <span role="img" aria-label={name} className={common}
        style={{ height: size, minWidth: size * 1.35, padding: "0 6px", background: BODY, color: "#fff", borderRadius: radius, fontSize: size * 0.4 }}>
        <span aria-hidden>{name}</span>
      </span>
    );
  }

  if (k === "ls" || k === "rs" || k === "l3" || k === "r3") {
    const click = k === "l3" || k === "r3";
    return (
      <span role="img" aria-label={click ? `${name} (appuyer)` : name} className={`${common} rounded-full`}
        style={{ ...box, background: BODY, color: "#fff", fontSize: size * 0.36, boxShadow: `inset 0 0 0 ${click ? 3 : 2}px #5A6270, 0 2px 0 rgba(0,0,0,0.25)` }}>
        <span aria-hidden>{SHOULDERS[family][k]}</span>
      </span>
    );
  }

  // Start, Select, bouton central
  const icon =
    k === "start" ? (
      family === "nintendo" ? <path d="M12 6v12M6 12h12" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        : <path d="M6 8h12M6 12h12M6 16h12" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
    ) : k === "select" ? (
      family === "nintendo" ? <path d="M6 12h12" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        : <g fill="none" stroke="#fff" strokeWidth={1.8}><rect x="5" y="5" width="9" height="9" rx="1.5" /><rect x="10" y="10" width="9" height="9" rx="1.5" fill={BODY} /></g>
    ) : (
      <path d="M5 11.5 12 5.5l7 6M7.5 10v8h9v-8" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    );
  return (
    <span role="img" aria-label={name} className={`${common} rounded-full`} style={{ ...box, background: BODY }}>
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66} aria-hidden>{icon}</svg>
    </span>
  );
}
