//! Source YouTube Music : le client web officiel dans une fenêtre WebView2 à part (`ytmusic`),
//! visible seulement pour la connexion Google. Validé à l'étape 0 (voir `docs/MUSIC.md`).
//!
//! La fenêtre a son propre dossier de données : les cookies Google restent isolés d'iBox,
//! et ses arguments de navigateur (lecture automatique) ne touchent pas les autres fenêtres
//! (des arguments différents sur un même dossier empêchent la création des fenêtres WebView2).
//!
//! La page n'a aucun accès IPC (aucune capability ne la vise). Rust la pilote avec
//! `eval_with_callback` : `bridge.js` (injecté au chargement) démarre l'action, puis Rust
//! relit le résultat par sondage tant qu'il est en attente (requêtes réseau).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "ytmusic";
const HOME: &str = "https://music.youtube.com/";
/// Traduction des réponses (`parse.js`, testée à part) puis le pont lui-même : les fichiers
/// `bridge/` à la racine du dépôt, les mêmes que ceux du plugin iBox.
const BRIDGE: &str = concat!(include_str!("../../../../bridge/parse.js"), "
", include_str!("../../../../bridge/bridge.js"));
/// Arguments par défaut de wry (à répéter quand on en ajoute) + lecture sans geste de l'utilisateur.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";
const EVAL_TIMEOUT: Duration = Duration::from_secs(5);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

static SEQ: AtomicU64 = AtomicU64::new(1);

fn data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join("ytmusic-webview"))
}

/// Une connexion a déjà eu lieu sur ce PC (dossier WebView2 présent).
pub fn known(app: &AppHandle) -> bool {
    data_dir(app).is_some_and(|d| d.is_dir())
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn build(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = window(app) {
        return Some(w);
    }
    let url = WebviewUrl::External(HOME.parse().ok()?);
    let w = WebviewWindowBuilder::new(app, LABEL, url)
        .title("Music in the Box - YouTube Music")
        .inner_size(1100.0, 780.0)
        .center()
        .visible(false)
        // lecteur caché : ni bouton dans la barre des tâches, ni Alt+Tab (montré seulement pour la connexion)
        .skip_taskbar(true)
        .data_directory(data_dir(app)?)
        .additional_browser_args(BROWSER_ARGS)
        .initialization_script(BRIDGE)
        .build()
        .map_err(|e| eprintln!("Music in the Box : fenêtre YouTube Music indisponible : {e}"))
        .ok()?;
    // Fermer la fenêtre la cache seulement : la musique continue.
    let h = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = h.hide();
            let _ = h.set_skip_taskbar(true);
        }
    });
    Some(w)
}

/// Crée (si besoin) puis montre ou cache la fenêtre. Bloquant : jamais depuis la boucle
/// d'événements. La fenêtre est créée par la boucle d'événements, depuis un autre fil.
pub fn open(app: &AppHandle, visible: bool) -> bool {
    // la fenêtre n'existe que pour un plugin qui en a reçu la permission
    if !super::overlay::config().is_some_and(|c| c.webview) {
        return false;
    }
    let (tx, rx) = mpsc::channel();
    let a = app.clone();
    std::thread::spawn(move || {
        let main = a.clone();
        let _ = main.run_on_main_thread(move || {
            let ok = build(&a).map(|w| {
                if visible {
                    let _ = w.set_skip_taskbar(false);
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                } else {
                    let _ = w.hide();
                    let _ = w.set_skip_taskbar(true);
                }
            });
            let _ = tx.send(ok.is_some());
        });
    });
    rx.recv_timeout(CALL_TIMEOUT).unwrap_or(false)
}

/// Montre la fenêtre pour se connecter (ou la cache).
#[tauri::command]
pub async fn music_ytm_open(app: AppHandle, visible: bool) -> Result<(), String> {
    let ok = tauri::async_runtime::spawn_blocking(move || open(&app, visible)).await.map_err(|e| e.to_string())?;
    if ok { Ok(()) } else { Err("Fenêtre YouTube Music indisponible.".into()) }
}

/// Envoie une commande au pont (`state`, `toggle`, `next`, `search`, `playlists`…) et
/// attend sa réponse. Bloquant.
pub fn call(app: &AppHandle, cmd: &str, arg: Value) -> Result<Value, String> {
    let w = window(app).ok_or("YouTube Music n'est pas ouvert.")?;
    let id = SEQ.fetch_add(1, Ordering::Relaxed);
    let req = json!({ "id": id, "cmd": cmd, "arg": arg }).to_string();
    let mut r = eval(&w, &format!("window.__ibox ? window.__ibox.start({req}) : JSON.stringify({{error: 'pont-absent'}})"))?;
    let deadline = Instant::now() + CALL_TIMEOUT;
    while is_pending(&r) {
        if Instant::now() > deadline {
            return Err("YouTube Music ne répond pas.".into());
        }
        std::thread::sleep(Duration::from_millis(120));
        r = eval(&w, &format!("window.__ibox ? window.__ibox.take({id}) : JSON.stringify({{error: 'pont-absent'}})"))?;
    }
    outcome(r)
}

/// Accès direct au pont, pour la recherche et les playlists (étapes 2 et 3).
#[tauri::command]
pub async fn music_ytm_call(app: AppHandle, cmd: String, arg: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || call(&app, &cmd, arg.unwrap_or(Value::Null))).await.map_err(|e| e.to_string())?
}

/// Évalue du JS et rend sa valeur. Le pont renvoie toujours une chaîne JSON ; WebView2
/// la sérialise une seconde fois, d'où le double décodage.
fn eval(w: &WebviewWindow, js: &str) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    w.eval_with_callback(js, move |raw| {
        let _ = tx.send(raw);
    })
    .map_err(|e| e.to_string())?;
    let raw = rx.recv_timeout(EVAL_TIMEOUT).map_err(|_| "La page YouTube Music ne répond pas.".to_string())?;
    Ok(decode(&raw))
}

fn decode(raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw).unwrap_or(Value::Null) {
        Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
        v => v,
    }
}

fn is_pending(v: &Value) -> bool {
    v.get("pending").and_then(Value::as_bool).unwrap_or(false)
}

fn outcome(v: Value) -> Result<Value, String> {
    if let Some(e) = v.get("error").and_then(Value::as_str) {
        return Err(e.to_string());
    }
    Ok(v.get("ok").cloned().unwrap_or(Value::Null))
}

/// Traduit l'état rendu par le pont (`state`) en état commun.
pub fn now_playing(v: &Value) -> Option<super::NowPlaying> {
    let video = v.get("videoId").and_then(Value::as_str)?;
    let state = v.get("playerState").and_then(Value::as_i64).unwrap_or(-1);
    let secs = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    Some(super::NowPlaying {
        source: super::Source::Youtube,
        app: Some("YouTube Music".into()),
        id: video.to_string(),
        title: s("title").unwrap_or_default(),
        artist: s("artist").unwrap_or_default(),
        album: s("album"),
        artwork: s("artwork"),
        position_ms: (secs("position") * 1000.0) as u64,
        duration_ms: (secs("duration") * 1000.0) as u64,
        // 3 = chargement : on garde l'affichage « en lecture »
        playing: state == 1 || state == 3,
        volume: v.get("volume").and_then(Value::as_u64).map(|x| x.min(100) as u8),
        can_seek: true,
        liked: v.get("liked").and_then(Value::as_bool),
        shuffle: v.get("shuffle").and_then(Value::as_bool),
        repeat: s("repeat"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_reads_the_double_encoded_bridge_answer() {
        let raw = serde_json::to_string(&json!({ "ok": { "title": "A" } }).to_string()).unwrap();
        assert_eq!(decode(&raw), json!({ "ok": { "title": "A" } }));
        // une page sans pont rend `null` (aucune valeur)
        assert_eq!(decode("null"), Value::Null);
    }

    #[test]
    fn outcome_separates_results_errors_and_pending() {
        assert!(is_pending(&json!({ "pending": true })));
        assert!(!is_pending(&json!({ "ok": 1 })));
        assert_eq!(outcome(json!({ "ok": [1, 2] })), Ok(json!([1, 2])));
        assert_eq!(outcome(json!({ "error": "non-connecte" })), Err("non-connecte".into()));
        assert_eq!(outcome(json!({})), Ok(Value::Null));
    }

    #[test]
    fn bridge_state_becomes_now_playing() {
        let v = json!({ "videoId": "abc", "playerState": 2, "title": "T", "artist": "A", "position": 12.5, "duration": 200.0, "volume": 40 });
        let n = now_playing(&v).unwrap();
        assert_eq!((n.title.as_str(), n.position_ms, n.duration_ms, n.playing, n.volume), ("T", 12_500, 200_000, false, Some(40)));
        assert!(now_playing(&json!({ "playerState": 1 })).is_none());
    }
}
