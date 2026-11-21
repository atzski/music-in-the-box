# Construit l'installeur de l'application autonome (app/) sans y laisser de chemins personnels.
#
#   pwsh -NoProfile -File scripts/build-app.ps1
#
# Comme scripts/release.ps1 d'iBox :
#   - les chemins de compilation (nom d'utilisateur Windows, dossiers cargo et rustup) sont
#     remplacés dans le binaire (--remap-path-prefix) ;
#   - le programme, l'installeur et l'interface compilée sont ensuite analysés : nom
#     d'utilisateur, dossier personnel, nom du PC. Une seule trace arrête tout ;
#   - l'installeur vérifié est copié dans dist/, prêt pour `gh release create`.
# Les versions 1.1.0 à 1.1.2 ont été construites sans ces précautions.
param([switch]$SkipTests)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$app = Join-Path $root "app"
$version = (Get-Content -LiteralPath (Join-Path $app "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$name = "Music in the Box_${version}_x64-setup.exe"

function Assert-NoLeak([string[]]$files) {
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  $needles = @($env:USERNAME, $env:USERPROFILE, $env:COMPUTERNAME) | Where-Object { $_ -and $_.Length -ge 4 } | Select-Object -Unique
  foreach ($file in $files) {
    $text = $latin1.GetString([IO.File]::ReadAllBytes($file))
    foreach ($needle in $needles) {
      foreach ($form in @($needle, $latin1.GetString([Text.Encoding]::Unicode.GetBytes($needle)), $latin1.GetString([Text.Encoding]::UTF8.GetBytes($needle)))) {
        if ($text.IndexOf($form, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $count = ([regex]::Matches($text, [regex]::Escape($form), "IgnoreCase")).Count
          throw "Information personnelle trouvée dans $(Split-Path -Leaf $file) ($count occurrence(s)). Rien n'est publié."
        }
      }
    }
  }
  Write-Host "Analyse : aucune information personnelle dans $($files.Count) fichier(s)."
}

Push-Location $app
try {
  if (-not $SkipTests) {
    npx tsc -b --noEmit
    if ($LASTEXITCODE -ne 0) { throw "Types : échec. Rien n'est construit." }
    npx vitest run
    if ($LASTEXITCODE -ne 0) { throw "Tests de l'interface : échec. Rien n'est construit." }
    Push-Location (Join-Path $app "src-tauri")
    try {
      cargo test --lib
      if ($LASTEXITCODE -ne 0) { throw "Tests natifs : échec. Rien n'est construit." }
    } finally { Pop-Location }
  }

  $saved = @{}
  foreach ($var in "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR") { $saved[$var] = [Environment]::GetEnvironmentVariable($var) }
  $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
  $rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { "$env:USERPROFILE\.rustup" }
  # La dernière règle qui correspond l'emporte : de la plus générale à la plus précise.
  $remaps = @(
    "--remap-path-prefix=$env:USERPROFILE=C:\build",
    "--remap-path-prefix=$cargoHome=C:\cargo",
    "--remap-path-prefix=$rustupHome=C:\rustup",
    "--remap-path-prefix=$root=C:\music-in-the-box"
  )
  # dossier séparé : la construction de développement (chemins réels) n'est jamais publiée
  $target = Join-Path $app "src-tauri\target\publish"
  try {
    $env:CARGO_ENCODED_RUSTFLAGS = $remaps -join [char]0x1f
    $env:CARGO_TARGET_DIR = $target
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation Tauri (code $LASTEXITCODE)." }
  } finally {
    foreach ($var in $saved.Keys) { [Environment]::SetEnvironmentVariable($var, $saved[$var]) }
  }

  $exe = Join-Path $target "release\music-in-the-box.exe"
  $installer = Join-Path $target "release\bundle\nsis\$name"
  # L'interface (dist) est compressée dans le programme : on l'analyse avant compression.
  $front = @(Get-ChildItem -LiteralPath (Join-Path $app "dist") -Recurse -File -Include *.js, *.html, *.css, *.json, *.svg | ForEach-Object FullName)
  Assert-NoLeak (@($exe, $installer) + $front)

  $out = Join-Path $root "dist"
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item -LiteralPath $installer -Destination $out -Force
  $hash = (Get-FileHash -LiteralPath (Join-Path $out $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Installeur : $(Join-Path $out $name)"
  Write-Host "sha256 $hash"
} finally { Pop-Location }
