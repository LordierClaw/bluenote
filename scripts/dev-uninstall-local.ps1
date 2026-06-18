param(
  [switch]$Web,
  [switch]$Tui,
  [switch]$All,
  [switch]$SkipCheck,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ($All) {
  $Web = $true
  $Tui = $true
}
if (-not $Web -and -not $Tui) {
  $Web = $true
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BlueNoteDir = Resolve-Path (Join-Path $ScriptDir '..')
$WorkspaceDir = Resolve-Path (Join-Path $BlueNoteDir '..')
$WebUiDir = Join-Path $WorkspaceDir 'bluenote-webui'
$TermPkgDir = Join-Path $WorkspaceDir 'bluenote-term/packages/term'
$TermRepoDir = Join-Path $WorkspaceDir 'bluenote-term'

function Write-Step([string]$Message) {
  Write-Output $Message
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string[]]$Command,
    [string]$WorkingDirectory,
    [switch]$AllowFailure
  )
  if ($DryRun) {
    $suffix = if ($AllowFailure) { ' || true' } else { '' }
    $prefix = if ($WorkingDirectory) { "+ cd $WorkingDirectory && " } else { '+ ' }
    Write-Output ($prefix + ($Command -join ' ') + $suffix)
    return
  }
  try {
    if ($WorkingDirectory) {
      Push-Location $WorkingDirectory
      try { & $Command[0] @($Command | Select-Object -Skip 1) } finally { Pop-Location }
    } else {
      & $Command[0] @($Command | Select-Object -Skip 1)
    }
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
      throw "Command failed with exit code ${LASTEXITCODE}: $($Command -join ' ')"
    }
  } catch {
    if (-not $AllowFailure) { throw }
  }
}

function Require-Command([string]$CommandName) {
  if ($DryRun) {
    Write-Output "+ Get-Command $CommandName"
    return
  }
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $CommandName"
  }
}

function Require-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Missing sibling checkout: $Path"
  }
}

Write-Step 'BlueNote local developer uninstall/unlink'
Write-Step "bluenote: $BlueNoteDir"
Write-Step "webui:    $WebUiDir"
if ($Tui) { Write-Step "term:     $TermPkgDir" }

Require-Command node
Require-Command npm
if ($Tui) { Require-Command bun }

Require-Directory $BlueNoteDir
if ($Web) { Require-Directory $WebUiDir }
if ($Tui) { Require-Directory $TermPkgDir }

if (-not $SkipCheck) {
  Invoke-Step -WorkingDirectory $BlueNoteDir -Command @('npm', 'run', 'check')
  if ($Web) { Invoke-Step -WorkingDirectory $WebUiDir -Command @('npm', 'run', 'check') }
  if ($Tui) { Invoke-Step -WorkingDirectory $TermRepoDir -Command @('bun', 'run', 'check') }
} else {
  Write-Step 'Skipping repo checks (-SkipCheck).'
}

Invoke-Step -Command @('bluenote', 'daemon', 'stop') -AllowFailure
Invoke-Step -Command @('npm', 'unlink', '-g', '@lordierclaw/bluenote')
if ($Web) { Invoke-Step -Command @('npm', 'unlink', '-g', '@lordierclaw/bluenote-webui') }
if ($Tui) { Invoke-Step -WorkingDirectory $TermPkgDir -Command @('bun', 'unlink') }

if (-not $SkipCheck) {
  if ($DryRun -or (Get-Command bluenote -ErrorAction SilentlyContinue)) {
    Invoke-Step -Command @('bluenote', 'doctor')
  } else {
    Write-Step 'bluenote is not on PATH after unlink; skipping doctor.'
  }
} else {
  Write-Step 'Skipping doctor (-SkipCheck).'
}
