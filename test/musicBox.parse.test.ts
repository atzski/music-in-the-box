import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Traduction des réponses de YouTube Music (`bridge/parse.js`, injecté dans la
 * page). Réponses réduites écrites à la main pour les cas connus, plus les réponses réelles
 * enregistrées dans `fixtures/` (titres publics seulement, jamais la bibliothèque d'un compte).
 */
const DIR = join(__dirname, "../bridge");
const src = readFileSync(join(DIR, "parse.js"), "utf8");
type Parse = {
  tracks: (j: unknown) => { videoId: string; title: string; artist: string; album: string | null; duration: string | null }[];
  playlists: (j: unknown) => { id: string; playlistId: string; title: string }[];
  continuation: (j: unknown) => { token: string; legacy: boolean } | null;
  queue: (j: unknown) => { videoId: string; title: string; artist: string; selected: boolean; index: number | null }[];
};
const P = new Function(`${src}; return ytmParse;`)() as Parse;

const run = (text: string, pageType?: string) =>
  pageType ? { text, navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } } : { text };
const item = (videoId: string, title: string, runs: object[], fixed?: string) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs } } },
    ],
    ...(fixed ? { fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { simpleText: fixed } } }] } : {}),
  },
});

describe("Music in the Box : réponses YouTube Music", () => {
  it("prend la chaîne pour artiste d'une vidéo, jamais le nombre de vues", () => {
    const json = { contents: [item("v1", "Daft Punk - One More Time", [run("Naf' Manson", "MUSIC_PAGE_TYPE_USER_CHANNEL"), run(" • "), run("50 M de vues"), run(" • "), run("5:21")])] };
    expect(P.tracks(json)[0]).toMatchObject({ artist: "Naf' Manson", duration: "5:21" });
  });

  it("lit artistes, album et durée d'un titre, séparateurs insécables compris", () => {
    const json = {
      contents: [
        item("s1", "One More Time", [run("Titre"), run(" • "), run("Daft Punk", "MUSIC_PAGE_TYPE_ARTIST"), run(" • "), run("Discovery", "MUSIC_PAGE_TYPE_ALBUM"), run(" • "), run("5:20")]),
        item("s2", "Back On 74", [run("Jungle", "MUSIC_PAGE_TYPE_ARTIST"), run(" & "), run("Autre", "MUSIC_PAGE_TYPE_ARTIST")], "3:29"),
      ],
    };
    const [a, b] = P.tracks(json);
    expect(a).toMatchObject({ artist: "Daft Punk", album: "Discovery", duration: "5:20" });
    expect(b).toMatchObject({ artist: "Jungle, Autre", duration: "3:29" });
  });

  it("devine l'artiste sans lien, sans prendre le type ni les vues", () => {
    const json = { contents: [item("g1", "Inconnu", [run("Titre • Un Artiste • 1,2 M d’écoutes")])] };
    expect(P.tracks(json)[0].artist).toBe("Un Artiste");
  });

  it("garde l'ordre du document et écarte les doublons", () => {
    const json = { a: [item("1", "Un", []), { deep: item("2", "Deux", []) }], b: item("1", "Un bis", []) };
    expect(P.tracks(json).map((t) => t.videoId)).toEqual(["1", "2"]);
  });

  it("lit les cartes de playlists et la page suivante", () => {
    const card = (id: string, title: string) => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: title }] }, navigationEndpoint: { browseEndpoint: { browseId: id } } } });
    expect(P.playlists({ items: [card("VLPLx", "kiffance"), card("UCartist", "Un artiste"), card("VLPLx", "doublon")] })).toEqual([
      expect.objectContaining({ id: "VLPLx", playlistId: "PLx", title: "kiffance" }),
    ]);
    expect(P.continuation({ x: { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "T" } } } } })).toEqual({ token: "T", legacy: false });
    expect(P.continuation({ continuations: [{ nextContinuationData: { continuation: "L" } }] })).toEqual({ token: "L", legacy: true });
    expect(P.continuation({})).toBeNull();
  });

  it("lit la durée dans une colonne à part", () => {
    const r = item("d1", "Truth or Dare", [run("Tyla", "MUSIC_PAGE_TYPE_ARTIST")]);
    r.musicResponsiveListItemRenderer.flexColumns.push({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "3:11" }] } } });
    expect(P.tracks({ contents: [r] })[0]).toMatchObject({ artist: "Tyla", duration: "3:11" });
  });

  it("ne garde que l'étagère de la playlist, pas les suggestions", () => {
    const json = {
      contents: { musicPlaylistShelfRenderer: { contents: [item("p1", "Un", []), item("p2", "Deux", [])] } },
      suggestions: { musicShelfRenderer: { contents: [item("x1", "Suggéré", [])] } },
      continuations: [{ nextContinuationData: { continuation: "SUGGESTIONS" } }],
    };
    const page = (P as unknown as { playlistPage: (j: unknown) => { tracks: { videoId: string }[]; next: unknown } }).playlistPage(json);
    expect(page.tracks.map((t) => t.videoId)).toEqual(["p1", "p2"]);
    expect(page.next).toBeNull();
  });

  it("ignore la version clip (counterpart) des titres de la file et lit « J'aime »", () => {
    const v = (id: string, selected = false) => ({ playlistPanelVideoRenderer: { videoId: id, selected, title: { runs: [{ text: id }] } } });
    const json = {
      playlistPanelRenderer: {
        contents: [{ playlistPanelVideoWrapperRenderer: { primaryRenderer: v("audio", true), counterpart: [{ counterpartRenderer: v("clip", true) }] } }, v("suivant")],
      },
      frameworkUpdates: { mutations: [{ payload: { likeStatusEntity: { likeStatus: "LIKE" } } }] },
    };
    expect(P.queue(json).map((x) => x.videoId)).toEqual(["audio", "suivant"]);
    const like = (P as unknown as { likeStatus: (j: unknown) => boolean | null }).likeStatus;
    expect(like(json)).toBe(true);
    expect(like({})).toBeNull();
  });

  it("trouve les artistes d'une recherche (carte du meilleur résultat comprise), sans doublon", () => {
    const P2 = P as unknown as { artists: (j: unknown) => { id: string; name: string; subtitle: string }[]; artistPage: (j: unknown) => { name: string; tracks: { videoId: string }[] } };
    const artistRow = (id: string, name: string) => ({
      musicResponsiveListItemRenderer: {
        navigationEndpoint: { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: name }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Artiste" }, { text: " • " }, { text: "65 M auditeurs/mois" }] } } },
        ],
      },
    });
    const card = { musicCardShelfRenderer: { title: { runs: [run("Daft Punk", "MUSIC_PAGE_TYPE_ARTIST")] }, subtitle: { runs: [{ text: "Artiste" }] } } };
    (card.musicCardShelfRenderer.title.runs[0] as { navigationEndpoint: { browseEndpoint: { browseId?: string } } }).navigationEndpoint.browseEndpoint.browseId = "UC1";
    const list = P2.artists({ a: card, b: [artistRow("UC1", "Daft Punk"), artistRow("UC2", "Pharrell Williams"), item("v1", "Un titre", [])] });
    expect(list.map((a) => [a.id, a.name])).toEqual([["UC1", "Daft Punk"], ["UC2", "Pharrell Williams"]]);
    expect(list[1].subtitle).toBe("65 M auditeurs/mois");
    const page = P2.artistPage({ header: { musicImmersiveHeaderRenderer: { title: { runs: [{ text: "Daft Punk" }] } } }, shelf: { musicShelfRenderer: { contents: [item("t1", "One More Time", [])] } } });
    expect(page.name).toBe("Daft Punk");
    expect(page.tracks.map((t) => t.videoId)).toEqual(["t1"]);
  });

  it("trouve les albums d'une recherche et lit la page d'un album", () => {
    const P3 = P as unknown as {
      albums: (j: unknown) => { id: string; title: string; artist: string; year: string | null; type: string | null }[];
      albumPage: (j: unknown) => { title: string; artist: string; year: string | null; thumbnail: string | null; playlistId: string | null; tracks: { videoId: string; artist: string; thumbnail: string | null }[] };
    };
    const albumRow = (id: string, title: string, sub: object[]) => ({
      musicResponsiveListItemRenderer: {
        navigationEndpoint: { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } } } },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: sub } } },
        ],
      },
    });
    const list = P3.albums({
      a: [
        albumRow("MPREb_1", "Discovery", [run("Album"), run(" • "), run("Daft Punk", "MUSIC_PAGE_TYPE_ARTIST"), run(" • "), run("2001")]),
        albumRow("MPREb_2", "Random Access Memories", [run("EP"), run(" • "), run("Daft Punk", "MUSIC_PAGE_TYPE_ARTIST"), run(" • "), run("2013")]),
        albumRow("MPREb_1", "doublon", []),
        item("v1", "Un titre", []),
      ],
    });
    expect(list.map((a) => [a.id, a.title, a.artist, a.year, a.type])).toEqual([
      ["MPREb_1", "Discovery", "Daft Punk", "2001", null],
      ["MPREb_2", "Random Access Memories", "Daft Punk", "2013", "EP"],
    ]);
    const page = P3.albumPage({
      header: {
        musicResponsiveHeaderRenderer: {
          title: { runs: [{ text: "Discovery" }] },
          straplineTextOne: { runs: [{ text: "Daft Punk" }] },
          subtitle: { runs: [{ text: "Album" }, { text: " • " }, { text: "2001" }] },
          thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "cover" }] } } },
          buttons: [{ musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: "OLAK5uy_x" } } } }],
        },
      },
      shelf: { musicShelfRenderer: { contents: [item("t1", "One More Time", [run("12 M de lectures")], "5:20"), item("t2", "Aerodynamic", [run("Daft Punk", "MUSIC_PAGE_TYPE_ARTIST")])] } },
    });
    expect(page).toMatchObject({ title: "Discovery", artist: "Daft Punk", year: "2001", thumbnail: "cover", playlistId: "OLAK5uy_x" });
    expect(page.tracks.map((t) => [t.videoId, t.artist, t.thumbnail])).toEqual([
      ["t1", "Daft Punk", "cover"],
      ["t2", "Daft Punk", "cover"],
    ]);
  });

  it("lit la file d'attente et le titre en cours", () => {
    const v = (id: string, selected: boolean, index: number) => ({
      playlistPanelVideoRenderer: { videoId: id, selected, title: { runs: [{ text: `T${id}` }] }, shortBylineText: { runs: [{ text: "Artiste • Album" }] }, navigationEndpoint: { watchEndpoint: { videoId: id, playlistId: "PL", index } } },
    });
    const q = P.queue({ playlistPanelRenderer: { contents: [v("a", false, 0), v("b", true, 1), v("c", false, 2)] } });
    expect(q.map((x) => [x.videoId, x.selected, x.index])).toEqual([["a", false, 0], ["b", true, 1], ["c", false, 2]]);
    expect(q[0].artist).toBe("Artiste");
  });

  // réponses réelles enregistrées : chaque titre a un identifiant, un titre et un artiste
  const fixtures = join(__dirname, "fixtures");
  const files = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.endsWith(".json")) : [];
  for (const f of files) {
    it(`réponse réelle ${f}`, () => {
      const json = JSON.parse(readFileSync(join(fixtures, f), "utf8"));
      const list = f.startsWith("next") ? P.queue(json) : P.tracks(json);
      expect(list.length).toBeGreaterThan(0);
      for (const t of list) {
        expect(t.videoId).toBeTruthy();
        expect(t.title).toBeTruthy();
        expect(t.artist).toBeTruthy();
        expect(t.artist).not.toMatch(/\d.*(vues|views)/i);
      }
    });
  }
});
