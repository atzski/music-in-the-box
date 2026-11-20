//! Music in the Box (plan : `docs/MUSIC.md`) : contrôler sa musique par-dessus une partie.
//!
//! Deux sources partagent l'état commun [`NowPlaying`] :
//! - `ytm` : YouTube Music dans une WebView2 cachée (lecture, recherche, playlists) ;
//! - `smtc` : les contrôles média de Windows (tout autre lecteur : lecture et titres seulement).
//!
//! `overlay` gère la fenêtre `music` (panneau par-dessus le jeu), le combo manette Vue + Y
//! et le retour du focus au jeu ; le raccourci clavier est dans `shortcut.rs`. Code repris
//! d'iBox (où il dort tant que le plugin n'est pas activé) ; ici, toujours actif.

pub mod backdrop;
pub mod diag;
pub mod overlay;
pub mod smtc;
pub mod ytm;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Youtube,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub source: Source,
    /// Lecteur lisible (« YouTube Music », « Spotify »…).
    pub app: Option<String>,
    /// Identifiant du titre (change à chaque titre).
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// URL https ou `data:` de la pochette.
    pub artwork: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub playing: bool,
    /// 0–100 ; absent quand la source n'a pas de volume (SMTC).
    pub volume: Option<u8>,
    pub can_seek: bool,
    /// Titre aimé (YouTube Music seulement).
    pub liked: Option<bool>,
    /// Lecture aléatoire ; absent si le lecteur ne le dit pas.
    pub shuffle: Option<bool>,
    /// Répétition : `none`, `all` ou `one` ; absent si le lecteur ne le dit pas.
    pub repeat: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicState {
    pub now: Option<NowPlaying>,
    /// Heure de l'instantané (ms Unix) : l'interface fait avancer la position d'elle-même.
    pub at: u64,
    /// Un compte YouTube Music a déjà été connecté sur ce PC.
    pub youtube: bool,
}

/// Source du dernier état lu : les commandes vont à celle-ci.
static LAST: Mutex<Option<Source>> = Mutex::new(None);

pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Choix de la source : YouTube Music s'il lit (ou a un titre en pause), sinon le lecteur
/// Windows en cours, sinon YouTube Music au repos. Bloquant.
pub fn current(app: &AppHandle) -> MusicState {
    let yt = ytm::window(app).and_then(|_| ytm::call(app, "state", Value::Null).ok());
    let now = match &yt {
        Some(v) if ytm::active(v) => ytm::now_playing(v),
        _ => smtc::now_playing().or_else(|| yt.as_ref().and_then(ytm::now_playing)),
    };
    if let Ok(mut last) = LAST.lock() {
        *last = now.as_ref().map(|n| n.source);
    }
    MusicState { now, at: now_ms(), youtube: ytm::known(app) }
}

pub fn emit_state(app: &AppHandle) {
    let state = current(app);
    let _ = app.emit_to(overlay::LABEL, "music://state", &state);
}

fn control(app: &AppHandle, action: &str, value: Option<f64>) -> Result<(), String> {
    let source = LAST.lock().ok().and_then(|l| *l);
    match source {
        Some(Source::Youtube) => {
            let arg = match action {
                "seek" => json!({ "seconds": value.unwrap_or(0.0) / 1000.0 }),
                "volume" => json!({ "value": value.unwrap_or(0.0) }),
                _ => Value::Null,
            };
            ytm::call(app, action, arg).map(|_| ())
        }
        Some(Source::System) => smtc::control(action, value),
        None => Err("Aucune musique en cours.".into()),
    }
}

#[tauri::command]
pub async fn music_state(app: AppHandle) -> Result<MusicState, String> {
    tauri::async_runtime::spawn_blocking(move || current(&app)).await.map_err(|e| e.to_string())
}

/// `toggle`, `play`, `pause`, `next`, `prev`, `seek` (valeur en ms), `volume` (0–100), `like`,
/// `shuffle`, `repeat` (bascule vers le mode suivant).
/// Rend l'état relu juste après l'action.
#[tauri::command]
pub async fn music_control(app: AppHandle, action: String, value: Option<f64>) -> Result<MusicState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        control(&app, &action, value)?;
        // laisse le lecteur appliquer l'action avant de relire
        std::thread::sleep(std::time::Duration::from_millis(if action == "next" || action == "prev" { 450 } else { 120 }));
        Ok(current(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Démarre les raccourcis (clavier, manette) et le suivi de l'état pendant que le panneau est ouvert.
pub fn start(app: AppHandle) {
    overlay::start(app);
}
