[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = 'D:\football'
Set-Location $repo

$headDiff = git diff HEAD -- src/pages/Matches.tsx
if ($LASTEXITCODE -ne 0) { throw "git diff HEAD failed with $LASTEXITCODE" }

if ($null -eq $headDiff) { $headDiff = [string]::Empty }
$headBytes = [System.Text.Encoding]::UTF8.GetBytes($headDiff)
Write-Output "HEAD_DIFF_BYTES=$($headBytes.Count)"

$patchFile = Join-Path '.tmp' 'task1-partial.patch'
if (-not (Test-Path $patchFile)) { throw "missing $patchFile" }
$preText = [System.IO.File]::ReadAllText($patchFile)
if ($null -eq $preText) { $preText = [string]::Empty }
$preBytes = [System.Text.Encoding]::UTF8.GetBytes($preText)
Write-Output "TASK1_PARTIAL_BYTES=$($preBytes.Count)"

$currentFile = 'src/pages/Matches.tsx'
$diskBytes = [System.IO.File]::ReadAllBytes($currentFile)
Write-Output "DISK_Matches_BYTES=$($diskBytes.Count)"

$base = git show :0:src/pages/Matches.tsx
if ($LASTEXITCODE -ne 0) { throw "git show failed with $LASTEXITCODE" }
$baseBytes = [System.Text.Encoding]::UTF8.GetBytes($base)
if ($null -eq $base) { $base = [string]::Empty }
$baseBytes = [System.Text.Encoding]::UTF8.GetBytes($base)
Write-Output "BASE_Matches_BYTES=$($baseBytes.Count)"
