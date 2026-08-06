@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "LOG_DIR=%PROJECT_ROOT%\server\agent\logs\scheduled"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "RUN_ID=%%I"
set "LOG_FILE=%LOG_DIR%\six-university-%RUN_ID%.log"

echo ==== UNI PICK six-university news update started: %DATE% %TIME% ==== > "%LOG_FILE%"
cd /d "%PROJECT_ROOT%"
call npm run news:agent:six:deploy >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=!ERRORLEVEL!"
echo ==== finished: %DATE% %TIME% / exit code: !EXIT_CODE! ==== >> "%LOG_FILE%"
exit /b !EXIT_CODE!
