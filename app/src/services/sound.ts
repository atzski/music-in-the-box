import { useSettings } from "./settings";

/**
 * Gestionnaire de sons d'interface.
 *
 * Chaque « cue » possède une voix synthétisée originale (Web Audio, aucun
 * fichier externe, aucun son officiel). Un fichier peut remplacer n'importe
 * quelle cue via `registerSoundFile` — par exemple `public/sounds/open.ogg`.
 * La musique d'ambiance (menu, consoles) est gérée par `music.ts`.
 */
export type SoundCue =
  | "move"
  | "select"
  | "back"
  | "open"
  | "close"
  | "toggle"
  | "tab"
  | "error"
  // sons « physiques » des boîtiers (phase 5)
  | "caseOpen"
  | "caseClose"
  | "trayOpen"
  | "trayClose"
  | "mediaOut"
  | "mediaIn"
  | "view"
  | "pull"
  // carnets (manuels) : page tournée, carnet ouvert / refermé
  | "page"
  | "bookOpen"
  | "bookClose";

interface Note {
  freq: number;
  at: number; // secondes après le déclenchement
  dur: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
}

/** Souffle filtré : frottements, clics de plastique, glissements de carton. */
interface Noise {
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

type Voice = Note | Noise;

const click = (at: number, gain = 0.45, freq = 2800): Noise => ({ noise: true, at, dur: 0.022, gain, filter: "highpass", freq });
const thump = (at: number, gain = 0.26, from = 140, to = 80): Note => ({ freq: from, slideTo: to, at, dur: 0.09, type: "sine", gain });
const whoosh = (at: number, dur: number, from: number, to: number, gain = 0.11): Noise => ({
  noise: true,
  at,
  dur,
  gain,
  filter: "bandpass",
  freq: from,
  slideTo: to,
  q: 1.2,
  attack: dur * 0.35,
});

// Petites phrases pentatoniques, douces et brèves.
const VOICES: Record<SoundCue, Voice[]> = {
  move: [{ freq: 1318.5, at: 0, dur: 0.05, type: "sine", gain: 0.18 }],
  tab: [
    { freq: 987.8, at: 0, dur: 0.05, type: "triangle", gain: 0.16 },
    { freq: 1318.5, at: 0.045, dur: 0.06, type: "triangle", gain: 0.14 },
  ],
  select: [
    { freq: 783.99, at: 0, dur: 0.08, type: "triangle", gain: 0.22 },
    { freq: 1174.7, at: 0.06, dur: 0.12, type: "sine", gain: 0.2 },
  ],
  back: [
    { freq: 880, at: 0, dur: 0.07, type: "triangle", gain: 0.18 },
    { freq: 659.25, at: 0.05, dur: 0.1, type: "sine", gain: 0.16 },
  ],
  toggle: [{ freq: 1046.5, at: 0, dur: 0.07, type: "triangle", gain: 0.18, slideTo: 1318.5 }],
  open: [
    { freq: 392, at: 0, dur: 0.16, type: "triangle", gain: 0.16, slideTo: 523.25 },
    { freq: 783.99, at: 0.1, dur: 0.18, type: "sine", gain: 0.14 },
    { freq: 1174.7, at: 0.18, dur: 0.26, type: "sine", gain: 0.1 },
  ],
  close: [
    { freq: 659.25, at: 0, dur: 0.1, type: "triangle", gain: 0.15, slideTo: 440 },
    { freq: 329.6, at: 0.08, dur: 0.12, type: "sine", gain: 0.18 },
  ],
  error: [
    { freq: 330, at: 0, dur: 0.1, type: "triangle", gain: 0.16 },
    { freq: 311, at: 0.1, dur: 0.14, type: "triangle", gain: 0.14 },
  ],

  // Charnière d'un boîtier plastique : petit « pop », souffle, note claire
  caseOpen: [
    click(0, 0.4),
    thump(0, 0.22, 150, 95),
    whoosh(0.02, 0.22, 900, 2400),
    { freq: 783.99, at: 0.12, dur: 0.16, type: "sine", gain: 0.07 },
    { freq: 1174.7, at: 0.19, dur: 0.22, type: "sine", gain: 0.05 },
  ],
  // Fermeture : souffle descendant puis « clac »
  caseClose: [whoosh(0, 0.14, 2200, 800, 0.1), click(0.11, 0.5, 3000), thump(0.11, 0.3, 125, 70)],
  // Plateau de carton qui glisse, puis petite butée
  trayOpen: [
    { noise: true, at: 0, dur: 0.38, gain: 0.2, filter: "lowpass", freq: 600, slideTo: 1500, attack: 0.06 },
    { noise: true, at: 0.33, dur: 0.05, gain: 0.18, filter: "bandpass", freq: 420, q: 2 },
  ],
  trayClose: [
    { noise: true, at: 0, dur: 0.32, gain: 0.19, filter: "lowpass", freq: 1500, slideTo: 500, attack: 0.05 },
    thump(0.29, 0.28, 110, 75),
  ],
  // Support saisi : déclic, souffle, petite note ascendante
  mediaOut: [
    click(0, 0.32, 3200),
    whoosh(0.01, 0.2, 700, 1800, 0.09),
    { freq: 1046.5, slideTo: 1568, at: 0.12, dur: 0.14, type: "triangle", gain: 0.09 },
  ],
  // Page de papier tournée : froissement bref, plus aigu en fin de geste
  page: [
    { noise: true, at: 0, dur: 0.16, gain: 0.13, filter: "bandpass", freq: 1800, slideTo: 4200, q: 0.8, attack: 0.04 },
    { noise: true, at: 0.12, dur: 0.05, gain: 0.07, filter: "highpass", freq: 5000 },
  ],
  // Carnet tiré de ses clips puis ouvert
  bookOpen: [
    click(0, 0.22, 2400),
    whoosh(0.03, 0.3, 600, 2600, 0.1),
    { noise: true, at: 0.24, dur: 0.14, gain: 0.1, filter: "bandpass", freq: 2200, slideTo: 3800, q: 0.9, attack: 0.03 },
    { freq: 880, at: 0.2, dur: 0.18, type: "sine", gain: 0.05 },
  ],
  // Carnet refermé : papier, puis petit claquement de couverture
  bookClose: [
    { noise: true, at: 0, dur: 0.14, gain: 0.1, filter: "bandpass", freq: 3200, slideTo: 1600, q: 0.9 },
    thump(0.12, 0.2, 160, 90),
    click(0.12, 0.18, 2000),
  ],
  // Support rangé : souffle puis encliquetage
  mediaIn: [whoosh(0, 0.16, 1800, 700, 0.09), click(0.14, 0.4, 3000), thump(0.14, 0.18, 170, 110)],
  // Changement de vue : balayage d'air et deux notes
  view: [
    whoosh(0, 0.26, 500, 2000, 0.12),
    { freq: 659.25, at: 0.05, dur: 0.12, type: "sine", gain: 0.1 },
    { freq: 987.8, at: 0.13, dur: 0.18, type: "sine", gain: 0.09 },
  ],
  // Boîtier tiré de l'étagère : léger frottement plastique
  pull: [click(0, 0.25, 2400), { noise: true, at: 0.01, dur: 0.3, gain: 0.15, filter: "bandpass", freq: 1200, slideTo: 2600, q: 1.5, attack: 0.08 }],
};

class SoundManager {
  private ctx: AudioContext | null = null;
  private files = new Map<SoundCue, AudioBuffer>();
  private lastPlayed = new Map<SoundCue, number>();
  private noiseBuffer: AudioBuffer | null = null;

  /** Une seconde de bruit blanc, générée une fois. */
  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private context(): AudioContext | null {
    if (typeof window === "undefined" || !("AudioContext" in window)) return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
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
    const { soundEnabled, soundVolume } = useSettings.getState();
    if (!soundEnabled || soundVolume <= 0) return;

    // Anti-mitraillage pour les déplacements rapides
    const now = performance.now();
    if (now - (this.lastPlayed.get(cue) ?? 0) < (cue === "move" ? 45 : 20)) return;
    this.lastPlayed.set(cue, now);

    const ctx = this.context();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.value = soundVolume * 0.9;
    master.connect(ctx.destination);

    const file = this.files.get(cue);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.connect(master);
      src.start();
      return;
    }

    const t0 = ctx.currentTime + 0.005;
    for (const n of VOICES[cue]) {
      const start = t0 + n.at;
      const g = ctx.createGain();
      const peak = n.gain ?? 0.2;
      const attack = "noise" in n ? (n.attack ?? 0.004) : 0.008;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(n.dur, attack + 0.01));
      g.connect(master);

      if ("noise" in n) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = n.filter;
        filter.Q.value = n.q ?? 0.7;
        filter.frequency.setValueAtTime(n.freq, start);
        if (n.slideTo) filter.frequency.exponentialRampToValueAtTime(n.slideTo, start + n.dur);
        src.connect(filter).connect(g);
        src.start(start, Math.random() * 0.5);
        src.stop(start + n.dur + 0.02);
        continue;
      }

      const osc = ctx.createOscillator();
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(n.slideTo, start + n.dur);
      osc.connect(g);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
  }
}

export const sound = new SoundManager();
