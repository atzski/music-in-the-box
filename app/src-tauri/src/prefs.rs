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
    /// Langue de l'interface (« fr », « en ») ; absente : celle de Windows.
    pub lang: Option<String>,
}

/// Langue de Windows : le français s'il est français, l'anglais sinon (langue par défaut).
#[cfg(windows)]
fn windows_lang() -> &'static str {
    use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;
    // identifiant de langue primaire : 0x0C = français
    if unsafe { GetUserDefaultUILanguage() } & 0x3FF == 0x0C { "fr" } else { "en" }
}
#[cfg(not(windows))]
fn windows_lang() -> &'static str {
    "en"
}

/// Langue de l'interface : le choix des réglages, sinon celle de Windows.
pub fn lang_of(choice: Option<&str>) -> &'static str {
    match choice {
        Some("fr") => "fr",
        Some("en") => "en",
        _ => windows_lang(),
    }
}

pub fn lang(app: &AppHandle) -> &'static str {
    lang_of(load(app).lang.as_deref())
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
        assert!(serde_json::from_str::<Prefs>("{}").unwrap().lang.is_none());
    }

    #[test]
    fn a_chosen_language_wins_over_windows() {
        assert_eq!(super::lang_of(Some("fr")), "fr");
        assert_eq!(super::lang_of(Some("en")), "en");
        assert!(matches!(super::lang_of(None), "fr" | "en"));
        assert!(matches!(super::lang_of(Some("de")), "fr" | "en"));
    }
}
