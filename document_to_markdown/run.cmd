@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set "CONVERTER_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %CONVERTER_EXIT%
