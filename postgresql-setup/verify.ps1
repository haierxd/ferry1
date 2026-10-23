$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Get-Command psql,pg_isready | Select-Object Name,Source
& psql --version
if ($LASTEXITCODE -ne 0) { throw 'psql is not available' }
& pg_isready -h 127.0.0.1 -p 5432
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is not ready' }
Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'" | Select-Object Name,State,StartMode,PathName
$info = Get-Content -LiteralPath 'D:\PostgreSQL\connection-info.txt'
$env:PGPASSWORD = ($info | Where-Object { $_.StartsWith('Password=') }).Substring(9)
try {
    & psql -X -w -h 127.0.0.1 -U postgres -d knowledge_base -v ON_ERROR_STOP=1 -f 'D:\test2\postgresql-setup\verify.sql'
    if ($LASTEXITCODE -ne 0) { throw 'Vector verification failed' }
    & psql -X -w -h 127.0.0.1 -U postgres -d template1 -v ON_ERROR_STOP=1 -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
    if ($LASTEXITCODE -ne 0) { throw 'Template extension verification failed' }
} finally { Remove-Item Env:\PGPASSWORD }
