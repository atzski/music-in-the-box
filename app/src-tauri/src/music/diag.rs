//! Journal de diagnostic des overlays (capture Alt+X, musique Alt+C et Vue + Y) :
//! `logs/overlay.log`. Sert à comprendre pourquoi un overlay ne s'affiche pas sur un jeu
//! (raccourci jamais reçu, jeu plus privilégié qu'iBox, plein écran exclusif…).
//! Une ligne par événement, le fichier repart de zéro au-delà de 256 Ko.

use std::io::Write;

use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 256 * 1024;

pub fn log(app: &AppHandle, event: &str) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("overlay.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    let line = format!("{} {event} | {}\n", super::now_ms(), foreground());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Programme au premier plan, mode d'affichage selon Windows, taille de sa fenêtre.
#[cfg(windows)]
fn foreground() -> String {
    use windows_sys::Win32::Foundation::{CloseHandle, RECT};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::UI::Shell::SHQueryUserNotificationState;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        // accès refusé : le programme a plus de droits qu'iBox (administrateur, protégé)
        let exe = if h.is_null() {
            "accès refusé".to_string()
        } else {
            let mut buf = [0u16; 520];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(h);
            if ok { String::from_utf16_lossy(&buf[..len as usize]).rsplit('\\').next().unwrap_or("").to_string() } else { "?".into() }
        };
        let mut state = 0;
        let _ = SHQueryUserNotificationState(&mut state);
        let mode = match state {
            3 => "plein écran exclusif",
            2 => "plein écran (occupé)",
            4 => "présentation",
            5 => "normal",
            7 => "appli plein écran",
            _ => "?",
        };
        let mut r: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut r);
        format!("premier plan : {exe} (pid {pid}) · Windows : {mode} ({state}) · fenêtre {}x{}", r.right - r.left, r.bottom - r.top)
    }
}
#[cfg(not(windows))]
fn foreground() -> String {
    String::new()
}

/// Après une ouverture : la fenêtre est-elle visible, et au premier plan ?
#[cfg(windows)]
pub fn after_show(app: &AppHandle, label: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindowVisible};
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let Some(w) = app.get_webview_window(&label) else {
            return log(&app, &format!("{label} : fenêtre absente"));
        };
        let Ok(h) = w.hwnd() else { return };
        let hwnd = h.0 as isize;
        let (visible, front) = unsafe { (IsWindowVisible(hwnd as _) != 0, GetForegroundWindow() as isize == hwnd) };
        log(&app, &format!("{label} : visible {visible}, au premier plan {front}"));
    });
}
#[cfg(not(windows))]
pub fn after_show(_: &AppHandle, _: &str) {}
