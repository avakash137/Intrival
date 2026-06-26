@echo off
echo ============================================
echo   Intrival — Setup
echo ============================================
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please download it from https://nodejs.org and run this again.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node --version
echo.

:: Navigate to the Desktop (where package.json lives)
cd /d "%USERPROFILE%\Desktop"

:: Install dependencies
echo [INFO] Installing dependencies...
npm install

if %errorlevel% neq 0 (
    echo [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo [OK] Setup complete!
echo.
echo Next: double-click start.bat to launch Intrival.
echo.
pause
