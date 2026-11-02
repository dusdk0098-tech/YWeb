# Y웹 Windows 시작 스크립트 (start.cmd가 실행). 처음이면 패키지 설치·.env 생성·첫 계정까지 하고, 매번 화면을 빌드한 뒤 서버를 켭니다.
# 외부 접속(도메인)은 앱의 "외부 접속 설정"에서 켭니다: docs/SELF_HOSTING.md
# Native commands report failure only through $LASTEXITCODE; "Stop" would also turn their stderr warnings into errors in PowerShell 5.1.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Fail([string]$message) {
  Write-Host $message -ForegroundColor Red
  Read-Host '엔터를 누르면 창을 닫습니다' | Out-Null
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js 24가 필요합니다. https://nodejs.org 에서 24.x LTS를 설치하거나 PowerShell에서: winget install OpenJS.NodeJS.LTS'
}
$nodeMajor = node --no-warnings -p "process.versions.node.split('.')[0]"
if ($nodeMajor -ne '24') { Fail "Node.js 24.x가 필요합니다(현재 $(node --version))." }

if (-not (Test-Path node_modules)) {
  Write-Host '[1/4] 필요한 패키지를 설치합니다. 처음 한 번은 몇 분 걸립니다...'
  npm ci
  if ($LASTEXITCODE -ne 0) { Fail '패키지 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행하세요.' }
}

if (-not (Test-Path .env)) {
  Write-Host '[2/4] 이 PC 전용 설정 파일(.env)을 만듭니다...'
  node --no-warnings -e "const fs=require('fs');fs.writeFileSync('.env',fs.readFileSync('.env.example','utf8').replace(/^SESSION_SECRET=.*$/m,'SESSION_SECRET='+require('crypto').randomBytes(48).toString('hex')),{mode:0o600})"
  if ($LASTEXITCODE -ne 0) { Fail '.env 파일을 만들지 못했습니다.' }
}

Write-Host '[3/4] 화면을 준비합니다...'
npm run build *> $null
if ($LASTEXITCODE -ne 0) { Fail '화면 빌드에 실패했습니다. 이 폴더에서 "npm run build"를 직접 실행해 오류를 확인하세요.' }

# First run: no account yet, so create the first one. The password is read hidden and passed by stdin, never on the command line.
$users = node --no-warnings -e "process.loadEnvFile('.env');const p=process.env.DB_PATH||'./data/pedit.sqlite';if(!require('fs').existsSync(p)){console.log(0)}else{const d=new (require('node:sqlite').DatabaseSync)(p);try{console.log(d.prepare('SELECT count(*) n FROM users').get().n)}catch{console.log(0)}finally{d.close()}}"
if ($users -eq '0') {
  Write-Host ''
  Write-Host '처음 실행입니다. 로그인할 첫 계정을 만듭니다.'
  $email = Read-Host '이메일(예: me@example.com)'
  $name = Read-Host '이름'
  while ($true) {
    $plain = [Net.NetworkCredential]::new('', (Read-Host '비밀번호(12~128자, 화면에 안 보임)' -AsSecureString)).Password
    $again = [Net.NetworkCredential]::new('', (Read-Host '비밀번호 확인' -AsSecureString)).Password
    if ($plain -ne $again) { Write-Host '두 비밀번호가 다릅니다.' -ForegroundColor Yellow; continue }
    if ($plain.Length -lt 12 -or $plain.Length -gt 128) { Write-Host '12~128자로 입력하세요.' -ForegroundColor Yellow; continue }
    break
  }
  $OutputEncoding = New-Object Text.UTF8Encoding $false
  $plain | npm run --silent provision -- $email $name
  $code = $LASTEXITCODE
  Remove-Variable plain, again
  if ($code -ne 0) { Fail '계정을 만들지 못했습니다. 이메일 형식을 확인하고 다시 실행하세요.' }
  Write-Host '계정을 만들었습니다. 로그인한 뒤 "현장 관리"에서 첫 현장을 만드세요.'
}

$port = node --no-warnings -e "process.loadEnvFile('.env');console.log(process.env.PORT||3000)"
Write-Host "[4/4] 서버를 시작합니다. 이 창을 닫으면 서버도 꺼집니다. 이 PC 주소: http://127.0.0.1:$port"
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:$port'"
# Exit code 75 = the app asked to be started again (외부 접속 설정의 "다시 시작해 적용"); the app shows that button only under this launcher.
$env:YWEB_LAUNCHER = '1'
do {
  npm start
  $code = $LASTEXITCODE
  if ($code -eq 75) { Write-Host '새 설정을 적용하려고 서버를 다시 시작합니다...' }
} while ($code -eq 75)
if ($code -ne 0) { Fail '서버가 오류로 종료되었습니다. 위 메시지를 확인하세요.' }
