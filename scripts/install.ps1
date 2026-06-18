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
$builtClientDir = if ($env:BLUENOTE_BUILT_CLIENT_DIR) { $env:BLUENOTE_BUILT_CLIENT_DIR } else { Join-Path $HOME 'AppData\Local\BlueNote\clients' }
$newPaths = @()
$backups = @()
$installedPackages = @()
$registryConfigTouched = $false
$scopeRegistryKey = '@lordierclaw:registry'
$previousScopeRegistry = ''
$scopeRegistryWasSet = $false
if ($All) { $WithWeb = $true; $WithTui = $true; $ClientMode = 'built' }
if ($WithTui) { $ClientMode = 'built' }
if ($Interactive -and $Yes) { throw 'Use only one of -Interactive or -Yes' }

function Write-RecoveryCommand { '.\scripts\uninstall.ps1 -DryRun # inspect recovery, then rerun without -DryRun if needed' }
function Invoke-RollbackCurrentRun {
  Write-Host 'Attempting best-effort rollback for current-run artifacts.'
  if (-not $DryRun) {
    foreach ($package in @($installedPackages) | Select-Object -Reverse) {
      Write-Host "rollback package: $package"
      try { & npm uninstall -g $package *> $null } catch { }
    }
    if ($registryConfigTouched) {
      if ($scopeRegistryWasSet) {
        Write-Host "restore npm config: $scopeRegistryKey=$previousScopeRegistry"
        try { & npm config set $scopeRegistryKey $previousScopeRegistry *> $null } catch { }
      } else {
        Write-Host "remove npm config: $scopeRegistryKey"
        try { & npm config delete $scopeRegistryKey *> $null } catch { }
      }
    }
  }
  foreach ($backup in $backups) {
    Write-Host "restore artifact: $($backup.Target)"
    if (-not $DryRun) { Copy-Item -LiteralPath $backup.BackupPath -Destination $backup.Target -Force }
  }
  foreach ($item in $newPaths) {
    Write-Host "rollback artifact: $item"
    if (-not $DryRun) { Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction SilentlyContinue }
  }
  foreach ($backup in $backups) {
    if (-not $DryRun) { Remove-Item -LiteralPath $backup.BackupPath -Force -ErrorAction SilentlyContinue }
  }
}
function Invoke-CommandLine([string[]]$CommandLine) {
  Write-Host ('+ ' + ($CommandLine -join ' '))
  if (-not $DryRun) { & $CommandLine[0] @($CommandLine | Select-Object -Skip 1); if ($LASTEXITCODE -ne 0) { throw "command failed: $($CommandLine -join ' ')" } }
}
function Save-ExistingFileForRollback([string]$TargetPath) {
  if (Test-Path -LiteralPath $TargetPath) {
    $backupPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    Copy-Item -LiteralPath $TargetPath -Destination $backupPath -Force
    $script:backups += [pscustomobject]@{ Target = $TargetPath; BackupPath = $backupPath }
  } else {
    $script:newPaths += $TargetPath
  }
}
function Test-BuiltTuiPlatform {
  return ($IsWindows -or $env:OS -eq 'Windows_NT') -and ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -in @('X64','Arm64'))
}
function Get-ConfigDir {
  $configHome = if ($env:BLUENOTE_CONFIG_HOME) { $env:BLUENOTE_CONFIG_HOME } elseif ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME 'AppData\Roaming' }
  Join-Path $configHome 'bluenote'
}
function Get-RequestedReleaseVersion {
  if ($Tag -match '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$') { return $Tag }
  return (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
}
function Get-RecordedBuiltClientDir {
  $recordPath = Join-Path (Get-ConfigDir) 'client-mode.env'
  if (-not (Test-Path -LiteralPath $recordPath)) { return $null }
  foreach ($line in (Get-Content -LiteralPath $recordPath)) {
    if ($line -like 'BLUENOTE_BUILT_CLIENT_DIR=*') { return $line.Substring('BLUENOTE_BUILT_CLIENT_DIR='.Length) }
  }
  return $null
}
function Get-GlobalPackageInventory {
  $json = (& npm list -g --depth=0 --json 2>$null)
  if ([string]::IsNullOrWhiteSpace($json)) { return @{} }
  $lastJsonObject = [regex]::Match($json.Trim(), '(\{(?:.|\r|\n)*\})\s*$', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($lastJsonObject.Success) {
    $json = $lastJsonObject.Groups[1].Value
  }
  try { return ($json | ConvertFrom-Json).dependencies } catch { return @{} }
}
function Compare-SemVer([string]$Left, [string]$Right) {
  $leftMatch = [regex]::Match($Left, '^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$')
  $rightMatch = [regex]::Match($Right, '^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$')
  if (-not $leftMatch.Success -or -not $rightMatch.Success) { return $null }
  for ($i = 1; $i -le 3; $i += 1) {
    $leftPart = [int]$leftMatch.Groups[$i].Value
    $rightPart = [int]$rightMatch.Groups[$i].Value
    if ($leftPart -lt $rightPart) { return -1 }
    if ($leftPart -gt $rightPart) { return 1 }
  }
  return 0
}
function Test-GitHubPackagesAuth {
  if ($env:NODE_AUTH_TOKEN -or $env:GH_TOKEN) { return $true }
  $token = (& npm config get '//npm.pkg.github.com/:_authToken' 2>$null)
  return -not [string]::IsNullOrWhiteSpace($token) -and $token -notin @('undefined','null')
}
function Test-WritableDirectory([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path) -or -not ((Get-Item -LiteralPath $Path).PSIsContainer)) {
    return $false
  }
  $probe = Join-Path $Path ('.bluenote-write-test-' + [guid]::NewGuid().ToString('N'))
  try {
    Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    return $true
  } catch {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    return $false
  }
}
function Test-WritableDirectoryOrParent([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  $probeDir = $Path
  while (-not (Test-Path -LiteralPath $probeDir)) {
    $parent = Split-Path -Path $probeDir -Parent
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $probeDir) { break }
    $probeDir = $parent
  }
  return Test-WritableDirectory $probeDir
}
function Test-NpmRegistryReachable([string]$RegistryUrl) {
  if ($env:BLUENOTE_TEST_NPM_PING_STATUS) { return $env:BLUENOTE_TEST_NPM_PING_STATUS -eq '0' }
  if ([string]::IsNullOrWhiteSpace($RegistryUrl)) {
    & npm ping *> $null
  } else {
    & npm ping --registry $RegistryUrl *> $null
  }
  return $LASTEXITCODE -eq 0
}
function Add-PackageConflicts($inventory, [string]$RequestedVersion) {
  $oldNames = @('bluenote')
  $scopedNames = @('@lordierclaw/bluenote')
  if ($WithWeb) {
    $oldNames += 'bluenote-webui'
    $scopedNames += '@lordierclaw/bluenote-webui'
  }
  if ($WithTui) {
    $oldNames += 'bluenote-term'
    $scopedNames += '@lordierclaw/bluenote-term'
  }
  foreach ($oldName in $oldNames) {
    $dep = $inventory.$oldName
    if ($dep -and $dep.version) {
      Write-Host "    old/unscoped package installed: $oldName@$($dep.version)"
      $script:conflicts += "old package $oldName@$($dep.version)"
    }
  }
  foreach ($scopedName in $scopedNames) {
    $dep = $inventory.$scopedName
    if ($dep -and $dep.version -and $RequestedVersion) {
      $comparison = Compare-SemVer $dep.version $RequestedVersion
      if ($comparison -eq -1) {
        Write-Host "    older scoped package installed: $scopedName@$($dep.version) < requested $RequestedVersion"
        $script:conflicts += "older scoped package $scopedName@$($dep.version) < $RequestedVersion"
      } elseif ($comparison -eq 1) {
        Write-Host "    newer installed version than requested: $scopedName@$($dep.version) > requested $RequestedVersion"
        $script:conflicts += "newer installed version $scopedName@$($dep.version) > $RequestedVersion"
      }
    }
  }
}
function Add-PartialInstallConflicts {
  $recordPath = Join-Path (Get-ConfigDir) 'client-mode.env'
  $recordedBuiltClientDir = Get-RecordedBuiltClientDir
  $builtDirForCheck = if ($recordedBuiltClientDir) { $recordedBuiltClientDir } else { $builtClientDir }
  $builtExec = Join-Path $builtDirForCheck 'bluenote-term.exe'
  if ((Test-Path -LiteralPath $recordPath) -and -not (Test-Path -LiteralPath $builtExec)) {
    Write-Host '    partial previous install detected: client-mode record exists without built client executable'
    $script:conflicts += 'partial previous install missing built client executable for recorded mode'
  }
  if ((Test-Path -LiteralPath $builtExec) -and -not (Test-Path -LiteralPath $recordPath)) {
    Write-Host '    partial previous install detected: built client executable exists without client-mode record'
    $script:conflicts += 'partial previous install missing client-mode record for built client executable'
  }
}

trap [System.Management.Automation.PSSecurityException] {
  Write-Error 'PowerShell ExecutionPolicy blocked this installer. Use a trusted shell or Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass after reviewing the script.'
  break
}

try {
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
  $requestedVersion = Get-RequestedReleaseVersion
  $inventory = Get-GlobalPackageInventory
  Add-PackageConflicts $inventory $requestedVersion
  Write-Host '  mixed install detection: CLI from npm plus TUI from built artifact'
  Write-Host '  stale daemon process and daemon metadata detection before upgrade'
  Write-Host '  partial previous install detection for missing CLI/client/artifact pieces and repair flow'
  Add-PartialInstallConflicts
  Write-Host '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files'
  if ($WithTui -and (Test-Path -LiteralPath $builtClientDir)) {
    $unknownEntries = Get-ChildItem -LiteralPath $builtClientDir -Force | Where-Object { $_.Name -notin @('.bluenote-managed','client-mode.env','bluenote-term.exe','bluenote-term') }
    if ($unknownEntries) { Write-Host "    unknown files in built artifact install directory: $($unknownEntries.FullName -join ', ')"; $script:conflicts += "unknown files in built artifact install directory $builtClientDir" }
  }
  Write-Host '  npm global prefix writable/permission preflight'
  $npmPrefix = (& npm prefix -g 2>$null)
  if (-not (Test-WritableDirectory $npmPrefix)) {
    $prefixDisplay = if ([string]::IsNullOrWhiteSpace($npmPrefix)) { '<empty>' } else { $npmPrefix }
    Write-Host "    npm global prefix not writable or missing: $prefixDisplay"
    $script:conflicts += "npm global prefix not writable $prefixDisplay"
  }
  if ($WithTui) {
    Write-Host '  built artifact and config destination writable/permission preflight'
    if (-not (Test-WritableDirectoryOrParent $builtClientDir)) {
      Write-Host "    built client directory not writable: $builtClientDir"
      $script:conflicts += "built client directory not writable $builtClientDir"
    }
    $configDirPath = Get-ConfigDir
    if (-not (Test-WritableDirectoryOrParent $configDirPath)) {
      Write-Host "    client-mode config directory not writable: $configDirPath"
      $script:conflicts += "client-mode config directory not writable $configDirPath"
    }
  }
  Write-Host '  registry/auth preflight for npm registry unavailable/auth failure'
  if ($Registry -eq 'github') {
    Write-Host '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup'
    if (-not (Test-GitHubPackagesAuth)) {
      Write-Host '    GitHub Packages auth missing: set NODE_AUTH_TOKEN or GH_TOKEN (or npm.pkg.github.com token in npm config) before install'
      $script:conflicts += 'GitHub Packages auth missing'
    }
    if (-not (Test-NpmRegistryReachable 'https://npm.pkg.github.com')) {
      Write-Host '    GitHub Packages registry unreachable or auth failed before install'
      $script:conflicts += 'GitHub Packages registry unreachable or auth failed'
    }
  }
  else {
    Write-Host '  npmjs registry selected; on auth/network failure retry or choose -Registry github with GitHub Packages token setup'
    if (-not (Test-NpmRegistryReachable 'https://registry.npmjs.org')) {
      Write-Host '    npmjs registry unreachable before install'
      $script:conflicts += 'npmjs registry unreachable'
    }
  }
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
        's' { $WithWeb = $false; $WithTui = $false; $ClientMode = 'auto'; Write-Host 'Skipping optional clients after explicit interactive choice.' }
        'S' { $WithWeb = $false; $WithTui = $false; $ClientMode = 'auto'; Write-Host 'Skipping optional clients after explicit interactive choice.' }
        default { throw 'Aborting install due to detected conflicts.' }
      }
    }
  }
  if ($WithTui -and -not (Test-BuiltTuiPlatform)) { throw 'unsupported OS/architecture/platform; cannot install built terminal artifact for an explicit -WithTui request.' }
  if ($ClientMode -eq 'built' -and -not $WithTui) { throw '-ClientMode built requires -WithTui so the installer can place a real built terminal artifact.' }

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
  if ($WithTui) {
    $builtDir = $builtClientDir
    Write-Host "  write client-mode record: BLUENOTE_CLIENT_MODE=built and BLUENOTE_BUILT_CLIENT_DIR=$builtDir for built-binary mode"
    Write-Host "  managed built client executable: $(Join-Path $builtDir 'bluenote-term.exe')"
  }
  Write-Host '  preserve user notes/config/data; Never delete user notes/config/data during install'
  Write-Host '  run after install: bluenote doctor'
  Write-Host '  on failure: best-effort rollback current-run artifacts and print Recovery command'

  function Write-ClientModeRecord {
    $builtDir = $builtClientDir
    $configHome = if ($env:BLUENOTE_CONFIG_HOME) { $env:BLUENOTE_CONFIG_HOME } elseif ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME 'AppData\Roaming' }
    $configDir = Join-Path $configHome 'bluenote'
    Invoke-CommandLine @('powershell','-NoProfile','-Command',"New-Item -ItemType Directory -Force -Path '$builtDir','$configDir' | Out-Null")
    $shimPath = Join-Path $builtDir 'bluenote-term.exe'
    $recordPath = Join-Path $configDir 'client-mode.env'
    if (-not $DryRun) {
      if (-not $env:BLUENOTE_TERM_ARTIFACT_PATH -or -not (Test-Path -LiteralPath $env:BLUENOTE_TERM_ARTIFACT_PATH)) { throw '-WithTui requires BLUENOTE_TERM_ARTIFACT_PATH pointing to a Bun-free built terminal executable; no Bun-source fallback will be used.' }
      Save-ExistingFileForRollback $shimPath
      Save-ExistingFileForRollback $recordPath
      Copy-Item -LiteralPath $env:BLUENOTE_TERM_ARTIFACT_PATH -Destination $shimPath -Force
      Set-Content -LiteralPath $recordPath -Value "BLUENOTE_CLIENT_MODE=built`nBLUENOTE_BUILT_CLIENT_DIR=$builtDir" -Encoding ASCII
    }
    Write-Host "managed built client executable: $shimPath"
    Write-Host "client-mode record: $recordPath"
  }

  if ($DryRun) { Write-Host 'Dry-run complete; no state mutated.'; exit 0 }
  if ($Registry -eq 'github') {
    $previousRegistryValue = (& npm config get $scopeRegistryKey 2>$null)
    if (-not [string]::IsNullOrWhiteSpace($previousRegistryValue) -and $previousRegistryValue -notin @('undefined','null')) {
      $previousScopeRegistry = $previousRegistryValue
      $scopeRegistryWasSet = $true
    }
    $registryConfigTouched = $true
    Invoke-CommandLine @('npm','config','set',$scopeRegistryKey,'https://npm.pkg.github.com')
  }
  Invoke-CommandLine @('npm','install','-g',"@lordierclaw/bluenote@$Tag")
  $installedPackages += '@lordierclaw/bluenote'
  if ($WithWeb) {
    Invoke-CommandLine @('npm','install','-g',"@lordierclaw/bluenote-webui@$Tag")
    $installedPackages += '@lordierclaw/bluenote-webui'
  }
  if ($WithTui) { Write-ClientModeRecord }
  Invoke-CommandLine @('bluenote','doctor')
  Write-Host 'BlueNote install complete.'
} catch {
  [Console]::Error.WriteLine($_)
  [Console]::Error.WriteLine("Install failed. Recovery command: $(Write-RecoveryCommand)")
  Invoke-RollbackCurrentRun
  exit 1
}
