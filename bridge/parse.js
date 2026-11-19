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

  // Page d'un artiste : nom, photo, titres populaires (première étagère de titres).
  function artistPage(json) {
    var h = find(json, 'musicImmersiveHeaderRenderer') || find(json, 'musicVisualHeaderRenderer') || find(json, 'musicResponsiveHeaderRenderer') || {};
    var shelf = find(json, 'musicShelfRenderer');
    return { name: text(h.title), thumbnail: thumb(h.thumbnail) || thumb(h.foregroundThumbnail), tracks: shelf ? tracks(shelf) : [] };
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
    var items = ((panel && panel.contents) || []).map(function (c) {
      if (c.playlistPanelVideoRenderer) return c.playlistPanelVideoRenderer;
      var w = c.playlistPanelVideoWrapperRenderer;
      return w && w.primaryRenderer && w.primaryRenderer.playlistPanelVideoRenderer;
    });
    items.forEach(function (r) {
      if (!r || !r.videoId || seen[r.videoId]) return;
      seen[r.videoId] = 1;
      var by = (r.shortBylineText && r.shortBylineText.runs) || (r.longBylineText && r.longBylineText.runs) || [];
      var w = r.navigationEndpoint && r.navigationEndpoint.watchEndpoint;
      out.push({
        videoId: r.videoId,
        title: text(r.title),
        artist: by.map(function (x) { return x.text; }).join('').split(SEP)[0] || '',
        duration: text(r.lengthText) || null,
        thumbnail: thumb(r.thumbnail),
        selected: !!r.selected,
        playlistId: (w && w.playlistId) || null,
        index: w && typeof w.index === 'number' ? w.index : null
      });
    });
    return out;
  }

  return { text: text, collect: collect, track: track, tracks: tracks, artists: artists, artistPage: artistPage, playlists: playlists, continuation: continuation, playlistPage: playlistPage, likeStatus: likeStatus, queue: queue };
})();
