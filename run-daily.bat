@echo off
REM Daily runner for the Client Response Time Tracker.
REM Called by Windows Task Scheduler. Logs each run to run.log.

cd /d "C:\Users\andre\OneDrive\Escritorio\second-brain\02 Projects\Client Response Time Tracker"

echo ============================================================ >> run.log
echo Run started: %DATE% %TIME% >> run.log

node run.js >> run.log 2>&1

echo Run finished: %DATE% %TIME% (exit %ERRORLEVEL%) >> run.log
