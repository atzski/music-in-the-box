<div align="center">

<img src="logo.png" width="140" alt="Music in the Box">

# Music in the Box

### Your music, on top of your game.

Control YouTube Music, or any music player on Windows, without leaving your game. One shortcut and a small glass panel slides in over the action; press it again and you are back in the fight.

<a href="https://github.com/atzski/ibox/releases/latest"><strong>Get iBox</strong></a> · then <strong>Settings › Plugins › Music in the Box</strong>

Windows 10 and 11 · Free and open source · A plugin for <a href="https://github.com/atzski/ibox">iBox</a>

<sub>English · <a href="README.fr.md">Français</a></sub>

<br>

<img src="docs/media/hero.webp" width="100%" alt="The Music in the Box panel open on the right side of the screen, on top of a night city in Cyberpunk 2077: cover, title, progress bar, playback controls and volume">

</div>

## Open it in the middle of a game

Press **Alt+C** on the keyboard, or hold **View + Y** on a controller. The panel takes the focus while it is open, so your game no longer receives your inputs, and gives it back the moment you close it. The panel never steals a key your game uses: the shortcut can be changed in its settings, and iBox tells you if another app already holds it.

- **Keyboard or controller.** Everything works with the arrows and Enter, or with the D-pad and A/B.
- **Glass that follows the game.** The panel blurs what is behind it, so the game stays alive under the glass, and takes on the colours of the album cover.
- **Stay on screen** if you like: the player stays visible while the game keeps the keyboard and the controller.
- **Out of your captures.** The panel is hidden from screenshots and clips, including iBox's own.

## Your whole YouTube Music library

<p align="center">
  <img src="docs/media/tour.webp" width="62%" alt="Tour of the panel: the player, then the playlists, the liked songs, and a search for Daft Punk">
</p>

Sign in once with your Google account and the panel gives you your library: your playlists and liked songs, what plays next, and search by song or by artist. Your liked songs show up as soon as the first page arrives, and the rest loads while you scroll.

<p align="center">
  <img src="docs/media/playlists.webp" width="32%" alt="The Playlists view: liked music, a recap and mixes">
  <img src="docs/media/liked.webp" width="32%" alt="The liked songs, with a big play button">
  <img src="docs/media/search.webp" width="32%" alt="Searching for Daft Punk: songs with their artists and durations">
</p>

Not using YouTube Music? The panel also drives whatever plays through Windows' media controls (Spotify, Deezer, a browser tab…): title, cover, play/pause, previous and next.

## Private by design

YouTube Music runs in its own isolated window, with its own storage. Your Google cookies stay in it: neither iBox nor the plugin ever reads them. That window never shows up in the taskbar; it only appears when you sign in.

Before installing, iBox lists exactly what the plugin is allowed to do:

- show a panel on top of your games;
- reserve a keyboard shortcut (Alt+C by default);
- read the controller to open and drive its panel (View + Y);
- see and control the Windows music player;
- see the game under its panel, for the glass effect;
- open music.youtube.com in an isolated window.

Every package is signed by its publisher, and iBox checks the signature before installing anything. A disabled plugin reserves no shortcut and opens no window.

## How it is built

The player itself lives in iBox. This repository holds what changes with YouTube: the bridge injected into music.youtube.com. When YouTube changes its pages, a new plugin version fixes it, without a new iBox release.

| Folder | Role |
|---|---|
| `bridge/` | The bridge: `parse.js` reads YouTube Music's answers (tested), `bridge.js` drives the player |
| `test/` | Vitest tests, with recorded YouTube Music answers (`fixtures/`) |
| `manifest.json` | Identity, permissions, panel and web view |

```
npm install
npm test
npm run pack      # signed package in dist/ (the publisher key never lives in this repository)
```

To try a package without publishing it, point iBox to a local catalog with `IBOX_PLUGINS_CATALOG` (see `docs/PLUGINS.md` in iBox).

<sub>Music in the Box is not affiliated with YouTube or Google. Made by <a href="https://github.com/atzski">atzski</a>.</sub>
