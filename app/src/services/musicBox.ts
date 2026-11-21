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
export interface Track {
  videoId: string;
  title: string;
  artist: string;
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

export interface ArtistPage {
  name: string;
  thumbnail: string | null;
  tracks: Track[];
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
  duration: string | null;
  thumbnail: string | null;
  selected: boolean;
  playlistId: string | null;
  index: number | null;
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
  /** Lance un titre, une playlist, ou une playlist à partir d'un titre. */
  play: (item: { videoId?: string; playlistId?: string; index?: number }) => ytm<boolean>("playItem", item),
};

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
