// Music in the Box : traduction des réponses InnerTube de YouTube Music en types simples.
// C'est la partie fragile (YouTube change ses réponses sans prévenir) : elle est isolée ici,
// sans dépendance au navigateur, et testée sur des réponses enregistrées
// (`src/services/musicBox.parse.test.ts`, fixtures dans `src-tauri/src/music/fixtures/`).
// Injectée dans la page avant `bridge.js` (même portée : fonctions globales `ytmParse*`).
var ytmParse = (function () {
  var TIME = /^\d+(:\d\d)+$/;
  // séparateur « • » entouré d'espaces ordinaires ou insécables
  var SEP = /\s*•\s*/;

  function text(o) {
    if (!o) return '';
    if (typeof o.simpleText === 'string') return o.simpleText;
    return (o.runs || []).map(function (r) { return r.text; }).join('');
  }
  function thumb(o) {
    if (!o) return null;
    var list = o.thumbnails
      || (o.musicThumbnailRenderer && o.musicThumbnailRenderer.thumbnail && o.musicThumbnailRenderer.thumbnail.thumbnails)
      || (o.thumbnail && o.thumbnail.thumbnails);
    if (!list || !list.length) return null;
    return list[list.length - 1].url;
  }
  // Parcourt toute la réponse et rend chaque objet portant la clé demandée, dans l'ordre.
  function collect(root, key) {
    var out = [], stack = [root], HIT = {};
    while (stack.length) {
      var v = stack.pop();
      if (v === HIT) { out.push(stack.pop()); continue; }
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) { for (var i = v.length - 1; i >= 0; i--) stack.push(v[i]); continue; }
      var keys = Object.keys(v);
      for (var j = keys.length - 1; j >= 0; j--) {
        // une trouvaille est rangée à sa place dans le parcours (ordre du document)
        if (keys[j] === key) { stack.push(v[keys[j]]); stack.push(HIT); }
        else stack.push(v[keys[j]]);
      }
    }
    return out;
  }
  function find(root, key) { var r = collect(root, key); return r.length ? r[0] : undefined; }

  function pageType(run) {
    var b = run && run.navigationEndpoint && run.navigationEndpoint.browseEndpoint;
    var c = b && b.browseEndpointContextSupportedConfigs && b.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig;
    return (c && c.pageType) || '';
  }

  // Artistes liés d'un texte : chacun avec l'identifiant de sa page (UC…) quand YouTube Music le
  // donne (page d'artiste) ; une chaîne d'utilisateur (vidéo importée, son de fan) n'en a pas.
  function artistRefs(runs) {
    return runs.filter(function (x) { return /ARTIST|USER_CHANNEL/.test(pageType(x)); }).map(function (x) {
      var id = /ARTIST/.test(pageType(x)) ? x.navigationEndpoint.browseEndpoint.browseId : null;
      return { name: x.text, id: id && /^UC/.test(id) ? id : null };
    });
  }

  // Une ligne de liste (recherche, playlist) : titre, artistes, album, durée.
  function track(r) {
    var cols = (r.flexColumns || []).map(function (c) {
      return c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text;
    });
    var videoId = (r.playlistItemData && r.playlistItemData.videoId) || (find(r.overlay, 'watchEndpoint') || {}).videoId;
    if (!videoId) return null;
    // colonnes 2 et suivantes (artistes, album, durée) : séparées comme un seul texte « a • b »
    var runs = [];
    for (var i = 1; i < cols.length; i++) {
      var cr = (cols[i] && cols[i].runs) || [];
      if (!cr.length) continue;
      if (runs.length) runs.push({ text: ' • ' });
      runs = runs.concat(cr);
    }
    var artists = runs.filter(function (x) { return /ARTIST|USER_CHANNEL/.test(pageType(x)); }).map(function (x) { return x.text; });
    var album = runs.filter(function (x) { return /ALBUM/.test(pageType(x)); }).map(function (x) { return x.text; })[0] || null;
    var parts = runs.map(function (x) { return x.text; }).join('').split(SEP).map(function (s) { return s.trim(); }).filter(Boolean);
    var fixed = (r.fixedColumns || []).map(function (c) {
      return text(c.musicResponsiveListItemFixedColumnRenderer && c.musicResponsiveListItemFixedColumnRenderer.text).trim();
    });
    var duration = fixed.concat(parts).filter(function (s) { return TIME.test(s); })[0] || null;
    // sans lien d'artiste : premier morceau qui n'est ni un type (« Titre »), ni des vues, ni une durée
    var guess = parts.filter(function (s, k) {
      return !TIME.test(s) && !/\d.*(vues|views|écoutes|lectures|plays)/i.test(s) && !(k === 0 && parts.length > 2);
    })[0];
    return {
      videoId: videoId,
      title: text(cols[0]),
      artist: artists.length ? artists.join(', ') : guess || parts[0] || '',
      artists: artistRefs(runs),
      album: album,
      duration: duration,
      thumbnail: thumb(r.thumbnail)
    };
  }
  function tracks(json) {
    var seen = {}, out = [];
    collect(json, 'musicResponsiveListItemRenderer').forEach(function (r) {
      var t = track(r);
      if (t && !seen[t.videoId]) { seen[t.videoId] = 1; out.push(t); }
    });
    return out;
  }

  // Artistes d'une recherche : lignes qui mènent à une page d'artiste, et la carte du
  // meilleur résultat quand c'est un artiste.
  function artists(json) {
    var out = [], seen = {};
    var add = function (id, name, subtitle, thumbnail) {
      if (!id || seen[id] || !name) return;
      seen[id] = 1;
      // « Artiste • 65 M auditeurs/mois » → « 65 M auditeurs/mois »
      var sub = String(subtitle || '').split(SEP).filter(function (s) { return s && !/^artist(e)?$/i.test(s.trim()); }).join(' • ');
      out.push({ id: id, name: name, subtitle: sub, thumbnail: thumbnail || null });
    };
    collect(json, 'musicCardShelfRenderer').forEach(function (c) {
      var run = c.title && c.title.runs && c.title.runs[0];
      if (run && /ARTIST/.test(pageType(run))) add(run.navigationEndpoint.browseEndpoint.browseId, run.text, text(c.subtitle), thumb(c.thumbnail));
    });
    collect(json, 'musicResponsiveListItemRenderer').forEach(function (r) {
      var b = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
      if (!b || !/ARTIST/.test(pageType({ navigationEndpoint: r.navigationEndpoint }))) return;
      var cols = (r.flexColumns || []).map(function (c) { return c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text; });
      add(b.browseId, text(cols[0]), text(cols[1]), thumb(r.thumbnail));
    });
    return out;
  }

  // Une carte de carrousel (page d'artiste) : album ou single (MPRE…), playlist (VL…), artiste
  // (UC…) ou vidéo. null pour tout le reste (rien d'inconnu n'est proposé à l'écran).
  function card(r) {
    var ne = r.navigationEndpoint || {}, b = ne.browseEndpoint, w = ne.watchEndpoint;
    var id = (b && b.browseId) || '';
    var kind = w && w.videoId ? 'video' : /^MPRE/.test(id) ? 'album' : /^VL/.test(id) ? 'playlist' : /^UC/.test(id) ? 'artist' : null;
    var title = text(r.title);
    if (!kind || !title) return null;
    var out = { kind: kind, id: kind === 'video' ? w.videoId : id, title: title, subtitle: text(r.subtitle), thumbnail: thumb(r.thumbnailRenderer) };
    if (kind === 'album') {
      var info = albumInfo((r.subtitle && r.subtitle.runs) || []);
      out.year = info.year; out.type = info.type; out.artist = info.artist;
    }
    if (kind === 'playlist') out.playlistId = id.slice(2);
    return out;
  }

  // Page d'un artiste : nom, photo, auditeurs, titres populaires et la liste de tous ses titres
  // (« Tout afficher »), puis chaque carrousel tel que YouTube Music le montre (albums, singles,
  // vidéos, playlists, artistes proches…), et sa présentation.
  function artistPage(json) {
    var h = find(json, 'musicImmersiveHeaderRenderer') || find(json, 'musicVisualHeaderRenderer') || find(json, 'musicResponsiveHeaderRenderer') || {};
    var shelf = find(json, 'musicShelfRenderer');
    var more = shelf && ((shelf.bottomEndpoint && shelf.bottomEndpoint.browseEndpoint) || (find(shelf.title, 'browseEndpoint')));
    var songs = more && /^VL/.test(more.browseId || '') ? more.browseId : null;
    var sections = collect(json, 'musicCarouselShelfRenderer').map(function (c) {
      var hd = c.header && c.header.musicCarouselShelfBasicHeaderRenderer;
      var items = (c.contents || []).map(function (x) { return x.musicTwoRowItemRenderer ? card(x.musicTwoRowItemRenderer) : null; }).filter(Boolean);
      return { title: text(hd && hd.title), items: items };
    }).filter(function (s) { return s.title && s.items.length; });
    var about = find(json, 'musicDescriptionShelfRenderer');
    var aboutText = (about && text(about.description)) || text(h.description) || '';
    return {
      name: text(h.title),
      thumbnail: thumb(h.thumbnail) || thumb(h.foregroundThumbnail),
      subtitle: text(h.monthlyListenerCount) || null,
      tracks: shelf ? tracks(shelf) : [],
      songsId: songs,
      sections: sections,
      about: aboutText.replace(/\r/g, '').trim() || null
    };
  }

  // Albums d'une recherche : lignes qui mènent à une page d'album (identifiant MPRE…), et
  // la carte du meilleur résultat quand c'est un album.
  // Sous-titre : « Album • Daft Punk • 2001 » → artiste « Daft Punk », année « 2001 » ;
  // le type n'est gardé que s'il dit autre chose qu'« Album » (EP, Single).
  function albumInfo(runs) {
    var parts = runs.map(function (x) { return x.text; }).join('').split(SEP).map(function (s) { return s.trim(); }).filter(Boolean);
    var linked = runs.filter(function (x) { return /ARTIST|USER_CHANNEL/.test(pageType(x)); }).map(function (x) { return x.text; });
    var year = parts.filter(function (s) { return /^\d{4}$/.test(s); })[0] || null;
    var type = parts.length > 1 && !/^\d/.test(parts[0]) && linked.indexOf(parts[0]) < 0 ? parts[0] : null;
    var rest = parts.filter(function (s) { return s !== type && s !== year; });
    return { artist: linked.length ? linked.join(', ') : rest[0] || '', year: year, type: type && !/^album$/i.test(type) ? type : null };
  }
  function albums(json) {
    var out = [], seen = {};
    var add = function (id, title, runs, thumbnail) {
      if (!id || !/^MPRE/.test(id) || seen[id] || !title) return;
      seen[id] = 1;
      var info = albumInfo(runs || []);
      out.push({ id: id, title: title, artist: info.artist, year: info.year, type: info.type, thumbnail: thumbnail || null });
    };
    collect(json, 'musicCardShelfRenderer').forEach(function (c) {
      var run = c.title && c.title.runs && c.title.runs[0];
      if (run && /ALBUM/.test(pageType(run))) add(run.navigationEndpoint.browseEndpoint.browseId, run.text, (c.subtitle && c.subtitle.runs) || [], thumb(c.thumbnail));
    });
    collect(json, 'musicResponsiveListItemRenderer').forEach(function (r) {
      var b = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
      if (!b || !/^MPRE/.test(b.browseId || '')) return;
      var cols = (r.flexColumns || []).map(function (c) { return c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text; });
      add(b.browseId, text(cols[0]), (cols[1] && cols[1].runs) || [], thumb(r.thumbnail));
    });
    return out;
  }

  // Page d'un album : nom, artiste, pochette, titres, et sa liste de lecture (OLAK5uy_…) pour
  // le lire en entier. Les titres d'un album n'ont souvent ni artiste ni image : ceux de
  // l'album les remplacent (jamais le nombre d'écoutes pris pour un artiste).
  function albumPage(json) {
    var h = find(json, 'musicResponsiveHeaderRenderer') || find(json, 'musicDetailHeaderRenderer') || find(json, 'musicImmersiveHeaderRenderer') || {};
    var info = albumInfo((h.subtitle && h.subtitle.runs) || []);
    var artist = text(h.straplineTextOne) || info.artist;
    var cover = thumb(h.thumbnail);
    var shelf = find(json, 'musicShelfRenderer') || find(json, 'musicPlaylistShelfRenderer');
    var list = shelf ? tracks(shelf) : [];
    list.forEach(function (t) {
      if (!t.artist || /\d.*(vues|views|écoutes|lectures|plays)/i.test(t.artist) || TIME.test(t.artist)) t.artist = artist;
      if (!t.thumbnail) t.thumbnail = cover;
      if (!t.album) t.album = text(h.title) || null;
    });
    // la liste de CET album : ses propres titres d'abord, puis l'adresse de la page, puis l'en-tête ;
    // jamais une recherche dans toute la page (les carrousels « Autres versions », « Vous aimerez
    // aussi » portent les listes d'autres albums)
    var we = shelf && collect(shelf, 'watchEndpoint').filter(function (w) { return w && w.playlistId; })[0];
    var pl = we && we.playlistId;
    if (!pl) {
      var m = /[?&]list=([\w-]+)/.exec((find(json, 'microformatDataRenderer') || {}).urlCanonical || '');
      pl = m && m[1];
    }
    if (!pl) pl = (find(h, 'watchPlaylistEndpoint') || {}).playlistId;
    return { title: text(h.title), artist: artist, year: info.year, thumbnail: cover, playlistId: pl || null, tracks: list };
  }

  // Cartes de playlists (bibliothèque).
  function playlists(json) {
    var out = [], seen = {};
    collect(json, 'musicTwoRowItemRenderer').forEach(function (r) {
      var b = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
      if (!b || !/^VL/.test(b.browseId || '') || seen[b.browseId]) return;
      seen[b.browseId] = 1;
      out.push({ id: b.browseId, playlistId: b.browseId.slice(2), title: text(r.title), subtitle: text(r.subtitle), thumbnail: thumb(r.thumbnailRenderer) });
    });
    return out;
  }

  // Jeton de la page suivante d'une liste (playlist longue).
  function continuation(json) {
    var c = find(json, 'continuationCommand');
    if (c && c.token) return { token: c.token, legacy: false };
    var n = find(json, 'nextContinuationData');
    if (n && n.continuation) return { token: n.continuation, legacy: true };
    return null;
  }

  // Une page de playlist : seulement l'étagère de la playlist (pas les « suggestions » de
  // YouTube en dessous), et le jeton de sa page suivante.
  function playlistPage(json) {
    var root = find(json, 'musicPlaylistShelfRenderer') || find(json, 'musicPlaylistShelfContinuation') || find(json, 'appendContinuationItemsAction');
    if (!root) return { tracks: [], next: null };
    return { tracks: tracks(root), next: continuation(root) };
  }

  // État « J'aime » d'un titre (réponse `next`) : true, false, ou null si absent.
  function likeStatus(json) {
    var e = find(json, 'likeStatusEntity');
    var s = (e && e.likeStatus) || (find(json, 'likeButtonRenderer') || {}).likeStatus;
    return s ? s === 'LIKE' : null;
  }

  // File d'attente (`next`) : titres de la file, celui en cours marqué. Chaque titre peut
  // exister en deux versions (audio et clip, « counterpart ») : seule la principale compte.
  function queue(json) {
    var out = [], seen = {};
    var panel = find(json, 'playlistPanelRenderer');
    ((panel && panel.contents) || []).map(panelVideo).forEach(function (r) {
      if (!r || !r.videoId || seen[r.videoId]) return;
      seen[r.videoId] = 1;
      out.push(queueItem(r));
    });
    return out;
  }

  // titre d'une file : le rendu principal (audio) quand il existe en deux versions
  function panelVideo(c) {
    if (!c) return null;
    if (c.playlistPanelVideoRenderer) return c.playlistPanelVideoRenderer;
    var w = c.playlistPanelVideoWrapperRenderer;
    return (w && w.primaryRenderer && w.primaryRenderer.playlistPanelVideoRenderer) || null;
  }

  function queueItem(r) {
    var by = (r.shortBylineText && r.shortBylineText.runs) || (r.longBylineText && r.longBylineText.runs) || [];
    var w = r.navigationEndpoint && r.navigationEndpoint.watchEndpoint;
    // artistes liés : la première partie de la ligne longue (avant « • vues »)
    var long = (r.longBylineText && r.longBylineText.runs) || [], head = [];
    for (var k = 0; k < long.length && !/^s*•s*$/.test(long[k].text); k++) head.push(long[k]);
    return {
      videoId: r.videoId,
      title: text(r.title),
      artist: by.map(function (x) { return x.text; }).join('').split(SEP)[0] || '',
      artists: artistRefs(head),
      duration: text(r.lengthText) || null,
      thumbnail: thumb(r.thumbnail),
      selected: !!r.selected,
      playlistId: (w && w.playlistId) || null,
      index: w && typeof w.index === 'number' ? w.index : null
    };
  }

  // File du lecteur de la page (titres ajoutés compris) : chaque titre garde sa place
  // (`queueIndex`), un même titre peut y figurer deux fois ; `current` : la place du titre en cours.
  function queueItems(items, current) {
    var out = [];
    (items || []).forEach(function (c, i) {
      var r = panelVideo(c);
      if (!r || !r.videoId) return;
      var q = queueItem(r);
      q.selected = i === current;
      q.queueIndex = i;
      out.push(q);
    });
    return out;
  }

  // File (`next`) et ce qu'il y a au-delà : `more` quand la file continue (radio sans fin, page
  // suivante), et la suite automatique que YouTube Music propose quand elle s'arrête (« automix »,
  // RDAMVM…, lue par son lecteur web à la fin de la file ; le pont s'en charge lui-même).
  function queueInfo(json) {
    var panel = find(json, 'playlistPanelRenderer') || {};
    var mix = find(json, 'automixPreviewVideoRenderer');
    var w = mix && find(mix, 'watchPlaylistEndpoint');
    return {
      items: queue(json),
      playlistId: panel.playlistId || null,
      more: !!(panel.isInfinite || panel.continuations),
      automix: w && w.playlistId ? { playlistId: w.playlistId, params: w.params || null } : null
    };
  }

  // Paroles, étape 1 (réponse `next`) : identifiant de la page de paroles du titre (MPLY…),
  // ou null quand YouTube Music n'en a pas (onglet « Paroles » grisé, `unselectable`).
  function lyricsId(json) {
    var tabs = collect(json, 'tabRenderer');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i], b = t && t.endpoint && t.endpoint.browseEndpoint;
      if (!b || t.unselectable) continue;
      if (/TRACK_LYRICS/.test(pageType({ navigationEndpoint: t.endpoint })) || /^MPLY/.test(b.browseId || '')) return b.browseId;
    }
    return null;
  }

  // Paroles, étape 2 (réponse `browse` de cette page) : les lignes dans l'ordre (une ligne
  // vide sépare deux couplets) et la source affichée par YouTube Music. null quand la page
  // ne porte qu'un message (« Paroles non disponibles »).
  function lyrics(json) {
    var shelf = find(json, 'musicDescriptionShelfRenderer');
    var body = shelf ? text(shelf.description).replace(/\r/g, '').trim() : '';
    if (!body) return null;
    return {
      lines: body.split('\n').map(function (l) { return l.trim(); }),
      source: text(shelf.footer).trim() || null
    };
  }

  // Paroles horodatées (réponse `browse` de la même page, demandée comme l'application
  // mobile) : chaque ligne avec l'instant où elle commence, en millisecondes. null dès qu'une
  // ligne n'a pas d'horaire (clip, source sans synchronisation) : on se rabat sur `lyrics`.
  function timedLyrics(json) {
    var data = find(json, 'timedLyricsData');
    if (!Array.isArray(data) || !data.length) return null;
    var lines = [], times = [];
    for (var i = 0; i < data.length; i++) {
      var cue = data[i] && data[i].cueRange;
      var at = cue ? Number(cue.startTimeMilliseconds) : NaN;
      if (!isFinite(at) || at < 0) return null;
      lines.push(String(data[i].lyricLine || '').trim());
      times.push(at);
    }
    var source = find(json, 'sourceMessage');
    return { lines: lines, times: times, source: (typeof source === 'string' && source.trim()) || null };
  }

  return { text: text, collect: collect, track: track, tracks: tracks, artists: artists, artistPage: artistPage, albums: albums, albumPage: albumPage, playlists: playlists, continuation: continuation, playlistPage: playlistPage, likeStatus: likeStatus, queue: queue, queueItems: queueItems, panelVideo: panelVideo, queueInfo: queueInfo, lyricsId: lyricsId, lyrics: lyrics, timedLyrics: timedLyrics };
})();
