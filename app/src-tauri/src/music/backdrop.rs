//! Fond « verre dépoli » du panneau : une page web ne peut pas flouter ce qui est derrière sa
//! fenêtre. On capture donc la zone de l'écran sous la fenêtre `music` (exclue elle-même de
//! toute capture, `WDA_EXCLUDEFROMCAPTURE`), en petite définition, et l'interface la floute.
//! Relue quelques fois par seconde pendant que le panneau est ouvert : le jeu reste vivant
//! derrière le verre. L'exclusion cache aussi le panneau des captures et clips d'iBox.

use tauri::{AppHandle, Manager};

/// Réduction de la capture : le flou efface de toute façon les détails.
const SCALE: i32 = 6;

/// Exclut la fenêtre des captures d'écran (Windows 10 2004 et plus ; sans effet avant).
#[cfg(windows)]
pub fn exclude_from_capture(w: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetWindowDisplayAffinity;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    if let Ok(h) = w.hwnd() {
        unsafe { SetWindowDisplayAffinity(h.0 as _, WDA_EXCLUDEFROMCAPTURE) };
    }
}
#[cfg(not(windows))]
pub fn exclude_from_capture(_: &tauri::WebviewWindow) {}

/// Capture JPEG de la zone de l'écran sous la fenêtre (x, y, largeur, hauteur en px physiques).
#[cfg(windows)]
fn grab(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::*;
    if w <= 0 || h <= 0 {
        return None;
    }
    let (tw, th) = ((w / SCALE).max(1), (h / SCALE).max(1));
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return None;
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, tw, th);
        let old = SelectObject(mem, bmp);
        SetStretchBltMode(mem, HALFTONE);
        let ok = StretchBlt(mem, 0, 0, tw, th, screen, x, y, w, h, SRCCOPY);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = tw;
        info.bmiHeader.biHeight = -th;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0u8; (tw * th * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, th as u32, bgra.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(null_mut(), screen);
        if ok == 0 || lines == 0 {
            return None;
        }
        let mut rgb = Vec::with_capacity((tw * th * 3) as usize);
        for px in bgra.chunks_exact(4) {
            rgb.extend_from_slice(&[px[2], px[1], px[0]]);
        }
        let mut out = Vec::new();
        jpeg_encoder::Encoder::new(&mut out, 60).encode(&rgb, tw as u16, th as u16, jpeg_encoder::ColorType::Rgb).ok()?;
        Some(out)
    }
}
#[cfg(not(windows))]
fn grab(_: i32, _: i32, _: i32, _: i32) -> Option<Vec<u8>> {
    None
}

/// Image (JPEG) de ce qui se trouve derrière le panneau.
#[tauri::command]
pub async fn music_backdrop(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    if !super::overlay::config().is_some_and(|c| c.backdrop) {
        return Err("Fond non autorisé.".into());
    }
    let w = app.get_webview_window(super::overlay::LABEL).ok_or("Panneau fermé.")?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || grab(pos.x, pos.y, size.width as i32, size.height as i32))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Capture indisponible.")?;
    Ok(tauri::ipc::Response::new(bytes))
}
