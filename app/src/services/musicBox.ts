import { invoke } from "@tauri-apps/api/core";

/**
 * Music in the Box : pilotage de la musique de l'utilisateur (YouTube Music ou lecteur
 * Windows) depuis le panneau en jeu. Rien à voir avec `music.ts` (ambiance des menus d'iBox).
 */

/** État commun des deux sources (voir `src-tauri/src/music/mod.rs`). */
export interface NowPlaying {
  source: "youtube" | "system";
  app: string | null;
  id: string;
  title: string;
  artist: string;
  album: string | null;
  artwork: string | null;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  volume: number | null;
  canSeek: boolean;
  /** Titre aimé (YouTube Music seulement). */
  liked: boolean | null;
  /** Lecture aléatoire ; null si le lecteur ne le dit pas. */
  shuffle: boolean | null;
  /** Répétition ; null si le lecteur ne le dit pas. */
  repeat: "none" | "all" | "one" | null;
}

/** Titre d'une playlist ou d'une recherche (YouTube Music). */
/** Un artiste d'un titre ; `id` (UC…) absent quand il n'a pas de page (chaîne d'utilisateur). */
export interface ArtistRef {
  name: string;
  id: string | null;
}

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  /** Chaque artiste séparément, avec sa page (pont 7 et plus). */
  artists?: ArtistRef[];
  album: string | null;
  duration: string | null;
  thumbnail: string | null;
}

/** Artiste trouvé par la recherche (YouTube Music). */
export interface Artist {
  id: string;
  name: string;
  subtitle: string;
  thumbnail: string | null;
}

/** Une carte d'un carrousel de la page d'artiste : album ou single, playlist, artiste, vidéo. */
export interface ArtistCard {
  kind: "album" | "playlist" | "artist" | "video";
  /** MPRE… (album), VL… (playlist), UC… (artiste), identifiant de vidéo. */
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
  /** Album : année et type (« Single », « EP » ; null pour un album). */
  year?: string | null;
  type?: string | null;
  artist?: string;
  /** Playlist : identifiant à lire (sans le préfixe VL). */
  playlistId?: string;
}

export interface ArtistPage {
  name: string;
  thumbnail: string | null;
  /** Titres populaires (les cinq de l'en-tête). */
  tracks: Track[];
  /** Les champs suivants viennent du pont 6 ; un pont plus ancien ne rend que les trois premiers. */
  /** « 94,2 M auditeurs/mois ». */
  subtitle?: string | null;
  /** Liste de lecture de tous ses titres (« Tout afficher », VL…). */
  songsId?: string | null;
  /** Carrousels tels que YouTube Music les montre : « Albums », « Singles et EP », « Vidéos »… */
  sections?: { title: string; items: ArtistCard[] }[];
  /** Présentation de l'artiste. */
  about?: string | null;
}

/** Une carte d'album ouverte comme un album trouvé par la recherche. */
export function cardAlbum(c: ArtistCard): Album {
  return { id: c.id, title: c.title, artist: c.artist ?? "", year: c.year ?? null, type: c.type ?? null, thumbnail: c.thumbnail };
}

/** Album trouvé par la recherche (YouTube Music). */
export interface Album {
  id: string;
  title: string;
  artist: string;
  year: string | null;
  /** « EP », « Single »… ; null pour un album. */
  type: string | null;
  thumbnail: string | null;
}

export interface AlbumPage {
  title: string;
  artist: string;
  year: string | null;
  thumbnail: string | null;
  /** Liste de lecture de l'album (le lire en entier, dans l'ordre). */
  playlistId: string | null;
  tracks: Track[];
}

export interface Playlist {
  id: string;
  playlistId: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
}

export interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  /** Chaque artiste séparément, avec sa page (pont 7 et plus). */
  artists?: ArtistRef[];
  /** Suite automatique (titres proches ajoutés quand la file s'arrête), pont 7 et plus. */
  auto?: boolean;
  duration: string | null;
  thumbnail: string | null;
  selected: boolean;
  playlistId: string | null;
  index: number | null;
}

/** Paroles d'un titre : une ligne vide sépare deux couplets. */
export interface Lyrics {
  lines: string[];
  /** « Source : Musixmatch » : affichée telle que YouTube Music la donne. */
  source: string | null;
  /**
   * Paroles synchronisées (pont 1.0.4 et plus) : l'instant où chaque ligne commence, en ms,
   * une valeur par ligne. Absent quand YouTube Music ne donne pas d'horaires (clips, certains
   * titres) : le texte défile alors à un rythme estimé.
   */
  times?: number[] | null;
}

/** Les horaires sont-ils utilisables ? (un par ligne, croissants) */
export function lyricsSynced(lyrics: Lyrics): lyrics is Lyrics & { times: number[] } {
  const t = lyrics.times;
  return Array.isArray(t) && t.length > 0 && t.length === lyrics.lines.length && t.every((v, i) => Number.isFinite(v) && (i === 0 || v >= t[i - 1]));
}

/**
 * Ligne chantée à l'instant `positionMs` : la dernière dont l'horaire est passé. -1 avant la
 * première (introduction). `leadMs` avance un peu l'affichage : l'œil lit avant l'oreille.
 */
export function lyricsLineAt(times: readonly number[], positionMs: number, leadMs = 180): number {
  const at = positionMs + leadMs;
  let low = 0, high = times.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= at) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * Radio d'un titre : la liste sans fin que YouTube Music compose à partir de lui
 * (le titre lui-même, puis des titres proches).
 */
export function radioOf(videoId: string): string {
  return `RDAMVM${videoId}`;
}

/** Ce qu'on a lancé en dernier (playlist, album) : proposé quand rien ne joue. */
export interface Launch {
  playlistId: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
}

/** Lancements gardés pour le démarrage rapide. */
export const MAX_LAUNCHES = 3;

/** Ajoute un lancement en tête, sans doublon ; les plus anciens sortent. */
export function pushLaunch(list: Launch[], launch: Launch): Launch[] {
  return [launch, ...list.filter((l) => l.playlistId !== launch.playlistId)].slice(0, MAX_LAUNCHES);
}

/** Lancements relus du stockage : tout ce qui n'a pas la bonne forme est écarté. */
export function parseLaunches(raw: string | null): Launch[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Launch => !!x && typeof x.playlistId === "string" && !!x.playlistId && typeof x.title === "string" && !!x.title)
      .map((x) => ({ playlistId: x.playlistId, title: x.title, subtitle: typeof x.subtitle === "string" ? x.subtitle : "", thumbnail: typeof x.thumbnail === "string" ? x.thumbnail : null }))
      .slice(0, MAX_LAUNCHES);
  } catch {
    return [];
  }
}

/**
 * Où en est le défilement des paroles (0 à 1) pour une position dans le titre. YouTube Music
 * ne donne pas l'heure de chaque ligne : on suppose une courte introduction et une fin
 * instrumentale, et le texte avance régulièrement entre les deux. C'est un repère, pas un
 * karaoké ; dès qu'on fait défiler soi-même, le suivi s'arrête.
 */
export function lyricsProgress(positionMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const p = positionMs / durationMs;
  return Math.max(0, Math.min(1, (p - 0.07) / 0.83));
}

/** Pas d'un déplacement dans le titre au clavier ou à la manette (ms). */
export const SEEK_STEP_MS = 5000;

/** Nouvelle position après `steps` pas (négatifs : en arrière), bornée au titre. */
export function seekBy(positionMs: number, steps: number, durationMs: number): number {
  const max = durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(max, Math.round(positionMs + steps * SEEK_STEP_MS)));
}

// ——— Fondus entre les titres ———
// Fondu enchaîné : le titre suivant démarre pendant que l'autre finit. Le lecteur de YouTube Music
// n'en joue qu'un à la fois ; le pont (`bridge.js`) charge donc un second lecteur caché, « l'écho »,
// qui finit l'ancien titre pendant que le lecteur principal monte avec le suivant. Quand l'écho ne
// peut pas servir (publicités, compte qui refuse deux lectures), le pont fait un fondu simple :
// baisse, suivant lancé un peu avant la fin, montée. Ici : les réglages, les courbes et le
// découpage d'une durée ; le pont ne fait qu'appliquer ce plan à la position des titres.

/** Durée de fondu la plus longue (s). 0 : désactivé. */
export const FADE_MAX_S = 12;
/** Fondu court d'un passage manuel (suivant, précédent, autre titre), en ms. */
export const FADE_QUICK_MS = 250;
/** Fin de titre sautée au plus par l'enchaînement anticipé (ms). */
export const FADE_CUT_MAX_MS = 2000;
/** Transitions réglées à part gardées au plus (les plus anciennes sortent). */
export const MAX_TRANSITIONS = 100;

export interface FadeSettings {
  /** Durée générale du fondu (s) ; 0 : désactivé. */
  seconds: number;
  /** Transitions réglées à part : titre qui finit → { titre qui suit, durée (0 : aucun fondu) }. */
  pairs: Record<string, { to: string; seconds: number }>;
}

export const NO_FADE: FadeSettings = { seconds: 0, pairs: {} };

/** Durée de fondu valide : un nombre entier de secondes, de 0 à `FADE_MAX_S`. */
export function clampFade(seconds: unknown): number {
  const n = Math.round(Number(seconds));
  return Number.isFinite(n) ? Math.max(0, Math.min(FADE_MAX_S, n)) : 0;
}

/** Réglages relus du stockage : tout ce qui n'a pas la bonne forme est écarté. */
export function parseFade(raw: string | null): FadeSettings {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (!v || typeof v !== "object") return NO_FADE;
    const { seconds, pairs } = v as { seconds?: unknown; pairs?: unknown };
    const kept: FadeSettings["pairs"] = {};
    if (pairs && typeof pairs === "object") {
      for (const [from, p] of Object.entries(pairs as Record<string, { to?: unknown; seconds?: unknown } | null>).slice(-MAX_TRANSITIONS)) {
        if (from && p && typeof p.to === "string" && p.to) kept[from] = { to: p.to, seconds: clampFade(p.seconds) };
      }
    }
    return { seconds: clampFade(seconds), pairs: kept };
  } catch {
    return NO_FADE;
  }
}

/**
 * Courbe d'un fondu : gain (0 à 1) pour un avancement `x` de 0 (silence) à 1 (plein volume).
 * Le volume du lecteur est une amplitude, que l'oreille n'entend pas en ligne droite : une
 * rampe droite paraît tomber d'un coup à la fin. Au carré, la baisse s'entend régulière.
 */
export function fadeCurve(x: number): number {
  const c = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  return c * c;
}

/** La courbe en `steps` segments, telle qu'envoyée au pont (qui relie les points). */
export function fadeCurveTable(steps = 16): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(fadeCurve(i / steps) * 10000) / 10000);
}

/**
 * Courbe du fondu enchaîné : gain du titre qui arrive pour un avancement `x` de 0 à 1 ; le titre qui
 * part suit la même courbe à rebours (`crossCurve(1 - x)`). Sinus et cosinus : la somme des
 * puissances (carrés des gains) reste à 1, le volume perçu ne creuse pas au milieu.
 */
export function crossCurve(x: number): number {
  const c = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  return Math.sin((c * Math.PI) / 2);
}

/** La courbe du fondu enchaîné en `steps` segments, telle qu'envoyée au pont. */
export function crossCurveTable(steps = 32): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(crossCurve(i / steps) * 10000) / 10000);
}

/**
 * Découpage d'un fondu (ms). Fondu enchaîné : `overlap`, le temps où les deux titres jouent
 * ensemble. Fondu simple (repli) : sortie du titre qui finit, fin sautée, entrée du suivant.
 */
export interface FadePlan {
  overlap: number;
  out: number;
  into: number;
  cut: number;
}

/**
 * Plan d'un fondu de `seconds` secondes. Enchaîné : les deux titres jouent ensemble toute la
 * durée. Repli : la moitié pour la sortie, la moitié pour l'entrée, et le titre suivant lancé un
 * peu avant la fin (un quart de la durée, 2 s au plus). Null : pas de fondu.
 */
export function fadePlan(seconds: number): FadePlan | null {
  const total = clampFade(seconds) * 1000;
  if (!total) return null;
  return { overlap: total, out: total / 2, into: total / 2, cut: Math.min(total / 4, FADE_CUT_MAX_MS) };
}

/** Durée propre à la transition `from` → `to` ; null : elle suit le réglage général. */
export function transitionFade(settings: FadeSettings, from: string, to: string): number | null {
  const p = settings.pairs[from];
  return p && p.to === to ? p.seconds : null;
}

/** Règle la transition `from` → `to` (null : la rend au réglage général). */
export function setTransitionFade(settings: FadeSettings, from: string, to: string, seconds: number | null): FadeSettings {
  const { [from]: _old, ...rest } = settings.pairs;
  if (seconds === null) return { ...settings, pairs: rest };
  // remise en queue : la plus récemment réglée sort en dernier
  const pairs = Object.fromEntries([...Object.entries(rest), [from, { to, seconds: clampFade(seconds) }] as const].slice(-MAX_TRANSITIONS));
  return { ...settings, pairs };
}

/**
 * Valeur suivante (`dir` 1) ou précédente (-1) du réglage. Général : 0 (désactivé) à 12 s.
 * Transition (`own`) : d'abord null (suit le réglage général), puis 0 (aucun fondu) à 12 s.
 */
export function stepFade(value: number | null, dir: 1 | -1, own = false): number | null {
  if (value === null) return dir > 0 ? 0 : null;
  const next = clampFade(value) + dir;
  if (next < 0) return own ? null : 0;
  return Math.min(FADE_MAX_S, next);
}

/**
 * État du fondu enchaîné rendu par le pont : « ok », ou la raison du repli sur le fondu simple.
 * « compte » : YouTube Music a mis une lecture en pause quand la seconde a démarré ; « pub » : le
 * second lecteur reçoit des publicités ; « indisponible » : il n'a pas pu se charger.
 */
export type CrossStatus = "ok" | "compte" | "pub" | "indisponible";

/** Note du panneau quand le fondu enchaîné se replie ; null : rien à dire. */
export function crossNote(status: CrossStatus | null | undefined): string | null {
  if (status === "compte") return "Fondu simple : ce compte ne permet qu’une lecture à la fois.";
  if (status === "pub") return "Fondu simple : les publicités empêchent le fondu enchaîné.";
  if (status === "indisponible") return "Fondu simple : le second lecteur n’a pas pu démarrer.";
  return null;
}

/** Ce que le pont reçoit : tout est déjà calculé, il n'a plus qu'à suivre la position. */
export interface FadeConfig {
  quick: number;
  /** Fondu enchaîné demandé (le pont se replie seul sur le fondu simple s'il ne peut pas le faire). */
  cross: boolean;
  /** Courbe du fondu enchaîné (`crossCurve`) ; `curve` : celle du fondu simple. */
  rise: number[];
  curve: number[];
  base: FadePlan | null;
  pairs: Record<string, { to: string; plan: FadePlan | null }>;
}

/** Réglages → commande `fade` du pont. Null : aucun fondu nulle part (le pont s'endort). */
export function fadeConfig(settings: FadeSettings): FadeConfig | null {
  const base = fadePlan(settings.seconds);
  const pairs: FadeConfig["pairs"] = {};
  let any = !!base;
  for (const [from, p] of Object.entries(settings.pairs)) {
    const plan = fadePlan(p.seconds);
    // sans fondu général, une transition « aucun fondu » ne change rien : inutile de l'envoyer
    if (!plan && !base) continue;
    pairs[from] = { to: p.to, plan };
    if (plan) any = true;
  }
  return any ? { quick: FADE_QUICK_MS, cross: true, rise: crossCurveTable(), curve: fadeCurveTable(), base, pairs } : null;
}

export interface MusicState {
  now: NowPlaying | null;
  /** Heure de l'instantané (ms) : la position avance d'elle-même entre deux lectures. */
  at: number;
  /** Un compte YouTube Music a déjà été connecté sur ce PC. */
  youtube: boolean;
}

export type MusicAction = "toggle" | "play" | "pause" | "next" | "prev" | "seek" | "volume" | "like" | "shuffle" | "repeat";

const ytm = <T>(cmd: string, arg?: unknown) => invoke<T>("music_ytm_call", { cmd, arg: arg ?? null });

/** Jeton de page suivante d'une playlist (rendu tel quel par le pont). */
export interface PageToken { token: string; legacy?: boolean }

/** Pages lues au plus par playlist (comme le pont) : environ 1 000 titres. */
const MAX_PAGES = 10;

/**
 * Titres d'une playlist, page par page : `onTracks` reçoit la liste complète à chaque page
 * ajoutée (la première s'affiche aussitôt). Un pont plus ancien, sans `playlistPage`, rend
 * tout d'un coup.
 */
export async function loadPlaylist(id: string, onTracks: (tracks: Track[], done: boolean) => void, alive: () => boolean = () => true): Promise<Track[]> {
  let page: { tracks: Track[]; next: PageToken | null };
  try {
    page = await music.playlistPage(id);
  } catch (e) {
    if (e !== "commande-inconnue") throw e;
    const all = await music.playlist(id);
    onTracks(all, true);
    return all;
  }
  const seen = new Set(page.tracks.map((t) => t.videoId));
  let all = page.tracks;
  onTracks(all, !page.next);
  for (let n = 1; page.next && n < MAX_PAGES && alive(); n++) {
    page = await music.playlistPage(id, page.next);
    const more = page.tracks.filter((t) => !seen.has(t.videoId));
    if (!more.length) break;
    more.forEach((t) => seen.add(t.videoId));
    all = [...all, ...more];
    onTracks(all, !page.next);
  }
  onTracks(all, true);
  return all;
}

export const music = {
  state: () => invoke<MusicState>("music_state"),
  control: (action: MusicAction, value?: number) => invoke<MusicState>("music_control", { action, value }),
  close: () => invoke("music_close"),
  /** Montre la fenêtre YouTube Music (connexion Google). */
  connect: () => invoke("music_ytm_open", { visible: true }),
  search: (query: string) => ytm<Track[]>("search", { query, kind: "songs" }),
  /**
   * Vidéos (sons de fans, extraits, remix…). Un pont plus ancien (plugin 1.0.4 et avant) ne
   * connaît pas ce filtre et rend les titres : ce double est écarté.
   */
  searchVideos: async (query: string) => {
    const [videos, songs] = await Promise.all([ytm<Track[]>("search", { query, kind: "videos" }), ytm<Track[]>("search", { query, kind: "songs" }).catch(() => [] as Track[])]);
    return sameTracks(videos, songs) ? [] : videos;
  },
  searchArtists: (query: string) => ytm<Artist[]>("search", { query, kind: "artists" }),
  artist: (id: string) => ytm<ArtistPage>("artist", { id }),
  /** Un pont plus ancien (plugin 1.0.1) ne connaît pas les albums et rend des titres : écartés. */
  searchAlbums: (query: string) => ytm<Album[]>("search", { query, kind: "albums" }).then((l) => l.filter((a) => /^MPRE/.test(a.id ?? ""))),
  album: (id: string) => ytm<AlbumPage>("album", { id }),
  playlists: () => ytm<Playlist[]>("playlists"),
  playlist: (id: string) => ytm<Track[]>("playlist", { id }),
  /** Une page de playlist (pont 1.0.1 et plus) : `next` à repasser pour la suivante. */
  playlistPage: (id: string, next?: PageToken | null) => ytm<{ tracks: Track[]; next: PageToken | null }>("playlistPage", next ? { next } : { id }),
  queue: () => ytm<QueueItem[]>("queue"),
  /** Paroles d'un titre (pont 1.0.3 et plus) : null quand YouTube Music n'en a pas. */
  lyrics: (videoId: string) => ytm<Lyrics | null>("lyrics", { videoId }),
  /** Lance un titre, une playlist, ou une playlist à partir d'un titre. */
  play: (item: { videoId?: string; playlistId?: string; index?: number }) => ytm<boolean>("playItem", item),
  /**
   * Fondus entre les titres (pont 5 et plus ; un pont plus ancien rejette « commande-inconnue »).
   * `cross` (pont 6) : « ok » quand le fondu enchaîné est possible, sinon la raison du repli.
   */
  fade: (settings: FadeSettings) => ytm<{ fade: boolean; cross?: CrossStatus | null } | null>("fade", fadeConfig(settings)),
  /**
   * Suite automatique quand la file s'arrête (titres proches, comme « Lecture automatique » de
   * YouTube Music), activée par défaut. Pont 7 et plus ; un pont plus ancien rejette « commande-inconnue ».
   */
  autoplay: (on: boolean) => ytm<{ autoplay: boolean }>("autoplay", { on }),
};

/**
 * Taille de la barre réduite (dessinée pour une police racine de 16 px). Son contenu est en
 * rem et grandit avec l'écran (≈ 23 px en 2560 px logiques) : la barre grandit d'autant,
 * sans jamais rapetisser, sinon le titre n'a plus la place que de quelques lettres.
 */
export function compactSize(rem: number, w = 340, h = 76): { w: number; h: number } {
  const k = Number.isFinite(rem) && rem > 16 ? rem / 16 : 1;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Position par défaut du mini-lecteur : bord droit, à mi-hauteur. */
export const DEFAULT_POSITION = { x: 1, y: 0.5 } as const;
/** Marge entre la carte et les bords de l'écran (px). */
export const SCREEN_MARGIN = 24;

/**
 * Place une carte de taille `w`×`h` dans l'écran `W`×`H` : la position (0 à 1) dit où la
 * carte se trouve dans l'espace libre. Une carte collée à droite s'agrandit vers la gauche,
 * en bas vers le haut, au centre des deux côtés : elle ne sort jamais de l'écran.
 */
export function placeCard(pos: { x: number; y: number }, w: number, h: number, W: number, H: number): { left: number; top: number } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const freeW = Math.max(0, W - 2 * SCREEN_MARGIN - w);
  const freeH = Math.max(0, H - 2 * SCREEN_MARGIN - h);
  return { left: Math.round(SCREEN_MARGIN + clamp(pos.x) * freeW), top: Math.round(SCREEN_MARGIN + clamp(pos.y) * freeH) };
}

/** Position (0 à 1) d'une carte posée à `left`/`top` ; aimantée aux bords et au centre. */
export function positionOf(left: number, top: number, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const freeW = Math.max(1, W - 2 * SCREEN_MARGIN - w);
  const freeH = Math.max(1, H - 2 * SCREEN_MARGIN - h);
  const snap = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    for (const s of [0, 0.5, 1]) if (Math.abs(c - s) < 0.04) return s;
    return Math.round(c * 1000) / 1000;
  };
  return { x: snap((left - SCREEN_MARGIN) / freeW), y: snap((top - SCREEN_MARGIN) / freeH) };
}

/** Les titres qui suivent celui en cours dans la file (au plus `count`). */
export function upNext(queue: QueueItem[], count: number): QueueItem[] {
  const i = queue.findIndex((q) => q.selected);
  return queue.slice(i + 1, i + 1 + count);
}

/** Déplacement du focus dans une grille de `columns` colonnes (1 = liste). */
export function moveFocus(index: number, length: number, columns: number, dir: "up" | "down" | "left" | "right"): number {
  if (length === 0) return 0;
  const step = dir === "up" ? -columns : dir === "down" ? columns : dir === "left" ? (columns > 1 ? -1 : 0) : columns > 1 ? 1 : 0;
  const next = index + step;
  return next < 0 || next >= length ? index : next;
}

/** Position estimée à l'instant `now`. */
export function positionAt(state: MusicState | null, now: number): number {
  const n = state?.now;
  if (!n) return 0;
  const p = n.positionMs + (n.playing ? Math.max(0, now - state.at) : 0);
  return n.durationMs > 0 ? Math.min(p, n.durationMs) : p;
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Deux listes avec les mêmes titres, dans le même ordre (vides : différentes). */
export function sameTracks(a: Track[], b: Track[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((t, i) => t.videoId === b[i].videoId);
}
