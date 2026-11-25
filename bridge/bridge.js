// Music in the Box : pont injecté dans music.youtube.com (fenêtre « ytmusic », voir ytm.rs),
// après `parse.js` (traduction des réponses, `ytmParse`). Aucun accès IPC : Rust appelle
// __ibox.start(req) puis __ibox.take(id) par évaluation de script. Chaque appel rend une
// chaîne JSON : {ok}, {error} ou {pending:true}.
(function () {
  if (window.top !== window || location.hostname !== 'music.youtube.com' || window.__ibox) return;

  var P = ytmParse;
  var results = {};
  var VERSION = 8;
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

  // ——— Fondus entre les titres ———
  // YouTube Music n'a qu'un lecteur : deux titres ne se recouvrent pas. Le fondu est donc une
  // rampe de volume : le titre qui finit baisse, le suivant est lancé un peu avant la fin, puis
  // monte. Le gain (0 à 1) se déduit de la position dans le titre : une pause le fige, un
  // déplacement le recalcule, et aucun minuteur ne peut le laisser de travers. Le volume choisi
  // par l'utilisateur est gardé à part (`user`) pendant qu'on baisse, et toujours rendu.
  // Durées, courbe et transitions réglées à part : calculées par l'interface (`musicBox.ts`).
  var FADE_KEY = 'ibox.fade', FADE_USER_KEY = 'ibox.fade.user';
  var fade = {
    cfg: null,     // réglages reçus ; null : aucun fondu, le pont ne touche à rien
    timer: null,
    busy: false,
    at: 0,         // heure du dernier calcul
    g: 1,          // gain appliqué
    user: null,    // volume de l'utilisateur pendant qu'on baisse ; null : volume intact
    set: null,     // dernier volume posé par le fondu
    id: null,      // titre suivi, sa dernière position, l'heure de son départ
    pos: 0,
    since: 0,
    live: 0,       // dernière heure où le lecteur lisait, chargeait ou était en pause
    zone: null,    // fin du titre en cours : {id, out, cut, into, to, ticks, advanced}
    entry: null,   // entrée du titre en cours : {id, ms, at, seen}
    hold: null,    // silence tenu avant un changement de titre : {manual, run, until}
    video: null,
    lost: null,    // volume à rendre après un fondu interrompu (page rechargée)
    tries: 0
  };
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch (e) { /* stockage refusé */ }
  }
  function ms(v, max) { v = Number(v); return v > 0 && isFinite(v) ? Math.min(v, max) : 0; }
  function cleanPlan(p) {
    var out = p ? ms(p.out, 30000) : 0;
    return out ? { overlap: ms(p.overlap, 30000) || out + ms(p.into, 30000), out: out, into: ms(p.into, 30000), cut: ms(p.cut, 5000) } : null;
  }
  // réglages reçus, remis d'aplomb ; null quand plus rien ne demande de fondu
  function cleanFade(a) {
    if (!a || typeof a !== 'object') return null;
    var cfg = { quick: ms(a.quick, 2000) || 250, cross: a.cross === true, curve: [0, 1], rise: null, base: cleanPlan(a.base), pairs: {} }, any = !!cfg.base;
    var table = function (c) { return Array.isArray(c) && c.length > 1 && c.length < 258 && c.every(function (x) { return typeof x === 'number' && x >= 0 && x <= 1; }); };
    if (table(a.curve)) cfg.curve = a.curve;
    // courbe du fondu enchaîné : celle de l'interface, sinon le sinus
    if (table(a.rise)) cfg.rise = a.rise;
    else { cfg.rise = []; for (var i = 0; i <= 32; i++) cfg.rise.push(Math.sin(i / 32 * Math.PI / 2)); }
    Object.keys(a.pairs && typeof a.pairs === 'object' ? a.pairs : {}).slice(0, 200).forEach(function (from) {
      var p = a.pairs[from];
      if (!p || typeof p.to !== 'string') return;
      cfg.pairs[from] = { to: p.to, plan: cleanPlan(p.plan) };
      if (cfg.pairs[from].plan) any = true;
    });
    return any ? cfg : null;
  }
  // gain pour un avancement x : 0 (silence) à 1 (plein volume), entre les points de la courbe
  function curveAt(x) {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    var c = fade.cfg.curve, n = c.length - 1, i = Math.floor(x * n), t = x * n - i;
    return c[i] + (c[i + 1] - c[i]) * t;
  }
  function adPlaying(p) {
    return !!(p.classList && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
  }
  // fin du titre `id` : la transition réglée à part, sinon le réglage général ; un titre
  // court garde au moins sa moitié à plein volume (un quart pour l'entrée, un quart pour la fin)
  function endPlan(id, dur) {
    var pair = fade.cfg.pairs[id], plan = pair ? pair.plan : fade.cfg.base;
    if (!plan) return null;
    var k = Math.min(1, dur / 4 / (plan.out + plan.cut));
    return { id: id, out: plan.out * k, cut: plan.cut * k, into: plan.into, to: pair ? pair.to : null, ticks: 0, first: 0, advanced: false };
  }
  // rend le volume de l'utilisateur et oublie le fondu en cours
  function fadeRelease(p) {
    if (fade.user != null) {
      if (p && p.setVolume) {
        p.setVolume(fade.user);
        store(FADE_USER_KEY, null);
      } else fade.lost = fade.user; // lecteur absent : à rendre dès qu'il revient
    }
    fade.user = null; fade.set = null; fade.g = 1;
  }
  // pose le volume qui correspond au gain `g`
  function fadeVolume(p, g) {
    if (g >= 1) {
      if (fade.user != null) fadeRelease(p);
      fade.g = 1;
      return;
    }
    if (fade.user == null) {
      // on commence à baisser : le volume de l'utilisateur est mis de côté (et noté, au cas où
      // la page serait rechargée ou iBox fermé en plein fondu)
      fade.user = fade.lost != null ? fade.lost : p.getVolume();
      fade.lost = null;
      store(FADE_USER_KEY, fade.user);
    }
    // seul `user` dit ce que l'utilisateur veut : le volume du lecteur n'est relu que pour le
    // tenir (YouTube Music peut le reposer à sa valeur au changement de titre). Jamais tout à
    // fait zéro : un lecteur mis à zéro pourrait se croire coupé et le rester.
    var want = Math.max(fade.user > 0 ? 1 : 0, Math.round(fade.user * g));
    if (want !== fade.set || Math.abs(p.getVolume() - want) > 0.5) p.setVolume(want);
    fade.set = want;
    fade.g = g;
  }
  // un fondu interrompu a pu laisser le lecteur à bas volume : on rend le volume noté
  function fadeRecover(p) {
    if (fade.lost == null || fade.user != null || !p || !p.setVolume || !p.getVolume) return;
    if (Math.abs(p.getVolume() - fade.lost) <= 1 || ++fade.tries > 20) {
      fade.lost = null;
      store(FADE_USER_KEY, null);
    } else p.setVolume(fade.lost);
  }
  function runHeld() {
    var h = fade.hold, run = h && h.run;
    if (!run) return;
    h.run = null;
    h.until = Date.now() + 4000;
    try { run(); } catch (e) { fade.hold = null; }
  }
  // ——— Fondu enchaîné : un second lecteur, « l'écho » ———
  // Un vrai recouvrement demande deux sons à la fois. Le lecteur de la page reste le seul maître
  // (file, historique, paroles, « En cours ») ; un second lecteur YouTube Music, chargé dans un
  // cadre caché de cette même page (pas de seconde fenêtre), ne joue que des fins de titre. Il
  // reprend le titre en cours, muet, se cale sur lui, puis prend la parole à sa place au début du
  // fondu ; le lecteur de la page passe alors au titre suivant et monte pendant que l'écho finit
  // l'ancien en baissant (sinus et cosinus : le volume perçu ne creuse pas).
  // L'écho n'est réglé que par sa balise vidéo (muet, volume, vitesse) : ``setVolume`` sur son
  // lecteur écrirait le volume que YouTube Music garde pour les deux.
  // Repli automatique sur le fondu simple : cadre impossible, publicités dans l'écho, ou compte
  // qui met une lecture en pause quand l'autre démarre (« utilisé à un autre endroit »).
  var ECHO_KEY = 'ibox.fade.echo', ECHO_PREP = 12000, ECHO_IDLE = 180000, ECHO_RETRY = 86400000;
  // fondu enchaîné interrompu (déplacement, écho arrêté trop tôt) : l'écho s'éteint et le titre en
  // cours rejoint son plein volume en courbe, sur ces durées (ms), jamais d'un saut
  var CROSS_ABORT = 800, CROSS_RECOVER = 1000;
  var echo = {
    frame: null,
    doc: null,      // document du cadre déjà gardé (silence imposé)
    born: 0,
    used: 0,        // dernière heure où la musique jouait : l'écho est retiré après 3 min sans
    job: null,      // fin de titre préparée ou en cours
    skip: null,     // fin de titre à laisser au fondu simple : {id, since}
    speaking: false,
    gain: 0,
    norm: 1,        // volume de la balise / volume du lecteur, pour le titre en cours
    lat: 0.5,       // temps (s) entre « suivant » et le son du nouveau titre, appris à chaque fondu
    failed: null,   // raison du repli : 'compte', 'pub', 'indisponible'
    ads: 0,
    userPause: 0,   // dernière pause demandée par l'utilisateur
    route: null,    // son de l'écho par Web Audio : {ctx, gain, el, win}
    routeSince: 0   // depuis quand le branchement attend
  };
  (function () {
    var s = null;
    try { s = JSON.parse(stored(ECHO_KEY) || 'null'); } catch (e) { s = null; }
    // un compte ou des publicités qui empêchaient l'écho : on réessaie au bout d'un jour
    if (s && typeof s.reason === 'string' && Date.now() - Number(s.at) < ECHO_RETRY) echo.failed = s.reason;
    else store(ECHO_KEY, null);
  })();
  function riseAt(x) {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    var c = fade.cfg.rise, n = c.length - 1, i = Math.floor(x * n), t = x * n - i;
    return c[i] + (c[i + 1] - c[i]) * t;
  }
  function echoDoc() {
    try { var d = echo.frame && echo.frame.contentDocument; return d && d.getElementById ? d : null; } catch (e) { return null; }
  }
  function echoPlayer() {
    var d = echoDoc(), p = d && d.getElementById('movie_player');
    return p && p.getPlayerState ? p : null;
  }
  function echoVideo() {
    var d = echoDoc();
    return d ? d.querySelector('video') : null;
  }
  // tant que l'écho n'a pas la parole, sa balise reste muette, quoi que fasse son lecteur
  function echoGuard(e) {
    var v = e && e.target;
    if (v && !echo.speaking && v.muted === false && !(echo.route && echo.route.el === v)) v.muted = true;
  }
  // Son de l'écho : par un gain Web Audio, jamais par sa balise. Mesuré sur le vrai lecteur
  // (25/11/2026) : YouTube remet lui-même la balise de l'écho à « muted = false, volume = 1 » au
  // chargement et en pleine lecture ; la garde la recoupait après coup, et l'écho passait en
  // rafales de 4 à 30 ms, à 100 %, sans tenir compte du volume choisi (« sons en double, très
  // forts »). Branchée sur un gain qui reste à zéro tant que l'écho n'a pas la parole, la balise
  // peut faire ce qu'elle veut. Sans ce branchement, pas de fondu enchaîné (fondu simple).
  // rend true (branché), false (pas encore : contexte audio qui démarre) ou null (impossible)
  function echoRoute() {
    var v = echoVideo(), w = echo.frame && echo.frame.contentWindow, r = echo.route;
    if (!v || !w) return false;
    try {
      if (!r || r.win !== w || r.ctx.state === 'closed') {
        var AC = w.AudioContext || w.webkitAudioContext;
        if (!AC) return null;
        var ctx = new AC({ latencyHint: 'interactive' }), gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        r = echo.route = { ctx: ctx, gain: gain, el: null, win: w };
      }
      if (r.ctx.state !== 'running') { r.ctx.resume(); return false; }
      if (r.el !== v) {
        // une balise ne se branche qu'une fois ; rien ne joue avant (le chargement suit le branchement)
        r.ctx.createMediaElementSource(v).connect(r.gain);
        r.el = v;
      }
      return true;
    } catch (e) { return null; }
  }
  function echoRouted() {
    var r = echo.route;
    return !!(r && r.el && r.el === echoVideo() && r.ctx.state === 'running');
  }
  // gain de l'écho : lissé (quelques millisecondes) pour qu'aucun réglage ne claque
  function echoGain(value, now) {
    var r = echo.route;
    if (!r || !r.gain) return;
    try {
      if (now) { r.gain.gain.cancelScheduledValues(r.ctx.currentTime); r.gain.gain.setValueAtTime(value, r.ctx.currentTime); }
      else r.gain.gain.setTargetAtTime(value, r.ctx.currentTime, 0.012);
    } catch (e) { r.gain.gain.value = value; }
  }
  // retard du chemin Web Audio sur celui de la balise : l'écho se cale d'autant en avance
  function echoLead() {
    var r = echo.route, c = r && r.ctx;
    var lat = c ? (Number(c.baseLatency) || 0) : 0;
    return Math.max(0, Math.min(0.06, lat));
  }
  function echoArm() {
    var d = echoDoc();
    if (!d || echo.doc === d) return;
    echo.doc = d;
    if (d.addEventListener) ['play', 'playing', 'volumechange', 'loadstart'].forEach(function (t) { d.addEventListener(t, echoGuard, true); });
  }
  function echoCreate(now) {
    try {
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('tabindex', '-1');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:270px;opacity:0;pointer-events:none;border:0';
      f.src = location.origin + '/';
      document.body.appendChild(f);
      echo.frame = f; echo.doc = null; echo.born = now; echo.used = now;
    } catch (e) { echoFail('indisponible', false); }
  }
  // arrête l'écho (muet, en pause, mémoire de lecture libérée) ; ``remove`` : retire le cadre
  function echoStop(remove) {
    var p = echoPlayer(), v = echoVideo();
    echo.speaking = false; echo.gain = 0; echo.job = null;
    echoGain(0, true);
    // branchée, la balise n'est jamais coupée par le pont : le gain fait le silence (couper la
    // balise d'un autre que son lecteur fait réagir YouTube)
    if (v) { if (!echoRouted()) v.muted = true; try { v.playbackRate = 1; } catch (e) { /* balise partie */ } }
    try { if (p) { p.pauseVideo(); if (p.stopVideo) p.stopVideo(); } } catch (e) { /* cadre parti */ }
    if (remove && echo.frame) {
      try { echo.frame.remove(); } catch (e) { /* déjà retiré */ }
      echo.frame = null; echo.doc = null;
      if (echo.route) { try { echo.route.ctx.close(); } catch (e) { /* déjà fermé */ } echo.route = null; }
    }
  }
  function echoFail(reason, keep) {
    echo.failed = reason;
    if (keep) store(ECHO_KEY, JSON.stringify({ reason: reason, at: Date.now() }));
    echoStop(true);
  }
  // volume de l'écho pour un gain ``g`` : celui de l'utilisateur, à la normalisation du titre près
  function echoSet(g) {
    var v = echoVideo(), p = player();
    echo.gain = g;
    if (!v) return;
    var user = fade.user != null ? fade.user : p && p.getVolume ? p.getVolume() : 0;
    var vol = Math.max(0, Math.min(1, echo.norm * user / 100 * g));
    if (echoRouted()) {
      // la balise à plein volume (YouTube l'y remet de toute façon), le gain fait le volume
      if (echo.speaking) {
        if (v.muted) v.muted = false;
        if (v.volume < 0.999) v.volume = 1;
        echoGain(vol);
      } else echoGain(0, true);
      return;
    }
    if (Math.abs(v.volume - vol) > 0.0005) v.volume = vol;
    if (v.muted !== !echo.speaking) v.muted = !echo.speaking;
  }
  // un geste de l'utilisateur (suivant, autre titre, déplacement) interrompt le fondu enchaîné :
  // l'écho s'éteint en un fondu court, le lecteur reprend la main
  // l'écho s'éteint en courbe pendant que le lecteur remonte, en ``CROSS_ABORT`` ms
  function crossAbort() {
    var j = echo.job;
    if (!j) return;
    if (j.phase === 'cross') {
      j.phase = 'abort'; j.abortAt = Date.now(); j.abortG = echo.speaking ? echo.gain : 0; j.abortFrom = fade.g;
      fade.since = Date.now();
    } else if (j.phase !== 'abort') echoStop(false);
  }
  // l'écho se tait et s'arrête, le fondu en cours continue (le titre en cours finit sa montée)
  function echoHalt() {
    var ev = echoVideo(), ep = echoPlayer();
    echo.speaking = false; echo.gain = 0;
    echoGain(0, true);
    if (ev) { if (!echoRouted()) ev.muted = true; try { ev.playbackRate = 1; } catch (e) { /* balise partie */ } }
    try { if (ep) { ep.pauseVideo(); if (ep.stopVideo) ep.stopVideo(); } } catch (e) { /* cadre parti */ }
  }
  // l'écho s'est arrêté avant la fin du fondu (fin de fichier, erreur, cadre parti) : il se tait
  // et le titre en cours rejoint son plein volume en ``CROSS_RECOVER`` ms
  function crossRecover(j, now) {
    echoHalt();
    if (!j.recover) j.recover = { at: now, from: fade.g };
  }
  function crossPlan(id, dur) {
    var pair = fade.cfg.pairs[id], plan = pair ? pair.plan : fade.cfg.base;
    if (!plan || !plan.overlap) return null;
    // un titre court garde au moins ses deux tiers sans recouvrement
    return Math.min(plan.overlap, dur / 3);
  }
  // un pas du fondu enchaîné. Rend le gain voulu pour le lecteur de la page, ou null quand le
  // fondu simple garde la main (pas de fondu enchaîné en cours).
  function crossStep(p, st, id, pos, dur, now) {
    var cfg = fade.cfg, j = echo.job;
    if (st === 1 || st === 3) echo.used = now;
    // repli décidé en plein fondu : le titre en cours finit d'abord de remonter (plus bas)
    var finishing = j && (j.phase === 'cross' || j.phase === 'abort') && j.recover;
    if ((!cfg.cross || echo.failed) && !finishing) {
      if (echo.frame) echoStop(true);
      return null;
    }
    if (!echo.frame && !finishing) {
      if (st === 1 && id) echoCreate(now);
      return null;
    }
    echoArm();
    var ep = echoPlayer(), ev = echoVideo();
    if (!j) {
      if (now - echo.used > ECHO_IDLE) { echoStop(true); return null; }
      if (!ep) {
        // le cadre ne se charge pas : fondu simple pour cette session
        if (now - echo.born > 20000) echoFail('indisponible', false);
        return null;
      }
      if (st !== 1 || !id || !(dur > 0) || !isFinite(dur) || adPlaying(p) || fade.hold || now - fade.since < 1500) return null;
      if (echo.skip && echo.skip.id === id && echo.skip.since === fade.since) return null;
      var D = crossPlan(id, dur), r = dur - pos;
      if (!D || r > D + ECHO_PREP) return null;
      // trop tard pour charger et caler l'écho (déplacement tout près de la fin) : fondu simple ;
      // sinon le fondu sera raccourci à ce qui restera du titre
      if (r < 4000) { echo.skip = { id: id, since: fade.since }; return null; }
      // préparation : l'écho charge le titre en cours, muet, un peu en avance, puis se cale
      var vm = document.querySelector('video'), uv = p.getVolume ? p.getVolume() : 0;
      echo.norm = vm && typeof vm.volume === 'number' && uv > 0 && fade.user == null ? Math.max(0.05, Math.min(1.5, vm.volume / (uv / 100))) : 1;
      echo.speaking = false;
      var routed = echoRoute();
      if (routed === null) { echoFail('indisponible', false); return null; }
      if (!routed) {
        // le gain Web Audio n'est pas encore prêt (contexte audio qui démarre) : on réessaie ; au
        // bout de 20 s, pas de fondu enchaîné pour cette session
        if (!echo.routeSince) echo.routeSince = now;
        else if (now - echo.routeSince > 20000) echoFail('indisponible', false);
        return null;
      }
      echo.routeSince = 0;
      echoGain(0, true);
      ep.loadVideoById({ videoId: id, startSeconds: pos / 1000 + 1 });
      echo.job = { id: id, phase: 'load', at: now, D: D, started: 0, locked: 0, sought: 0, lead: 0.05, act: repeatMode() === 'one' ? 'again' : 'next' };
      fade.fast = true;
      return null;
    }
    fade.fast = true;
    if (!ep || !ev) {
      if (j.phase === 'load' || j.phase === 'sync') { echoStop(false); return null; }
      // cadre parti en plein fondu : le titre en cours remonte en courbe
      crossRecover(j, now);
    }
    var es = ep ? ep.getPlayerState() : -1;

    if (j.phase === 'load' || j.phase === 'sync') {
      // le titre a changé, est fini ou a été déplacé au début : cette préparation tombe
      if (id !== j.id || st === 0 || adPlaying(p) || pos < 1000) { echoStop(false); return null; }
      if (adPlaying(ep)) {
        // publicité dans l'écho : jamais regardée, même muette ; au bout de deux, repli durable
        echo.ads++;
        echo.skip = { id: id, since: fade.since };
        if (echo.ads >= 2) echoFail('pub', true); else echoStop(false);
        return null;
      }
      if (st === 2) {
        if (now - echo.userPause < 2000) { echoStop(false); return null; }
        // le lecteur s'est mis en pause tout seul quand l'écho a démarré : le compte n'accepte
        // qu'une lecture à la fois. La musique repart, le fondu simple prend le relais.
        if (j.started) { echoFail('compte', true); p.playVideo(); return null; }
      }
      if (es === 2 && j.started) { echoFail('compte', true); return null; }
      if (!echoRouted() && !echoRoute()) { echo.skip = { id: id, since: fade.since }; echoStop(false); return null; }
      echoGain(0, true);
      if (es === 1) {
        if (!j.started) j.started = now;
        j.phase = 'sync';
        var d = ep.getCurrentTime() - p.getCurrentTime() - echoLead(), a = Math.abs(d);
        if (j.sought && now - j.sought < 600) {
          // juste après un saut : on laisse l'écho repartir avant de mesurer
        } else if (a > 0.15 || (a > 0.04 && (j.seeks || 0) < 4)) {
          // trop loin : un saut, en visant un peu devant (le temps que l'écho reparte, appris à
          // chaque saut : quatre sauts au plus pour les petits écarts), puis la vitesse fait le reste
          if (j.sought) j.lead = Math.max(0, Math.min(0.5, j.lead - d));
          ep.seekTo(p.getCurrentTime() + echoLead() + j.lead, true);
          j.sought = now;
          j.seeks = (j.seeks || 0) + 1;
          ev.playbackRate = 1;
          j.locked = 0;
        } else {
          // à moins de 15 ms près : un écart plus grand s'entend au moment où l'écho prend la parole
          ev.playbackRate = a < 0.004 ? 1 : d > 0 ? (a > 0.1 ? 0.9 : a > 0.02 ? 0.97 : 0.99) : (a > 0.1 ? 1.1 : a > 0.02 ? 1.03 : 1.01);
          if (a < 0.015) { if (!j.locked) j.locked = now; } else j.locked = 0;
        }
      } else if (!j.started && now - j.at > 9000) {
        // l'écho ne démarre pas à temps : fondu simple pour ce titre
        echo.skip = { id: id, since: fade.since };
        echoStop(false);
        return null;
      }
      var left = dur - pos, lat = echo.lat * 1000;
      if (left > j.D + lat) return null;
      if (!(j.locked && now - j.locked >= 250 && st === 1)) {
        // pas encore calé : le lecteur garde son plein volume tant qu'il reste de quoi faire un fondu
        if (left > 1500 + lat && st === 1) return 1;
        echo.skip = { id: id, since: fade.since };
        echoStop(false);
        return null;
      }
      // il reste moins que la durée réglée (titre court, déplacement près de la fin, réglage long) :
      // le fondu est raccourci dès maintenant, et les deux courbes arrivent ensemble au bout
      j.D = Math.min(j.D, Math.max(500, left - lat));
      // début du fondu : l'écho prend la parole au même instant du même titre, puis le lecteur
      // de la page passe au suivant
      j.g0 = Math.max(0.05, fade.g);
      fadeVolume(p, 0);
      fade.g = 0;
      echo.speaking = true;
      ev.playbackRate = 1;
      echoSet(j.g0);
      j.phase = 'cross'; j.hand = now; j.since = fade.since;
      j.from = id; j.handPos = ep.getCurrentTime(); j.end = ep.getDuration() || dur / 1000;
      j.inSeen = 0; j.inPos = 0;
      if (j.act === 'again') p.seekTo(0, true); else j.nav = advance(p) === 'auto';
      return 0;
    }

    // l'écho finit l'ancien titre, en baissant selon sa propre position
    if (j.phase === 'abort') {
      var xa = Math.min(1, (now - j.abortAt) / CROSS_ABORT);
      if (echo.speaking && es === 1 && xa < 1) echoSet(j.abortG * riseAt(1 - xa));
      else if (echo.speaking) echoHalt();
      if (xa >= 1) { echoStop(false); return fade.hold ? null : 1; }
      // un « suivant » ou un autre titre demandé : le fondu court du lecteur s'en charge
      if (fade.hold) return null;
      return j.abortFrom + (1 - j.abortFrom) * riseAt(xa);
    }
    // le lecteur de la page : l'ancien titre continue en silence jusqu'au changement
    var fresh = j.act === 'again' ? now - j.hand > 300 && pos < 1500 + (now - j.hand) : id !== j.from;
    var ad = fresh && adPlaying(p);
    // la position du nouveau titre traîne un instant sur celle de l'ancien : on attend de la voir
    // repartir du début (une seconde et demie au plus)
    if (fresh && !ad && !j.low && (st === 1 || st === 2)) {
      if (!j.inSeen) j.inSeen = now;
      if (pos < 1500 || now - j.inSeen > 1500) j.low = true;
    }
    var et = echo.speaking ? ep.getCurrentTime() : 0;
    // horloge commune : elle part quand le nouveau titre (ou une publicité) se fait entendre.
    // Jusque-là l'écho garde son volume ; ensuite les deux courbes avancent ensemble, et la
    // somme des puissances reste constante.
    if (!j.S && (ad || (j.low && st === 1))) {
      var tail = echo.speaking ? Math.max(0.3, j.end - et) : j.D / 1000;
      j.et0 = et;
      // durée du fondu : jamais plus que la durée réglée, ni que ce qui reste de l'ancien titre,
      // ni qu'un tiers du nouveau
      j.S = ad || !(dur > 0) || !isFinite(dur) ? Math.min(tail, j.D / 1000) : Math.min(tail, j.D / 1000, dur / 3000);
      // temps qu'a mis le nouveau titre à se faire entendre : le prochain fondu partira d'autant plus tôt
      if (!ad) echo.lat = Math.max(0.1, Math.min(2.5, echo.lat / 2 + ((now - j.hand) / 1000 - pos / 1000) / 2));
    }
    if (echo.speaking && echo.route && !echoRouted() && !echoRoute()) crossRecover(j, now);
    if (echo.speaking) {
      var x = j.S ? (et - j.et0) / j.S : 0;
      if (es === 2 && st !== 2 && now - echo.userPause > 2000) {
        // le compte a mis l'écho en pause : repli durable, mais le titre en cours remonte en courbe
        echo.failed = 'compte';
        store(ECHO_KEY, JSON.stringify({ reason: 'compte', at: now }));
        crossRecover(j, now);
      } else if (x >= 0.995) echoHalt();
      else if (es === 0 || et >= j.end - 0.05 || (es === 3 && now - (j.stall || (j.stall = now)) > 2000)) {
        // l'écho s'est arrêté avant la fin de sa courbe (fin de fichier, chargement bloqué)
        crossRecover(j, now);
      } else {
        if (es !== 3) j.stall = 0;
        echoSet(j.g0 * riseAt(1 - x));
      }
    }
    if (!fresh) {
      // (une suite automatique passe par la navigation de la page : elle met un peu plus longtemps)
      if (j.act === 'next' && st === 1 && now - j.hand > (j.nav ? 5000 : 2500)) {
        // rien après ce titre (fin de la file) : le lecteur reprend la parole là où en est
        // l'écho (ils jouent le même instant) et le fondu simple éteint la fin
        fade.g = echo.speaking ? echo.gain : 0;
        fadeVolume(p, fade.g);
        echoStop(false);
        echo.skip = { id: id, since: j.since };
        fade.since = j.since; fade.id = id; fade.pos = pos;
        return null;
      }
      if (!echo.speaking && now - j.hand > 4000) { echo.job = null; return null; }
      return 0;
    }
    // publicité entre deux titres (compte gratuit) : elle passe à son volume, sans fondu
    if (ad) return 1;
    if (!j.low || (st !== 1 && st !== 2)) return echo.speaking || now - j.hand < 4000 ? 0 : (echo.job = null, null);
    var gi = riseAt(pos / 1000 / (j.S || j.D / 1000));
    if (j.recover) {
      var ra = Math.max(j.recover.at, j.inSeen || 0);
      gi = Math.max(gi, j.recover.from + (1 - j.recover.from) * riseAt((now - ra) / CROSS_RECOVER));
    }
    if (gi >= 1 && !echo.speaking) { echo.job = null; return 1; }
    return gi;
  }
  // un pas du fondu ; rend le délai avant le suivant (ms)
  function fadeStep() {
    var cfg = fade.cfg, p = player();
    if (!cfg || !p || !p.getPlayerState) return 1000;
    var now = Date.now(), dt = Math.max(0, now - fade.at);
    fade.at = now;
    fadeRecover(p);
    if (!fade.video || !fade.video.isConnected) {
      // les événements du lecteur font avancer le fondu même quand les minuteurs d'une page
      // cachée sont ralentis
      var el = document.querySelector('video');
      if (el && el !== fade.video && el.addEventListener) { fade.video = el; el.addEventListener('timeupdate', fadeTick); }
    }
    // -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 en file
    var st = p.getPlayerState(), data = p.getVideoData ? p.getVideoData() : {};
    var id = (data && data.video_id) || null;
    var pos = (p.getCurrentTime ? p.getCurrentTime() : 0) * 1000 || 0, dur = (p.getDuration ? p.getDuration() : 0) * 1000 || 0;
    var target = 1, near = false;
    fade.fast = false;
    var crossG = crossStep(p, st, id, pos, dur, now);

    if (crossG !== null) {
      // fondu enchaîné : le gain du lecteur vient de crossStep, le fondu simple attend (pendant
      // le calage de l'écho, il garde ses repères : il reprend la main si l'écho n'est pas prêt)
      var jj = echo.job;
      if (!jj || (jj.phase !== 'load' && jj.phase !== 'sync')) {
        fade.id = id; fade.pos = pos; fade.since = now;
        fade.zone = null; fade.entry = null; fade.hold = null;
      }
      fade.live = now;
      target = crossG;
      near = true;
      // gain posé tel quel : la courbe est déjà douce, et un pas de fondu court la ferait traîner
      fade.g = target;
    } else if (adPlaying(p)) {
      // publicité : ni fondu ni enchaînement anticipé ; une action demandée part tout de suite
      runHeld();
      fade.hold = null; fade.zone = null; fade.entry = null;
      fade.id = id; fade.pos = pos; fade.since = now;
    } else {
      // nouveau départ : un autre titre, ou le même relancé au début (répétition, précédent)
      if (id !== fade.id || (pos < fade.pos - 1000 && pos < 3000)) {
        var h = fade.hold;
        if (h && h.run) {
          // une action demandée (suivant, autre titre) reste à faire : le silence est tenu
          fade.zone = null; fade.entry = null;
        } else {
          // le titre n'entre en fondu que s'il a été précédé d'une sortie. Un même départ peut
          // se voir en deux temps (le titre change, puis sa position revient à zéro, ou
          // l'inverse) : l'entrée déjà prévue est gardée, avec sa durée.
          var e0 = fade.entry, again = e0 && now - e0.at < 1500;
          var from = again ? e0.from : h || fade.g < 0.5 ? { manual: !!(h && h.manual), zone: fade.zone } : null;
          var into = 0;
          if (from) into = from.manual || !from.zone ? cfg.quick : from.zone.to && from.zone.to !== id ? (cfg.base ? cfg.base.into : 0) : from.zone.into;
          fade.entry = into > 0 && id ? { id: id, ms: into, at: again ? e0.at : now, seen: false, from: from } : null;
          fade.hold = null; fade.zone = null;
        }
        fade.since = now;
      }
      fade.id = id; fade.pos = pos;

      if (fade.hold) {
        if (fade.hold.run) {
          if (fade.g <= 0.001) runHeld();
        } else if (now > fade.hold.until) fade.hold = null;
      }
      if (fade.hold) {
        target = 0;
        near = true;
      } else if (st === 1 || st === 2 || st === 3) {
        fade.live = now;
        // entrée : le titre monte sur ses premières secondes
        var e = fade.entry;
        if (e) {
          var span = dur > 0 && isFinite(dur) ? Math.min(e.ms, dur / 4) : e.ms;
          if (pos < span) e.seen = true;
          // tant que la position du nouveau titre n'est pas connue (elle traîne un instant sur
          // celle de l'ancien), on tient le silence ; pas plus d'une seconde et demie
          if (e.id !== id || (e.seen ? pos >= span : now - e.at > 1500)) fade.entry = null;
          else { target = e.seen ? curveAt(pos / span) : 0; near = true; }
        }
        // fin : le titre baisse, puis le suivant est lancé un peu avant la fin
        var z = fade.zone && fade.zone.id === id ? fade.zone : null;
        if (id && dur > 0 && isFinite(dur) && now - fade.since > 2000) {
          var r = dur - pos, plan = z || endPlan(id, dur);
          if (plan && r <= plan.out + plan.cut + 1500) near = true;
          if (plan && r <= plan.out + plan.cut) {
            if (!z) {
              z = fade.zone = plan;
              // un titre répété (répétition « un titre ») va jusqu'au bout : rien n'est sauté
              if (repeatMode() === 'one') z.cut = 0;
              z.first = now;
            }
            z.ticks++;
            target = Math.min(target, curveAt((r - z.cut) / z.out));
            if (z.cut > 0 && r <= z.cut && r > 150 && st === 1 && !z.advanced && z.ticks > 2 && now - z.first > 100) {
              z.advanced = true;
              fade.hold = { manual: false, run: null, until: now + r + 4000 };
              target = 0;
              advance(p);
            }
          } else if (z && !z.advanced) fade.zone = null;
        } else if (z && !z.advanced) fade.zone = null;
      } else if (now - fade.live < 4000) {
        // ni lecture ni pause : le plus souvent le court passage d'un titre au suivant, le gain
        // est gardé tel quel ; si rien ne repart (file finie), le volume revient
        target = fade.g;
        near = true;
      }
    }

    // le gain rejoint sa cible sans saut : au plus un fondu court de bout en bout
    // après une erreur, le volume revient en une seconde plutôt qu'en un fondu court
    var step = dt / (fade.ease > now ? CROSS_RECOVER : cfg.quick), g = fade.g;
    g = target > g ? Math.min(target, g + step) : Math.max(target, g - step);
    fadeVolume(p, g);
    if (fade.hold && fade.hold.run && g <= 0.001) runHeld();
    return near || g < 1 || fade.fast ? 40 : st === 1 || st === 3 ? 250 : 1000;
  }
  function fadeTick() {
    if (fade.busy) return 40;
    fade.busy = true;
    var wait = 1000;
    try { wait = fadeStep(); fade.errors = 0; } catch (e) {
      // dans le doute, le volume de l'utilisateur d'abord : en courbe sur une seconde, ou tout de
      // suite si l'erreur se répète
      fade.errors = (fade.errors || 0) + 1;
      try { echoStop(false); } catch (e3) { /* cadre parti */ }
      runHeld();
      fade.hold = null; fade.zone = null; fade.entry = null;
      if (fade.errors >= 3) {
        try { fadeRelease(player()); } catch (e2) { /* lecteur absent */ }
      } else fade.ease = Date.now() + CROSS_RECOVER;
      wait = 40;
    }
    fade.busy = false;
    return wait;
  }
  function fadeLoop() {
    fade.timer = null;
    if (!fade.cfg) return;
    var wait = fadeTick();
    if (fade.cfg && fade.timer == null) fade.timer = setTimeout(fadeLoop, wait);
  }
  function setFade(cfg) {
    fade.cfg = cfg;
    if (fade.zone && !fade.zone.advanced) fade.zone = null;
    if (cfg) {
      if (fade.timer == null) { fade.at = Date.now(); fade.timer = setTimeout(fadeLoop, 0); }
      return;
    }
    // désactivé : tout s'arrête, le volume revient, une action en attente part aussitôt
    if (fade.timer != null) clearTimeout(fade.timer);
    fade.timer = null;
    echoStop(true);
    runHeld();
    fade.hold = null; fade.zone = null; fade.entry = null;
    fadeRelease(player());
  }
  // pause et reprise : pendant un fondu enchaîné, l'écho suit le lecteur
  function pauseAll(p) {
    echo.userPause = Date.now();
    p.pauseVideo();
    var ep = echo.job && echo.speaking ? echoPlayer() : null;
    if (ep) ep.pauseVideo();
  }
  function playAll(p) {
    p.playVideo();
    var ep = echo.job && echo.speaking ? echoPlayer() : null;
    if (ep && ep.getPlayerState() === 2) ep.playVideo();
  }
  function crossStatus() {
    return echo.failed || (fade.cfg && fade.cfg.cross ? 'ok' : null);
  }
  // passage manuel (suivant, précédent, autre titre) : courte sortie, l'action, courte entrée
  function fadeThen(run) {
    var p = player();
    crossAbort();
    runHeld();
    if (!fade.cfg || !fade.cfg.base || !p || !p.getPlayerState || p.getPlayerState() !== 1 || adPlaying(p)) return run();
    fade.hold = { manual: true, run: run, until: 0 };
    // la sortie part de maintenant (et non du dernier calcul, parfois vieux d'un quart de seconde)
    fade.at = Date.now();
    if (fade.timer != null) clearTimeout(fade.timer);
    fade.timer = setTimeout(fadeLoop, 0);
  }
  // au chargement de la page : réglages gardés, et volume à rendre si un fondu a été coupé
  (function () {
    var lost = stored(FADE_USER_KEY), saved = null;
    if (lost != null && Number(lost) >= 0 && Number(lost) <= 100) fade.lost = Number(lost);
    try { saved = cleanFade(JSON.parse(stored(FADE_KEY) || 'null')); } catch (e) { saved = null; }
    if (saved) setFade(saved);
  })();

  // ——— Suite automatique ———
  // Quand la file s'arrête après le titre en cours (titre lancé seul, fin d'un album ou d'une
  // playlist), YouTube Music propose une suite de titres proches (« automix », RDAMVM…) que son
  // lecteur web devrait charger de lui-même : dans la fenêtre cachée, rien ne garantit qu'il le
  // fasse. Le pont la prépare donc dès le début du titre et la lance à la fin, comme le ferait
  // « Lecture automatique ». Jamais tant que la file continue (rien n'est écrasé), jamais quand
  // la répétition est active, et le fondu (simple ou enchaîné) passe par elle comme par « suivant ».
  var AUTO_KEY = 'ibox.autoplay';
  var auto = {
    on: stored(AUTO_KEY) !== '0',
    id: null,       // titre dont la file a été lue
    info: null,     // sa file : {items, more, automix}
    loading: null,
    list: null,     // suite prête : {id, playlistId, params, items, used}
    ended: null     // fin de titre vue : {id, at}
  };
  function autoWanted() {
    var r = repeatMode();
    return auto.on && r !== 'one' && r !== 'all';
  }
  // file du titre `id` (une requête par titre), puis la suite si elle s'arrête après lui
  function autoLoad(p, id) {
    var list = (p.getPlaylistId && p.getPlaylistId()) || null;
    if (auto.id === id && auto.listId === list && auto.info) return Promise.resolve(auto.info);
    if (auto.id === id && auto.listId === list && auto.loading) return auto.loading;
    auto.id = id; auto.listId = list; auto.info = null; auto.list = null;
    var body = { videoId: id, isAudioOnly: true };
    if (list) body.playlistId = list;
    auto.loading = innertube('next', body).then(function (json) {
      var info = P.queueInfo(json);
      if (auto.id !== id) return info;
      auto.info = info;
      var at = -1;
      info.items.forEach(function (q, i) { if (q.selected) at = i; });
      var last = at < 0 ? info.items.length <= 1 : at === info.items.length - 1;
      if (!last || info.more) return info;
      // la file s'arrête ici : la suite que YouTube Music propose, sinon la radio du titre
      var mix = info.automix || { playlistId: 'RDAMVM' + id, params: null };
      var seen = {};
      info.items.forEach(function (q) { seen[q.videoId] = 1; });
      var b = { videoId: id, playlistId: mix.playlistId, isAudioOnly: true };
      if (mix.params) b.params = mix.params;
      return innertube('next', b).then(function (j2) {
        if (auto.id !== id) return info;
        var items = P.queue(j2).filter(function (q) { return !seen[q.videoId]; }).slice(0, 25);
        if (items.length) auto.list = { id: id, playlistId: mix.playlistId, params: mix.params, items: items, used: false };
        return info;
      });
    }, function () { return { items: [], more: false, automix: null }; }).then(function (info) {
      if (auto.id === id) auto.loading = null;
      return info;
    });
    return auto.loading;
  }
  // passe au titre suivant : la suite automatique quand la file est finie, sinon « suivant »
  function advance(p) {
    var d = p.getVideoData ? p.getVideoData() : {}, a = auto.list;
    if (a && a.id === d.video_id && !a.used && autoWanted()) {
      a.used = true;
      var first = a.items[0], w = { videoId: first.videoId, playlistId: a.playlistId };
      if (a.params) w.params = a.params;
      navigate({ watchEndpoint: w }, '/watch?v=' + encodeURIComponent(first.videoId) + '&list=' + encodeURIComponent(a.playlistId));
      return 'auto';
    }
    p.nextVideo();
    return 'next';
  }
  // veille légère, fondu ou pas : la file du titre est lue à son début ; à sa fin, si rien n'a
  // suivi (YouTube Music n'a pas enchaîné de lui-même), la suite part
  setInterval(function () {
    try {
      var p = player();
      if (!p || !p.getPlayerState || !auto.on || adPlaying(p)) return;
      var st = p.getPlayerState(), d = p.getVideoData ? p.getVideoData() : {}, id = d && d.video_id;
      if (!id) return;
      if ((st === 1 || st === 2) && (auto.id !== id || auto.listId !== ((p.getPlaylistId && p.getPlaylistId()) || null))) autoLoad(p, id);
      if (st !== 0) { auto.ended = null; return; }
      if (!auto.ended || auto.ended.id !== id) { auto.ended = { id: id, at: Date.now() }; return; }
      // un court instant d'abord : si YouTube Music enchaîne de lui-même, le titre aura déjà changé
      if (Date.now() - auto.ended.at > 900 && auto.list && auto.list.id === id && !auto.list.used) {
        auto.ended = null;
        advance(p);
      }
    } catch (e) { /* lecteur en cours de chargement */ }
  }, 500);

  // ——— Lecture ———
  function state() {
    var p = player(), m = navigator.mediaSession && navigator.mediaSession.metadata;
    fadeRecover(p);
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
      // pendant un fondu : le volume choisi par l'utilisateur, pas celui de la rampe
      volume: fade.user != null ? fade.user : fade.lost != null ? fade.lost : p && p.getVolume ? p.getVolume() : null,
      muted: p && p.isMuted ? p.isMuted() : null,
      liked: data.video_id && likes[data.video_id] != null ? likes[data.video_id] : null,
      shuffle: shuffleState(),
      repeat: repeatMode(),
      // fondu enchaîné : « ok », ou la raison du repli sur le fondu simple
      cross: crossStatus()
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
    toggle: function () { var p = needPlayer(); if (p.getPlayerState() === 1) pauseAll(p); else playAll(p); return true; },
    play: function () { playAll(needPlayer()); return true; },
    pause: function () { pauseAll(needPlayer()); return true; },
    // au bout de la file, « suivant » passe à la suite automatique (titres proches)
    next: function () { needPlayer(); fadeThen(function () { advance(needPlayer()); }); return true; },
    prev: function () { needPlayer(); fadeThen(function () { needPlayer().previousVideo(); }); return true; },
    seek: function (a) { var p = needPlayer(); crossAbort(); p.seekTo(Number(a && a.seconds) || 0, true); return true; },
    volume: function (a) {
      var p = needPlayer(), v = Math.max(0, Math.min(100, Number(a && a.value) || 0));
      // un choix de l'utilisateur prime sur tout volume « à rendre »
      fade.lost = null;
      if (fade.user != null) {
        // en plein fondu : la rampe continue, vers ce nouveau volume
        fade.user = v;
        fade.set = Math.round(v * fade.g);
        p.setVolume(fade.set);
        store(FADE_USER_KEY, v);
        // l'écho qui finit l'ancien titre suit le nouveau volume
        if (echo.speaking) echoSet(echo.gain);
      } else {
        p.setVolume(v);
        store(FADE_USER_KEY, null);
      }
      if (p.isMuted()) p.unMute();
      return true;
    },
    // fondus entre les titres : {quick, curve, base, pairs} (durées en ms, calculées par
    // l'interface) ; null : désactivés. Gardés ici pour survivre à un rechargement de la page.
    fade: function (a) {
      var cfg = cleanFade(a);
      store(FADE_KEY, cfg ? JSON.stringify(a) : null);
      setFade(cfg);
      return { fade: !!cfg, cross: crossStatus() };
    },
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
    // la suite automatique y figure, marquée `auto`, quand la file s'arrête après ce titre
    queue: async function () {
      var p = needPlayer(), d = p.getVideoData ? p.getVideoData() : {};
      if (!d.video_id) return [];
      var info = await autoLoad(p, d.video_id);
      var items = info.items.slice();
      var a = auto.list && auto.list.id === d.video_id && autoWanted() ? auto.list : null;
      if (a) a.items.forEach(function (q) { items.push(Object.assign({}, q, { auto: true, selected: false })); });
      return items;
    },
    // suite automatique : {on} ; rend l'état retenu
    autoplay: function (a) {
      auto.on = !(a && a.on === false);
      store(AUTO_KEY, auto.on ? null : '0');
      return { autoplay: auto.on };
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
      fadeThen(function () { navigate({ watchEndpoint: w }, '/watch?' + q.join('&')); });
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
