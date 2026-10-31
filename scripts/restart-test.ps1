$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$listener=Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if($listener){$serverPid=$listener.OwningProcess;$process=Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid";if($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'server.mjs'){throw 'Port is occupied by a different application.'};& taskkill /PID $serverPid /T /F | Out-Null}
$env:PORT='4318';$env:APP_ORIGIN='http://127.0.0.1:4318'
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @('--env-file=.env.qa','server.mjs') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectPath 'tmp\enterprise-server.log') -RedirectStandardError (Join-Path $projectPath 'tmp\enterprise-error.log')
for($attempt=0;$attempt -lt 50;$attempt++){try{$response=Invoke-WebRequest -Uri 'http://127.0.0.1:4318/login' -UseBasicParsing -TimeoutSec 2;if($response.StatusCode -eq 200){Write-Output 'Test server ready';exit 0}}catch{};Start-Sleep -Milliseconds 200}
throw 'Test server did not become ready; inspect tmp/enterprise-error.log.'
