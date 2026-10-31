$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$pgBin='C:\Program Files\PostgreSQL\18\bin'
$dataPath=Join-Path $projectPath '.local-postgres'
if(Test-Path -LiteralPath $dataPath){throw 'Project cluster already exists; use pg_ctl to start it. No data overwritten.'}
if(Test-Path -LiteralPath (Join-Path $projectPath '.env')){throw '.env exists; configure manually to preserve settings.'}
function New-Secret { $bytes=New-Object byte[] 32;$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()};return [BitConverter]::ToString($bytes).Replace('-','').ToLower() }
$dbSecret=New-Secret
$appSecret=New-Secret
$passwordFile=Join-Path $projectPath 'tmp\init-password'
Set-Content -LiteralPath $passwordFile -Value $dbSecret -NoNewline
try{
 & "$pgBin\initdb.exe" -D $dataPath -U clarity_owner --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C
 if($LASTEXITCODE -ne 0){throw 'initdb failed'}
 Add-Content -LiteralPath (Join-Path $dataPath 'postgresql.conf') -Value "`nlisten_addresses='127.0.0.1'`nport=55432`n"
 $launcher=Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @('start','-D',$dataPath,'-l',(Join-Path $dataPath 'server.log'),'-w') -WindowStyle Hidden -PassThru
 $launcher.WaitForExit()
 $env:PGPASSWORD=$dbSecret
 & "$pgBin\psql.exe" -h 127.0.0.1 -p 55432 -U clarity_owner -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE clarity_app LOGIN PASSWORD '$appSecret' NOSUPERUSER NOCREATEDB NOCREATEROLE;" -c 'CREATE DATABASE clarity_portal OWNER clarity_owner;'
 if($LASTEXITCODE -ne 0){throw 'Database creation failed'}
 @("DATABASE_URL=postgresql://clarity_app:$appSecret@127.0.0.1:55432/clarity_portal",'APP_ORIGIN=http://127.0.0.1:4317','PORT=4317','DOCUMENT_RETENTION_HOURS=2') | Set-Content -LiteralPath (Join-Path $projectPath '.env')
 @("MIGRATION_DATABASE_URL=postgresql://clarity_owner:$dbSecret@127.0.0.1:55432/clarity_portal",'DATABASE_RUNTIME_ROLE=clarity_app') | Set-Content -LiteralPath (Join-Path $projectPath '.env.migration')
 Write-Output 'Isolated PostgreSQL cluster ready. Credentials written only to local .env and .env.migration.'
}finally{Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue;Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue}
