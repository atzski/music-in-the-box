//! Réglages lus au démarrage, avant toute fenêtre : raccourci du lecteur et écran choisi.
//! Gardés dans `settings.json` (dossier de configuration de l'app). Le reste des réglages
//! (position, « Rester affiché »…) vit dans l'interface.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Raccourci du lecteur (« Alt+C ») ; absent : celui par défaut.
    pub music_keys: Option<String>,
    /// Écran du lecteur (nom Windows) ; absent : l'écran principal.
    pub music_monitor: Option<String>,
}

static LOCK: Mutex<()> = Mutex::new(());

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Prefs {
    path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Modifie puis réécrit les réglages.
pub fn update(app: &AppHandle, change: impl FnOnce(&mut Prefs)) {
    let _guard = LOCK.lock();
    let mut prefs = load(app);
    change(&mut prefs);
    let Some(p) = path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec_pretty(&prefs) {
        let _ = std::fs::write(p, json);
    }
}

#[cfg(test)]
mod tests {
    use super::Prefs;

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let p: Prefs = serde_json::from_str(r#"{ "musicKeys": "Ctrl+F9" }"#).unwrap();
        assert_eq!(p.music_keys.as_deref(), Some("Ctrl+F9"));
        assert!(p.music_monitor.is_none());
        assert!(serde_json::from_str::<Prefs>("{}").unwrap().music_keys.is_none());
    }
}
