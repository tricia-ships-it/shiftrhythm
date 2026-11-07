@echo off
REM Starts ShiftRhythm on this computer only (127.0.0.1 is not reachable from other devices).
cd /d "%~dp0"
set PORT=8642
echo ShiftRhythm is running at http://127.0.0.1:%PORT%/
echo Keep this window open while you use it. Close it to stop.
start "" "http://127.0.0.1:%PORT%/"
where py >nul 2>nul && (py serve.py %PORT%) || (python serve.py %PORT%)
pause
