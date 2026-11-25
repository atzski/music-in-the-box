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

  it("trouve la page de paroles d'un titre et lit ses lignes", () => {
    const P4 = P as unknown as { lyricsId: (j: unknown) => string | null; lyrics: (j: unknown) => { lines: string[]; source: string | null } | null };
    // forme réelle des réponses de YouTube Music (novembre 2026) ; texte inventé, les vraies
    // paroles n'ont pas leur place dans un dépôt
    const tab = (title: string, browseId?: string, pageType?: string, unselectable?: boolean) => ({
      tabRenderer: {
        title,
        ...(unselectable ? { unselectable: true } : {}),
        ...(browseId ? { endpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } } : { content: {} }),
      },
    });
    const next = (lyricsTab: object) => ({
      contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [tab("À suivre"), lyricsTab, tab("Similaires", "MPTRt_x", "MUSIC_PAGE_TYPE_TRACK_RELATED")] } } } },
    });
    expect(P4.lyricsId(next(tab("Paroles", "MPLYt_x", "MUSIC_PAGE_TYPE_TRACK_LYRICS")))).toBe("MPLYt_x");
    // onglet grisé : YouTube Music n'a pas de paroles pour ce titre, même s'il garde une adresse
    expect(P4.lyricsId(next(tab("Paroles", "MPLYt_x", "MUSIC_PAGE_TYPE_TRACK_LYRICS", true)))).toBeNull();
    // jamais l'onglet « Similaires », et rien sans onglet
    expect(P4.lyricsId(next(tab("Commentaires")))).toBeNull();
    expect(P4.lyricsId({})).toBeNull();

    const page = P4.lyrics({
      contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "Premier vers\r\nDeuxième vers \n\nNouveau couplet\n" }] }, footer: { runs: [{ text: "Source : Exemple" }] } } }] } },
    });
    expect(page).toEqual({ lines: ["Premier vers", "Deuxième vers", "", "Nouveau couplet"], source: "Source : Exemple" });
    // « Paroles non disponibles » : un message, pas d'étagère de texte
    expect(P4.lyrics({ contents: { messageRenderer: { text: { runs: [{ text: "Paroles non disponibles" }] } } } })).toBeNull();
    expect(P4.lyrics({ contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "  " }] } } }] } } })).toBeNull();
  });

  it("lit les paroles horodatées, et renonce dès qu'une ligne n'a pas d'horaire", () => {
    const P5 = P as unknown as { timedLyrics: (j: unknown) => { lines: string[]; times: number[]; source: string | null } | null };
    // forme réelle de la réponse faite à l'application mobile (novembre 2026) ; texte inventé
    const page = (lines: object[]) => ({
      contents: { elementRenderer: { newElement: { type: { componentType: { model: { timedLyricsModel: { lyricsData: { timedLyricsData: lines, sourceMessage: "Source : Exemple", staticLayout: false } } } } } } } },
    });
    const line = (text: string, start?: number) => ({ lyricLine: text, ...(start === undefined ? {} : { cueRange: { startTimeMilliseconds: String(start), endTimeMilliseconds: String(start + 2000), metadata: { id: "1" } } }) });
    expect(P5.timedLyrics(page([line("♪", 0), line("Premier vers ", 5530), line("Deuxième vers", 8280)]))).toEqual({
      lines: ["♪", "Premier vers", "Deuxième vers"],
      times: [0, 5530, 8280],
      source: "Source : Exemple",
    });
    // un clip : les lignes viennent sans horaire (`staticLayout`) → pas de synchronisation
    expect(P5.timedLyrics(page([line("Premier vers"), line("Deuxième vers")]))).toBeNull();
    expect(P5.timedLyrics(page([line("Premier vers", 1000), line("Deuxième vers")]))).toBeNull();
    expect(P5.timedLyrics(page([]))).toBeNull();
    expect(P5.timedLyrics({ contents: { messageRenderer: {} } })).toBeNull();
  });

  it("file réelle : titre lancé seul (suite automatique proposée) et radio (sans fin)", () => {
    type Info = { items: { videoId: string; selected: boolean; artists: { name: string; id: string | null }[] }[]; more: boolean; automix: { playlistId: string; params: string | null } | null };
    const P7 = P as unknown as { queueInfo: (j: unknown) => Info };
    const read = (f: string) => P7.queueInfo(JSON.parse(readFileSync(join(__dirname, "fixtures", f), "utf8")));
    const solo = read("next-titre-seul.json");
    // la file s'arrête après ce titre ; YouTube Music propose sa suite (« automix »)
    expect(solo.items.map((q) => q.selected)).toEqual([true]);
    expect(solo.more).toBe(false);
    expect(solo.automix?.playlistId).toMatch(/^RDAMVM/);
    const radio = read("next-radio-titre.json");
    expect(radio.items.length).toBeGreaterThan(20);
    expect(radio.more).toBe(true);
    expect(radio.automix).toBeNull();
    // chaque artiste d'un titre à plusieurs artistes, avec sa page
    const duo = radio.items.find((q) => q.artists.length > 1)!;
    expect(duo.artists.every((a) => /^UC/.test(a.id ?? ""))).toBe(true);
    expect(radio.items.every((q) => q.artists.length > 0)).toBe(true);
  });

  it("artistes d'un titre trouvé : un lien par artiste, aucun pour une chaîne d'utilisateur", () => {
    type T = { artists: { name: string; id: string | null }[] };
    const list = (P as unknown as { tracks: (j: unknown) => T[] }).tracks(JSON.parse(readFileSync(join(__dirname, "fixtures", "search-daft-punk.json"), "utf8")));
    const linked = list.flatMap((t) => t.artists).filter((a) => a.id);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every((a) => /^UC/.test(a.id!))).toBe(true);
    // une vidéo de fan : la chaîne est nommée, sans page d'artiste
    expect(list.some((t) => t.artists.some((a) => a.id === null))).toBe(true);
    const json = { contents: [item("v1", "Son de fan", [run("Naf' Manson", "MUSIC_PAGE_TYPE_USER_CHANNEL"), run(" • "), run("5:21")])] };
    expect((P as unknown as { tracks: (j: unknown) => T[] }).tracks(json)[0].artists).toEqual([{ name: "Naf' Manson", id: null }]);
  });

  it("page d'artiste réelle : tous ses titres, ses carrousels, ses auditeurs et sa présentation", () => {
    type Card = { kind: string; id: string; title: string; subtitle: string; thumbnail: string | null; year?: string | null; playlistId?: string };
    type Page = { name: string; subtitle: string | null; tracks: { videoId: string }[]; songsId: string | null; sections: { title: string; items: Card[] }[]; about: string | null };
    const P6 = P as unknown as { artistPage: (j: unknown) => Page };
    const page = P6.artistPage(JSON.parse(readFileSync(join(__dirname, "fixtures", "artist-travis-scott.json"), "utf8")));
    expect(page.name).toBe("Travis Scott");
    expect(page.subtitle).toMatch(/auditeurs/);
    expect(page.tracks).toHaveLength(5);
    // « Tout afficher » : la liste de lecture de tous ses titres
    expect(page.songsId).toMatch(/^VL/);
    const by = (title: string) => page.sections.find((s) => s.title === title);
    expect(page.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Albums", "Singles et EP", "Vidéos", "Vous aimerez peut-être aussi"]));
    expect(by("Albums")!.items.every((c) => c.kind === "album" && /^MPRE/.test(c.id) && !!c.year)).toBe(true);
    expect(by("Vidéos")!.items.every((c) => c.kind === "video" && !!c.id)).toBe(true);
    expect(by("Vous aimerez peut-être aussi")!.items.every((c) => c.kind === "artist" && /^UC/.test(c.id))).toBe(true);
    const lists = page.sections.flatMap((s) => s.items).filter((c) => c.kind === "playlist");
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((c) => c.playlistId && !c.playlistId.startsWith("VL"))).toBe(true);
    expect(page.sections.flatMap((s) => s.items).every((c) => c.title && c.thumbnail)).toBe(true);
    expect(page.about?.length).toBeGreaterThan(100);
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
