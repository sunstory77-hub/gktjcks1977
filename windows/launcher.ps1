# 홍보공장 PC 실행기 (Windows 10/11)
# 처음 실행: Node.js(설치 없이 이 폴더에) 내려받기 → 부품 설치 → 서버 시작 → 전용 창 열기
# 두 번째부터: 서버 시작 → 전용 창 열기 (이미 켜져 있으면 창만 열기)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root 'runtime'
$Home2 = Join-Path $env:LOCALAPPDATA 'PromoFactory'
$Data = Join-Path $Home2 'data'
$Port = 5180
$Url = "http://127.0.0.1:$Port"
New-Item -ItemType Directory -Force -Path $Runtime, $Data | Out-Null

function Test-Server {
  try { return (Invoke-WebRequest -UseBasicParsing "$Url/healthz" -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

# 주소창 없는 전용 창: Edge(모든 Windows 10/11에 있음) → Chrome → 기본 브라우저
function Find-Browser {
  $cands = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Open-App {
  $b = Find-Browser
  if ($b) { Start-Process -FilePath $b -ArgumentList "--app=$Url", '--window-size=1400,900' }
  else { Start-Process $Url }
}

if (Test-Server) { Open-App; exit 0 }

Write-Host ''
Write-Host '  홍보공장을 준비하고 있습니다. 이 창은 닫지 마세요.' -ForegroundColor Yellow
Write-Host ''

# 1) Node.js 22 (설치 없이 runtime 폴더에 풀어 둠, 해시 확인)
$node = Get-ChildItem -Path $Runtime -Directory -Filter 'node-v22*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
  Write-Host '  [1/3] Node.js 내려받는 중 (처음 한 번, 약 30MB)...'
  $base = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
  $line = ($sums -split "`n") | Where-Object { $_ -match 'node-v[\d.]+-win-x64\.zip\s*$' } | Select-Object -First 1
  if (-not $line) { throw 'Node.js 파일 목록을 읽지 못했습니다.' }
  $hash, $file = $line.Trim() -split '\s+'
  $zip = Join-Path $Runtime $file
  Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $hash.ToLower()) { Remove-Item $zip; throw 'Node.js 파일 확인(해시)에 실패했습니다. 다시 실행해 주세요.' }
  Expand-Archive -Path $zip -DestinationPath $Runtime -Force
  Remove-Item $zip
  $node = Get-ChildItem -Path $Runtime -Directory -Filter 'node-v22*-win-x64' | Select-Object -First 1
}
$env:Path = "$($node.FullName);$env:Path"

# 2) 부품 설치 (처음 한 번, 몇 분)
foreach ($d in @('poc', 'app')) {
  $dir = Join-Path $Root $d
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "  [2/3] 부품 설치 중 ($d, 처음 한 번 몇 분 걸립니다)..."
    Push-Location $dir
    & (Join-Path $node.FullName 'npm.cmd') install --omit=dev --no-audit --no-fund
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Remove-Item -Recurse -Force (Join-Path $dir 'node_modules') -ErrorAction SilentlyContinue; throw "부품 설치에 실패했습니다 ($d). 인터넷 연결을 확인하고 다시 실행해 주세요." }
  }
}

# 3) 서버 시작 (창 없이 뒤에서) → 준비되면 전용 창
Write-Host '  [3/3] 홍보공장 시작 중...'
$env:PROMO_LOCAL = '1'
$env:DATA_DIR = $Data
$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$b = Find-Browser
if ($b) { $env:HYPERFRAMES_BROWSER_PATH = $b }  # 릴스 렌더에 PC의 Edge/Chrome 사용
$log = Join-Path $Home2 'server.log'
$err = Join-Path $Home2 'server-error.log'
$p = Start-Process -FilePath (Join-Path $node.FullName 'node.exe') `
  -ArgumentList '--disable-warning=ExperimentalWarning', 'src\server.js' `
  -WorkingDirectory (Join-Path $Root 'app') -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
Set-Content -Path (Join-Path $Home2 'server.pid') -Value $p.Id

for ($i = 0; $i -lt 60; $i++) {
  if (Test-Server) { break }
  if ($p.HasExited) { break }
  Start-Sleep -Seconds 1
}
if (-not (Test-Server)) {
  Write-Host ''
  Write-Host '  시작하지 못했습니다. 아래 기록을 캡처해 보내 주세요.' -ForegroundColor Red
  Get-Content $err -Tail 20 -ErrorAction SilentlyContinue
  Read-Host '  Enter를 누르면 닫힙니다'
  exit 1
}

# 바탕화면 바로가기 (처음 한 번)
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '홍보공장.lnk'
if (-not (Test-Path $lnk)) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $Root '홍보공장_실행.bat'
  $s.WorkingDirectory = $Root
  $s.WindowStyle = 7
  $s.Save()
}

Open-App
