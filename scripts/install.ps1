param(
  [switch]$Interactive,
  [switch]$Yes,
  [switch]$WithWeb,
  [switch]$WithTui,
  [switch]$All,
  [string]$Tag = 'latest',
  [ValidateSet('npm','github')][string]$Registry = 'npm',
  [ValidateSet('path','built','auto')][string]$ClientMode = 'auto',
  [switch]$DryRun
)

# BlueNote Windows installer. Interactive by default; safe default installs only
# @lordierclaw/bluenote from npmjs, then runs bluenote doctor.
# ExecutionPolicy/PSSecurityException guidance: if blocked, review the script and use
# Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass only if trusted.

$ErrorActionPreference = 'Stop'
$createdThisRun = @()
$conflicts = @()
if ($All) { $WithWeb = $true; $WithTui = $true; $ClientMode = 'built' }
if ($WithTui) { $ClientMode = 'built' }
if ($Interactive -and $Yes) { throw 'Use only one of -Interactive or -Yes' }

function Write-RecoveryCommand { '.\scripts\uninstall.ps1 -DryRun # inspect recovery, then rerun without -DryRun if needed' }
function Invoke-RollbackCurrentRun {
  Write-Host 'Attempting best-effort rollback for current-run artifacts.'
  foreach ($item in $createdThisRun) {
    Write-Host "rollback artifact: $item"
    if (-not $DryRun) { Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
function Invoke-CommandLine([string[]]$CommandLine) {
  Write-Host ('+ ' + ($CommandLine -join ' '))
  if (-not $DryRun) { & $CommandLine[0] @($CommandLine | Select-Object -Skip 1); if ($LASTEXITCODE -ne 0) { throw "command failed: $($CommandLine -join ' ')" } }
}
function Test-BuiltTuiPlatform {
  return ($IsWindows -or $env:OS -eq 'Windows_NT') -and ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -in @('X64','Arm64'))
}

trap [System.Management.Automation.PSSecurityException] {
  Write-Error 'PowerShell ExecutionPolicy blocked this installer. Use a trusted shell or Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass after reviewing the script.'
  break
}

try {
  Write-Host 'Preflight checks before mutating state'
  Write-Host '  missing required runtime: verify node and npm are available'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'missing required runtime node' }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'missing required runtime npm' }
  Write-Host '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term'
  foreach ($commandName in @('bluenote','bn','bluenote-webui','bluenote-term')) {
    $found = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($found) { Write-Host "    Conflict found: $commandName at $($found.Source)"; $conflicts += "PATH command $commandName at $($found.Source)" }
  }
  Write-Host '  old package/unscoped detection: bluenote, bluenote-webui, bluenote-term'
  Write-Host '  older scoped package lower version detection via semver/version compare'
  Write-Host "  newer installed version than requested tag ($Tag) detection; do not downgrade without explicit confirmation"
  Write-Host '  mixed install detection: CLI from npm plus TUI from built artifact'
  Write-Host '  stale daemon process and daemon metadata detection before upgrade'
  Write-Host '  partial previous install detection for missing CLI/client/artifact pieces and repair flow'
  Write-Host '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files'
  if ($env:BLUENOTE_BUILT_CLIENT_DIR -and (Test-Path -LiteralPath $env:BLUENOTE_BUILT_CLIENT_DIR)) {
    $unknownEntries = Get-ChildItem -LiteralPath $env:BLUENOTE_BUILT_CLIENT_DIR -Force | Where-Object { $_.Name -notin @('.bluenote-managed','client-mode.env','bluenote-term.exe','bluenote-term') }
    if ($unknownEntries) { Write-Host "    unknown files in built artifact install directory: $($unknownEntries.FullName -join ', ')"; $conflicts += "unknown files in built artifact install directory $env:BLUENOTE_BUILT_CLIENT_DIR" }
  }
  Write-Host '  npm global prefix writable/permission preflight'
  Write-Host '  registry/auth preflight for npm registry unavailable/auth failure'
  if ($Registry -eq 'github') { Write-Host '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup' }
  else { Write-Host '  npmjs registry selected; on auth/network failure retry or choose -Registry github with GitHub Packages token setup' }
  Write-Host '  unsupported OS/architecture/platform for built TUI artifacts: skip optional clients when safe'
  Write-Host '  Windows PowerShell ExecutionPolicy/PSSecurityException guidance is available'
  if ($Yes -and $conflicts.Count -gt 0) {
    [Console]::Error.WriteLine('ERROR: non-interactive conflict failure; -Yes will not overwrite unknown/conflicting files.')
    foreach ($conflict in $conflicts) { [Console]::Error.WriteLine("  conflict: $conflict") }
    exit 1
  }
  if ($conflicts.Count -gt 0) {
    Write-Host 'Conflict found; safe choices: upgrade, repair, skip, abort. Interactive mode will never overwrite unknown conflicts by default.'
    if (-not $DryRun) {
      if ([Console]::IsInputRedirected) { throw 'conflicts require interactive choice; aborting in non-interactive input' }
      $conflictChoice = Read-Host 'Choose how to handle detected conflicts: [a]bort, [u]pgrade, [r]epair, [s]kip optional clients'
      switch ($conflictChoice) {
        'u' { Write-Host 'Continuing with upgrade after explicit interactive choice.' }
        'U' { Write-Host 'Continuing with upgrade after explicit interactive choice.' }
        'r' { Write-Host 'Continuing with repair after explicit interactive choice.' }
        'R' { Write-Host 'Continuing with repair after explicit interactive choice.' }
        's' { $WithWeb = $false; $WithTui = $false; Write-Host 'Skipping optional clients after explicit interactive choice.' }
        'S' { $WithWeb = $false; $WithTui = $false; Write-Host 'Skipping optional clients after explicit interactive choice.' }
        default { throw 'Aborting install due to detected conflicts.' }
      }
    }
  }
  if (-not $DryRun -and -not $Yes -and [Console]::IsInputRedirected) { throw 'default install is interactive; use -Yes for non-interactive automation' }
  if (-not $DryRun -and -not $Yes -and -not [Console]::IsInputRedirected) {
    Write-Host ''
    Write-Host 'BlueNote installer (safe defaults shown in brackets). Press Enter to keep defaults.'
    $modeChoice = Read-Host 'Install mode: [1] CLI only, [2] CLI + WebUI, [3] CLI + built TUI, [4] all clients'
    switch ($modeChoice) {
      '2' { $WithWeb = $true }
      '3' { $WithTui = $true; $ClientMode = 'built' }
      '4' { $WithWeb = $true; $WithTui = $true; $ClientMode = 'built' }
      default { }
    }
    $registryChoice = Read-Host 'Registry: [1] npmjs, [2] GitHub Packages'
    if ($registryChoice -eq '2') { $Registry = 'github' }
  }

  if ($WithTui -and -not (Test-BuiltTuiPlatform)) { throw 'unsupported OS/architecture/platform for built terminal artifact; no Bun-source fallback will be used' }

  if ($Yes) { Write-Host 'Install mode: non-interactive' } else { Write-Host 'Install mode: interactive' }
  Write-Host 'Default selected clients: @lordierclaw/bluenote only'
  Write-Host 'Client choices:'
  Write-Host '  [x] @lordierclaw/bluenote (distribution CLI)'
  $webMark = if ($WithWeb) { 'x' } else { ' ' }
  $tuiMark = if ($WithTui) { 'x' } else { ' ' }
  Write-Host "  [$webMark] @lordierclaw/bluenote-webui (WebUI)"
  Write-Host "  [$tuiMark] @lordierclaw/bluenote-term built terminal artifact (TUI)"
  Write-Host '  [ ] all clients (CLI + WebUI + built TUI)'
  Write-Host 'Registry choices: npmjs (default), GitHub Packages'
  Write-Host 'dry-run conflict summary / Planned actions:'
  if ($Yes) { Write-Host '  -Yes non-interactive safe defaults: CLI only; fail instead of overwriting unknown/conflicting files' }
  else { Write-Host '  interactive choices on conflicts: upgrade, repair, skip optional clients, abort' }
  if ($Registry -eq 'github') { Write-Host '  configure npm: @lordierclaw:registry=https://npm.pkg.github.com (requires NODE_AUTH_TOKEN or GH_TOKEN)' }
  else { Write-Host '  registry: npmjs default; do not configure GitHub Packages registry' }
  Write-Host "  install package: @lordierclaw/bluenote@$Tag"
  if ($WithWeb) { Write-Host "  optional package: @lordierclaw/bluenote-webui@$Tag" }
  if ($WithTui) { Write-Host '  optional built terminal artifact: copy BLUENOTE_TERM_ARTIFACT_PATH into managed client dir (does not require Bun at runtime; will not use Bun source install)' }
  if ($WithTui -or $ClientMode -eq 'built') {
    $builtDir = if ($env:BLUENOTE_BUILT_CLIENT_DIR) { $env:BLUENOTE_BUILT_CLIENT_DIR } else { Join-Path $HOME 'AppData\Local\BlueNote\clients' }
    Write-Host "  write client-mode record: BLUENOTE_CLIENT_MODE=built and BLUENOTE_BUILT_CLIENT_DIR=$builtDir for built-binary mode"
    Write-Host "  managed built client shim: $(Join-Path $builtDir 'bluenote-term.cmd')"
  }
  Write-Host '  preserve user notes/config/data; Never delete user notes/config/data during install'
  Write-Host '  run after install: bluenote doctor'
  Write-Host '  on failure: best-effort rollback current-run artifacts and print Recovery command'

  function Write-ClientModeRecord {
    $builtDir = if ($env:BLUENOTE_BUILT_CLIENT_DIR) { $env:BLUENOTE_BUILT_CLIENT_DIR } else { Join-Path $HOME 'AppData\Local\BlueNote\clients' }
    $configHome = if ($env:BLUENOTE_CONFIG_HOME) { $env:BLUENOTE_CONFIG_HOME } elseif ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME 'AppData\Roaming' }
    $configDir = Join-Path $configHome 'bluenote'
    Invoke-CommandLine @('powershell','-NoProfile','-Command',"New-Item -ItemType Directory -Force -Path '$builtDir','$configDir' | Out-Null")
    $shimPath = Join-Path $builtDir 'bluenote-term.cmd'
    $recordPath = Join-Path $configDir 'client-mode.env'
    $createdThisRun += $shimPath
    $createdThisRun += $recordPath
    if (-not $DryRun) {
      if ($WithTui) {
        if (-not $env:BLUENOTE_TERM_ARTIFACT_PATH -or -not (Test-Path -LiteralPath $env:BLUENOTE_TERM_ARTIFACT_PATH)) { throw '-WithTui requires BLUENOTE_TERM_ARTIFACT_PATH pointing to a Bun-free built terminal executable; no Bun-source fallback will be used.' }
        Copy-Item -LiteralPath $env:BLUENOTE_TERM_ARTIFACT_PATH -Destination $shimPath -Force
      } else {
        Set-Content -LiteralPath $shimPath -Value @('@echo off','rem managed BlueNote built client placeholder') -Encoding ASCII
      }
      Set-Content -LiteralPath $recordPath -Value "BLUENOTE_CLIENT_MODE=built`nBLUENOTE_BUILT_CLIENT_DIR=$builtDir" -Encoding ASCII
    }
    Write-Host "managed built client shim: $shimPath"
    Write-Host "client-mode record: $recordPath"
  }

  if ($DryRun) { Write-Host 'Dry-run complete; no state mutated.'; exit 0 }
  if ($Registry -eq 'github') { Invoke-CommandLine @('npm','config','set','@lordierclaw:registry','https://npm.pkg.github.com') }
  Invoke-CommandLine @('npm','install','-g',"@lordierclaw/bluenote@$Tag")
  if ($WithWeb) { Invoke-CommandLine @('npm','install','-g',"@lordierclaw/bluenote-webui@$Tag") }
  if ($WithTui -or $ClientMode -eq 'built') { Write-ClientModeRecord }
  Invoke-CommandLine @('bluenote','doctor')
  Write-Host 'BlueNote install complete.'
} catch {
  [Console]::Error.WriteLine($_)
  [Console]::Error.WriteLine("Install failed. Recovery command: $(Write-RecoveryCommand)")
  Invoke-RollbackCurrentRun
  exit 1
}
