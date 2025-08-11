@echo off
echo Starting Ruvo Player API Server...
echo.
echo Make sure you have Node.js installed and dependencies installed.
echo Run 'npm install' in the api folder if you haven't already.
echo.
cd /d "%~dp0"
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Failed to install dependencies!
    pause
    exit /b 1
)
echo.
echo Starting server...
call npm run dev
if %errorlevel% neq 0 (
    echo Failed to start server!
    pause
    exit /b 1
)
pause
