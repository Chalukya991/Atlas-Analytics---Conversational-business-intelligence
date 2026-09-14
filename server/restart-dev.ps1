$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force } catch {}
}
Start-Sleep -Seconds 1
Set-Location $PSScriptRoot
Start-Process node -ArgumentList "src/index.js" -WindowStyle Hidden -RedirectStandardOutput "api.log" -RedirectStandardError "api-err.log"
Start-Process node -ArgumentList "src/workers/worker.js" -WindowStyle Hidden -RedirectStandardOutput "worker.log" -RedirectStandardError "worker-err.log"
Start-Sleep -Seconds 5
try {
  $h = Invoke-RestMethod -Uri "http://localhost:4000/health" -TimeoutSec 5
  Write-Host "API health: $($h.status)"
} catch {
  Write-Host "API health check failed: $_"
}