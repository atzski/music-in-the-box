<p align="center"><img src="logo.png" width="160" alt="Logo Music in the Box"></p>

# Music in the Box

Plugin iBox : contrôlez YouTube Music, ou n'importe quel lecteur Windows, par-dessus vos parties, au clavier (Alt+C par défaut) ou à la manette (Vue + Y).

Créé par **atzski**. S'installe depuis iBox : **Paramètres › Plugins**.

## Ce que le plugin peut faire

Permissions affichées par iBox avant l'installation :

- afficher un panneau par-dessus vos jeux ;
- réserver un raccourci clavier (Alt+C par défaut) ;
- lire la manette pour ouvrir et piloter son panneau (Vue + Y) ;
- voir et piloter le lecteur de musique de Windows ;
- voir l'image du jeu sous son panneau (effet de verre) ;
- ouvrir music.youtube.com dans une fenêtre isolée (vos cookies Google y restent ; ni iBox ni le plugin ne les lisent).

## Contenu

Le mini-lecteur lui-même est intégré à iBox ; ce plugin le réveille (sans lui, iBox ne réserve ni raccourci ni manette) et fournit le pont YouTube Music, la partie qui change avec YouTube.

| Dossier | Rôle |
|---|---|
| `bridge/` | Pont injecté dans music.youtube.com : `parse.js` (traduction des réponses, testée) et `bridge.js` |
| `test/` | Tests Vitest, dont des réponses YouTube Music enregistrées (`fixtures/`) |
| `manifest.json` | Identité, permissions, overlay, WebView |

## Développer

```
npm install
npm test
npm run pack
NOTES="…" npm run release   # publication, sur demande seulement
```

`npm run pack` crée `dist/music-in-the-box-<version>.iboxplugin` et l'entrée de catalogue signée `dist/catalog-entry.json`. La clé d'éditeur n'est jamais dans ce dépôt (`IBOX_PLUGIN_KEY`).

Pour essayer un paquet sans le publier : un catalogue local désigné par `IBOX_PLUGINS_CATALOG` au lancement d'iBox (voir `docs/PLUGINS.md` d'iBox).

## Quand YouTube Music change

Seul `bridge/parse.js` dépend du format des réponses. Enregistrer la nouvelle réponse dans `test/fixtures/`, corriger, publier une nouvelle version du plugin : iBox propose la mise à jour, sans nouvelle version d'iBox.
