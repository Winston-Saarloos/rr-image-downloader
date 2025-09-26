@echo off
echo Building RecNet Photo Downloader for Windows...
echo.

echo Installing dependencies...
call npm install

echo.
echo Linting code...
call npm run lint

echo.
echo Building React app...
call npm run build:react

echo.
echo Building Windows executable...
call npm run build:win

echo.
echo Build complete! Check the 'dist' folder for the executable.
pause
