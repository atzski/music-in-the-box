//! Source « lecteur Windows » : les contrôles média du système (SMTC). Tout lecteur qui
//! s'y déclare (Spotify, navigateur, YouTube Music PWA, Deezer…) est lu et piloté :
//! lecture/pause, titres précédent/suivant, position. Pas de volume (le SMTC n'en a pas).

use super::{NowPlaying, Source};

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use std::sync::Mutex;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    /// Pochette du dernier titre lu (clé = appli + titre + artiste), relue seulement au changement.
    static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

    /// Lecteur à piloter : jamais les WebView2 (la musique d'ambiance d'iBox et la fenêtre
    /// YouTube Music, déjà pilotée directement, s'y déclarent sous `msedgewebview2.exe`) ;
    /// un lecteur qui joue passe avant un lecteur en pause.
    fn session() -> Option<Session> {
        let manager = Manager::RequestAsync().ok()?.join().ok()?;
        let all = manager.GetSessions().ok()?;
        let mut paused = None;
        for s in all {
            let id = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
            if id.to_ascii_lowercase().contains("msedgewebview2") {
                continue;
            }
            let playing = s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).ok() == Some(Status::Playing);
            if playing {
                return Some(s);
            }
            paused.get_or_insert(s);
        }
        paused
    }

    /// Ticks Windows (100 ns) depuis 1601 → millisecondes Unix.
    fn unix_ms(ticks: i64) -> i64 {
        ticks / 10_000 - 11_644_473_600_000
    }

    fn artwork(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 4 * 1024 * 1024 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let mime = stream.ContentType().map(|t| t.to_string()).ok().filter(|t| t.starts_with("image/")).unwrap_or_else(|| "image/jpeg".into());
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf)))
    }

    pub fn now_playing() -> Option<NowPlaying> {
        let s = session()?;
        let app = s.SourceAppUserModelId().ok().map(|h| h.to_string());
        let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().ok().map(|h| h.to_string()).filter(|a| !a.is_empty());
        let info = s.GetPlaybackInfo().ok()?;
        let playing = info.PlaybackStatus().ok() == Some(Status::Playing);
        let controls = info.Controls().ok();
        let tl = s.GetTimelineProperties().ok()?;
        let duration = tl.EndTime().map(|t| t.Duration).unwrap_or(0) - tl.StartTime().map(|t| t.Duration).unwrap_or(0);
        let mut position = tl.Position().map(|t| t.Duration).unwrap_or(0) / 10_000;
        // la position n'est mise à jour que de temps en temps : on ajoute le temps écoulé
        if playing {
            if let Ok(at) = tl.LastUpdatedTime() {
                let elapsed = super::super::now_ms() as i64 - unix_ms(at.UniversalTime);
                if (0..3_600_000).contains(&elapsed) {
                    position += elapsed;
                }
            }
        }
        let duration_ms = (duration / 10_000).max(0) as u64;
        let key = format!("{}|{title}|{artist}", app.clone().unwrap_or_default());
        let art = {
            let mut cache = ART.lock().ok()?;
            match cache.as_ref() {
                Some((k, a)) if *k == key => a.clone(),
                _ => {
                    let a = artwork(&props);
                    *cache = Some((key.clone(), a.clone()));
                    a
                }
            }
        };
        Some(NowPlaying {
            source: Source::System,
            app: app.as_deref().map(app_name),
            id: key,
            title,
            artist,
            album,
            artwork: art,
            position_ms: (position.max(0) as u64).min(duration_ms.max(position.max(0) as u64)),
            duration_ms,
            playing,
            volume: None,
            liked: None,
            shuffle: info.IsShuffleActive().and_then(|r| r.Value()).ok(),
            repeat: info.AutoRepeatMode().and_then(|r| r.Value()).ok().map(|m| {
                match m {
                    windows::Media::MediaPlaybackAutoRepeatMode::Track => "one",
                    windows::Media::MediaPlaybackAutoRepeatMode::List => "all",
                    _ => "none",
                }
                .to_string()
            }),
            can_seek: controls.and_then(|c| c.IsPlaybackPositionEnabled().ok()).unwrap_or(false) && duration_ms > 0,
        })
    }

    pub fn control(action: &str, value: Option<f64>) -> Result<(), String> {
        let s = session().ok_or("Aucun lecteur en cours.")?;
        let done = match action {
            "toggle" => s.TryTogglePlayPauseAsync().and_then(|o| o.join()),
            "play" => s.TryPlayAsync().and_then(|o| o.join()),
            "pause" => s.TryPauseAsync().and_then(|o| o.join()),
            "next" => s.TrySkipNextAsync().and_then(|o| o.join()),
            "prev" => s.TrySkipPreviousAsync().and_then(|o| o.join()),
            "seek" => {
                let ms = value.unwrap_or(0.0).max(0.0) as i64;
                s.TryChangePlaybackPositionAsync(ms * 10_000).and_then(|o| o.join())
            }
            "shuffle" => {
                let on = s.GetPlaybackInfo().and_then(|i| i.IsShuffleActive()).and_then(|r| r.Value()).unwrap_or(false);
                s.TryChangeShuffleActiveAsync(!on).and_then(|o| o.join())
            }
            "repeat" => {
                use windows::Media::MediaPlaybackAutoRepeatMode as Mode;
                let now = s.GetPlaybackInfo().and_then(|i| i.AutoRepeatMode()).and_then(|r| r.Value()).unwrap_or(Mode::None);
                // aucune → toute la liste → un titre → aucune (comme YouTube Music)
                let next = if now == Mode::None { Mode::List } else if now == Mode::List { Mode::Track } else { Mode::None };
                s.TryChangeAutoRepeatModeAsync(next).and_then(|o| o.join())
            }
            _ => return Err("Action indisponible pour ce lecteur.".into()),
        };
        match done {
            Ok(true) => Ok(()),
            _ => Err("Le lecteur a refusé l'action.".into()),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn now_playing() -> Option<NowPlaying> {
        None
    }
    pub fn control(_: &str, _: Option<f64>) -> Result<(), String> {
        Err("Indisponible sur ce système.".into())
    }
}

pub use imp::{control, now_playing};

/// Nom lisible d'un identifiant d'appli Windows (`Spotify.exe`, `MSEdge`, `…!App`).
pub fn app_name(id: &str) -> String {
    let lower = id.to_ascii_lowercase();
    for (needle, name) in [
        ("spotify", "Spotify"),
        ("music.youtube", "YouTube Music"),
        ("deezer", "Deezer"),
        ("msedge", "Microsoft Edge"),
        ("chrome", "Google Chrome"),
        ("firefox", "Firefox"),
        ("zunemusic", "Lecteur multimédia"),
        ("vlc", "VLC"),
        ("applemusic", "Apple Music"),
        ("tidal", "TIDAL"),
    ] {
        if lower.contains(needle) {
            return name.into();
        }
    }
    let base = id.rsplit(['\\', '/']).next().unwrap_or(id);
    let base = base.split('!').next().unwrap_or(base);
    // applis du Store : « Éditeur.Nom_empreinte » → « Nom »
    let base = match base.rsplit_once('_') {
        Some((name, hash)) if hash.len() >= 10 && hash.chars().all(|c| c.is_ascii_alphanumeric()) => name,
        _ => base,
    };
    let base = base.rsplit('.').find(|p| !p.is_empty() && !p.eq_ignore_ascii_case("exe")).unwrap_or(base);
    base.to_string()
}

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn app_names_are_readable() {
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("MSEdge"), "Microsoft Edge");
        assert_eq!(app_name("C:\\Apps\\foobar2000.exe"), "foobar2000");
        assert_eq!(app_name("Contoso.Player_8wekyb3d8bbwe!App"), "Player");
        assert_eq!(app_name("Claude_pzs8sxrjxfjjc!Claude"), "Claude");
    }
}
