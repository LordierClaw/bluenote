param(
  [switch]$PurgeConfig,
  [switch]$PurgeCache,
  [switch]$PurgeData,
  [string]$Confirm = '',
  [switch]$DryRun
)

# BlueNote Windows uninstaller. Normal uninstall preserves notes/config/data.
# -PurgeData is destructive and requires exact typed confirmation: delete my bluenote data.
# ExecutionPolicy/PSSecurityException guidance: if blocked, review the script and use
# Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass only if trusted.

$ErrorActionPreference = 'Stop'
$createdThisRun = @()

function Write-RecoveryCommand { '.\scripts\install.ps1 -DryRun # inspect repair/reinstall plan' }
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
function Get-ConfigHome {
  if ($env:BLUENOTE_CONFIG_HOME) { return $env:BLUENOTE_CONFIG_HOME }
  if ($env:APPDATA) { return $env:APPDATA }
  return (Join-Path $HOME 'AppData\Roaming')
}
function Get-RecordedBuiltClientDir {
  if ($env:BLUENOTE_BUILT_CLIENT_DIR) { return $env:BLUENOTE_BUILT_CLIENT_DIR }
  $recordPath = Join-Path (Join-Path (Get-ConfigHome) 'bluenote') 'client-mode.env'
  if (Test-Path -LiteralPath $recordPath) {
    $line = Get-Content -LiteralPath $recordPath | Where-Object { $_ -like 'BLUENOTE_BUILT_CLIENT_DIR=*' } | Select-Object -Last 1
    if ($line) { return $line.Substring('BLUENOTE_BUILT_CLIENT_DIR='.Length) }
  }
  return (Join-Path $HOME 'AppData\Local\BlueNote\clients')
}

trap [System.Management.Automation.PSSecurityException] {
  Write-Error 'PowerShell ExecutionPolicy blocked this uninstaller. Use a trusted shell or Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass after reviewing the script.'
  break
}

try {
  Write-Host 'Preflight checks before mutating state'
  Write-Host '  missing required runtime: verify node and npm are available'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'missing required runtime node' }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'missing required runtime npm' }
  Write-Host '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term'
  Write-Host '  old package/unscoped detection: bluenote, bluenote-webui, bluenote-term'
  Write-Host '  older scoped package lower version detection via semver/version compare'
  Write-Host '  newer installed version than requested detection and downgrade protection'
  Write-Host '  mixed install detection: npm CLI with built artifact TUI'
  Write-Host '  stale daemon process and daemon metadata detection before uninstall'
  Write-Host '  partial previous install detection and repair choices'
  Write-Host '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files'
  Write-Host '  npm global prefix writable/permission preflight'
  Write-Host '  GitHub Packages auth/registry guidance: @lordierclaw:registry, NODE_AUTH_TOKEN/GH_TOKEN, .npmrc'
  Write-Host '  unsupported OS/architecture/platform for built artifact: skip optional clients'
  Write-Host '  Windows PowerShell ExecutionPolicy/PSSecurityException guidance is available'

  if ($PurgeData) {
    if ($Confirm -ne 'delete my bluenote data') { throw 'ERROR: -PurgeData requires exact confirmation: delete my bluenote data' }
    Write-Host 'Purge-data confirmed by exact typed phrase: delete my bluenote data'
  }

  Write-Host 'dry-run conflict summary / Planned actions:'
  Write-Host '  stop stale daemon / daemon metadata if present before package/artifact removal'
  Write-Host '  bluenote daemon stop'
  Write-Host '  uninstall packages/artifacts: @lordierclaw/bluenote, @lordierclaw/bluenote-webui, and optionally remove managed @lordierclaw/bluenote-term built terminal artifact'
  Write-Host '  npm uninstall -g @lordierclaw/bluenote'
  Write-Host '  npm uninstall -g @lordierclaw/bluenote-webui'
  Write-Host '  npm uninstall -g @lordierclaw/bluenote-term'
  $builtDir = Get-RecordedBuiltClientDir
  Write-Host "  remove managed built client executable: $(Join-Path $builtDir 'bluenote-term.exe')"
  Write-Host '  interactive choices on conflicts: upgrade, repair, skip optional clients, abort'
  Write-Host '  -Yes/non-interactive contract: fail instead of overwriting unknown/conflicting files'
  Write-Host '  preserve user notes/config/data during normal uninstall'
  Write-Host '  Never delete user notes/config/data unless -PurgeData exact confirmation is supplied'
  Write-Host '  purge confirmation phrase: delete my bluenote data'
  if ($PurgeConfig) { Write-Host "  purge config after package removal: $(Join-Path (Get-ConfigHome) 'bluenote')" }
  if ($PurgeCache) { Write-Host '  purge cache after package removal' }
  if ($PurgeData) { Write-Host '  purge data after exact confirmation phrase' }
  Write-Host '  on failure: best-effort rollback current-run artifacts and print Recovery command'

  if ($DryRun) { Write-Host 'Dry-run complete; no state mutated.'; exit 0 }
  try { Invoke-CommandLine @('bluenote','daemon','stop') } catch { Write-Host 'daemon was not running or could not be stopped; continuing uninstall' }
  Invoke-CommandLine @('npm','uninstall','-g','@lordierclaw/bluenote')
  try { Invoke-CommandLine @('npm','uninstall','-g','@lordierclaw/bluenote-webui') } catch {}
  try { Invoke-CommandLine @('npm','uninstall','-g','@lordierclaw/bluenote-term') } catch {}
  $builtDir = Get-RecordedBuiltClientDir
  if (-not $DryRun) { Remove-Item -LiteralPath (Join-Path $builtDir 'bluenote-term.exe') -Force -ErrorAction SilentlyContinue }
  $configHome = Get-ConfigHome
  if (-not $DryRun) { Remove-Item -LiteralPath (Join-Path (Join-Path $configHome 'bluenote') 'client-mode.env') -Force -ErrorAction SilentlyContinue }
  if ($PurgeCache) { Remove-Item -LiteralPath (Join-Path $HOME 'AppData\Local\BlueNote\cache') -Recurse -Force -ErrorAction SilentlyContinue }
  if ($PurgeConfig) { Remove-Item -LiteralPath (Join-Path (Get-ConfigHome) 'bluenote') -Recurse -Force -ErrorAction SilentlyContinue }
  if ($PurgeData) { Remove-Item -LiteralPath (Join-Path $HOME 'AppData\Local\BlueNote\data') -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host 'BlueNote uninstall complete. User notes/config/data preserved unless purge flags were confirmed.'
} catch {
  [Console]::Error.WriteLine($_)
  [Console]::Error.WriteLine("Uninstall failed. Recovery command: $(Write-RecoveryCommand)")
  Invoke-RollbackCurrentRun
  exit 1
}
