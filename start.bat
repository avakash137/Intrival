@echo off
echo ============================================
echo   Intrival — Starting Server
echo ============================================
echo.

cd /d "%USERPROFILE%\Desktop"

if not exist .env (
    echo [ERROR] .env file not found!
    echo Open .env.example, copy it to .env, and add your Anthropic API key.
    pause
    exit /b 1
)

echo [INFO] Starting Intrival server...
echo [INFO] Open http://localhost:3000 in your browser.
echo.
node server.js
pause
