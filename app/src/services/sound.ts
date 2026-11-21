import { useSettings } from "./settings";

/**
 * Sons d'interface d'iBox.
 *
 * Une seule famille sonore, entièrement synthétisée (Web Audio, aucun fichier, aucun son
 * officiel), accordée sur la gamme pentatonique de ré majeur. Chaque signal est fait de couches :
 * un contact feutré (souffle très bref), un corps grave qui donne la sensation d'appui, puis une
 * ou plusieurs notes chaudes (verre, bois, carillon), le tout dans une courte résonance commune.
 * La hiérarchie va du plus discret (déplacement, simple appui) au plus présent (confirmation,
 * enregistrement, lancement) ; l'erreur reste douce, dans le grave. Les grandes destinations
 * (accueil, paramètres, amis, notifications, profil, recherche…) ont chacune leur signature.
 * Les sons répétés varient légèrement (hauteur, niveau) pour ne pas fatiguer.
 *
 * Un fichier peut remplacer n'importe quelle cue via `registerSoundFile`.
 * La musique d'ambiance (menu, consoles) est gérée par `music.ts`.
 */
export const SOUND_CUES = [
  // navigation
  "move", "tap", "select", "confirm", "save", "back", "open", "close", "tab", "view",
  // destinations
  "home", "settings", "friends", "bell", "profile", "search", "menu", "enter", "power", "minimize",
  // états
  "toggle", "on", "off", "favorite", "unfavorite", "delete", "error",
  // événements
  "notify", "message", "success", "launch",
  // sons « physiques » des boîtiers et des carnets
  "caseOpen", "caseClose", "trayOpen", "trayClose", "mediaOut", "mediaIn", "pull", "page", "bookOpen", "bookClose",
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/** Partiels d'un timbre : [rapport de fréquence, niveau relatif, durée relative]. */
type Partial3 = readonly [number, number, number];
const TIMBRES = {
  /** Lame de verre : claire et ronde, sans partiel aigu qui pique. */
  glass: [[1, 1, 1], [2, 0.2, 0.5], [2.76, 0.07, 0.3]],
  /** Carillon : le verre, doublé d'une voix à peine désaccordée qui fait scintiller la queue. */
  chime: [[1, 1, 1], [1.004, 0.4, 1], [2, 0.18, 0.55], [2.76, 0.08, 0.35]],
  /** Voix chaude : une octave grave sous la note lui donne du corps. */
  warm: [[1, 1, 1], [0.5, 0.3, 0.8], [2, 0.2, 0.5], [3, 0.06, 0.3]],
  /** Lame de bois (marimba) : attaque nette, très courte, posée sur son octave grave. */
  wood: [[1, 1, 1], [0.5, 0.2, 0.5], [4, 0.12, 0.2]],
  /** Voix feutrée : retours, fermetures, extinctions. */
  soft: [[1, 1, 1], [2, 0.1, 0.45]],
  /** Voix creuse (partiels impairs) : l'erreur, reconnaissable sans être agressive. */
  hollow: [[1, 1, 1], [3, 0.22, 0.6], [5, 0.07, 0.35]],
} as const satisfies Record<string, readonly Partial3[]>;
type Timbre = keyof typeof TIMBRES;

export interface Tone {
  freq: number;
  /** Secondes après le déclenchement. */
  at: number;
  /** Durée de la résonance (extinction complète). */
  dur: number;
  gain: number;
  timbre?: Timbre;
  /** Petite inflexion d'attaque : la note part de `freq × from` et rejoint `freq` en `glide` s. */
  from?: number;
  glide?: number;
  attack?: number;
}

/** Souffle filtré : frottements, clics de plastique, glissements de carton, air d'une ouverture. */
export interface Noise {
  noise: true;
  at: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  slideTo?: number;
  q?: number;
  /** Montée du volume (s) : courte = clic, longue = frottement. */
  attack?: number;
}

export type Voice = Tone | Noise;

// Gamme pentatonique de ré majeur (ré, mi, fa dièse, la, si), du médium grave à l'aigu doux.
const D4 = 293.66, Fs4 = 369.99, A4 = 440, B4 = 493.88, D5 = 587.33, E5 = 659.26, Fs5 = 739.99;
const A5 = 880, B5 = 987.77, D6 = 1174.66, Fs6 = 1479.98, A6 = 1760;

const note = (freq: number, at: number, dur: number, gain: number, timbre: Timbre = "glass", extra: Partial<Tone> = {}): Tone => ({ freq, at, dur, gain, timbre, ...extra });
/** Contact : un grain de souffle feutré (médium, jamais sifflant) qui précise l'attaque. */
const tick = (at: number, gain = 0.022, freq = 1900): Noise => ({ noise: true, at, dur: 0.016, gain, filter: "bandpass", freq, q: 0.9, attack: 0.003 });
/** Corps : un petit choc grave qui donne la sensation d'appuyer sur quelque chose. */
const body = (at: number, gain = 0.07, from = 190, to = 105): Tone => ({ freq: to, from: from / to, glide: 0.045, at, dur: 0.085, gain, timbre: "soft", attack: 0.004 });
const click = (at: number, gain = 0.2, freq = 2800): Noise => ({ noise: true, at, dur: 0.022, gain, filter: "highpass", freq });
const thump = (at: number, gain = 0.2, from = 140, to = 80): Tone => ({ freq: to, from: from / to, glide: 0.07, at, dur: 0.1, gain, timbre: "soft", attack: 0.003 });
const whoosh = (at: number, dur: number, from: number, to: number, gain = 0.08): Noise => ({
  noise: true, at, dur, gain, filter: "bandpass", freq: from, slideTo: to, q: 1.2, attack: dur * 0.35,
});

export const VOICES: Record<SoundCue, Voice[]> = {
  // ——— navigation ———
  // Déplacement : le plus discret, une lame de bois effleurée.
  move: [tick(0, 0.016), note(D5, 0, 0.065, 0.07, "wood")],
  // Appui par défaut de tout élément cliquable : un « toc » grave et rond.
  tap: [tick(0, 0.022, 1600), body(0, 0.1, 210, 115), note(A4, 0, 0.09, 0.085, "warm", { from: 1.18, glide: 0.022 })],
  // Sélection : l'appui, puis une quinte qui monte.
  select: [tick(0), body(0, 0.07), note(D5, 0, 0.15, 0.105, "warm"), note(A5, 0.06, 0.28, 0.115)],
  // Confirmation : l'accord de ré égrené, plus présent.
  confirm: [tick(0, 0.025), body(0, 0.08), note(D5, 0, 0.18, 0.1, "warm"), note(Fs5, 0.05, 0.2, 0.1, "chime"), note(A5, 0.1, 0.4, 0.115, "chime"), note(D6, 0.1, 0.4, 0.04, "soft")],
  // Enregistrement : un coup de tampon feutré, puis deux notes qui se posent.
  save: [
    whoosh(0, 0.09, 1400, 500, 0.03), tick(0, 0.03, 1500), body(0, 0.14, 230, 100),
    note(D5, 0, 0.12, 0.07, "warm"), note(A5, 0.07, 0.22, 0.1, "chime"), note(D6, 0.14, 0.5, 0.11, "chime"),
  ],
  // Retour : la sélection à l'envers, feutrée.
  back: [note(A5, 0, 0.12, 0.09, "soft"), note(D5, 0.055, 0.22, 0.11, "warm"), body(0.055, 0.05)],
  // Ouverture d'une fenêtre : un souffle et trois notes qui montent.
  open: [whoosh(0, 0.2, 400, 1800, 0.03), note(A4, 0, 0.14, 0.085, "warm"), note(D5, 0.045, 0.16, 0.09, "warm"), note(A5, 0.09, 0.36, 0.105)],
  // Fermeture : la même phrase qui redescend, dans le temps de la sortie (160 ms).
  close: [whoosh(0, 0.14, 1700, 500, 0.022), note(A5, 0, 0.1, 0.07, "soft"), note(D5, 0.04, 0.12, 0.085, "soft"), note(A4, 0.08, 0.2, 0.1, "warm")],
  // Onglet, tri, segment : deux lames de bois rapprochées.
  tab: [tick(0, 0.018), note(Fs5, 0, 0.06, 0.08, "wood"), note(A5, 0.04, 0.13, 0.085, "wood")],
  // Changement de vue : balayage d'air et deux notes.
  view: [whoosh(0, 0.24, 450, 1800, 0.055), note(E5, 0.04, 0.14, 0.085, "warm"), note(B5, 0.11, 0.32, 0.085)],

  // ——— destinations ———
  // Accueil : trois notes qui redescendent se poser sur le ré, comme on rentre chez soi.
  home: [note(A5, 0, 0.1, 0.08), note(Fs5, 0.05, 0.12, 0.085), note(D5, 0.1, 0.34, 0.11, "warm"), note(D4, 0.1, 0.3, 0.05, "soft"), body(0.1, 0.08)],
  // Paramètres : un cliquet, trois crans de bois dont le dernier sonne.
  settings: [tick(0, 0.03, 2200), note(B4, 0, 0.05, 0.07, "wood"), tick(0.04, 0.026, 2200), note(B4, 0.04, 0.05, 0.07, "wood"), tick(0.08, 0.03, 2200), note(E5, 0.08, 0.2, 0.1, "warm")],
  // Amis : deux voix à la tierce, un petit « coucou ».
  friends: [body(0, 0.05), note(D5, 0, 0.14, 0.08), note(Fs5, 0, 0.14, 0.07), note(Fs5, 0.075, 0.3, 0.085), note(A5, 0.075, 0.3, 0.08)],
  // Notifications : une clochette, deux coups rapprochés.
  bell: [tick(0, 0.02, 2400), note(D6, 0, 0.34, 0.085, "chime"), note(A5, 0, 0.3, 0.06, "chime"), note(D6, 0.07, 0.3, 0.05, "chime")],
  // Profil : un accord chaleureux roulé.
  profile: [body(0, 0.06), note(Fs5, 0, 0.14, 0.085, "warm"), note(A5, 0.04, 0.16, 0.085), note(D6, 0.08, 0.3, 0.07, "soft")],
  // Recherche : un souffle qui monte et une note qui s'ouvre.
  search: [whoosh(0, 0.16, 700, 2600, 0.045), note(E5, 0.03, 0.1, 0.075, "glass", { from: 0.85, glide: 0.05 }), note(B5, 0.09, 0.26, 0.09)],
  // Menu rapide : un appui franc et un accord de mi qui se déplie.
  menu: [tick(0), body(0, 0.09, 220, 120), note(B4, 0, 0.1, 0.085, "warm"), note(E5, 0.04, 0.12, 0.085), note(B5, 0.08, 0.26, 0.07, "soft")],
  // Entrée dans une rubrique (bibliothèque, consoles, communauté) : un élan vers l'avant.
  enter: [whoosh(0, 0.22, 350, 2000, 0.05), body(0, 0.08), note(D5, 0, 0.12, 0.09, "warm"), note(A5, 0.05, 0.14, 0.09), note(D6, 0.1, 0.32, 0.08)],
  // Alimentation : une quinte grave qui descend, longue et posée.
  power: [whoosh(0, 0.25, 1500, 300, 0.04), note(A4, 0, 0.18, 0.1, "warm"), note(D4, 0.09, 0.45, 0.12, "warm"), body(0.09, 0.08, 140, 75)],
  // Réduction de la fenêtre : un souffle et une note qui s'affaissent.
  minimize: [whoosh(0, 0.16, 1800, 400, 0.035), note(A5, 0, 0.09, 0.07, "soft"), note(D5, 0.05, 0.2, 0.09, "soft", { from: 1.12, glide: 0.08 })],

  // ——— états ———
  // Bascule sans état connu : une goutte.
  toggle: [tick(0, 0.018), body(0, 0.05), note(A5, 0, 0.14, 0.1, "glass", { from: 0.8, glide: 0.04 })],
  // Interrupteur allumé : déclic et quarte montante ; éteint : quarte descendante, feutrée.
  on: [tick(0, 0.03, 1700), body(0, 0.09, 240, 130), note(Fs5, 0, 0.08, 0.085, "warm"), note(B5, 0.045, 0.22, 0.11)],
  off: [tick(0, 0.022, 1300), note(B5, 0, 0.08, 0.075, "soft"), note(Fs5, 0.045, 0.2, 0.095, "warm"), body(0.045, 0.07, 170, 95)],
  // Favori : une étincelle qui grimpe, posée sur un ré chaud ; retiré : deux notes qui se posent.
  favorite: [note(D5, 0, 0.3, 0.05, "warm"), note(A5, 0, 0.2, 0.08, "chime"), note(D6, 0.035, 0.2, 0.08, "chime"), note(Fs6, 0.07, 0.26, 0.08, "chime"), note(A6, 0.105, 0.46, 0.075, "chime")],
  unfavorite: [note(D6, 0, 0.1, 0.06, "soft"), note(A5, 0.05, 0.24, 0.09, "soft")],
  // Suppression : tierce grave descendante et choc sourd.
  delete: [whoosh(0, 0.1, 1200, 400, 0.025), note(Fs4, 0, 0.1, 0.11, "warm"), note(D4, 0.06, 0.22, 0.12, "warm"), body(0.06, 0.11, 150, 80)],
  // Erreur : deux coups graves identiques, doux mais sans équivoque.
  error: [
    body(0, 0.08, 150, 90), note(Fs4, 0, 0.13, 0.16, "hollow", { from: 1.035, glide: 0.05, attack: 0.006 }),
    body(0.115, 0.07, 150, 90), note(Fs4, 0.115, 0.22, 0.15, "hollow", { from: 1.035, glide: 0.05, attack: 0.006 }),
  ],

  // ——— événements ———
  // Notification : carillon à deux notes, longue queue.
  notify: [note(D5, 0, 0.4, 0.04, "warm"), note(A5, 0, 0.5, 0.11, "chime"), note(D6, 0.09, 0.72, 0.1, "chime")],
  // Message reçu : deux petits coups sur la même note.
  message: [tick(0, 0.02), note(Fs5, 0, 0.09, 0.09, "wood"), note(Fs5, 0.085, 0.3, 0.1, "chime")],
  // Tâche réussie : l'arpège complet, posé sur son octave grave.
  success: [
    body(0, 0.07), note(D5, 0, 0.25, 0.09, "chime"), note(Fs5, 0.07, 0.25, 0.09, "chime"), note(A5, 0.14, 0.3, 0.095, "chime"),
    note(D6, 0.21, 0.8, 0.105, "chime"), note(D4, 0.21, 0.7, 0.06, "warm"),
  ],
  // Lancement d'un jeu : la signature d'iBox, un envol puis un accord qui s'ouvre.
  launch: [
    whoosh(0, 0.45, 250, 2600, 0.05), body(0, 0.1),
    note(D4, 0, 0.2, 0.09, "warm"), note(A4, 0.07, 0.2, 0.09, "warm"), note(D5, 0.13, 0.2, 0.09, "warm"), note(Fs5, 0.18, 0.2, 0.09), note(A5, 0.22, 0.24, 0.09),
    note(D5, 0.28, 0.9, 0.06, "chime"), note(A5, 0.28, 0.9, 0.07, "chime"), note(D6, 0.28, 0.95, 0.075, "chime"), note(Fs6, 0.34, 0.8, 0.035, "chime"),
  ],

  // ——— boîtiers et carnets ———
  // Charnière d'un boîtier plastique : petit « pop », souffle, note claire
  caseOpen: [click(0, 0.2), thump(0, 0.18, 150, 95), whoosh(0.02, 0.22, 900, 2400, 0.09), note(A5, 0.12, 0.2, 0.06), note(D6, 0.19, 0.3, 0.05)],
  // Fermeture : souffle descendant puis « clac »
  caseClose: [whoosh(0, 0.14, 2200, 800, 0.08), click(0.11, 0.18, 3000), thump(0.11, 0.22, 125, 70)],
  // Plateau de carton qui glisse, puis petite butée
  trayOpen: [
    { noise: true, at: 0, dur: 0.38, gain: 0.16, filter: "lowpass", freq: 600, slideTo: 1500, attack: 0.06 },
    { noise: true, at: 0.33, dur: 0.05, gain: 0.14, filter: "bandpass", freq: 420, q: 2 },
  ],
  trayClose: [{ noise: true, at: 0, dur: 0.32, gain: 0.15, filter: "lowpass", freq: 1500, slideTo: 500, attack: 0.05 }, thump(0.29, 0.22, 110, 75)],
  // Support saisi : déclic, souffle, petite note ascendante
  mediaOut: [click(0, 0.16, 3200), whoosh(0.01, 0.2, 700, 1800, 0.075), note(Fs6, 0.12, 0.2, 0.075, "glass", { from: 0.75, glide: 0.09 })],
  // Support rangé : souffle puis encliquetage
  mediaIn: [whoosh(0, 0.16, 1800, 700, 0.075), click(0.14, 0.14, 3000), thump(0.14, 0.15, 170, 110)],
  // Boîtier tiré de l'étagère : léger frottement plastique
  pull: [click(0, 0.14, 2400), { noise: true, at: 0.01, dur: 0.3, gain: 0.12, filter: "bandpass", freq: 1200, slideTo: 2600, q: 1.5, attack: 0.08 }],
  // Page de papier tournée : froissement bref, plus aigu en fin de geste
  page: [
    { noise: true, at: 0, dur: 0.16, gain: 0.11, filter: "bandpass", freq: 1800, slideTo: 4200, q: 0.8, attack: 0.04 },
    { noise: true, at: 0.12, dur: 0.05, gain: 0.06, filter: "highpass", freq: 5000 },
  ],
  // Carnet tiré de ses clips puis ouvert
  bookOpen: [
    click(0, 0.13, 2400),
    whoosh(0.03, 0.3, 600, 2600, 0.085),
    { noise: true, at: 0.24, dur: 0.14, gain: 0.085, filter: "bandpass", freq: 2200, slideTo: 3800, q: 0.9, attack: 0.03 },
    note(A5, 0.2, 0.24, 0.045),
  ],
  // Carnet refermé : papier, puis petit claquement de couverture
  bookClose: [{ noise: true, at: 0, dur: 0.14, gain: 0.085, filter: "bandpass", freq: 3200, slideTo: 1600, q: 0.9 }, thump(0.12, 0.16, 160, 90), click(0.12, 0.13, 2000)],
};

/** Part de résonance : presque sec pour les gestes répétés, plus ample pour les événements. */
const WET: Partial<Record<SoundCue, number>> = {
  move: 0.04, tap: 0.05, tab: 0.07, toggle: 0.08, settings: 0.07, error: 0.06,
  confirm: 0.16, save: 0.16, home: 0.14, friends: 0.14, enter: 0.14, power: 0.16,
  bell: 0.18, favorite: 0.18, notify: 0.2, success: 0.2, launch: 0.22,
};
const DEFAULT_WET = 0.11;
/** Variation aléatoire de hauteur (centièmes de demi-ton) des sons les plus répétés. */
const DRIFT: Partial<Record<SoundCue, number>> = { move: 14, tap: 14, tab: 8, toggle: 8, on: 5, off: 5, select: 5, back: 5, page: 0 };
/** Écart minimal (ms) entre deux déclenchements de la même cue. */
const GAP: Partial<Record<SoundCue, number>> = { move: 45, tap: 40 };
/** Carillons d'événements : un seul à la fois, pour qu'ils ne se recouvrent pas. */
const CHIMES: ReadonlySet<SoundCue> = new Set(["notify", "message", "success"]);
const CHIME_GAP = 450;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Une seconde de bruit blanc, générée une fois par contexte. */
function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

const warmths = new WeakMap<BaseAudioContext, AudioNode>();
/** Couleur commune : un peu plus de grave, un peu moins d'aigu, pour une tonalité chaude. */
function warmth(ctx: BaseAudioContext): AudioNode {
  let node = warmths.get(ctx);
  if (!node) {
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 220;
    low.gain.value = 2.5;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 4500;
    high.gain.value = -3.5;
    low.connect(high).connect(ctx.destination);
    warmths.set(ctx, (node = low));
  }
  return node;
}

const rooms = new WeakMap<BaseAudioContext, ConvolverNode>();
/** Résonance commune : une petite pièce claire (0,4 s), calculée une fois par contexte. */
function room(ctx: BaseAudioContext): ConvolverNode {
  let conv = rooms.get(ctx);
  if (!conv) {
    const len = Math.floor(ctx.sampleRate * 0.42);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // bruit adouci (passe-bas à un pôle) qui s'éteint vite : pas de sifflantes dans la queue
        low += (Math.random() * 2 - 1 - low) * 0.35;
        data[i] = low * Math.pow(1 - t, 2) * Math.exp(-5 * t);
      }
    }
    conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = ir;
    conv.connect(warmth(ctx));
    rooms.set(ctx, conv);
  }
  return conv;
}

/** Sortie d'un son : voie directe au volume demandé, plus un envoi vers la résonance commune. */
export function soundOutput(ctx: BaseAudioContext, volume: number, cue: SoundCue): AudioNode {
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(warmth(ctx));
  const send = ctx.createGain();
  send.gain.value = WET[cue] ?? DEFAULT_WET;
  out.connect(send).connect(room(ctx));
  return out;
}

/** Programme les voix d'une cue sur `out` à partir de `t0` (fonctionne aussi hors ligne, pour les mesures). */
export function renderCue(ctx: BaseAudioContext, cue: SoundCue, out: AudioNode, t0: number, detune = 0, level = 1): void {
  for (const n of VOICES[cue]) {
    const start = t0 + n.at;
    if ("noise" in n) {
      const attack = n.attack ?? 0.003;
      const g = ctx.createGain();
      // muet avant le départ : sans cela un échantillon peut passer à plein niveau (claquement)
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(n.gain * level, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(n.dur, attack + 0.01));
      const src = ctx.createBufferSource();
      src.buffer = whiteNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = n.filter;
      filter.Q.value = n.q ?? 0.7;
      filter.frequency.setValueAtTime(n.freq, start);
      if (n.slideTo) filter.frequency.exponentialRampToValueAtTime(n.slideTo, start + n.dur);
      src.connect(filter).connect(g).connect(out);
      src.start(start, Math.random() * 0.5);
      src.stop(start + n.dur + 0.02);
      continue;
    }
    const attack = n.attack ?? 0.004;
    for (const [ratio, rel, decay] of TIMBRES[n.timbre ?? "glass"]) {
      const f = n.freq * ratio;
      if (f > 11000) continue; // partiels trop aigus : inutiles et durs à l'oreille
      const end = start + Math.max(n.dur * decay, attack + 0.012);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.detune.value = detune;
      if (n.from && n.from !== 1) {
        osc.frequency.setValueAtTime(f * n.from, start);
        osc.frequency.exponentialRampToValueAtTime(f, start + (n.glide ?? 0.03));
      } else {
        osc.frequency.setValueAtTime(f, start);
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(n.gain * rel * level, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(out);
      osc.start(start);
      osc.stop(end + 0.01);
    }
  }
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private files = new Map<SoundCue, AudioBuffer>();
  private lastPlayed = new Map<SoundCue, number>();
  private lastChime = 0;
  /** Horodatage du dernier son joué (sert au son par défaut des éléments cliquables). */
  private lastAny = 0;
  private background = false;

  private context(): AudioContext | null {
    if (typeof window === "undefined" || !("AudioContext" in window)) return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Fenêtre principale masquée (zone de notification) : plus aucun son d'interface. */
  setBackground(value: boolean): void {
    this.background = value;
  }

  /** Remplace la voix synthétisée d'une cue par un fichier audio. */
  async registerSoundFile(cue: SoundCue, url: string): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Son introuvable : ${url}`);
    this.files.set(cue, await ctx.decodeAudioData(await res.arrayBuffer()));
  }

  play(cue: SoundCue): void {
    const now = performance.now();
    // un son a été demandé pour ce geste, même s'il reste muet : pas de son par défaut en plus
    this.lastAny = now;
    const { soundEnabled, soundVolume } = useSettings.getState();
    if (!soundEnabled || soundVolume <= 0) return;
    if (this.background || (typeof document !== "undefined" && document.hidden)) return;

    // Anti-mitraillage (déplacements rapides) et carillons qui ne se recouvrent pas
    if (now - (this.lastPlayed.get(cue) ?? -1e9) < (GAP[cue] ?? 20)) return;
    if (CHIMES.has(cue)) {
      if (now - this.lastChime < CHIME_GAP) return;
      this.lastChime = now;
    }
    this.lastPlayed.set(cue, now);

    const ctx = this.context();
    if (!ctx) return;
    const out = soundOutput(ctx, soundVolume * 0.9, cue);

    const file = this.files.get(cue);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.connect(out);
      src.start();
      return;
    }

    const drift = DRIFT[cue] ?? 0;
    const detune = drift ? (Math.random() * 2 - 1) * drift : 0;
    const level = drift ? 0.94 + Math.random() * 0.12 : 1;
    renderCue(ctx, cue, out, ctx.currentTime + 0.005, detune, level);
  }

  /**
   * Son par défaut de tout ce qui se clique : si un bouton, un lien ou une case n'a joué aucun
   * son pendant son clic, il reçoit le petit « tap ». À appeler une fois par fenêtre.
   */
  attachClicks(): () => void {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
      if (!target || target.closest("[data-silent]")) return;
      // champs de saisie et curseurs : on y écrit, on n'y « appuie » pas
      if (e.target instanceof Element && e.target.closest('textarea, input:not([type="checkbox"]):not([type="radio"])')) return;
      if ((target as HTMLButtonElement).disabled || target.getAttribute("aria-disabled") === "true") return;
      const at = performance.now();
      // après tous les gestionnaires du clic : ceux qui ont leur propre son ont déjà joué
      window.setTimeout(() => {
        if (this.lastAny < at) this.play("tap");
      }, 0);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }
}

const CLICKABLE = 'button, a[href], summary, select, input[type="checkbox"], input[type="radio"], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [data-focusable]';

export const sound = new SoundManager();
