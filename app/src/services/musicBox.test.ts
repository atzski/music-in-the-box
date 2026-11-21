import { describe, expect, it, vi } from "vitest";
import { formatTime, moveFocus, placeCard, positionAt, positionOf, upNext, type MusicState, type QueueItem } from "./musicBox";

const state = (playing: boolean): MusicState => ({
  at: 1_000,
  youtube: true,
  now: { source: "youtube", app: "YouTube Music", id: "a", title: "T", artist: "A", album: null, artwork: null, positionMs: 10_000, durationMs: 12_000, playing, volume: 50, canSeek: true, liked: null, shuffle: null, repeat: null },
});

describe("Music in the Box", () => {
  it("fait avancer la position seulement pendant la lecture, sans dépasser la durée", () => {
    expect(positionAt(state(true), 1_500)).toBe(10_500);
    expect(positionAt(state(true), 9_000)).toBe(12_000);
    expect(positionAt(state(false), 9_000)).toBe(10_000);
    expect(positionAt(null, 9_000)).toBe(0);
  });

  it("affiche les durées en m:ss ou h:mm:ss", () => {
    expect(formatTime(5_000)).toBe("0:05");
    expect(formatTime(296_588)).toBe("4:56");
    expect(formatTime(3_725_000)).toBe("1:02:05");
  });

  it("déplace le focus dans une grille sans en sortir", () => {
    expect(moveFocus(0, 5, 2, "right")).toBe(1);
    expect(moveFocus(1, 5, 2, "down")).toBe(3);
    expect(moveFocus(3, 5, 2, "down")).toBe(3);
    expect(moveFocus(0, 5, 2, "up")).toBe(0);
    expect(moveFocus(2, 5, 1, "left")).toBe(2);
    expect(moveFocus(0, 0, 2, "down")).toBe(0);
  });

  it("donne les titres qui suivent celui en cours", () => {
    const q = (id: string, selected = false): QueueItem => ({ videoId: id, title: id, artist: "", duration: null, thumbnail: null, selected, playlistId: null, index: null });
    expect(upNext([q("a"), q("b", true), q("c"), q("d")], 2).map((x) => x.videoId)).toEqual(["c", "d"]);
    expect(upNext([q("a"), q("b")], 1).map((x) => x.videoId)).toEqual(["a"]);
  });

  it("place la carte dans l’écran, et l’agrandit sans la faire sortir", () => {
    // collée à droite, au milieu : elle grandit vers la gauche et des deux côtés en hauteur
    expect(placeCard({ x: 1, y: 0.5 }, 392, 340, 1920, 1080)).toEqual({ left: 1504, top: 370 });
    expect(placeCard({ x: 1, y: 0.5 }, 468, 760, 1920, 1080)).toEqual({ left: 1428, top: 160 });
    // en haut à gauche, puis valeurs hors bornes ramenées dans l’écran
    expect(placeCard({ x: 0, y: 0 }, 392, 340, 1920, 1080)).toEqual({ left: 24, top: 24 });
    expect(placeCard({ x: 3, y: -1 }, 392, 340, 1920, 1080)).toEqual({ left: 1504, top: 24 });
  });

  it("retrouve la position d’une carte déplacée, aimantée aux bords et au centre", () => {
    expect(positionOf(1500, 372, 392, 340, 1920, 1080)).toEqual({ x: 1, y: 0.5 });
    expect(positionOf(30, 30, 392, 340, 1920, 1080)).toEqual({ x: 0, y: 0 });
    const p = positionOf(500, 200, 392, 340, 1920, 1080);
    expect(p.x).toBeGreaterThan(0.2);
    expect(p.x).toBeLessThan(0.4);
  });
});

describe("playlists page par page", () => {
  const t = (id: string) => ({ videoId: id, title: id, artist: "", album: null, duration: "", thumbnail: null }) as unknown as import("./musicBox").Track;

  it("montre la première page aussitôt puis ajoute les suivantes sans doublon", async () => {
    const { music, loadPlaylist } = await import("./musicBox");
    const pages = [
      { tracks: [t("a"), t("b")], next: { token: "p2" } },
      { tracks: [t("b"), t("c")], next: null },
    ];
    const spy = vi.spyOn(music, "playlistPage").mockImplementation(async (_id, next) => pages[next ? 1 : 0]);
    const seen: string[][] = [];
    const all = await loadPlaylist("VLLM", (list) => seen.push(list.map((x) => x.videoId)));
    expect(seen[0]).toEqual(["a", "b"]);
    expect(all.map((x) => x.videoId)).toEqual(["a", "b", "c"]);
    spy.mockRestore();
  });

  it("se replie sur l'ancien pont, qui rend tout d'un coup", async () => {
    const { music, loadPlaylist } = await import("./musicBox");
    const page = vi.spyOn(music, "playlistPage").mockRejectedValue("commande-inconnue");
    const whole = vi.spyOn(music, "playlist").mockResolvedValue([t("x")]);
    expect((await loadPlaylist("VLLM", () => undefined)).map((x) => x.videoId)).toEqual(["x"]);
    page.mockRestore();
    whole.mockRestore();
  });
});

describe("démarrage rapide, paroles et déplacement", () => {
  it("garde les derniers lancements, le plus récent d'abord, sans doublon", async () => {
    const { pushLaunch, MAX_LAUNCHES } = await import("./musicBox");
    const l = (id: string): import("./musicBox").Launch => ({ playlistId: id, title: id, subtitle: "", thumbnail: null });
    let list = [l("a"), l("b"), l("c")];
    list = pushLaunch(list, l("b"));
    expect(list.map((x) => x.playlistId)).toEqual(["b", "a", "c"]);
    list = pushLaunch(list, l("d"));
    expect(list.map((x) => x.playlistId)).toEqual(["d", "b", "a"]);
    expect(list).toHaveLength(MAX_LAUNCHES);
  });

  it("écarte un stockage abîmé au lieu de planter", async () => {
    const { parseLaunches } = await import("./musicBox");
    expect(parseLaunches(null)).toEqual([]);
    expect(parseLaunches("pas du json")).toEqual([]);
    expect(parseLaunches('{"playlistId":"x"}')).toEqual([]);
    expect(parseLaunches('[{"playlistId":"PL1","title":"Ma liste","thumbnail":7},{"title":"sans identifiant"},null]')).toEqual([{ playlistId: "PL1", title: "Ma liste", subtitle: "", thumbnail: null }]);
  });

  it("compose la radio d'un titre", async () => {
    const { radioOf } = await import("./musicBox");
    expect(radioOf("abc123")).toBe("RDAMVMabc123");
  });

  it("fait avancer les paroles entre l'introduction et la fin du titre", async () => {
    const { lyricsProgress } = await import("./musicBox");
    expect(lyricsProgress(0, 200_000)).toBe(0);
    expect(lyricsProgress(10_000, 200_000)).toBe(0);
    expect(lyricsProgress(97_000, 200_000)).toBeCloseTo(0.5, 2);
    expect(lyricsProgress(190_000, 200_000)).toBe(1);
    // durée inconnue (diffusion en direct) : on reste en haut
    expect(lyricsProgress(50_000, 0)).toBe(0);
  });

  it("déplace la lecture par pas de cinq secondes sans sortir du titre", async () => {
    const { seekBy } = await import("./musicBox");
    expect(seekBy(30_000, 1, 200_000)).toBe(35_000);
    expect(seekBy(30_000, -2, 200_000)).toBe(20_000);
    expect(seekBy(2_000, -1, 200_000)).toBe(0);
    expect(seekBy(198_000, 1, 200_000)).toBe(200_000);
  });
});
