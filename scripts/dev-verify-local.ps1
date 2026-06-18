param(
  [switch]$Web,
  [switch]$Tui,
  [switch]$All,
  [switch]$KeepTemp,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Verification contract: npm pack runs before npm install -g. The installed
# temp-prefix CLI then runs bluenote --help, bluenote version, bluenote doctor,
# and daemon lifecycle commands: bluenote daemon start, bluenote daemon status,
# bluenote daemon stop.

if ($All) {
  $Web = $true
  $Tui = $true
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bluenoteDir = Resolve-Path (Join-Path $scriptDir '..')
$workspaceDir = Resolve-Path (Join-Path $bluenoteDir '..')
$coreDir = Join-Path $workspaceDir 'bluenote-core'
$webuiDir = Join-Path $workspaceDir 'bluenote-webui'
$termPkgDir = Join-Path $workspaceDir 'bluenote-term\packages\term'

if ($DryRun) {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'bluenote-verify-local.dry-run'
} else {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("bluenote-verify-local.{0}" -f ([System.Guid]::NewGuid().ToString('N')))
}

$packDir = Join-Path $tempRoot 'packs'
$npmPrefix = Join-Path $tempRoot 'npm-prefix'
$npmCache = Join-Path $tempRoot 'npm-cache'
$npmUserConfig = Join-Path $tempRoot 'npmrc'
$configHome = Join-Path $tempRoot 'config'
$dataHome = Join-Path $tempRoot 'data'
$cacheHome = Join-Path $tempRoot 'cache'
$daemonStarted = $false

function Write-Step([string]$Message) {
  Write-Output $Message
}

function Format-Command([string[]]$Command) {
  return ($Command | ForEach-Object {
    if ($_ -match '[\s"'']') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
}

function Invoke-Native([string[]]$Command) {
  if ($DryRun) {
    Write-Output ("+ {0}" -f (Format-Command $Command))
    return
  }
  & $Command[0] @($Command | Select-Object -Skip 1)
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE: $(Format-Command $Command)"
  }
}

function Invoke-InDirectory([string]$Directory, [string[]]$Command) {
  if ($DryRun) {
    Write-Output ("+ cd {0} && {1}" -f $Directory, (Format-Command $Command))
    return
  }
  Push-Location $Directory
  try {
    Invoke-Native $Command
  } finally {
    Pop-Location
  }
}

function Invoke-Isolated([string[]]$Command) {
  if ($DryRun) {
    Write-Output ("+ NPM_CONFIG_PREFIX={0} NPM_CONFIG_CACHE={1} NPM_CONFIG_USERCONFIG={2} BLUENOTE_CONFIG_HOME={3} BLUENOTE_DATA_HOME={4} BLUENOTE_CACHE_HOME={5} PATH={6} {7}" -f $npmPrefix, $npmCache, $npmUserConfig, $configHome, $dataHome, $cacheHome, ("$npmPrefix\bin;$npmPrefix;$env:Path"), (Format-Command $Command))
    return
  }

  $oldPrefix = $env:NPM_CONFIG_PREFIX
  $oldNpmCache = $env:NPM_CONFIG_CACHE
  $oldUserConfig = $env:NPM_CONFIG_USERCONFIG
  $oldConfig = $env:BLUENOTE_CONFIG_HOME
  $oldData = $env:BLUENOTE_DATA_HOME
  $oldCache = $env:BLUENOTE_CACHE_HOME
  $oldPath = $env:Path
  try {
    $env:NPM_CONFIG_PREFIX = $npmPrefix
    $env:NPM_CONFIG_CACHE = $npmCache
    $env:NPM_CONFIG_USERCONFIG = $npmUserConfig
    $env:BLUENOTE_CONFIG_HOME = $configHome
    $env:BLUENOTE_DATA_HOME = $dataHome
    $env:BLUENOTE_CACHE_HOME = $cacheHome
    $env:Path = "$npmPrefix\bin;$npmPrefix;$env:Path"
    Invoke-Native $Command
  } finally {
    $env:NPM_CONFIG_PREFIX = $oldPrefix
    $env:NPM_CONFIG_CACHE = $oldNpmCache
    $env:NPM_CONFIG_USERCONFIG = $oldUserConfig
    $env:BLUENOTE_CONFIG_HOME = $oldConfig
    $env:BLUENOTE_DATA_HOME = $oldData
    $env:BLUENOTE_CACHE_HOME = $oldCache
    $env:Path = $oldPath
  }
}

function Require-Command([string]$Name) {
  if ($DryRun) {
    Write-Output "+ Get-Command $Name"
    return
  }
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Require-Directory([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "Missing checkout/package directory: $Directory"
  }
}

function New-PackageTarball([string]$Directory, [string]$Label) {
  if ($DryRun) {
    Invoke-InDirectory $Directory @('npm', 'pack', '--pack-destination', $packDir)
    return (Join-Path $packDir "$Label-local.tgz")
  }
  Push-Location $Directory
  try {
    $tarballName = (& npm pack --pack-destination $packDir | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0) {
      throw "npm pack failed in $Directory"
    }
    return (Join-Path $packDir $tarballName)
  } finally {
    Pop-Location
  }
}

function New-PackageTarballIgnoreScripts([string]$Directory, [string]$Label) {
  if ($DryRun) {
    Invoke-InDirectory $Directory @('npm', 'pack', '--ignore-scripts', '--pack-destination', $packDir)
    return (Join-Path $packDir "$Label-local.tgz")
  }
  Push-Location $Directory
  try {
    $tarballName = (& npm pack --ignore-scripts --pack-destination $packDir | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0) {
      throw "npm pack failed in $Directory"
    }
    return (Join-Path $packDir $tarballName)
  } finally {
    Pop-Location
  }
}

function Copy-PackageEntry([string]$SourceDir, [string]$StageDir, [string]$Entry) {
  $from = Join-Path $SourceDir $Entry
  if (-not (Test-Path -LiteralPath $from)) { return }
  $to = Join-Path $StageDir $Entry
  $parent = Split-Path -Parent $to
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
}

function New-StagedPackageWithLocalCore([string]$Directory, [string]$Label, [string]$CoreTarball) {
  $stageRoot = Join-Path $tempRoot 'stage'
  $stageDir = Join-Path $stageRoot $Label
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

  $packageJson = Get-Content -LiteralPath (Join-Path $Directory 'package.json') -Raw | ConvertFrom-Json
  foreach ($entry in @($packageJson.files)) {
    Copy-PackageEntry $Directory $stageDir $entry
  }
  foreach ($entry in @('README.md', 'LICENSE')) {
    Copy-PackageEntry $Directory $stageDir $entry
  }

  if ($packageJson.dependencies -and $packageJson.dependencies.PSObject.Properties.Name -contains '@lordierclaw/bluenote-core') {
    $packageJson.dependencies.'@lordierclaw/bluenote-core' = "file:$CoreTarball"
  }
  if ($packageJson.PSObject.Properties.Name -contains 'devDependencies') {
    $packageJson.PSObject.Properties.Remove('devDependencies')
  }
  if ($packageJson.scripts) {
    foreach ($scriptName in @('prepare', 'prepack', 'prepublishOnly')) {
      if ($packageJson.scripts.PSObject.Properties.Name -contains $scriptName) {
        $packageJson.scripts.PSObject.Properties.Remove($scriptName)
      }
    }
  }

  $packageJson | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stageDir 'package.json') -Encoding UTF8
  return (New-PackageTarballIgnoreScripts $stageDir $Label)
}

Write-Step 'BlueNote local packed-artifact verification'
Write-Step "bluenote: $bluenoteDir"
Write-Step "core:     $coreDir"
if ($Web) { Write-Step "webui:    $webuiDir" }
if ($Tui) { Write-Step "term:     $termPkgDir" }
Write-Step "temp:     $tempRoot"
Write-Step "npm prefix: $npmPrefix"
Write-Step "state:    $configHome | $dataHome | $cacheHome"

try {
  Require-Command 'node'
  Require-Command 'npm'
  Require-Directory $coreDir
  Require-Directory $bluenoteDir
  if ($Web) { Require-Directory $webuiDir }
  if ($Tui) { Require-Directory $termPkgDir }

  if ($DryRun) {
    Write-Output ("+ New-Item -ItemType Directory -Force {0} {1} {2} {3} {4} {5}" -f $packDir, $npmPrefix, $npmCache, $configHome, $dataHome, $cacheHome)
  } else {
    New-Item -ItemType Directory -Force -Path $packDir, $npmPrefix, $npmCache, $configHome, $dataHome, $cacheHome | Out-Null
    Set-Content -LiteralPath $npmUserConfig -Value "cache=$npmCache" -Encoding UTF8
  }

  Invoke-InDirectory $coreDir @('npm', 'run', 'build')
  Invoke-InDirectory $bluenoteDir @('npm', 'run', 'build')
  if ($Web) { Invoke-InDirectory $webuiDir @('npm', 'run', 'build') }

  if ($DryRun) {
    $coreTarball = New-PackageTarball $coreDir 'lordierclaw-bluenote-core'
    Write-Step "+ stage package manifests with @lordierclaw/bluenote-core=file:$coreTarball"
    $bluenoteTarball = New-PackageTarball $bluenoteDir 'lordierclaw-bluenote'
  } else {
    $coreTarball = New-PackageTarballIgnoreScripts $coreDir 'lordierclaw-bluenote-core'
    $bluenoteTarball = New-StagedPackageWithLocalCore $bluenoteDir 'bluenote' $coreTarball
  }
  $webuiTarball = $null
  $termTarball = $null
  if ($Web) {
    if ($DryRun) { $webuiTarball = New-PackageTarball $webuiDir 'lordierclaw-bluenote-webui' } else { $webuiTarball = New-StagedPackageWithLocalCore $webuiDir 'bluenote-webui' $coreTarball }
  }
  if ($Tui) {
    if ($DryRun) { $termTarball = New-PackageTarball $termPkgDir 'lordierclaw-bluenote-term' } else { $termTarball = New-StagedPackageWithLocalCore $termPkgDir 'bluenote-term' $coreTarball }
  }

  Invoke-Isolated @('npm', 'install', '-g', $bluenoteTarball)
  if ($Web) { Invoke-Isolated @('npm', 'install', '-g', $webuiTarball) }
  if ($Tui) { Invoke-Isolated @('npm', 'install', '-g', $termTarball) }

  Invoke-Isolated @('bluenote', '--help')
  Invoke-Isolated @('bluenote', 'version')
  Invoke-Isolated @('bluenote', 'doctor')
  Invoke-Isolated @('bluenote', 'daemon', 'start')
  $daemonStarted = $true
  Invoke-Isolated @('bluenote', 'daemon', 'status')
  Invoke-Isolated @('bluenote', 'doctor')
  Invoke-Isolated @('bluenote', 'daemon', 'stop')
  $daemonStarted = $false
  Invoke-Isolated @('bluenote', 'daemon', 'status')

  Write-Step 'BlueNote local packed-artifact verification complete.'
} finally {
  if ($daemonStarted -and -not $DryRun) {
    try {
      Invoke-Isolated @('bluenote', 'daemon', 'stop')
    } catch {
      Write-Step "Warning: failed to stop daemon during cleanup: $($_.Exception.Message)"
    }
    $daemonStarted = $false
  }
  if ($DryRun) {
    if ($KeepTemp) {
      Write-Step "+ keeping temp paths under $tempRoot (-KeepTemp)"
    } else {
      Write-Step "+ cleanup temp paths: Remove-Item -Recurse -Force $tempRoot"
    }
  } elseif ($KeepTemp) {
    Write-Step "Keeping temp paths under $tempRoot (-KeepTemp)."
  } else {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
