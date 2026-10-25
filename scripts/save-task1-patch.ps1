[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repo = 'D:\football'
Set-Location $repo

$diff = git diff src/pages/Matches.tsx
if ($LASTEXITCODE -ne 0) {
    throw "git diff exited with $LASTEXITCODE"
}

if (-not (Test-Path '.tmp')) {
    New-Item -ItemType Directory -Path '.tmp' | Out-Null
}

$file = Join-Path '.tmp' 'task1-partial.patch'
[System.IO.File]::WriteAllText($file, $diff, [System.Text.UTF8Encoding]::new($true))

Write-Output "PATCH_BYTES=$([System.IO.File]::ReadAllText($file).Length)"
