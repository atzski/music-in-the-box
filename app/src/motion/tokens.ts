/**
 * iBox — langage de mouvement (source unique pour les animations pilotées par `motion`).
 *
 * Direction : des mouvements courts, physiques et calmes. Tout ce qui répond à un geste
 * est un ressort (il peut être interrompu et repart de sa vitesse courante) ; tout ce
 * qui n'est qu'un fondu est une courbe. Une seule famille de rebond, discrète.
 *
 * Hiérarchie : plus la surface est grande, plus le ressort est lent.
 *   snappy  → pastilles, interrupteurs, infobulles, menus déroulants
 *   smooth  → cartes, panneaux, modales, écrans
 *   gentle  → grandes surfaces, héros, décors
 *   pop     → confirmation ponctuelle (badge, compteur, favori) : un seul léger dépassement
 *   drift   → jauges et remplissages lents
 *
 * Les équivalents CSS (transitions de survol et de focus) sont dans `styles/tokens.css`.
 */
export const SPRING = {
  snappy: { type: "spring", stiffness: 440, damping: 34, mass: 0.9 },
  smooth: { type: "spring", stiffness: 280, damping: 30, mass: 1 },
  gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  pop: { type: "spring", stiffness: 420, damping: 26, mass: 1 },
  drift: { type: "spring", stiffness: 60, damping: 16, mass: 1 },
} as const;

/** Courbes : `out` pour ce qui arrive, `in` pour ce qui part, `inOut` pour ce qui se déplace. */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  in: [0.5, 0, 0.84, 0.3],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Durées (secondes). Les sorties sont toujours plus brèves que les entrées. */
export const DUR = {
  micro: 0.14,
  fast: 0.2,
  base: 0.32,
  slow: 0.5,
  exit: 0.16,
} as const;

export const TWEEN = {
  micro: { duration: DUR.micro, ease: EASE.out },
  fast: { duration: DUR.fast, ease: EASE.out },
  base: { duration: DUR.base, ease: EASE.out },
  slow: { duration: DUR.slow, ease: EASE.out },
  exit: { duration: DUR.exit, ease: EASE.in },
} as const;

/** Retard d'apparition en cascade, plafonné : une longue liste ne fait jamais attendre. */
export function stagger(index: number, step = 0.04, max = 8): number {
  return Math.min(index, max) * step;
}

/** Cascade d'un conteneur (`variants`) : les enfants entrent l'un après l'autre. */
export const CASCADE = {
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
} as const;
