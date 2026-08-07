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
set "NEWS_EXIT_CODE=!ERRORLEVEL!"
set "RESULT_FILE="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$f=Get-ChildItem -LiteralPath '%LOG_DIR%' -Filter 'six-university-*.json' ^| Sort-Object LastWriteTime -Descending ^| Select-Object -First 1 -ExpandProperty FullName; if($f){$f}"') do set "RESULT_FILE=%%I"
if defined RESULT_FILE (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0show-six-university-news-notification.ps1" -ResultFile "!RESULT_FILE!" >> "%LOG_FILE%" 2>&1
) else (
  echo Notification skipped: copy the example notification script to the local file first. >> "%LOG_FILE%"
)
set "EXIT_CODE=!NEWS_EXIT_CODE!"
echo ==== finished: %DATE% %TIME% / exit code: !EXIT_CODE! ==== >> "%LOG_FILE%"
exit /b !EXIT_CODE!
