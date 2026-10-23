param(
    [string]$InputPath = '',
    [string]$OutputPath = '',
    [ValidateSet('basic', 'docling')][string]$Engine = 'basic',
    [string]$PythonPath = '',
    [switch]$Force,
    [switch]$KeepPdfHeaders,
    [switch]$InstallOnly
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$envDir = Join-Path $PSScriptRoot '.venv'
$venvPython = Join-Path $envDir 'Scripts\python.exe'

try {
    if (-not (Test-Path -LiteralPath $venvPython)) {
        if (-not $PythonPath) {
            $command = Get-Command python -ErrorAction SilentlyContinue
            if ($command -and $command.Source -notlike '*WindowsApps*') {
                $PythonPath = $command.Source
            }
        }
        if (-not $PythonPath) {
            $launcher = Get-Command py -ErrorAction SilentlyContinue
            if ($launcher) {
                $ErrorActionPreference = 'Continue'
                $candidate = & $launcher.Source -3 -c 'import sys; print(sys.executable)' 2>$null
                $ErrorActionPreference = 'Stop'
                if ($LASTEXITCODE -eq 0 -and $candidate) { $PythonPath = "$candidate".Trim() }
            }
        }
        if (-not $PythonPath) {
            $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
            if (Test-Path -LiteralPath $bundled) { $PythonPath = $bundled }
        }
        if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath)) {
            throw 'Python not found. Run: .\run.ps1 -PythonPath C:\path\to\python.exe'
        }
        & $PythonPath -c 'import sys; sys.exit(sys.version_info < (3, 10))'
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required.' }
        & $PythonPath -m venv --system-site-packages $envDir
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create virtual environment.' }
    }
    & $venvPython (Join-Path $PSScriptRoot 'check_environment.py') --engine $Engine
    $needsInstall = $LASTEXITCODE -ne 0
    if ($needsInstall) {
        $requirements = if ($Engine -eq 'docling') { 'requirements-advanced.txt' } else { 'requirements.txt' }
        & $venvPython -m pip --disable-pip-version-check install -r (Join-Path $PSScriptRoot $requirements)
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check network access and retry.' }
        & $venvPython (Join-Path $PSScriptRoot 'check_environment.py') --engine $Engine
        if ($LASTEXITCODE -ne 0) { throw 'Installed dependencies could not be imported or have unsupported versions.' }
    }
    if ($InstallOnly) { Write-Host 'Environment ready.'; exit 0 }
    $arguments = @((Join-Path $PSScriptRoot 'convert.py'), '--engine', $Engine)
    if ($InputPath) { $arguments += @('--input', $InputPath) }
    if ($OutputPath) { $arguments += @('--output', $OutputPath) }
    if ($Force) { $arguments += '--force' }
    if ($KeepPdfHeaders) { $arguments += '--keep-pdf-headers' }
    & $venvPython @arguments
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 2
}
