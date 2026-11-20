import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { animate, AnimatePresence, motion, useAnimationFrame, useMotionValue, useSpring, useTransform } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_POSITION, formatTime, loadPlaylist, music, placeCard, positionAt, positionOf, upNext, type Artist, type ArtistPage, type MusicAction, type MusicState, type Playlist, type QueueItem, type Track } from "@/services/musicBox";
import { sound } from "@/services/sound";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PadKeyboard } from "@/components/shell/PadKeyboard";
import { input } from "@/input/InputController";
import { useSettings } from "@/services/settings";
import { Logo } from "./Logo";

const MINI_W = 380;
const BIG_W = 520;
const BIG_H_MAX = 780;
const RECENT_KEY = "ibox.music.recent";
const EASE = [0.22, 1, 0.36, 1] as const;

/** Animations réduites (réglage d'iBox) : tout devient instantané ou presque. */
const reduced = () => document.documentElement.dataset.motion === "reduced";
/** Ressort de la carte : net, sans rebond (position et taille bougent ensemble). */
const CARD_SPRING = { type: "spring", stiffness: 300, damping: 34, mass: 0.9 } as const;

type View = "mini" | "lists" | "queue" | "search";
type Tab = Exclude<View, "mini">;
const ORDER: View[] = ["mini", "lists", "queue", "search"];
const TABS: { value: Tab; label: string; tone: string }[] = [
  { value: "lists", label: "Playlists", tone: "tone-purple" },
  { value: "queue", label: "À suivre", tone: "tone-green" },
  { value: "search", label: "Rechercher", tone: "tone-orange" },
];
type SearchKind = "songs" | "artists";

/** Playlists gardées d'une ouverture du panneau à l'autre. */
let cachedPlaylists: Playlist[] | null = null;
/** Titres des playlists déjà ouvertes : affichés aussitôt, puis relus en arrière-plan. */
const cachedTracks = new Map<string, Track[]>();
/** Lecture en cours par playlist (une seule à la fois, partagée avec le préchargement). */
const loadingTracks = new Map<string, Promise<Track[]>>();

function fetchTracks(id: string, onTracks?: (tracks: Track[]) => void): Promise<Track[]> {
  const running = loadingTracks.get(id);
  if (running) {
    if (onTracks) void running.then(onTracks, () => undefined);
    return running;
  }
  const p = loadPlaylist(id, (tracks) => {
    cachedTracks.set(id, tracks);
    onTracks?.(tracks);
  }).finally(() => loadingTracks.delete(id));
  loadingTracks.set(id, p);
  return p;
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecent(q: string): string[] {
  const list = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* stockage indisponible : l'historique n'est pas gardé */
  }
  return list;
}

/**
 * Music in the Box : mini-lecteur par-dessus le jeu, dans le style de l'overlay de capture
 * d'iBox. La fenêtre couvre tout un écran ; la carte s’y place selon le réglage (fenêtre de
 * réglages) ou en la faisant glisser par le haut, y compris vers un autre écran. Elle
 * s'agrandit pour les playlists, la file « À suivre » et la recherche, sans quitter sa place.
 * Navigation : celle d'iBox (InputController), alimentée par la manette lue en natif.
 */
export function MusicWindow() {
  const [state, setState] = useState<MusicState | null>(null);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<View>("mini");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(cachedPlaylists);
  const [listsError, setListsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ list: Playlist; tracks: Track[] | null } | null>(null);
  const [search, setSearch] = useState<{ query: string; kind: SearchKind; songs: Track[] | null; artists: Artist[] | null; loading: boolean }>({ query: "", kind: "songs", songs: null, artists: null, loading: false });
  const [artist, setArtist] = useState<{ id: string; preview: Artist; page: ArtistPage | null } | null>(null);
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [miniH, setMiniH] = useState(520);
  const [moving, setMoving] = useState<{ left: number; top: number } | null>(null);
  /** Sens de la dernière navigation (1 : on avance, -1 : on revient) : oriente les fondus. */
  const [dir, setDir] = useState<1 | -1>(1);
  const busy = useRef(false);
  const card = useRef<HTMLElement>(null);
  const position = useSettings((s) => s.musicPosition ?? DEFAULT_POSITION);
  const setSetting = useSettings((s) => s.set);
  const stayOpen = useSettings((s) => s.musicStayOpen === true);

  // comme l'overlay de capture : thème clair (où « white » est vraiment blanc) sur un voile sombre
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    return input.attachKeyboard();
  }, []);

  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    void music.state().then(setState).catch(() => undefined);
    const offs = [
      listen<MusicState>("music://state", (e) => setState(e.payload)),
      listen("music://open", () => {
        setError(null);
        setView("mini");
        setDetail(null);
        setArtist(null);
        setOpen(true);
        sound.play("open");
      }),
      listen("music://close-request", () => setOpen(false)),
    ];
    return () => offs.forEach((o) => void o.then((f) => f()));
  }, []);

  const n = state?.now ?? null;
  const youtube = n?.source === "youtube";

  // position à l'instant présent, lue à chaque image par les barres (aucun re-rendu)
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useCallback(() => positionAt(stateRef.current, Date.now()), []);

  // file « À suivre » : relue à chaque changement de titre
  useEffect(() => {
    if (!youtube || !n?.id) return setQueue([]);
    let alive = true;
    void music.queue().then((q) => alive && setQueue(q)).catch(() => alive && setQueue([]));
    return () => {
      alive = false;
    };
  }, [youtube, n?.id]);

  // playlists : chargées à la première ouverture de la vue
  useEffect(() => {
    if (view !== "lists" || playlists || !state?.youtube) return;
    setListsError(null);
    music
      .playlists()
      .then((p) => {
        cachedPlaylists = p;
        setPlaylists(p);
        // « Titres aimés » : la plus ouverte, préparée pendant qu'on regarde la liste
        const liked = p.find((l) => l.id === "LM" || l.id === "VLLM");
        if (liked && !cachedTracks.has(liked.id)) void fetchTracks(liked.id).catch(() => undefined);
      })
      .catch((e) => setListsError(e === "non-connecte" ? "Connectez YouTube Music pour retrouver vos playlists." : "Playlists indisponibles pour le moment."));
  }, [view, playlists, state?.youtube]);

  // hauteur réelle du mini-lecteur (la carte s'y anime) : mesurée dès qu'il apparaît
  const miniObserver = useRef<ResizeObserver | null>(null);
  const measureMini = useCallback((el: HTMLDivElement | null) => {
    miniObserver.current?.disconnect();
    miniObserver.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setMiniH(el.offsetHeight));
    ro.observe(el);
    miniObserver.current = ro;
    setMiniH(el.offsetHeight);
  }, []);
  useEffect(() => () => miniObserver.current?.disconnect(), []);

  const close = useCallback(() => {
    sound.play("back");
    setOpen(false);
  }, []);

  // par défaut, revenir au jeu (Alt+Tab, clic dans une autre fenêtre) referme le lecteur ;
  // « Rester affiché pendant le jeu » le laisse à l'écran
  useEffect(() => {
    if (stayOpen) return;
    const onBlur = () => setOpen(false);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [stayOpen]);

  // « Rester affiché » : B ou Échap au premier niveau rend la main au jeu sans fermer
  const release = useCallback(() => {
    sound.play("back");
    void invoke("music_release").catch(() => undefined);
  }, []);

  const go = useCallback((v: View) => {
    setView((from) => {
      setDir(ORDER.indexOf(v) >= ORDER.indexOf(from) ? 1 : -1);
      return v;
    });
    setDetail(null);
    setArtist(null);
  }, []);

  // focus initial de chaque vue (anneau d'iBox), une fois la vue affichée
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => input.focusInitial(), 260);
    return () => window.clearTimeout(t);
  }, [view, detail?.list.id, artist?.id, open]);

  // Retour : fiche → liste → mini-lecteur → fermeture (ou retour au jeu)
  useEffect(
    () =>
      input.onBack(() => {
        if (artist) {
          setDir(-1);
          setArtist(null);
          return true;
        }
        if (detail) {
          setDir(-1);
          setDetail(null);
          return true;
        }
        if (view !== "mini") {
          go("mini");
          return true;
        }
        if (stayOpen) release();
        else close();
        return "quiet";
      }),
    [artist, close, detail, go, release, stayOpen, view],
  );
  // LB / RB : vue précédente / suivante
  useEffect(
    () =>
      input.onTab((d) => {
        const i = ORDER.indexOf(view) + d;
        if (i < 0 || i >= ORDER.length || (i > 0 && !state?.youtube)) return "quiet";
        go(ORDER[i]);
      }),
    [go, state?.youtube, view],
  );

  const act = useCallback(async (action: MusicAction, value?: number) => {
    if (busy.current && action !== "volume") return;
    busy.current = true;
    setError(null);
    try {
      setState(await music.control(action, value));
    } catch (e) {
      setError(typeof e === "string" ? e : "Action impossible.");
    } finally {
      busy.current = false;
    }
  }, []);

  const play = useCallback(async (item: { videoId?: string; playlistId?: string; index?: number }) => {
    sound.play("select");
    setError(null);
    try {
      await music.play(item);
      // retour au mini-lecteur : le titre lancé s'y affiche
      setDir(-1);
      setView("mini");
      setDetail(null);
      setArtist(null);
      window.setTimeout(() => void music.state().then(setState).catch(() => undefined), 1200);
    } catch {
      setError("Lecture impossible.");
    }
  }, []);

  const openList = useCallback((list: Playlist) => {
    setDir(1);
    // déjà ouverte : affichée tout de suite, puis relue (titres aimés ou retirés entre-temps)
    setDetail({ list, tracks: cachedTracks.get(list.id) ?? null });
    const show = (tracks: Track[]) => setDetail((d) => (d?.list.id === list.id ? { list, tracks } : d));
    fetchTracks(list.id, show).catch(() => setDetail((d) => (d?.list.id === list.id ? { list, tracks: d.tracks ?? [] } : d)));
  }, []);

  const openArtist = useCallback((a: Artist) => {
    setDir(1);
    setArtist({ id: a.id, preview: a, page: null });
    music
      .artist(a.id)
      .then((page) => setArtist((x) => (x?.id === a.id ? { ...x, page } : x)))
      .catch(() => setArtist((x) => (x?.id === a.id ? { ...x, page: { name: a.name, thumbnail: a.thumbnail, tracks: [] } } : x)));
  }, []);

  // recherche pendant la frappe, après une courte pause ; titres et artistes en parallèle
  const searchSeq = useRef(0);
  const runSearch = useCallback((q: string) => {
    const text = q.trim();
    if (!text) return setSearch((s) => ({ ...s, songs: null, artists: null, loading: false }));
    const id = ++searchSeq.current;
    setSearch((s) => ({ ...s, loading: true }));
    void Promise.all([music.search(text).catch(() => [] as Track[]), music.searchArtists(text).catch(() => [] as Artist[])]).then(([songs, artists]) => {
      if (id === searchSeq.current) setSearch((s) => ({ ...s, songs, artists, loading: false }));
    });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => runSearch(search.query), 350);
    return () => window.clearTimeout(t);
  }, [search.query, runSearch]);

  // manette (lue en natif) → mêmes actions que dans iBox
  useEffect(() => {
    const off = listen<string>("music://pad", (e) => {
      document.documentElement.dataset.input = "keyboard";
      const a = e.payload;
      const el = document.activeElement as HTMLElement | null;
      if (a === "ok" && el instanceof HTMLInputElement && el.type !== "range") {
        window.dispatchEvent(new CustomEvent("ibox:pad-keyboard", { detail: el }));
        return;
      }
      // éléments réglables (volume, position) : gauche / droite les règlent
      const capture = el?.closest<HTMLElement>("[data-nav-capture]")?.dataset.navCapture ?? "";
      if ((a === "left" || a === "right") && capture.includes("x")) {
        el?.dispatchEvent(new KeyboardEvent("keydown", { key: a === "left" ? "ArrowLeft" : "ArrowRight", bubbles: true }));
        return;
      }
      if (a === "x") {
        if (n) void act("toggle");
        return;
      }
      if (a === "y") {
        if (view === "mini" && youtube) void act("like");
        else if (detail) void play({ playlistId: detail.list.playlistId });
        return;
      }
      const map: Record<string, Parameters<typeof input.dispatch>[0]> = { up: "up", down: "down", left: "left", right: "right", ok: "confirm", back: "back", lb: "tabPrev", rb: "tabNext" };
      if (map[a]) input.dispatch(map[a]);
    });
    return () => void off.then((f) => f());
  }, [act, detail, n, play, view, youtube]);

  const tint = useDominantColor(n?.artwork ?? null);
  const expanded = view !== "mini";
  const W = expanded ? BIG_W : MINI_W;
  const H = expanded ? Math.min(BIG_H_MAX, screen.h - 48) : miniH;
  const place = moving ?? placeCard(position, W, H, screen.w, screen.h);

  // déplacer la carte par le haut ; vers un autre écran, la fenêtre suit la souris
  const startMove = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, input, [role=tab], [role=slider]")) return;
    const box = card.current?.getBoundingClientRect();
    if (!box) return;
    const grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let moved = false;
    let following = false;
    const onMove = (ev: PointerEvent) => {
      moved = true;
      const W0 = window.innerWidth, H0 = window.innerHeight;
      // la souris sort de l'écran : la fenêtre du lecteur passe sur l'écran voisin
      if (!following && (ev.clientX < 1 || ev.clientY < 1 || ev.clientX > W0 - 2 || ev.clientY > H0 - 2)) {
        following = true;
        void invoke<string | null>("music_follow_cursor")
          .then((name) => name && setSetting("musicMonitor", name))
          .finally(() => window.setTimeout(() => (following = false), 150));
      }
      setMoving({ left: Math.max(0, Math.min(W0 - W, ev.clientX - grab.x)), top: Math.max(0, Math.min(H0 - H, ev.clientY - grab.y)) });
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (moved) {
        const W0 = window.innerWidth, H0 = window.innerHeight;
        setSetting("musicPosition", positionOf(ev.clientX - grab.x, ev.clientY - grab.y, W, H, W0, H0));
      }
      setMoving(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // clé et sens du contenu (pour des fondus orientés)
  const contentKey = view === "mini" ? "mini" : view === "search" && artist ? `artist-${artist.id}` : view === "lists" && detail ? `list-${detail.list.id}` : view;

  return (
    <div
      data-nav-root
      data-nav-main
      className="fixed inset-0 overflow-hidden text-white select-none"
      // un clic à côté de la carte rend la main au jeu
      onPointerDown={(e) => !stayOpen && e.target === e.currentTarget && close()}
    >
      <AnimatePresence onExitComplete={() => void music.close()}>
        {open && (
          <motion.section
            key="card"
            ref={card}
            aria-label="Music in the Box"
            initial={{ opacity: 0, scale: 0.94, y: -20, left: place.left, top: place.top, width: W, height: H }}
            animate={{ opacity: 1, scale: 1, y: 0, left: place.left, top: place.top, width: W, height: H }}
            exit={{ opacity: 0, scale: 0.96, y: -14, transition: { duration: 0.2, ease: EASE } }}
            transition={moving || reduced() ? { duration: 0 } : { ...CARD_SPRING, opacity: { duration: 0.25 } }}
            className="absolute overflow-hidden rounded-[2rem] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 will-change-[width,height,transform]"
          >
            <Glass card={card} tint={tint} />
            <ReportLayout card={card} stayOpen={stayOpen} />
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              {view === "mini" ? (
                <Fade key="mini" dir={dir}>
                  <div ref={measureMini} className="flex flex-col p-5">
                    <Header app={n?.app ?? null} playing={!!n?.playing} onClose={close} onMove={startMove} />
                    {n ? <Player n={n} tint={tint} live={live} onSeek={(ms) => void act("seek", ms)} act={act} /> : <Empty youtube={!!state?.youtube} loading={!state} />}
                    {state?.youtube && (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {TABS.map((t, i) => (
                          <Tile key={t.value} view={t.value} label={t.label} tone={t.tone} index={i} onClick={() => go(t.value)} disabled={t.value === "queue" && !youtube} />
                        ))}
                      </div>
                    )}
                  </div>
                </Fade>
              ) : (
                <Fade key="big" dir={dir} fill>
                  <div className="flex h-full flex-col p-5">
                    <div className="-mx-5 -mt-5 cursor-grab px-5 pt-2.5 pb-1 active:cursor-grabbing" onPointerDown={startMove} title="Déplacer">
                      <Grip />
                      <div className="flex items-center gap-2">
                        <RoundButton icon="back" label="Revenir au lecteur" onClick={() => go("mini")} />
                        <div className="flex flex-1 justify-center">
                          <IconTabs value={view as Tab} onChange={(v) => go(v)} />
                        </div>
                        <RoundButton icon="x" label="Fermer" onClick={close} />
                      </div>
                    </div>
                    {n && <NowBar n={n} live={live} onToggle={() => void act("toggle")} />}
                    <div className="relative mt-4 flex min-h-0 flex-1 flex-col">
                      <AnimatePresence mode="wait" initial={false} custom={dir}>
                        <Fade key={contentKey} dir={dir} fill>
                          {view === "queue" ? (
                            <QueueList items={upNext(queue, 50)} current={n} onPlay={(q) => void play({ videoId: q.videoId, playlistId: q.playlistId ?? undefined, index: q.index ?? undefined })} />
                          ) : view === "search" ? (
                            artist ? (
                              <ArtistDetail artist={artist} current={n} onPlay={(t) => void play({ videoId: t.videoId })} />
                            ) : (
                              <Search
                                search={search}
                                current={n}
                                onQuery={(query) => setSearch((s) => ({ ...s, query }))}
                                onKind={(kind) => setSearch((s) => ({ ...s, kind }))}
                                onSubmit={() => runSearch(search.query)}
                                onPlay={(t) => void play({ videoId: t.videoId })}
                                onArtist={openArtist}
                              />
                            )
                          ) : detail ? (
                            <PlaylistDetail detail={detail} current={n} onPlay={play} />
                          ) : listsError ? (
                            <p className="py-10 text-center text-[0.9rem] font-bold text-white/55">{listsError}</p>
                          ) : !playlists ? (
                            <Loading grid />
                          ) : (
                            <Scroll>
                              <div className="grid grid-cols-2 gap-3" data-nav-group="music-lists">
                                {playlists.map((p, i) => (
                                  <Card key={p.id} list={p} index={i} onClick={() => openList(p)} />
                                ))}
                              </div>
                            </Scroll>
                          )}
                        </Fade>
                      </AnimatePresence>
                    </div>
                  </div>
                </Fade>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute right-5 bottom-5 left-5 rounded-xl bg-[#E8433A]/30 px-3 py-2 text-[0.85rem] font-bold backdrop-blur-md"
                  role="status"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
      <PadKeyboard />
    </div>
  );
}

// ——— Verre dépoli, position de la carte ———

/** Transmet à iBox la place de la carte (« Rester affiché » : les clics à côté vont au jeu). */
function ReportLayout({ card, stayOpen }: { card: RefObject<HTMLElement | null>; stayOpen: boolean }) {
  const last = useRef("");
  useAnimationFrame(() => {
    const c = card.current;
    const r = c?.getBoundingClientRect();
    const rect = r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null;
    const key = `${stayOpen}|${rect?.join(",") ?? ""}`;
    if (key === last.current) return;
    last.current = key;
    void invoke("music_layout", { stayOpen, card: rect, scale: window.devicePixelRatio || 1 }).catch(() => undefined);
  });
  return null;
}

/**
 * Le jeu derrière la carte, flouté : capture de la zone de l'écran (la fenêtre s'exclut
 * elle-même de la capture), relue quatre fois par seconde et recalée à chaque image sur
 * la position de la carte, qui bouge pendant les animations.
 */
/**
 * Floute la capture (déjà réduite par le natif) une fois, dans un petit canevas. Un flou CSS
 * sur une image plein écran est dessiné en tuiles par Chromium et laisse des raccords
 * (une barre horizontale dans le verre) ; il coûte aussi bien plus à la carte graphique.
 */
async function preBlur(img: HTMLImageElement): Promise<string> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canevas indisponible");
  // marge débordante : les bords ne s'assombrissent pas sous le flou
  const m = 16;
  ctx.filter = "blur(7px)";
  ctx.drawImage(img, -m, -m, w + 2 * m, h + 2 * m);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("flou impossible");
  return URL.createObjectURL(blob);
}

/** Fondu entre deux images du fond (ms) : le jeu bouge derrière le verre sans à-coups. */
const GLASS_FADE = 450;

function Glass({ card, tint }: { card: RefObject<HTMLElement | null>; tint: string }) {
  const img = useRef<HTMLDivElement>(null);
  // trois couches au plus : chaque nouvelle image apparaît en fondu par-dessus les précédentes
  const [layers, setLayers] = useState<{ src: string; id: number }[]>([]);
  const seq = useRef(0);
  const setSrc = useCallback((src: string) => {
    const id = ++seq.current;
    setLayers((l) => [...l.slice(-2), { src, id }]);
  }, []);

  useEffect(() => {
    let alive = true;
    let current: string | null = null;
    void (async () => {
      while (alive) {
        try {
          const bytes = await invoke<ArrayBuffer>("music_backdrop");
          const raw = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          const probe = new Image();
          probe.src = raw;
          await probe.decode().finally(() => URL.revokeObjectURL(raw));
          const next = await preBlur(probe);
          if (!alive) {
            URL.revokeObjectURL(next);
            break;
          }
          setSrc(next);
          const old = current;
          current = next;
          // l'ancienne reste dessous le temps du fondu (et d'une image de plus)
          if (old) window.setTimeout(() => URL.revokeObjectURL(old), GLASS_FADE * 3);
        } catch {
          /* capture impossible : le voile seul reste */
        }
        await new Promise((r) => window.setTimeout(r, 250));
      }
    })();
    return () => {
      alive = false;
    };
  }, [setSrc]);

  useAnimationFrame(() => {
    const c = card.current;
    const i = img.current;
    if (!c || !i) return;
    const r = c.getBoundingClientRect();
    i.style.transform = `translate(${-r.left}px, ${-r.top}px)`;
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-clip rounded-[inherit]">
      <div ref={img} className="absolute top-0 left-0 h-screen w-screen">
        {layers.map((l, i) => (
          <img
            key={l.id}
            src={l.src}
            alt=""
            data-glass
            className="absolute inset-0 h-full w-full max-w-none"
            style={i > 0 ? { animation: `glass-in ${GLASS_FADE}ms ease-out both` } : undefined}
          />
        ))}
      </div>
      {/* voile de l'overlay de capture d'iBox, allégé, et une touche de la couleur de la pochette :
          une couleur unie (elle s'anime) découpée en halo, un dégradé ne s'animant pas */}
      <div className="absolute inset-0 bg-[rgba(20,24,40,0.64)]" />
      <div
        className="absolute inset-0 opacity-45 transition-[background-color] duration-1000 ease-out"
        style={{ backgroundColor: tint, maskImage: "radial-gradient(120% 70% at 50% 0%, #000, transparent 70%)" }}
      />
      <style>{`@keyframes glass-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

// ——— Mise en page ———

/** Fondu orienté : on avance → le contenu arrive de la droite ; on revient → de la gauche. */
const fadeVariants = {
  enter: (d: 1 | -1) => (reduced() ? { opacity: 0 } : { opacity: 0, x: 22 * d, scale: 0.985, filter: "blur(4px)" }),
  center: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.32, ease: EASE } },
  exit: (d: 1 | -1) => (reduced() ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: -14 * d, scale: 0.99, filter: "blur(3px)", transition: { duration: 0.16, ease: EASE } }),
};

function Fade({ children, fill, dir }: { children: ReactNode; fill?: boolean; dir: 1 | -1 }) {
  return (
    <motion.div custom={dir} variants={fadeVariants} initial="enter" animate="center" exit="exit" className={`relative ${fill ? "flex h-full min-h-0 flex-1 flex-col" : ""}`}>
      {children}
    </motion.div>
  );
}

/** Apparition en cascade, très rapide et une seule fois (les 12 premiers éléments). */
function rise(index: number) {
  return reduced()
    ? {}
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: EASE, delay: Math.min(index, 12) * 0.025 } };
}

/** Zone qui défile ; la marge intérieure laisse la place à l'anneau de focus d'iBox. */
function Scroll({ children }: { children: ReactNode }) {
  return <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none]">{children}</div>;
}

function Header({ app, playing, onClose, onMove }: { app: string | null; playing: boolean; onClose: () => void; onMove: (e: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    // tout le haut de la carte, d'un bord à l'autre, sert de poignée
    <div className="-mx-5 -mt-5 cursor-grab px-5 pt-2.5 pb-1 active:cursor-grabbing" onPointerDown={onMove} title="Déplacer">
      <Grip />
      <div className="flex items-center gap-2.5">
        <Logo size={30} playing={playing} />
        <div className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-white/55">{app ?? ""}</div>
        <RoundButton icon="x" label="Fermer" onClick={onClose} />
      </div>
    </div>
  );
}

/** Petite barre de saisie : on comprend qu'on peut attraper la carte pour la déplacer. */
function Grip() {
  return <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-white/25" />;
}

function RoundButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" data-focusable onClick={onClick} aria-label={label} title={label} className="ibox-focusable grid size-10 flex-none place-items-center rounded-full bg-white/10 transition-[background-color,transform] duration-150 [--ring-radius:999px] hover:bg-white/20 active:scale-90">
      <Icon name={icon} size="1.1rem" />
    </button>
  );
}

/** Accès rapide en icône, coloré comme les tons d'iBox. */
function Tile({ view, label, tone, index, onClick, disabled }: { view: Tab; label: string; tone: string; index: number; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      data-focusable
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => {
        sound.play("select");
        onClick();
      }}
      {...rise(index + 2)}
      whileHover={reduced() ? undefined : { y: -2 }}
      whileTap={{ scale: 0.92 }}
      className={`ibox-focusable ${tone} grid h-12 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--tone)_34%,transparent)] text-[color-mix(in_srgb,var(--tone)_40%,#ffffff)] shadow-[inset_0_-3px_0_color-mix(in_srgb,var(--tone)_45%,transparent)] [--ring-radius:1rem] hover:bg-[color-mix(in_srgb,var(--tone)_50%,transparent)] disabled:opacity-40`}
    >
      <ViewIcon view={view} size={22} />
    </motion.button>
  );
}

/** Icônes des vues : playlists, file « À suivre », recherche. */
function ViewIcon({ view, size }: { view: Tab; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {view === "lists" ? (
        <>
          <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
          <path d="M14 21v-6.5l6-1.5" />
          <circle cx="12.6" cy="20.2" r="1.6" fill="currentColor" />
        </>
      ) : view === "queue" ? (
        <>
          <path d="M3 6h12M3 12h12M3 18h7" />
          <path d="M15 15.5v6l5-3z" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.6-4.6" />
        </>
      )}
    </svg>
  );
}

/** Onglets en icônes, pastille qui glisse (comme le sélecteur d'iBox). */
function IconTabs<T extends string>({ value, onChange, items, small }: { value: T; onChange: (v: T) => void; items?: { value: T; label: string; tone: string; icon: ReactNode }[]; small?: boolean }) {
  const list = items ?? (TABS.map((t) => ({ ...t, icon: <ViewIcon view={t.value} size={20} /> })) as unknown as { value: T; label: string; tone: string; icon: ReactNode }[]);
  const id = small ? "music-subtab" : "music-tab";
  return (
    <div role="tablist" className="inline-flex rounded-full bg-white/10 p-1">
      {list.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-focusable
            aria-selected={active}
            aria-label={t.label}
            title={t.label}
            onClick={() => {
              if (!active) {
                sound.play("toggle");
                onChange(t.value);
              }
            }}
            className={`ibox-focusable ${t.tone} relative grid place-items-center rounded-full transition-[color,transform] duration-150 [--ring-radius:999px] active:scale-90 ${small ? "h-9 w-12" : "h-10 w-14"} ${active ? "text-white" : "text-white/55 hover:text-white"}`}
          >
            {active && (
              <motion.span
                layoutId={id}
                transition={reduced() ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 36 }}
                className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--tone)_55%,transparent)] shadow-[inset_0_-3px_0_color-mix(in_srgb,var(--tone)_60%,transparent)]"
              />
            )}
            <span className="relative">{t.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

// ——— Lecteur ———

function Player({ n, tint, live, onSeek, act }: {
  n: NonNullable<MusicState["now"]>;
  tint: string;
  live: () => number;
  onSeek: (ms: number) => void;
  act: (a: MusicAction, v?: number) => Promise<void>;
}) {
  return (
    <div className="mt-3 flex flex-col items-center">
      {/* pochette au centre, en grand ; le cœur dans son coin */}
      <motion.div
        className="relative size-[208px] overflow-hidden rounded-[1.6rem] bg-black/30 ring-1 ring-white/15"
        style={{ boxShadow: `0 22px 50px -18px ${tint}` }}
        animate={reduced() ? undefined : { scale: n.playing ? 1 : 0.96 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        <AnimatePresence initial={false}>
          <motion.div key={n.id} initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} className="absolute inset-0">
            <Thumb src={n.artwork} fill />
          </motion.div>
        </AnimatePresence>
        {n.liked != null && <Heart liked={n.liked} onClick={() => void act("like")} />}
      </motion.div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={n.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: EASE }} className="mt-4 w-full min-w-0 text-center">
          <Marquee text={n.title} center className="font-display text-[1.3rem] leading-tight font-semibold" />
          <Marquee text={n.artist} center className="mt-1 text-[0.88rem] font-bold text-white/55" />
        </motion.div>
      </AnimatePresence>

      <div className="mt-4 w-full">
        <LiveProgress live={live} durationMs={n.durationMs} canSeek={n.canSeek} trackKey={n.id} onSeek={onSeek} />
      </div>

      <div className="mt-3 flex w-full items-center justify-between">
        <Toggle label="Lecture aléatoire" active={!!n.shuffle} hidden={n.shuffle == null && n.source !== "youtube"} onClick={() => void act("shuffle")}>
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Toggle>
        <div className="flex items-center gap-3">
          <Control label="Précédent" onClick={() => void act("prev")}>
            <path d="M19 5L9 12l10 7z" fill="currentColor" />
            <path d="M6 5v14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </Control>
          <motion.button
            type="button"
            data-focusable
            data-autofocus
            whileTap={{ scale: 0.88 }}
            onClick={() => {
              sound.play("select");
              void act("toggle");
            }}
            aria-label={n.playing ? "Pause" : "Lecture"}
            title={n.playing ? "Pause" : "Lecture"}
            className="ibox-focusable ibox-btn ibox-btn-primary grid size-14 place-items-center rounded-full [--ring-radius:999px]"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.svg key={n.playing ? "pause" : "play"} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.14 }}>
                {n.playing ? (
                  <>
                    <rect x="6" y="5" width="4" height="14" rx="1.4" fill="currentColor" />
                    <rect x="14" y="5" width="4" height="14" rx="1.4" fill="currentColor" />
                  </>
                ) : (
                  <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
                )}
              </motion.svg>
            </AnimatePresence>
          </motion.button>
          <Control label="Suivant" onClick={() => void act("next")}>
            <path d="M5 5l10 7-10 7z" fill="currentColor" />
            <path d="M18 5v14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </Control>
        </div>
        <Toggle
          label={n.repeat === "one" ? "Répéter le titre" : n.repeat === "all" ? "Répéter la liste" : "Répétition désactivée"}
          active={!!n.repeat && n.repeat !== "none"}
          hidden={n.repeat == null && n.source !== "youtube"}
          badge={n.repeat === "one" ? "1" : undefined}
          onClick={() => void act("repeat")}
        >
          <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Toggle>
      </div>

      {n.volume != null && <VolumeBar value={n.volume} onChange={(v) => void act("volume", v)} />}
    </div>
  );
}

/** Cœur « J'aime » posé dans le coin de la pochette ; petit rebond quand on aime. */
function Heart({ liked, onClick }: { liked: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      data-focusable
      aria-pressed={liked}
      aria-label={liked ? "Retirer des titres aimés" : "J’aime"}
      title={liked ? "Retirer des titres aimés" : "J’aime"}
      whileTap={{ scale: 0.8 }}
      onClick={() => {
        sound.play("select");
        onClick();
      }}
      className="ibox-focusable tone-pink absolute right-2.5 bottom-2.5 grid size-10 place-items-center rounded-full bg-[rgba(20,24,40,0.55)] backdrop-blur-md [--ring-radius:999px] hover:bg-[rgba(20,24,40,0.75)]"
    >
      <motion.svg
        key={String(liked)}
        initial={liked && !reduced() ? { scale: 0.3 } : false}
        animate={{ scale: [null, 1.25, 1] }}
        transition={{ type: "spring", stiffness: 520, damping: 12 }}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={liked ? "#ff8fb8" : "none"}
        stroke={liked ? "#ff8fb8" : "#ffffff"}
        strokeWidth="2.2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
      </motion.svg>
    </motion.button>
  );
}

function Control({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      data-focusable
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.86 }}
      onClick={() => {
        sound.play("select");
        onClick();
      }}
      className="ibox-focusable grid size-11 place-items-center rounded-full bg-white/10 transition-colors [--ring-radius:999px] hover:bg-white/20"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
    </motion.button>
  );
}

function Toggle({ label, active, hidden, badge, onClick, children }: { label: string; active: boolean; hidden?: boolean; badge?: string; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      data-focusable
      aria-label={label}
      aria-pressed={active}
      title={label}
      whileTap={{ scale: 0.85, rotate: active ? 0 : -8 }}
      onClick={() => {
        sound.play("toggle");
        onClick();
      }}
      className={`ibox-focusable relative grid size-10 place-items-center rounded-full transition-colors duration-200 [--ring-radius:999px] ${hidden ? "invisible" : ""} ${active ? "bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-[var(--accent)]" : "text-white/55 hover:bg-white/10 hover:text-white"}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
      <AnimatePresence>
        {badge && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 520, damping: 18 }} className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-[var(--accent)] text-[0.6rem] font-extrabold text-[var(--ibox-on-accent)]">
            {badge}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * Volume : le remplissage suit la main avec un ressort ; tiré au-delà du maximum (ou du
 * minimum), la barre s'étire comme un élastique et revient en rebondissant ; une montée
 * brusque au maximum « cogne » la butée. Les ondes du haut-parleur suivent le niveau.
 */
function VolumeBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<number | null>(null);
  const shown = local ?? value;
  const level = useSpring(shown / 100, { stiffness: 340, damping: 19, mass: 0.6 });
  const stretch = useMotionValue(1);
  const [origin, setOrigin] = useState<"left" | "right">("left");
  const [knock, setKnock] = useState(0);
  const prev = useRef(shown);
  const lastSend = useRef(0);
  const pending = useRef<number | null>(null);
  const release = useRef<number | undefined>(undefined);

  useEffect(() => {
    level.set(shown / 100);
    // arrivée brusque en butée : la barre cogne et rebondit, le haut-parleur tremble
    if ((shown === 100 && prev.current < 90) || (shown === 0 && prev.current > 10)) {
      if (!reduced()) {
        setOrigin(shown === 0 ? "right" : "left");
        void animate(stretch, [1, 1.07, 0.985, 1], { duration: 0.5, ease: "easeOut" });
      }
      setKnock((k) => k + 1);
    }
    prev.current = shown;
  }, [shown, level, stretch]);

  const fill = useTransform(level, (v) => `scaleX(${Math.max(0, v)})`);
  const knob = useTransform(level, (v) => `${Math.max(0, Math.min(1, v)) * 100}%`);

  const send = (v: number, force = false) => {
    pending.current = v;
    const now = Date.now();
    if (force || now - lastSend.current > 90) {
      lastSend.current = now;
      pending.current = null;
      onChange(v);
    }
  };
  const fromPointer = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return (x - r.left) / r.width;
  };
  const set = (v: number) => {
    window.clearTimeout(release.current);
    setLocal(v);
    send(v);
  };
  const handle = (clientX: number) => {
    const raw = fromPointer(clientX);
    const over = raw > 1 ? raw - 1 : raw < 0 ? raw : 0;
    // élastique : plus on tire, moins ça s'étire
    if (over !== 0 && !reduced()) {
      setOrigin(over > 0 ? "left" : "right");
      stretch.set(1 + 0.07 * (1 - Math.exp(-Math.abs(over) * 5)));
    } else stretch.set(1);
    set(Math.round(Math.max(0, Math.min(1, raw)) * 100));
  };
  const end = () => {
    if (pending.current != null) send(pending.current, true);
    // l'élastique revient en rebondissant
    void animate(stretch, 1, { type: "spring", stiffness: 520, damping: 11 });
    release.current = window.setTimeout(() => setLocal(null), 900);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : e.key === "End" ? 100 : e.key === "Home" ? -100 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const v = Math.max(0, Math.min(100, shown + step));
    set(v);
    send(v, true);
    release.current = window.setTimeout(() => setLocal(null), 900);
  };

  return (
    <div className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white/6 px-3 py-2.5">
      <Speaker level={shown} knock={knock} />
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        data-focusable
        data-nav-capture="x"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handle(e.clientX);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handle(e.clientX)}
        onPointerUp={end}
        onPointerCancel={end}
        className="ibox-focusable group relative flex h-6 flex-1 cursor-pointer touch-none items-center [--ring-radius:999px]"
      >
        <motion.div className="relative h-2 w-full rounded-full bg-white/12" style={{ scaleX: stretch, transformOrigin: origin }}>
          <motion.div className="absolute inset-0 origin-left rounded-full bg-[linear-gradient(90deg,var(--ibox-sky),var(--ibox-lavender))] will-change-transform" style={{ transform: fill }} />
        </motion.div>
        <motion.div
          key={knock}
          aria-hidden="true"
          className="pointer-events-none absolute size-4 -translate-x-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ left: knob }}
          initial={knock ? { scale: 1.5 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 14 }}
        />
      </div>
      <span aria-hidden="true" className="w-[18px] flex-none" />
    </div>
  );
}

/** Haut-parleur : aucune onde à 0, une à faible volume, deux au-delà ; tremble en butée. */
function Speaker({ level, knock }: { level: number; knock: number }) {
  const waves = level === 0 ? 0 : level < 50 ? 1 : 2;
  return (
    <motion.svg
      key={knock}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-white/70"
      aria-hidden="true"
      initial={knock && !reduced() ? { rotate: -12 } : false}
      animate={{ rotate: [null, 10, -6, 0] }}
      transition={{ duration: 0.45 }}
    >
      <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" fillOpacity={0.25} />
      <motion.path d="M15.5 8.5a5 5 0 0 1 0 7" animate={{ opacity: waves >= 1 ? 1 : 0, pathLength: waves >= 1 ? 1 : 0 }} transition={{ duration: 0.2 }} />
      <motion.path d="M18.5 5.5a9 9 0 0 1 0 13" animate={{ opacity: waves >= 2 ? 1 : 0, pathLength: waves >= 2 ? 1 : 0 }} transition={{ duration: 0.2 }} />
      <motion.path d="M16 9.5l5 5M21 9.5l-5 5" animate={{ opacity: waves === 0 ? 1 : 0 }} transition={{ duration: 0.15 }} />
    </motion.svg>
  );
}

/** Rappel du titre en cours dans la vue agrandie. */
function NowBar({ n, live, onToggle }: { n: NonNullable<MusicState["now"]>; live: () => number; onToggle: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/8 p-2 pr-3">
      <div className="size-12 flex-none overflow-hidden rounded-xl ring-1 ring-white/10">
        <Thumb src={n.artwork} fill />
      </div>
      <div className="min-w-0 flex-1">
        <Marquee text={n.title} className="text-[0.92rem] font-bold" />
        <Marquee text={n.artist} className="text-[0.78rem] font-bold text-white/50" />
        <LiveProgress live={live} durationMs={n.durationMs} trackKey={n.id} compact />
      </div>
      <motion.button whileTap={{ scale: 0.86 }} type="button" data-focusable onClick={onToggle} aria-label={n.playing ? "Pause" : "Lecture"} title={n.playing ? "Pause" : "Lecture"} className="ibox-focusable grid size-10 flex-none place-items-center rounded-full bg-white/10 [--ring-radius:999px] hover:bg-white/20">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          {n.playing ? (
            <>
              <rect x="6" y="5" width="4" height="14" rx="1.4" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1.4" fill="currentColor" />
            </>
          ) : (
            <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
          )}
        </svg>
      </motion.button>
    </div>
  );
}

/**
 * Texte qui défile quand il est trop long (titre, artiste), comme dans les applis de musique :
 * une pause, un défilement lent, puis la copie qui enchaîne ; fondu sur les bords.
 * S’il tient, il reste immobile (centré si demandé). Animations réduites : coupé avec « … ».
 */
function Marquee({ text, className = "", center }: { text: string; className?: string; center?: boolean }) {
  // Les mêmes éléments restent en place, qu'il défile ou non : la mesure suit toujours le
  // vrai cadre (avant, passer d'un mode à l'autre laissait l'observateur sur un élément
  // retiré, et le texte ne repartait plus).
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => {
      const b = box.current, i = inner.current;
      if (!b || !i) return;
      // largeur de mise en page : le zoom d'ouverture de la carte (scale) ne la fausse pas
      const textW = i.offsetWidth;
      setWidth(textW - b.clientWidth > 2 ? textW : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (inner.current) ro.observe(inner.current);
    // la police (Cal Sans) peut arriver après la première mesure
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [text]);
  const GAP = 44;
  const scroll = width > 0 && !reduced();
  // Animation du navigateur, en boucle sans fin : elle ne dépend pas des rendus de React.
  useEffect(() => {
    const el = track.current;
    if (!scroll || !el) return;
    const d = width + GAP;
    const pause = 1600;
    const total = (d / 38) * 1000 + pause; // vitesse de lecture : environ 38 px/s
    const a = el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(0)", offset: pause / total }, { transform: `translateX(${-d}px)` }],
      { duration: total, iterations: Infinity, easing: "linear" },
    );
    return () => a.cancel();
  }, [scroll, width, text]);
  const fade = "linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)";
  return (
    <div
      ref={box}
      className={`relative overflow-hidden whitespace-nowrap ${scroll ? "" : `text-ellipsis ${center ? "text-center" : ""}`} ${className}`}
      style={scroll ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      title={scroll ? text : undefined}
    >
      <div ref={track} className={scroll ? "inline-flex pl-[9%]" : "inline"}>
        <span ref={inner}>{text}</span>
        {scroll && <span aria-hidden="true" style={{ paddingLeft: GAP }}>{text}</span>}
      </div>
    </div>
  );
}

function Thumb({ src, fill, size, round }: { src: string | null; fill?: boolean; size?: number; round?: boolean }) {
  const style = fill ? undefined : { width: size, height: size };
  const cls = fill ? "size-full" : `flex-none ${round ? "rounded-full" : "rounded-xl"}`;
  return src ? (
    <img src={src} alt="" draggable={false} className={`${cls} object-cover`} style={style} />
  ) : (
    <div className={`${cls} grid place-items-center bg-white/8 text-white/40`} style={style}>
      <Icon name="sound" size="40%" />
    </div>
  );
}

// ——— Listes ———

function Row({ title, artist, duration, thumbnail, index, current, playing, first, round, onClick }: { title: string; artist: string; duration?: string | null; thumbnail: string | null; index: number; current?: boolean; playing?: boolean; first?: boolean; round?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      data-focusable
      data-autofocus={first || undefined}
      onClick={onClick}
      {...rise(index)}
      whileTap={{ scale: 0.98 }}
      className={`ibox-focusable flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors [--ring-radius:1rem] ${current ? "bg-white/12" : "hover:bg-white/10"}`}
    >
      <Thumb src={thumbnail} size={44} round={round} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.9rem] font-bold">{title}</div>
        {artist && <div className="truncate text-[0.78rem] font-bold text-white/50">{artist}</div>}
      </div>
      {current && <Equalizer playing={!!playing} />}
      {duration && <span className="flex-none text-[0.75rem] font-bold tracking-[-0.04em] text-white/45 tabular-nums">{duration}</span>}
    </motion.button>
  );
}

function Card({ list, index, onClick }: { list: Playlist; index: number; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      data-focusable
      data-autofocus={index === 0 || undefined}
      onClick={() => {
        sound.play("select");
        onClick();
      }}
      {...rise(index)}
      whileHover={reduced() ? undefined : { y: -3 }}
      whileTap={{ scale: 0.96 }}
      className="ibox-focusable flex flex-col gap-2 rounded-2xl bg-white/6 p-2 text-left transition-colors [--ring-radius:1rem] hover:bg-white/12"
    >
      <div className="aspect-square w-full overflow-hidden rounded-xl ring-1 ring-white/10">
        <Thumb src={list.thumbnail} fill />
      </div>
      <div className="px-1 pb-0.5">
        <div className="truncate text-[0.88rem] font-bold">{list.title}</div>
        <div className="truncate text-[0.75rem] font-bold text-white/50">{list.subtitle}</div>
      </div>
    </motion.button>
  );
}

/** En-tête d'une fiche (playlist, artiste) : image, nom, gros bouton lecture. */
function DetailHeader({ image, round, title, subtitle, onPlay, playLabel }: { image: string | null; round?: boolean; title: string; subtitle?: string; onPlay: () => void; playLabel: string }) {
  return (
    <div className="flex items-center gap-4">
      <motion.div initial={reduced() ? false : { scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 26 }} className={`size-20 flex-none overflow-hidden ring-1 ring-white/10 ${round ? "rounded-full" : "rounded-2xl"}`}>
        <Thumb src={image} fill />
      </motion.div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[1.2rem] font-semibold">{title}</div>
        {subtitle && <div className="truncate text-[0.78rem] font-bold text-white/50">{subtitle}</div>}
      </div>
      <motion.button type="button" data-focusable data-autofocus aria-label={playLabel} title={playLabel} whileTap={{ scale: 0.88 }} onClick={onPlay} className="ibox-focusable ibox-btn ibox-btn-primary grid size-14 flex-none place-items-center rounded-full [--ring-radius:999px]">
        <Icon name="play" size="1.4rem" />
      </motion.button>
    </div>
  );
}

function PlaylistDetail({ detail, current, onPlay }: { detail: { list: Playlist; tracks: Track[] | null }; current: MusicState["now"]; onPlay: (i: { videoId?: string; playlistId?: string; index?: number }) => void }) {
  const { list, tracks } = detail;
  return (
    <>
      <DetailHeader image={list.thumbnail} title={list.title} subtitle={list.subtitle} playLabel="Lire la playlist" onPlay={() => onPlay({ playlistId: list.playlistId })} />
      <Scroll>
        <div className="mt-2 flex flex-col gap-0.5">
          {tracks === null ? (
            <Loading />
          ) : tracks.length === 0 ? (
            <p className="py-6 text-center text-[0.9rem] font-bold text-white/55">Aucun titre à afficher.</p>
          ) : (
            tracks.map((t, i) => (
              <Row key={t.videoId} index={i} title={t.title} artist={t.artist} duration={t.duration} thumbnail={t.thumbnail} current={current?.source === "youtube" && current.id === t.videoId} playing={!!current?.playing} onClick={() => onPlay({ videoId: t.videoId, playlistId: list.playlistId, index: i })} />
            ))
          )}
        </div>
      </Scroll>
    </>
  );
}

function ArtistDetail({ artist, current, onPlay }: { artist: { preview: Artist; page: ArtistPage | null }; current: MusicState["now"]; onPlay: (t: Track) => void }) {
  const page = artist.page;
  const tracks = page?.tracks ?? null;
  return (
    <>
      <DetailHeader image={page?.thumbnail ?? artist.preview.thumbnail} round title={page?.name || artist.preview.name} subtitle={artist.preview.subtitle} playLabel="Lire les titres populaires" onPlay={() => tracks?.[0] && onPlay(tracks[0])} />
      <Scroll>
        <div className="mt-2 flex flex-col gap-0.5">
          {tracks === null ? (
            <Loading />
          ) : tracks.length === 0 ? (
            <p className="py-6 text-center text-[0.9rem] font-bold text-white/55">Aucun titre à afficher.</p>
          ) : (
            tracks.map((t, i) => <Row key={t.videoId} index={i} title={t.title} artist={t.album ?? ""} duration={t.duration} thumbnail={t.thumbnail} current={current?.id === t.videoId} playing={!!current?.playing} onClick={() => onPlay(t)} />)
          )}
        </div>
      </Scroll>
    </>
  );
}

function QueueList({ items, current, onPlay }: { items: QueueItem[]; current: MusicState["now"]; onPlay: (q: QueueItem) => void }) {
  if (!items.length) return <p className="py-10 text-center text-[0.9rem] font-bold text-white/55">Rien à suivre pour l’instant.</p>;
  return (
    <Scroll>
      <div className="flex flex-col gap-0.5">
        {items.map((q, i) => (
          <Row key={q.videoId} index={i} first={i === 0} title={q.title} artist={q.artist} duration={q.duration} thumbnail={q.thumbnail} current={current?.id === q.videoId} onClick={() => onPlay(q)} />
        ))}
      </div>
    </Scroll>
  );
}

const SEARCH_TABS: { value: SearchKind; label: string; tone: string; icon: ReactNode }[] = [
  {
    value: "songs",
    label: "Titres",
    tone: "tone-orange",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    value: "artists",
    label: "Artistes",
    tone: "tone-pink",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

/** Recherche : titres ou artistes (onglets en icônes). Clavier virtuel d'iBox à la manette. */
function Search({ search, current, onQuery, onKind, onSubmit, onPlay, onArtist }: {
  search: { query: string; kind: SearchKind; songs: Track[] | null; artists: Artist[] | null; loading: boolean };
  current: MusicState["now"];
  onQuery: (q: string) => void;
  onKind: (k: SearchKind) => void;
  onSubmit: () => void;
  onPlay: (t: Track) => void;
  onArtist: (a: Artist) => void;
}) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const remember = () => search.query.trim() && setRecent(saveRecent(search.query.trim()));
  const list = search.kind === "songs" ? search.songs : search.artists;
  return (
    <>
      <div className="flex items-center gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-white/10 px-4 transition-colors focus-within:bg-white/16">
          <Icon name="search" size="1.1rem" className="flex-none text-white/60" />
          <span className="sr-only">Rechercher un titre ou un artiste</span>
          <input
            data-focusable
            data-autofocus
            value={search.query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                remember();
                onSubmit();
              }
            }}
            placeholder="Titre, artiste…"
            className="ibox-focusable h-full min-w-0 flex-1 bg-transparent text-[0.95rem] font-bold text-white outline-none placeholder:text-white/40"
          />
          {search.loading && <span className="size-4 flex-none animate-spin rounded-full border-2 border-white/25 border-t-white" aria-label="Recherche…" />}
        </label>
        <IconTabs<SearchKind> small value={search.kind} onChange={onKind} items={SEARCH_TABS} />
      </div>
      <Scroll>
        {list === null ? (
          recent.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-white/40" title="Recherches récentes" aria-label="Recherches récentes">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5M12 7v5l3 2" />
                </svg>
              </span>
              {recent.map((r, i) => (
                <motion.button key={r} type="button" data-focusable {...rise(i)} whileTap={{ scale: 0.94 }} onClick={() => onQuery(r)} className="ibox-focusable h-9 rounded-full bg-white/10 px-4 text-[0.85rem] font-bold [--ring-radius:999px] hover:bg-white/20">
                  {r}
                </motion.button>
              ))}
            </div>
          )
        ) : list.length === 0 && !search.loading ? (
          <p className="py-8 text-center text-[0.9rem] font-bold text-white/55">Aucun résultat.</p>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={search.kind} initial={{ opacity: 0, x: search.kind === "artists" ? 16 : -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="mt-1 flex flex-col gap-0.5">
              {search.kind === "songs"
                ? (search.songs ?? []).map((t, i) => (
                    <Row
                      key={t.videoId}
                      index={i}
                      title={t.title}
                      artist={t.artist}
                      duration={t.duration}
                      thumbnail={t.thumbnail}
                      current={current?.id === t.videoId}
                      playing={!!current?.playing}
                      onClick={() => {
                        remember();
                        onPlay(t);
                      }}
                    />
                  ))
                : (search.artists ?? []).map((a, i) => (
                    <Row
                      key={a.id}
                      index={i}
                      round
                      title={a.name}
                      artist={a.subtitle}
                      thumbnail={a.thumbnail}
                      onClick={() => {
                        remember();
                        onArtist(a);
                      }}
                    />
                  ))}
            </motion.div>
          </AnimatePresence>
        )}
      </Scroll>
    </>
  );
}

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <div aria-hidden="true" className="flex h-3.5 flex-none items-end gap-[2px] text-[var(--ibox-sky)]">
      {[0.6, 1, 0.4, 0.8].map((h, i) => (
        <motion.span
          key={i}
          className="block w-[3px] origin-bottom rounded-sm bg-current"
          style={{ height: `${h * 100}%` }}
          animate={playing ? { scaleY: [0.35, 1, 0.35] } : { scaleY: 0.35 }}
          transition={playing ? { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 } : { duration: 0.3 }}
        />
      ))}
    </div>
  );
}

function Loading({ grid }: { grid?: boolean }) {
  return (
    <div className={grid ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2 pt-1"} aria-label="Chargement…">
      {Array.from({ length: 6 }, (_, i) => (
        <motion.div key={i} className={`rounded-2xl bg-white/8 ${grid ? "aspect-[4/5]" : "h-[60px]"}`} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.1 }} />
      ))}
    </div>
  );
}

function Empty({ youtube, loading }: { youtube: boolean; loading: boolean }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl bg-white/6 px-4 py-6 text-center">
      <div className="font-display text-[1.1rem] font-semibold">{loading ? "Chargement…" : "Aucune musique en cours"}</div>
      {!loading && (
        <button type="button" data-focusable data-autofocus onClick={() => void music.connect()} className="ibox-focusable ibox-btn ibox-btn-primary h-11 rounded-full px-5 text-[0.92rem] font-bold [--ring-radius:999px] active:scale-95">
          {youtube ? "Ouvrir YouTube Music" : "Connecter YouTube Music"}
        </button>
      )}
    </div>
  );
}

/**
 * Barre de progression animée à chaque image : la position est recalculée 60 fois par
 * seconde et lissée (les petites corrections du lecteur ne font plus sauter la barre ;
 * un vrai saut, nouveau titre ou déplacement, est suivi aussitôt). Rien n'est re-rendu par
 * React : la barre, le curseur et le temps sont écrits directement.
 */
function LiveProgress({ live, durationMs, canSeek, trackKey, onSeek, compact }: { live: () => number; durationMs: number; canSeek?: boolean; trackKey: string; onSeek?: (ms: number) => void; compact?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const shown = useRef<number | null>(null);
  const dragging = useRef<number | null>(null);
  const hold = useRef(0);

  // nouveau titre : on repart de sa position, sans glisser depuis l'ancien
  useEffect(() => {
    shown.current = null;
  }, [trackKey]);

  useAnimationFrame(() => {
    const target = dragging.current ?? (Date.now() < hold.current ? (shown.current ?? live()) : live());
    let v = shown.current;
    if (v == null || dragging.current != null || Math.abs(target - v) > 1500) v = target;
    else v += (target - v) * 0.18;
    shown.current = v;
    const r = durationMs > 0 ? Math.max(0, Math.min(1, v / durationMs)) : 0;
    if (fill.current) fill.current.style.transform = `scaleX(${r})`;
    if (knob.current) knob.current.style.left = `${r * 100}%`;
    if (time.current) {
      const t = formatTime(v);
      if (time.current.textContent !== t) time.current.textContent = t;
    }
    if (range.current && dragging.current == null) range.current.value = String(Math.round(r * 1000));
  });

  const commit = () => {
    if (dragging.current == null) return;
    onSeek?.(dragging.current);
    shown.current = dragging.current;
    dragging.current = null;
    // le lecteur applique le déplacement : on garde la nouvelle position un instant
    hold.current = Date.now() + 600;
  };

  if (compact) {
    return (
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/12">
        <div ref={fill} className="h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--ibox-sky),var(--ibox-lavender))] will-change-transform" style={{ transform: "scaleX(0)" }} />
      </div>
    );
  }
  return (
    <>
      <div className="group relative flex h-5 items-center">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/12">
          <div ref={fill} className="absolute inset-0 origin-left rounded-full bg-[linear-gradient(90deg,var(--ibox-sky),var(--ibox-lavender))] will-change-transform" style={{ transform: "scaleX(0)" }} />
        </div>
        <div ref={knob} aria-hidden="true" className="pointer-events-none absolute size-3.5 -translate-x-1/2 scale-0 rounded-full bg-white shadow transition-transform duration-200 group-hover:scale-100" style={{ left: "0%" }} />
        <input
          ref={range}
          type="range"
          aria-label="Position"
          min={0}
          max={1000}
          defaultValue={0}
          disabled={!canSeek}
          onInput={(e) => {
            dragging.current = (Number((e.target as HTMLInputElement).value) / 1000) * durationMs;
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[0.72rem] font-bold tracking-[-0.04em] text-white/50 tabular-nums">
        <span ref={time}>0:00</span>
        <span>{durationMs ? formatTime(durationMs) : "--:--"}</span>
      </div>
    </>
  );
}

/** Couleur moyenne de la pochette (lueur, ombre). Neutre si l'image est illisible (CORS). */
function useDominantColor(src: string | null): string {
  const [color, setColor] = useState("#6b7a99");
  useEffect(() => {
    if (!src) return setColor("#6b7a99");
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          // les pixels saturés comptent davantage : une lueur colorée plutôt que grise
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
          const k = 1 + ((max - min) / 255) * 4;
          r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k;
        }
        if (alive && w) setColor(`rgb(${Math.round(r / w)}, ${Math.round(g / w)}, ${Math.round(b / w)})`);
      } catch {
        /* image d'une autre origine sans CORS : couleur neutre */
      }
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return color;
}
