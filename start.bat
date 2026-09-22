@echo off
rem ---------------------------------------------------------------------------
rem MD Graph — launcher (Windows)
rem Uso:
rem   start.bat                       :: vault default (./vault), porta 8000
rem   start.bat "C:\caminho\vault"   :: VAULT_DIR = 1o argumento
rem   start.bat "C:\caminho\vault" 9000
rem ---------------------------------------------------------------------------
setlocal

if "%~1"=="" (
  set "VAULT_DIR=%~dp0vault"
) else (
  set "VAULT_DIR=%~1"
)
if not "%~2"=="" set "PORT=%~2"

echo [start] VAULT_DIR=%VAULT_DIR%
node "%~dp0server.js"
endlocal
