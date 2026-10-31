$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$pgBin='C:\Program Files\PostgreSQL\18\bin'
$dataPath=Join-Path $projectPath '.local-postgres'
if(Test-Path -LiteralPath $dataPath){
 & "$pgBin\pg_ctl.exe" status -D $dataPath *> $null
 if($LASTEXITCODE -ne 0){$launcher=Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @('start','-D',$dataPath,'-l',(Join-Path $dataPath 'server.log'),'-w') -WindowStyle Hidden -PassThru;$launcher.WaitForExit();if($launcher.ExitCode -ne 0){throw 'PostgreSQL could not start.'}}
}
$existing=Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
if($existing){
 try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4317/healthz' -TimeoutSec 5;$login=Invoke-WebRequest -Uri 'http://127.0.0.1:4317/login' -UseBasicParsing -TimeoutSec 5;if($health.status -eq 'ok' -and $login.Content -match 'PDF Extractor HDM'){Write-Output 'PDF Extractor HDM is already running. Open http://127.0.0.1:4317';exit 0}}catch{}
 throw 'Port 4317 is already occupied or the portal is unhealthy. Check the existing process before starting another copy.'
}
Write-Output 'Open http://127.0.0.1:4317. Initial local credentials: .local-credentials.txt'
node server.mjs
