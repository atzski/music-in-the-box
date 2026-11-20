import type { SVGProps } from "react";

/** Jeu d'icônes maison : trait 2 px, extrémités arrondies, grille 24 px. */
const PATHS = {
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
      <circle cx="12" cy="12" r="7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  star: <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  trophy: (
    <>
      <path d="M7.5 4.5h9v4.2a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6.2H4.8a2.6 2.6 0 0 0 2.9 3.6M16.5 6.2h2.7a2.6 2.6 0 0 1-2.9 3.6" />
      <path d="M12 13.2v3.3M8.8 19.5h6.4M9.8 16.5h4.4v3H9.8z" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  shelf: (
    <>
      <rect x="4" y="4" width="3.4" height="13" rx="1" />
      <rect x="9.3" y="4" width="3.4" height="13" rx="1" />
      <rect x="14.6" y="5.5" width="5.4" height="11.5" rx="1.2" transform="rotate(-8 17 11)" />
      <path d="M2.5 20h19" />
    </>
  ),
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  // carnet (manuel du jeu) : couverture, tranche de pages, deux lignes de texte
  manual: (
    <>
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3H18v15H7.5A1.5 1.5 0 0 0 6 19.5z" />
      <path d="M6 19.5A1.5 1.5 0 0 0 7.5 21H18v-3" />
      <path d="M9.5 7.5h5M9.5 10.5h5" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" />,
  open: (
    <>
      <path d="M12 6v13" />
      <path d="M12 6C9.5 4.5 6.5 4.3 3.5 5v13c3-.7 6-.5 8.5 1 2.5-1.5 5.5-1.7 8.5-1V5c-3-.7-6-.5-8.5 1z" />
    </>
  ),
  close: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M8 3.5v17" />
    </>
  ),
  front: (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9 15h6" />
    </>
  ),
  backFace: (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9 8h6M9 11h6M9 14h3" />
    </>
  ),
  spine: (
    <>
      <path d="M9 3.5h6v17H9z" />
      <path d="M12 7v7" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5" opacity=".5" />
    </>
  ),
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  sortAlpha: (
    <>
      <path d="M4 17 7 7l3 10M5 14h4" />
      <path d="M14 7h6l-6 10h6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  sparkle: <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />,
  user: (
    <>
      <circle cx="12" cy="9" r="3.6" />
      <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12h9M17.5 12v3M20.5 12v2" />
    </>
  ),
  gamepad: (
    <>
      <path d="M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-.9 3a2.3 2.3 0 0 1-4 .7L15 16H9l-1.4 1.5a2.3 2.3 0 0 1-4-.7l-.9-3A4.5 4.5 0 0 1 7 8z" />
      <path d="M8 11v3M6.5 12.5h3" />
      <circle cx="15.5" cy="11.5" r=".6" fill="currentColor" />
      <circle cx="17.3" cy="13.3" r=".6" fill="currentColor" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  motion: (
    <>
      <path d="M4 12c3-6 6-6 8 0s5 6 8 0" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  power: (
    <>
      <path d="M12 3.5v8" />
      <path d="M7.2 6.6a7.5 7.5 0 1 0 9.6 0" />
    </>
  ),
  chat: <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5v-9A1.5 1.5 0 0 1 5.5 5z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0" />
      <path d="M9.2 9.8v.4M14.8 9.8v.4" />
    </>
  ),
  home: <path d="M4 11.5 12 5l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5h-5v5h-4A1.5 1.5 0 0 1 4 19z" />,
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.9 11.6A1.6 1.6 0 0 0 9 20h6a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
      <path d="M10.2 11v5M13.8 11v5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  /** Réglages fins (SmartConfig). */
  tune: (
    <>
      <path d="M5 7h8M17 7h2M5 17h2M11 17h8" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  /** Composant électronique (matériel détecté). */
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" />
    </>
  ),
  /** Historique (horloge qui revient en arrière). */
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.2h3.2" />
      <path d="M12 8.5V12l2.5 1.8" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = "1.25em",
  filled,
  ...rest
}: { name: IconName; size?: string | number; filled?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
