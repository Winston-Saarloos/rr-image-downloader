@echo off
echo Starting RecNet Photo Downloader in development mode...
echo.

echo Checking code quality...
call npm run lint

echo.
echo Starting React development server...
start "React Dev Server" cmd /k "npm run dev:react"

echo Waiting for React server to start...
timeout /t 15

echo Starting Electron...
start "Electron App" cmd /k "npm run dev:electron"

echo.
echo Both processes started!
echo - React dev server should be running on http://localhost:3000
echo - Electron app should open automatically
echo.
echo Press any key to close this window...
pause > nul
