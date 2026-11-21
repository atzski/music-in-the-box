// Music in the Box : pont injecté dans music.youtube.com (fenêtre « ytmusic », voir ytm.rs),
// après `parse.js` (traduction des réponses, `ytmParse`). Aucun accès IPC : Rust appelle
// __ibox.start(req) puis __ibox.take(id) par évaluation de script. Chaque appel rend une
// chaîne JSON : {ok}, {error} ou {pending:true}.
(function () {
  if (window.top !== window || location.hostname !== 'music.youtube.com' || window.__ibox) return;

  var P = ytmParse;
  var results = {};
  var VERSION = 4;
  /** Pages lues au plus pour une playlist (environ 100 titres par page). */
  var MAX_PAGES = 10;

  // ——— Outils ———
  function cfg(k) {
    try { return window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : undefined; } catch (e) { return undefined; }
  }
  function player() { return document.getElementById('movie_player'); }

  async function sha1(s) {
    var buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Requête InnerTube depuis la page (mêmes cookies que YouTube Music lui-même).
  async function innertube(endpoint, body, query) {
    var ctx = cfg('INNERTUBE_CONTEXT');
    if (!ctx) throw new Error('page-pas-prete');
    var headers = {
      'Content-Type': 'application/json',
      'X-Goog-AuthUser': String(cfg('SESSION_INDEX') || 0),
      'X-Origin': location.origin,
      'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 67),
      'X-Youtube-Client-Version': String(cfg('INNERTUBE_CLIENT_VERSION') || ctx.client.clientVersion)
    };
    var sid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (sid) {
      var ts = Math.floor(Date.now() / 1000);
      headers.Authorization = 'SAPISIDHASH ' + ts + '_' + (await sha1(ts + ' ' + sid + ' ' + location.origin));
    }
    var page = cfg('DELEGATED_SESSION_ID');
    if (page) headers['X-Goog-PageId'] = page;
    var res = await fetch('/youtubei/v1/' + endpoint + '?prettyPrint=false' + (query || ''), {
      method: 'POST', credentials: 'include', headers: headers,
      body: JSON.stringify(Object.assign({ context: ctx }, body))
    });
    if (!res.ok) throw new Error('innertube-' + res.status);
    return res.json();
  }

  // Paroles horodatées : YouTube Music ne donne l'instant de chaque ligne qu'à son application
  // mobile. Même point d'entrée, autre client ; la demande est publique, envoyée sans cookies
  // ni jeton (rien du compte ne part avec elle).
  var APP_CLIENT = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' };
  async function innertubeApp(endpoint, body) {
    var web = (cfg('INNERTUBE_CONTEXT') || {}).client || {};
    var res = await fetch('/youtubei/v1/' + endpoint + '?prettyPrint=false', {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '21', 'X-Youtube-Client-Version': APP_CLIENT.clientVersion },
      body: JSON.stringify(Object.assign({ context: { client: Object.assign({ hl: web.hl, gl: web.gl }, APP_CLIENT) } }, body))
    });
    if (!res.ok) throw new Error('innertube-' + res.status);
    return res.json();
  }

  // ——— Aléatoire et répétition : boutons de la barre du lecteur ———
  // barre du lecteur : ancienne (ytmusic-player-bar) ou nouvelle mise en page (ytmusic-wiz-player-controls)
  function bar() { return document.querySelector('ytmusic-player-bar, ytmusic-wiz-player-controls') || document.body; }
  function barButton(kind) {
    var root = bar();
    var host = root.querySelector(kind === 'shuffle' ? '.shuffle' : '.repeat');
    var btn = host && (host.matches('button') ? host : host.querySelector('button'));
    if (btn) return btn;
    // repli : libellé accessible (français ou anglais), dans toute la page
    var re = kind === 'shuffle' ? /al[ée]atoire|shuffle/i : /r[ée]p[ée]t|repeat|boucle|loop/i;
    return Array.prototype.filter.call(document.querySelectorAll('button, [role=button]'), function (x) {
      return re.test(x.getAttribute('aria-label') || x.getAttribute('title') || '');
    })[0] || null;
  }
  // dernier recours : raccourcis clavier de YouTube Music (S : aléatoire, R : répétition)
  function shortcutKey(letter) {
    var code = letter.toUpperCase().charCodeAt(0);
    ['keydown', 'keyup'].forEach(function (type) {
      document.body.dispatchEvent(new KeyboardEvent(type, { key: letter, code: 'Key' + letter.toUpperCase(), keyCode: code, which: code, bubbles: true, composed: true }));
    });
  }
  // « NONE », « ALL » ou « ONE » → none, all, one ; null si inconnu
  function repeatMode() {
    var b = bar();
    var m = b && (b.getAttribute('repeat-mode') || b.getAttribute('repeat-mode_') || (b.repeatMode_ || b.repeatMode));
    if (typeof m === 'string' && /^(NONE|ALL|ONE)$/.test(m)) return m.toLowerCase();
    var btn = barButton('repeat');
    var label = btn ? (btn.getAttribute('aria-label') || btn.getAttribute('title') || '') : '';
    // « Lecture en boucle désactivée », « … du titre », « … de la playlist » (ou en anglais)
    if (/d[ée]sactiv|\boff\b/i.test(label)) return 'none';
    if (/un seul|titre|morceau|\bone\b|track|song/i.test(label)) return 'one';
    if (/tous|tout|playlist|liste|\ball\b|activ/i.test(label)) return 'all';
    return null;
  }
  function shuffleState() {
    var btn = barButton('shuffle');
    if (!btn) return null;
    var p = btn.getAttribute('aria-pressed');
    if (p === 'true' || p === 'false') return p === 'true';
    var host = btn.closest('.shuffle');
    return host ? host.hasAttribute('active') || host.classList.contains('active') : null;
  }

  // ——— Lecture ———
  function state() {
    var p = player(), m = navigator.mediaSession && navigator.mediaSession.metadata;
    var art = m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null;
    var data = p && p.getVideoData ? p.getVideoData() : {};
    if (cfg('LOGGED_IN')) refreshLike(data.video_id);
    return {
      bridge: VERSION,
      loggedIn: !!cfg('LOGGED_IN'),
      visibility: document.visibilityState,
      ready: !!(p && p.getPlayerState),
      // -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 en file
      playerState: p && p.getPlayerState ? p.getPlayerState() : null,
      videoId: data.video_id || null,
      playlistId: p && p.getPlaylistId ? p.getPlaylistId() || null : null,
      title: (m && m.title) || data.title || null,
      artist: (m && m.artist) || data.author || null,
      album: (m && m.album) || null,
      artwork: art,
      position: p && p.getCurrentTime ? p.getCurrentTime() : 0,
      duration: p && p.getDuration ? p.getDuration() : 0,
      volume: p && p.getVolume ? p.getVolume() : null,
      muted: p && p.isMuted ? p.isMuted() : null,
      liked: data.video_id && likes[data.video_id] != null ? likes[data.video_id] : null,
      shuffle: shuffleState(),
      repeat: repeatMode()
    };
  }
  function needPlayer() {
    var p = player();
    if (!p || !p.getPlayerState) throw new Error('lecteur-absent');
    return p;
  }
  function navigate(endpoint, href) {
    var app = document.querySelector('ytmusic-app');
    if (app) app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: endpoint } }));
    // Repli : rechargement complet si la navigation interne n'a rien donné.
    var want = endpoint.watchEndpoint && endpoint.watchEndpoint.videoId;
    setTimeout(function () {
      var p = player(), now = p && p.getVideoData ? p.getVideoData().video_id : null;
      if (!app || (want && now !== want)) location.href = href;
    }, 2500);
  }

  // « Vidéo mise en pause. Continuer ? » : apparaît après une longue écoute sans interaction.
  setInterval(function () {
    var d = document.querySelector('ytmusic-you-there-renderer');
    if (d && d.offsetParent !== null) {
      var b = d.querySelector('button, tp-yt-paper-button, yt-button-renderer');
      if (b) b.click();
    }
  }, 4000);

  async function playlistTracks(id) {
    if (!/^VL/.test(id)) id = 'VL' + id;
    var first = P.playlistPage(await innertube('browse', { browseId: id }));
    var out = first.tracks, seen = {};
    out.forEach(function (t) { seen[t.videoId] = 1; });
    var next = first.next;
    for (var page = 1; next && page < MAX_PAGES; page++) {
      var json = next.legacy
        ? await innertube('browse', {}, '&ctoken=' + encodeURIComponent(next.token) + '&continuation=' + encodeURIComponent(next.token) + '&type=next')
        : await innertube('browse', { continuation: next.token });
      var p = P.playlistPage(json);
      var more = p.tracks.filter(function (t) { return !seen[t.videoId]; });
      if (!more.length) break;
      more.forEach(function (t) { seen[t.videoId] = 1; out.push(t); });
      next = p.next;
    }
    return out;
  }

  // « J'aime » du titre en cours : lu une fois par titre (réponse `next`), gardé ici.
  var likes = {}, likeLoading = null;
  // Paroles : page de paroles par titre (lue dans la même réponse `next` que le « J'aime »
  // quand elle est déjà passée), puis le texte lui-même, gardé par titre.
  var lyricsPages = {}, lyricsCache = {};
  function refreshLike(videoId) {
    if (!videoId || videoId in likes || likeLoading === videoId) return;
    likeLoading = videoId;
    innertube('next', { videoId: videoId, isAudioOnly: true }).then(function (j) {
      likes[videoId] = P.likeStatus(j);
      lyricsPages[videoId] = P.lyricsId(j);
    }, function () {}).then(function () { if (likeLoading === videoId) likeLoading = null; });
  }

  var COMMANDS = {
    state: function () { return state(); },
    toggle: function () { var p = needPlayer(); if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); return true; },
    play: function () { needPlayer().playVideo(); return true; },
    pause: function () { needPlayer().pauseVideo(); return true; },
    next: function () { needPlayer().nextVideo(); return true; },
    prev: function () { needPlayer().previousVideo(); return true; },
    seek: function (a) { needPlayer().seekTo(Number(a && a.seconds) || 0, true); return true; },
    volume: function (a) { var p = needPlayer(); p.setVolume(Math.max(0, Math.min(100, Number(a && a.value) || 0))); if (p.isMuted()) p.unMute(); return true; },
    // « J'aime » du titre en cours : bascule et rend le nouvel état
    like: async function () {
      var p = needPlayer(), id = p.getVideoData ? p.getVideoData().video_id : null;
      if (!id) throw new Error('aucun-titre');
      if (!cfg('LOGGED_IN')) throw new Error('non-connecte');
      var now = !likes[id];
      await innertube(now ? 'like/like' : 'like/removelike', { target: { videoId: id } });
      likes[id] = now;
      return now;
    },
    // mélange la file (bouton de la barre du lecteur)
    shuffle: function () {
      var b = barButton('shuffle');
      if (b) b.click();
      else shortcutKey('s');
      return true;
    },
    // répétition : aucune → toute la liste → un titre → aucune
    repeat: function () {
      var b = barButton('repeat');
      if (b) b.click();
      else shortcutKey('r');
      return repeatMode();
    },
    // diagnostic : structure de la page autour du lecteur (pour ajuster les sélecteurs)
    probe: function () {
      var tags = {};
      Array.prototype.forEach.call(document.querySelectorAll('*'), function (x) {
        var t = x.tagName.toLowerCase();
        if (/player|bar|queue/.test(t)) tags[t] = (tags[t] || 0) + 1;
      });
      var b = document.querySelector('ytmusic-player-bar, ytmusic-wiz-player-controls');
      return {
        url: location.pathname,
        tags: tags,
        bar: b ? Array.prototype.map.call(b.attributes, function (x) { return x.name + '=' + x.value.slice(0, 30); }) : null,
        buttons: Array.prototype.map.call((b || document).querySelectorAll('button[aria-label], [role=button][aria-label], [title]'), function (x) {
          return [x.tagName.toLowerCase(), x.getAttribute('aria-label'), x.getAttribute('aria-pressed'), ((x.parentElement || {}).className || '').toString().slice(0, 40)].join(' | ');
        }).filter(function (s) { return !/j.aime/i.test(s); }).slice(0, 25)
      };
    },
    // recherche par catégorie (filtres de YouTube Music) : titres, vidéos, artistes ou albums
    search: async function (a) {
      var q = String((a && a.query) || '').trim();
      if (!q) return [];
      var KINDS = {
        songs: ['EgWKAQIIAWoMEA4QChADEAQQCRAF', P.tracks],
        // vidéos : ce que YouTube Music a de plus que les autres (sons de fans, extraits, remix…)
        videos: ['EgWKAQIQAWoMEA4QChADEAQQCRAF', P.tracks],
        artists: ['EgWKAQIgAWoMEA4QChADEAQQCRAF', P.artists],
        albums: ['EgWKAQIYAWoMEA4QChADEAQQCRAF', P.albums]
      };
      var k = KINDS[a && a.kind] || KINDS.songs;
      var params = k[0], parse = k[1];
      var list = parse(await innertube('search', { query: q, params: params }));
      // aucun titre officiel : liste vide, iBox montre alors l'onglet Vidéos (sons de fans,
      // extraits, remix…) ; pour les autres filtres (refusés ou vides) : résultats mélangés
      if (list.length || a.kind === 'songs') return list;
      return parse(await innertube('search', { query: q }));
    },
    // page d'un artiste : titres populaires
    artist: async function (a) {
      var id = String((a && a.id) || '');
      if (!/^UC/.test(id)) throw new Error('artiste-inconnu');
      return P.artistPage(await innertube('browse', { browseId: id }));
    },
    // page d'un album : titres, et la liste de lecture qui permet de le lire en entier
    album: async function (a) {
      var id = String((a && a.id) || '');
      if (!/^MPRE/.test(id)) throw new Error('album-inconnu');
      return P.albumPage(await innertube('browse', { browseId: id }));
    },
    playlists: async function () {
      if (!cfg('LOGGED_IN')) throw new Error('non-connecte');
      return P.playlists(await innertube('browse', { browseId: 'FEmusic_liked_playlists' }));
    },
    playlist: function (a) { return playlistTracks(String((a && a.id) || '')); },
    // une page à la fois : {id} pour la première, puis {next} rendu par la page précédente.
    // L'interface affiche la première page aussitôt et complète la suite pendant qu'on lit.
    playlistPage: async function (a) {
      var next = a && a.next;
      if (!next) {
        var id = String((a && a.id) || '');
        if (!/^VL/.test(id)) id = 'VL' + id;
        return P.playlistPage(await innertube('browse', { browseId: id }));
      }
      var json = next.legacy
        ? await innertube('browse', {}, '&ctoken=' + encodeURIComponent(next.token) + '&continuation=' + encodeURIComponent(next.token) + '&type=next')
        : await innertube('browse', { continuation: next.token });
      return P.playlistPage(json);
    },
    // file d'attente du titre en cours (titres suivants de la playlist ou de la radio)
    queue: async function () {
      var p = needPlayer(), d = p.getVideoData ? p.getVideoData() : {};
      if (!d.video_id) return [];
      var body = { videoId: d.video_id, isAudioOnly: true };
      var list = p.getPlaylistId && p.getPlaylistId();
      if (list) body.playlistId = list;
      return P.queue(await innertube('next', body));
    },
    // paroles d'un titre (celui en cours par défaut) : {lines, source}, avec {times} (début de
    // chaque ligne, en ms) quand elles sont synchronisées ; null quand YouTube Music n'en a
    // pas. Gardées par titre : rouvrir l'onglet ne relance aucune requête.
    lyrics: async function (a) {
      var p = player();
      var id = String((a && a.videoId) || (p && p.getVideoData ? p.getVideoData().video_id : '') || '');
      if (!id) throw new Error('aucun-titre');
      if (id in lyricsCache) return lyricsCache[id];
      var page = id in lyricsPages ? lyricsPages[id] : P.lyricsId(await innertube('next', { videoId: id, isAudioOnly: true }));
      lyricsPages[id] = page;
      var out = null;
      if (page) {
        // d'abord les paroles horodatées ; à défaut (clip, refus, source sans horaires), le texte seul
        try { out = P.timedLyrics(await innertubeApp('browse', { browseId: page })); } catch (e) { out = null; }
        if (!out) out = P.lyrics(await innertube('browse', { browseId: page }));
      }
      lyricsCache[id] = out;
      return out;
    },
    // {videoId} et/ou {playlistId}, {index} : position dans la playlist
    playItem: function (a) {
      var w = {}, q = [];
      if (a && a.videoId) { w.videoId = String(a.videoId); q.push('v=' + encodeURIComponent(w.videoId)); }
      if (a && a.playlistId) { w.playlistId = String(a.playlistId).replace(/^VL/, ''); q.push('list=' + encodeURIComponent(w.playlistId)); }
      if (a && typeof a.index === 'number') { w.index = a.index; q.push('index=' + a.index); }
      if (!q.length) throw new Error('rien-a-lire');
      navigate({ watchEndpoint: w }, '/watch?' + q.join('&'));
      return true;
    },
    // réponse brute d'InnerTube, pour enregistrer des réponses de test (fixtures)
    raw: function (a) {
      if (!a || !/^(browse|search|next)$/.test(a.endpoint)) throw new Error('point-inconnu');
      return innertube(a.endpoint, a.body || {});
    }
  };

  function wrap(v) { return JSON.stringify(v); }
  function fail(e) { return { error: String((e && e.message) || e || 'erreur') }; }

  window.__ibox = {
    start: function (req) {
      var fn = COMMANDS[req && req.cmd];
      if (!fn) return wrap({ error: 'commande-inconnue' });
      try {
        var r = fn(req.arg);
        if (r && typeof r.then === 'function') {
          results[req.id] = { pending: true };
          r.then(function (v) { results[req.id] = { ok: v }; }, function (e) { results[req.id] = fail(e); });
          return wrap({ pending: true });
        }
        return wrap({ ok: r });
      } catch (e) {
        return wrap(fail(e));
      }
    },
    take: function (id) {
      var r = results[id];
      if (!r) return wrap({ error: 'resultat-perdu' });
      if (!r.pending) delete results[id];
      return wrap(r);
    }
  };
})();
