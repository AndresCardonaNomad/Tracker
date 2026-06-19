@echo off
REM Double-click this file to update the Client Response Time numbers in your scorecard.
REM It pulls the latest from Slack and writes to the "Response Time" tab.

cd /d "%~dp0"

echo ============================================================
echo   Updating Client Response Time...
echo   (pulling Slack, writing to your scorecard sheet)
echo ============================================================
echo.

node run.js

echo.
echo ============================================================
echo   Done. You can close this window.
echo ============================================================
pause
