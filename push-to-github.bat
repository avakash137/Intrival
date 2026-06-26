@echo off
echo ============================================
echo   Intrival — Push to GitHub
echo ============================================
echo.

cd /d "%USERPROFILE%\Desktop"

:: Check git installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed. Download from https://git-scm.com
    pause
    exit /b 1
)

:: Init repo if not already
if not exist .git (
    echo [INFO] Initialising git repo...
    git init
    git branch -M main
) else (
    echo [INFO] Git repo already exists.
)

:: Create .gitignore safety check
if not exist .gitignore (
    echo .env > .gitignore
    echo node_modules/ >> .gitignore
)

:: Stage and commit
echo.
echo [INFO] Staging all files...
git add .
git status

echo.
set /p CONFIRM=Commit and push these files? (y/n):
if /i "%CONFIRM%" neq "y" (
    echo Aborted.
    pause
    exit /b 0
)

:: Commit
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo [INFO] Nothing new to commit.
) else (
    git commit -m "Initial Intrival commit — secure Node proxy + frontend"
    echo [OK] Committed.
)

:: Set remote
echo.
echo Go to https://github.com/new and create a NEW EMPTY repo called: intrival
echo (Do NOT tick "Add a README" — keep it empty)
echo.
set /p REPO_URL=Paste your GitHub repo URL here (e.g. https://github.com/yourname/intrival.git):

if "%REPO_URL%"=="" (
    echo [ERROR] No URL entered.
    pause
    exit /b 1
)

:: Remove old remote if exists
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo.
echo [INFO] Pushing to GitHub...
git push -u origin main

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Push failed. A browser window may have opened to authenticate.
    echo Complete the GitHub login, then double-click this script again.
) else (
    echo.
    echo [SUCCESS] Intrival is on GitHub!
    echo.
    echo Next step: Deploy to Render at https://render.com
    echo  - New Web Service - Connect GitHub repo
    echo  - Build: npm install  /  Start: node server.js
    echo  - Add env var: ANTHROPIC_API_KEY
)

echo.
pause
