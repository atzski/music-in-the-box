//! Music in the Box, application autonome : le mini-lecteur d'iBox sans iBox.
//!
//! L'app vit dans la zone de notification. Alt+C (réglable) ou Vue + Y sur une manette
//! ouvre le panneau par-dessus le jeu (`music::overlay`) ; la fenêtre de réglages s'ouvre
//! depuis l'icône. Aucun système de plugins : tout est actif dès le démarrage.
//!
//! Règle reprise d'iBox : aucune fenêtre n'est créée dans une commande synchrone ni dans
//! un gestionnaire de la boucle d'événements (blocage de WebView2) ; on passe par un fil
//! qui demande la création à la boucle (`run_on_main_thread`).

pub mod music;
pub mod prefs;
pub mod shortcut;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

/// Argument du démarrage avec Windows : l'app reste discrète (pas de fenêtre de réglages).
const HIDDEN: &str = "--hidden";

/// Ouvre (ou ramène devant) la fenêtre de réglages.
pub fn open_settings(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                return;
            }
            let built = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
                .title("Music in the Box")
                .inner_size(760.0, 820.0)
                .min_inner_size(620.0, 560.0)
                .center()
                .background_color(tauri::window::Color(248, 247, 243, 255))
                .build();
            if let Err(e) = built {
                eprintln!("Music in the Box : réglages indisponibles : {e}");
            }
        });
    });
}

#[tauri::command]
async fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
async fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
async fn app_quit(app: AppHandle) {
    app.exit(0);
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let player = MenuItem::with_id(app, "player", "Ouvrir le lecteur", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Réglages", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&player, &settings, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Music in the Box (Alt+C)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "player" => music::overlay::toggle(app),
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                open_settings(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // une seule instance : relancer l'app ouvre ses réglages
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_settings(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![HIDDEN])))
        .setup(|app| {
            let handle = app.handle().clone();
            let prefs = prefs::load(&handle);
            music::overlay::configure(
                &handle,
                Some(music::overlay::Config { hotkey: true, combo: Some(music::overlay::pad::COMBO), webview: true, backdrop: true }),
            );
            music::overlay::set_monitor(prefs.music_monitor.clone());
            music::start(handle.clone());
            let keys = prefs.music_keys.as_deref().and_then(|k| k.parse().ok());
            shortcut::start(handle.clone(), keys, |app, slot| match slot {
                shortcut::Slot::Music => music::overlay::toggle(app),
            });
            tray(&handle)?;
            if !std::env::args().any(|a| a == HIDDEN) {
                open_settings(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            music::music_state,
            music::music_control,
            music::backdrop::music_backdrop,
            music::overlay::music_open,
            music::overlay::music_close,
            music::overlay::music_layout,
            music::overlay::music_follow_cursor,
            music::overlay::music_release,
            music::ytm::music_ytm_open,
            music::ytm::music_ytm_call,
            shortcut::shortcuts_set,
            shortcut::shortcuts_suspend,
            autostart_get,
            autostart_set,
            app_quit,
        ])
        .build(tauri::generate_context!())
        .expect("Music in the Box n'a pas pu démarrer");
    app.run(|_app, event| {
        // fermer la fenêtre de réglages ne quitte pas l'app : elle reste dans la zone de notification
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
