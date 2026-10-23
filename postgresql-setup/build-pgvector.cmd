@echo off
call "D:\BuildTools\2022\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
set "PGROOT=D:\PostgreSQL\17"
cd /d D:\test2\postgresql-setup\pgvector
nmake /NOLOGO /F Makefile.win
if errorlevel 1 exit /b 1
nmake /NOLOGO /F Makefile.win install
exit /b %errorlevel%
