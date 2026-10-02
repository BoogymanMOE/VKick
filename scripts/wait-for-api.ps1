<#
  Waits for the API to answer, in ONE process, trying every loopback form.

  Why several hosts: `server.listen(port)` binds the unspecified address, which
  on Windows is `::` and can end up IPv6-only depending on the host stack. A
  probe pinned to 127.0.0.1 then sees "connection refused" against a server
  that is up and healthy, and the launcher blames a dead API. So try IPv4, then
  IPv6, then the hostname, and stop at the first that answers.

  Spawning a PowerShell process per attempt is what made the old check look
  frozen; this polls internally and prints a dot per pass.

    scripts\wait-for-api.ps1                 # 30s budget, default settings
    scripts\wait-for-api.ps1 -Timeout 10     # shorter budget
#>
param(
  [int]$TimeoutSeconds = 30,
  [string[]]$Urls = @(
    "http://127.0.0.1:8787/api/matches?limit=1",
    "http://[::1]:8787/api/matches?limit=1",
    "http://localhost:8787/api/matches?limit=1"
  )
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$pass = 0

while ((Get-Date) -lt $deadline) {
  $pass++
  foreach ($url in $Urls) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "  up on pass $pass via $url (HTTP $($response.StatusCode))"
        exit 0
      }
    } catch {
      # Refused or timed out on this host form: try the next one.
    }
  }
  Write-Host -NoNewline "."
  Start-Sleep -Milliseconds 400
}

Write-Host ""
Write-Host "  no answer after $pass pass(es) over $TimeoutSeconds seconds"
Write-Host "  tried: $($Urls -join ', ')"
exit 1
