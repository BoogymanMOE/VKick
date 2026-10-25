param(
[Parameter(Mandatory=$true)][string]$file,
[Parameter(Mandatory=$false)][string[]]$patterns = @()
)

$ErrorActionPreference = 'Stop'
$full = [System.IO.File]::ReadAllText($file)

Write-Output "FILE_BYTES=$([string]::new([char[]]$full).Length)"

$items = @()
if ($patterns.Length) { $items += $patterns }
else {
    $items += 'import { Card, EmptyState, ErrorState'
    $items += 'const LEAGUE_CHIP_OFF = '
    $items += 'const pad = (n: number) => String(n).padStart(2, "0");'
    $items += 'const STATUS_RANK'
    $items += 'const dayMatches = useMemo'
    $items += 'const myTeamsMatches = useMemo'
    $items += 'const otherMatches = useMemo'
    $items += 'const nextMatchDay = useMemo'
    $items += 'const syncHealth = useSyncHealth'
    $items += 'const hasFeedError = matchesQuery.isError'
    $items += 'const scoreRef = useRef'
    $items += 'const seeded = useRef(false)'
    $items += 'useEffect(() => {'
    $items += 'function refresh() {'
    $items += 'const pull = usePullToRefresh'
    $items += 'return ('
    $items += '<ConfettiBurst trigger={burst} />'
    $items += '<TopBar'
    $items += '<Card className="pitch-watermark'
    $items += '<BallIcon className="mx-auto h-8 w-8 text-voltage" />'
    $items += '<Link to="/onboarding"'
    $items += 't("myTeams.empty")'
    $items += 't("myTeams.hint")'
    $items += 't("matches.pickBanner")'
    $items += 't("matches.pickBannerCta")'
    $items += 'pickBannerDismiss'
    $items += 'role="region"'
    $items += 'useLocalState'
}

foreach ($p in $items) {
    $pos = $full.IndexOf($p)
    if ($pos -lt 0) {
        Write-Output "POS($([string]::new([char[]]$p).Length))=NOT_FOUND"
    } else {
        $snippet = ""
        if ($pos + 70 -le $full.Length) {
            $snippet = $full.Substring($pos, 70)
        } else {
            $snippet = $full.Substring($pos)
        }
        Write-Output "POS($([string]::new([char[]]$p).Length))=$pos :: $snippet"
    }
}
