$ErrorActionPreference = 'Stop'
$setup = 'D:\test2\postgresql-setup'
$root = 'D:\PostgreSQL\17'
$status = Join-Path $setup 'status.txt'
function Status([string]$message) { ('{0:u} {1}' -f (Get-Date), $message) | Add-Content $status }
function CheckExit([string]$name) { if ($LASTEXITCODE -ne 0) { throw "$name failed: $LASTEXITCODE" } }
try {
    $previous = Get-CimInstance Win32_Process -Filter 'ProcessId=10384'
    $children = Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq 10384
    $children | Select-Object Name,ProcessId,ParentProcessId | Out-File "$setup\waiting-processes.txt"
    if ($children | Where-Object { $_.Name -match 'cmd|nmake|cl.exe|link.exe' }) { throw 'Compiler process is still active' }
    if (-not (Test-Path "$root\lib\vector.dll")) { throw 'pgvector DLL missing' }
    if (-not (Test-Path "$root\share\extension\vector--0.8.7.sql")) { throw 'pgvector SQL missing' }
    if ($previous -and $previous.CommandLine -like '*postgresql-setup\install.ps1*') { Stop-Process -Id 10384 -Force }
    $info = Get-Content -LiteralPath 'D:\PostgreSQL\connection-info.txt'
    $password = ($info | Where-Object { $_.StartsWith('Password=') }).Substring(9)
    Status 'Configuring global PATH and database extensions'
    $machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
    $machinePath | Set-Content "$setup\machine-path-before.txt"
    if (($machinePath -split ';') -notcontains "$root\bin") {
        [Environment]::SetEnvironmentVariable('Path', "$root\bin;$machinePath", 'Machine')
    }
    $env:Path = "$root\bin;$env:Path"
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PgEnvNotify { [DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result); }'
    $notifyResult = [UIntPtr]::Zero
    [void][PgEnvNotify]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$notifyResult)
    Add-Content "$root\data\postgresql.conf" "`n# Local knowledge base service`nlisten_addresses = 'localhost'`npassword_encryption = 'scram-sha-256'"
    Set-Service postgresql-x64-17 -StartupType Automatic
    Restart-Service postgresql-x64-17
    $env:PGPASSWORD = $password
    & "$root\bin\psql.exe" -X -w -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'
    CheckExit 'Enable pgvector in postgres'
    & "$root\bin\psql.exe" -X -w -h 127.0.0.1 -U postgres -d template1 -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'
    CheckExit 'Enable pgvector in template1'
    & "$root\bin\createdb.exe" -w -h 127.0.0.1 -U postgres -E UTF8 knowledge_base
    CheckExit 'Create knowledge_base'
    & "$root\bin\psql.exe" -X -w -h 127.0.0.1 -U postgres -d knowledge_base -v ON_ERROR_STOP=1 -c "SELECT version(); SELECT extname, extversion FROM pg_extension WHERE extname='vector'; SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector AS l2_distance;" > "$setup\verification.txt" 2>&1
    CheckExit 'Database verification'
    Remove-Item Env:\PGPASSWORD
    Status 'SUCCESS: PostgreSQL, pgvector, automatic service, global PATH and knowledge_base ready'
} catch {
    Status "FAILED: $($_.Exception.Message)"
    $_ | Out-String | Add-Content "$setup\error.txt"
    exit 1
}
