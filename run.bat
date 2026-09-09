@echo off
REM SpeakUp - one-click local start (Windows)
REM Starts a static server on port 8080 and opens the app in your browser.

title SpeakUp - local server
cd /d "%~dp0"

set PORT=8080
set URL=http://localhost:%PORT%

REM --- find a server -------------------------------------------------------
set RUNNER=
where py >nul 2>&1 && set RUNNER=py -3 -m http.server %PORT%
if not defined RUNNER (
  where python >nul 2>&1 && set RUNNER=python -m http.server %PORT%
)
if not defined RUNNER (
  where npx >nul 2>&1 && set RUNNER=npx --yes http-server -p %PORT% -c-1
)

if not defined RUNNER (
  echo.
  echo   Could not find Python or Node on this computer.
  echo   Install Python from https://www.python.org/downloads/
  echo   ^(tick "Add python.exe to PATH" during setup^), then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   SpeakUp is starting on %URL%
echo   Keep this window open while you use the app.
echo   Press Ctrl+C, then Y, to stop the server.
echo.

REM --- open the browser shortly after the server boots ----------------------
start "" cmd /c "timeout /t 2 /nobreak >nul & start %URL%"

REM --- run the server in this window ----------------------------------------
%RUNNER%

echo.
echo   Server stopped.
pause
