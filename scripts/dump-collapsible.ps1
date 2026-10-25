$ErrorActionPreference = 'Stop'
$repo = 'D:\football'
Set-Location $repo

$rules = Select-String -Path src\components\ui.tsx -Pattern 'export function CollapsibleSection' -Encoding UTF8
if ($rules.Count -eq 0) { Write-Output 'NOT_FOUND_IN_UI_TSX'; exit 0 }

$lineNo = $rules[0].LineNumber
$fileText = [System.IO.File]::ReadAllText('src\components\ui.tsx', [System.Text.Encoding]::UTF8)

$needle = 'export function CollapsibleSection'
$idx = $fileText.IndexOf($needle)
if ($idx -lt 0) { throw 'internal: needle not found after Select-String matched it' }

$end = [Math]::Min($fileText.Length, $idx + 2800)
$start = $idx
if ($end - $start -le 0) { return }
Write-Output $fileText.Substring($start, $end - $start)
