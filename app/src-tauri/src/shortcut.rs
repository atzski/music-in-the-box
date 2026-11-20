//! Raccourci clavier global du lecteur (repris d'iBox), réglable dans la fenêtre de réglages.
//! Un seul fil l'enregistre (`RegisterHotKey`) et le ré-enregistre dès que le réglage change ;
//! il signale quand une autre application a déjà pris la combinaison. Par défaut : Alt+C,
//! touche qu'aucun jeu PC courant n'utilise en combinaison avec Alt.

use std::fmt;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

pub const MOD_ALT: u32 = 0x1;
pub const MOD_CONTROL: u32 = 0x2;
pub const MOD_SHIFT: u32 = 0x4;
pub const MOD_WIN: u32 = 0x8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shortcut {
    /// Combinaison de `MOD_*`.
    pub modifiers: u32,
    /// Code de touche virtuelle Windows.
    pub vk: u32,
}

/// Les raccourcis gérés ici (un seul dans l'app autonome).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Music = 0,
}
const SLOTS: usize = 1;

pub const DEFAULT_MUSIC: &str = "Alt+C";

const NAMED: &[(&str, u32)] = &[
    ("Pause", 0x13),
    ("ScrollLock", 0x91),
    ("Insert", 0x2D),
    ("Delete", 0x2E),
    ("Home", 0x24),
    ("End", 0x23),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("Space", 0x20),
];

fn key_code(name: &str) -> Option<u32> {
    if let Some(n) = name.strip_prefix(['F', 'f']).and_then(|n| n.parse::<u32>().ok()) {
        return (1..=24).contains(&n).then_some(0x70 + n - 1);
    }
    if name.chars().count() == 1 {
        let c = name.chars().next()?.to_ascii_uppercase();
        return c.is_ascii_alphanumeric().then_some(c as u32);
    }
    NAMED.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, vk)| *vk)
}

fn key_name(vk: u32) -> String {
    match vk {
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk).map(String::from).unwrap_or_default(),
        _ => NAMED.iter().find(|(_, v)| *v == vk).map_or_else(|| format!("0x{vk:02X}"), |(n, _)| (*n).to_owned()),
    }
}

impl FromStr for Shortcut {
    type Err = String;

    /// « Alt+C », « Ctrl+Maj+F9 » : au moins Ctrl, Alt ou Win (Maj seule changerait une
    /// lettre ordinaire) et exactement une touche.
    fn from_str(s: &str) -> Result<Self, String> {
        let mut modifiers = 0;
        let mut vk = None;
        for part in s.split('+').map(str::trim).filter(|p| !p.is_empty()) {
            let m = match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => MOD_CONTROL,
                "alt" => MOD_ALT,
                "shift" | "maj" => MOD_SHIFT,
                "win" => MOD_WIN,
                _ => 0,
            };
            if m != 0 {
                modifiers |= m;
                continue;
            }
            let code = key_code(part).ok_or_else(|| format!("touche inconnue : « {part} »"))?;
            if vk.replace(code).is_some() {
                return Err("une seule touche en plus des modificateurs".into());
            }
        }
        let vk = vk.ok_or("touche manquante")?;
        if modifiers & (MOD_CONTROL | MOD_ALT | MOD_WIN) == 0 {
            return Err("Ctrl, Alt ou Win est nécessaire".into());
        }
        Ok(Shortcut { modifiers, vk })
    }
}

impl fmt::Display for Shortcut {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (m, name) in [(MOD_CONTROL, "Ctrl"), (MOD_ALT, "Alt"), (MOD_SHIFT, "Maj"), (MOD_WIN, "Win")] {
            if self.modifiers & m != 0 {
                write!(f, "{name}+")?;
            }
        }
        f.write_str(&key_name(self.vk))
    }
}

/// Raccourcis voulus (None : désactivé) et état réel de leur enregistrement.
static WANTED: Mutex<[Option<Shortcut>; SLOTS]> = Mutex::new([None]);
static TAKEN: [AtomicBool; SLOTS] = [AtomicBool::new(false)];
static APPLIED: AtomicBool = AtomicBool::new(true);
/// Saisie d'un nouveau raccourci dans les Paramètres : tout est libéré le temps de la saisie.
static SUSPENDED: AtomicBool = AtomicBool::new(false);

pub fn set(slot: Slot, shortcut: Option<Shortcut>) {
    if let Ok(mut w) = WANTED.lock() {
        if w[slot as usize] != shortcut {
            w[slot as usize] = shortcut;
            APPLIED.store(false, Ordering::Relaxed);
        }
    }
}

/// Démarre le fil des raccourcis avec la combinaison gardée (sinon celle par défaut) ;
/// `on_press` reçoit le raccourci pressé.
pub fn start(app: AppHandle, music: Option<Shortcut>, on_press: fn(&AppHandle, Slot)) {
    set(Slot::Music, music.or_else(|| DEFAULT_MUSIC.parse().ok()));
    thread(app, on_press);
}

#[cfg(windows)]
fn thread(app: AppHandle, on_press: fn(&AppHandle, Slot)) {
    std::thread::spawn(move || unsafe {
        use std::ptr::null_mut;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY};
        const BASE: i32 = 0x1B10;
        let mut registered: [Option<Shortcut>; SLOTS] = [None];
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let suspended = SUSPENDED.load(Ordering::Relaxed);
            let wanted = if suspended { [None] } else { WANTED.lock().map(|w| *w).unwrap_or([None]) };
            for i in 0..SLOTS {
                if registered[i] != wanted[i] || (wanted[i].is_some() && TAKEN[i].load(Ordering::Relaxed) && !APPLIED.load(Ordering::Relaxed)) {
                    if registered[i].take().is_some() {
                        UnregisterHotKey(null_mut(), BASE + i as i32);
                    }
                    let mut taken = false;
                    if let Some(s) = wanted[i] {
                        if RegisterHotKey(null_mut(), BASE + i as i32, s.modifiers | MOD_NOREPEAT, s.vk) != 0 {
                            registered[i] = Some(s);
                        } else {
                            taken = true;
                            crate::music::diag::log(&app, &format!("raccourci {s} indisponible : déjà pris par une autre application"));
                        }
                    }
                    // un raccourci suspendu n'est pas « pris » : on ne signale rien pendant la saisie
                    if !suspended {
                        TAKEN[i].store(taken, Ordering::Relaxed);
                    }
                }
            }
            APPLIED.store(true, Ordering::Relaxed);
            while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_HOTKEY {
                    let slot = match msg.wParam as i32 - BASE {
                        0 => Some(Slot::Music),
                        _ => None,
                    };
                    if let Some(slot) = slot {
                        crate::music::diag::log(&app, &format!("raccourci {} reçu", registered[slot as usize].map(|s| s.to_string()).unwrap_or_default()));
                        on_press(&app, slot);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    });
}
#[cfg(not(windows))]
fn thread(_app: AppHandle, _on_press: fn(&AppHandle, Slot)) {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsState {
    /// Combinaison appliquée, écrite comme dans les réglages (« Alt+C »).
    pub music: Option<String>,
    /// Combinaison déjà prise par une autre application.
    pub music_taken: bool,
}

fn state() -> ShortcutsState {
    let w = WANTED.lock().map(|w| *w).unwrap_or([None]);
    ShortcutsState { music: w[0].map(|s| s.to_string()), music_taken: TAKEN[0].load(Ordering::Relaxed) }
}

/// Applique le raccourci des réglages (`None` : désactivé), le garde pour le prochain
/// démarrage et rend son état réel.
#[tauri::command]
pub async fn shortcuts_set(app: AppHandle, music: Option<String>) -> Result<ShortcutsState, String> {
    let music = music.map(|s| s.parse::<Shortcut>()).transpose()?;
    set(Slot::Music, music);
    crate::prefs::update(&app, |p| p.music_keys = music.map(|s| s.to_string()));
    // laisse le fil appliquer (il passe toutes les 30 ms)
    for _ in 0..20 {
        if APPLIED.load(Ordering::Relaxed) {
            break;
        }
        tokio_sleep(Duration::from_millis(25)).await;
    }
    Ok(state())
}

/// Libère (ou reprend) tous les raccourcis pendant la saisie d'une nouvelle combinaison.
#[tauri::command]
pub async fn shortcuts_suspend(suspended: bool) {
    SUSPENDED.store(suspended, Ordering::Relaxed);
    APPLIED.store(false, Ordering::Relaxed);
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_writes_shortcuts() {
        let s: Shortcut = "alt+c".parse().unwrap();
        assert_eq!((s.modifiers, s.vk), (MOD_ALT, 'C' as u32));
        assert_eq!(s.to_string(), "Alt+C");
        assert_eq!("Ctrl+Maj+F9".parse::<Shortcut>().unwrap().to_string(), "Ctrl+Maj+F9");
        assert_eq!("Win+Shift+1".parse::<Shortcut>().unwrap().to_string(), "Maj+Win+1");
    }

    #[test]
    fn refuses_unsafe_shortcuts() {
        assert!("C".parse::<Shortcut>().is_err());
        assert!("Maj+C".parse::<Shortcut>().is_err());
        assert!("Alt+C+D".parse::<Shortcut>().is_err());
        assert!("Alt+Truc".parse::<Shortcut>().is_err());
    }

    #[test]
    fn defaults_are_valid() {
        assert!(DEFAULT_MUSIC.parse::<Shortcut>().is_ok());
    }
}
