$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$setup = 'D:\test2\postgresql-setup'
$root = 'D:\PostgreSQL\17'
$status = Join-Path $setup 'status.txt'
function Status([string]$message) { ('{0:u} {1}' -f (Get-Date), $message) | Add-Content $status }
function CheckExit([string]$name) { if ($LASTEXITCODE -ne 0) { throw "$name failed: $LASTEXITCODE" } }
try {
    if (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) { throw 'Administrator rights required' }
    Status 'Installing PostgreSQL 17.11 to D:\PostgreSQL\17'
    if (Test-Path "$root\data\PG_VERSION") { throw 'Existing database detected; refusing to overwrite' }
    New-Item -ItemType Directory -Path 'D:\PostgreSQL' -Force | Out-Null
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $password = 'Pg17!' + [Convert]::ToBase64String($bytes)
    $credentials = 'D:\PostgreSQL\connection-info.txt'
    New-Item -ItemType File -Path $credentials -Force | Out-Null
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sidText in @('S-1-5-18','S-1-5-32-544')) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
    }
    $userSid = (New-Object Security.Principal.NTAccount('lenovo')).Translate([Security.Principal.SecurityIdentifier])
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($userSid,'Read','Allow')))
    Set-Acl -LiteralPath $credentials -AclObject $acl
    @("Host=127.0.0.1",'Port=5432','Database=knowledge_base','Username=postgres',"Password=$password","InstallDirectory=$root",'Service=postgresql-x64-17') | Set-Content -LiteralPath $credentials -Encoding UTF8
    $options = Join-Path $setup 'postgresql-options.conf'
    New-Item -ItemType File -Path $options -Force | Out-Null
    Set-Acl -LiteralPath $options -AclObject $acl
    @('mode=unattended','unattendedmodeui=none',"prefix=$root","datadir=$root\data",'serverport=5432','servicename=postgresql-x64-17','superaccount=postgres',"superpassword=$password",'enable-components=server,commandlinetools','disable-components=pgAdmin,stackbuilder','locale=C') | Set-Content $options -Encoding ASCII
    $p = Start-Process -FilePath "$setup\postgresql-17.11-5-windows-x64.exe" -ArgumentList "--optionfile `"$options`"" -WindowStyle Hidden -PassThru -Wait
    Remove-Item -LiteralPath $options
    if ($p.ExitCode -ne 0) { throw "PostgreSQL installer failed: $($p.ExitCode)" }
    if (-not (Test-Path "$root\data\PG_VERSION")) { throw 'PostgreSQL cluster initialization failed' }
    Status 'PostgreSQL installed; installing Microsoft C++ Build Tools on D drive'
    $p = Start-Process -FilePath "$setup\vs_BuildTools.exe" -ArgumentList '--quiet --wait --norestart --nocache --installPath D:\BuildTools\2022 --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --addProductLang en-US' -WindowStyle Hidden -PassThru -Wait
    if ($p.ExitCode -notin @(0,3010)) { throw "Build Tools installer failed: $($p.ExitCode)" }
    Status 'Compiling official pgvector v0.8.7'
    $build = @'
@echo off
call "D:\BuildTools\2022\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
set "PGROOT=D:\PostgreSQL\17"
cd /d D:\test2\postgresql-setup\pgvector
nmake /NOLOGO /F Makefile.win
if errorlevel 1 exit /b 1
nmake /NOLOGO /F Makefile.win install
exit /b %errorlevel%
'@
    $build | Set-Content "$setup\build-pgvector.cmd" -Encoding ASCII
    $p = Start-Process -FilePath cmd.exe -ArgumentList "/d /c $setup\build-pgvector.cmd" -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput "$setup\build-pgvector.log" -RedirectStandardError "$setup\build-pgvector-errors.log"
    if ($p.ExitCode -ne 0) { throw "pgvector compilation failed: $($p.ExitCode)" }
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
