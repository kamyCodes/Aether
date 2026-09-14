# Detached dev-server launcher for the Aether preview.
# Pulls Postgres credentials from the user-level environment (registry) —
# required because Start-Process children inherit the *caller's* environment,
# which can predate a `setx`. Never prints secret values.
$uref = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'User')
$uuser = [Environment]::GetEnvironmentVariable('PGUSER', 'User')
$udb = [Environment]::GetEnvironmentVariable('PGDATABASE', 'User')
if ($uref) { $env:PGPASSWORD = $uref }
if ($uuser) { $env:PGUSER = $uuser }
if ($udb) { $env:PGDATABASE = $udb }

$log = 'C:\Users\Kamy\Hybrid\.freebuff\preview-f0625ea4-22c8-4264-85c0-27a160c22f2e.log'
$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' `
  -WorkingDirectory 'C:\Users\Kamy\Hybrid' `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" `
  -WindowStyle Hidden -PassThru
$p.Id
