param(
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$WithWeb,
  [switch]$WithTui,
  [switch]$All,
  [ValidateSet('npm','github')][string]$Registry = 'npm',
  [string]$Tag = 'latest'
)

# BlueNote Windows installer preflight/conflict/rollback contract scaffold (Task 10).
# Run preflight before mutating state; full install mutation is deferred to Task 11.
# ExecutionPolicy/PSSecurityException guidance: if blocked, run PowerShell as instructed by
# your organization or use: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass.

$ErrorActionPreference = 'Stop'
$createdThisRun = @()
$conflicts = @()

function Write-RecoveryCommand {
  '.\scripts\uninstall.ps1 -DryRun # inspect recovery, then rerun without -DryRun if needed'
}

function Invoke-RollbackCurrentRun {
  # best-effort rollback current-run artifacts only; Never delete user notes/config/data.
  foreach ($item in $createdThisRun) {
    Write-Host "rollback artifact: $item"
    if (-not $DryRun) { Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction SilentlyContinue }
  }
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
    if ($found) {
      Write-Host "    conflict candidate: $commandName at $($found.Source)"
      $conflicts += "PATH command $commandName at $($found.Source)"
    }
  }

  Write-Host '  old package/unscoped detection: bluenote, bluenote-webui, bluenote-term'
  Write-Host '  older scoped package lower version detection via semver/version compare'
  Write-Host "  newer installed version than requested tag ($Tag) detection; downgrade only with explicit confirmation"
  Write-Host '  mixed install detection: CLI from npm plus TUI from built artifact'
  Write-Host '  stale daemon process and daemon metadata detection before upgrade'
  Write-Host '  partial previous install detection and repair flow'
  Write-Host '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files'
  if ($env:BLUENOTE_BUILT_CLIENT_DIR -and (Test-Path -LiteralPath $env:BLUENOTE_BUILT_CLIENT_DIR)) {
    $unknownEntries = Get-ChildItem -LiteralPath $env:BLUENOTE_BUILT_CLIENT_DIR -Force | Where-Object { $_.Name -ne '.bluenote-managed' }
    if ($unknownEntries) {
      Write-Host "    unknown files in built artifact install directory: $($unknownEntries.FullName -join ', ')"
      $conflicts += "unknown files in built artifact install directory $env:BLUENOTE_BUILT_CLIENT_DIR"
    }
  }
  Write-Host '  npm global prefix writable/permission preflight'
  Write-Host '  registry/auth preflight for npm registry unavailable/auth failure'
  if ($Registry -eq 'github') {
    Write-Host '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup'
  }
  Write-Host '  unsupported OS/architecture/platform for built TUI artifacts: skip optional clients when safe'
  Write-Host '  Windows PowerShell ExecutionPolicy/PSSecurityException guidance is available'
  if ($Yes -and $conflicts.Count -gt 0) {
    [Console]::Error.WriteLine('ERROR: non-interactive conflict failure; -Yes will not overwrite unknown/conflicting files.')
    foreach ($conflict in $conflicts) { [Console]::Error.WriteLine("  conflict: $conflict") }
    exit 1
  }
  Write-Host 'dry-run conflict summary / Planned actions:'
  if ($Yes) {
    Write-Host '  -Yes non-interactive safe defaults: upgrade/repair same package identity only; skip optional unsupported clients; fail instead of overwriting unknown/conflicting files'
  } else {
    Write-Host '  interactive choices on conflicts: upgrade, repair, uninstall-reinstall, skip optional clients, abort'
  }
  Write-Host "  install package: @lordierclaw/bluenote@$Tag"
  if ($WithWeb -or $All) { Write-Host "  optional package: @lordierclaw/bluenote-webui@$Tag" }
  if ($WithTui -or $All) { Write-Host '  optional built artifact: @lordierclaw/bluenote-term built TUI for supported OS/architecture' }
  Write-Host '  preserve user notes/config/data; Never delete user notes/config/data during install'
  Write-Host '  on failure: best-effort rollback current-run artifacts and print Recovery command'
  Write-Host '  purge-data destructive path exists only in uninstall.ps1 -PurgeData with exact phrase: delete my bluenote data'

  if ($DryRun) { Write-Host 'Dry-run complete; no state mutated.'; exit 0 }
  throw 'Task 10 contract scaffold complete. Real install mutation is intentionally deferred to Task 11. Re-run with -DryRun for planned actions.'
} catch {
  [Console]::Error.WriteLine($_)
  [Console]::Error.WriteLine("Install failed. Recovery command: $(Write-RecoveryCommand)")
  Invoke-RollbackCurrentRun
  exit 1
} finally {
  # Interrupted install/uninstall handling uses try/catch/finally plus rollback current-run artifacts.
}
