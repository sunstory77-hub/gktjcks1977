# 홍보공장 서버 종료
$pidFile = Join-Path $env:LOCALAPPDATA 'PromoFactory\server.pid'
if (Test-Path $pidFile) {
  $id = [int](Get-Content $pidFile)
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $id -Force }
  Remove-Item $pidFile
}
Write-Host '  홍보공장을 종료했습니다.'
Start-Sleep -Seconds 2
