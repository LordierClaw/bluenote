param(
  [switch]$DryRun,
  [switch]$PurgeData,
  [string]$Confirm = ''
)

# BlueNote Windows uninstaller preflight/conflict/rollback contract scaffold (Task 10).
# Normal uninstall preserves notes/config/data. -PurgeData is the only destructive
# user-data path and requires exact typed confirmation: delete my bluenote data.
# ExecutionPolicy/PSSecurityException guidance: if blocked, review the script and use
# Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass only if trusted.

$ErrorActionPreference = 'Stop'
$createdThisRun = @()

function Write-RecoveryCommand {
  '.\scripts\install.ps1 -DryRun # inspect repair/reinstall plan'
}

function Invoke-RollbackCurrentRun {
  # best-effort rollback current-run artifacts only; Never delete user notes/config/data.
  foreach ($item in $createdThisRun) {
    Write-Host "rollback artifact: $item"
    if (-not $DryRun) { Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction SilentlyContinue }
  }
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
  Write-Host '  mixed install detection: CLI from npm plus TUI from built artifact'
  Write-Host '  stop stale daemon process and inspect daemon metadata before uninstall'
  Write-Host '  partial previous install detection and repair/uninstall-reinstall choices'
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
  Write-Host '  uninstall packages/artifacts: @lordierclaw/bluenote, @lordierclaw/bluenote-webui, @lordierclaw/bluenote-term when managed'
  Write-Host '  interactive choices on conflicts: upgrade, repair, uninstall-reinstall, skip optional clients, abort'
  Write-Host '  -Yes/non-interactive contract: fail instead of overwriting unknown/conflicting files'
  Write-Host '  preserve user notes/config/data during normal uninstall'
  Write-Host '  Never delete user notes/config/data unless -PurgeData exact confirmation is supplied'
  Write-Host '  purge confirmation phrase: delete my bluenote data'
  Write-Host '  on failure: best-effort rollback current-run artifacts and print Recovery command'

  if ($DryRun) { Write-Host 'Dry-run complete; no state mutated.'; exit 0 }
  throw 'Task 10 contract scaffold complete. Real uninstall mutation is intentionally deferred to Task 11. Re-run with -DryRun for planned actions.'
} catch {
  [Console]::Error.WriteLine($_)
  [Console]::Error.WriteLine("Uninstall failed. Recovery command: $(Write-RecoveryCommand)")
  Invoke-RollbackCurrentRun
  exit 1
} finally {
  # Interrupted install/uninstall handling uses try/catch/finally plus rollback current-run artifacts.
}
