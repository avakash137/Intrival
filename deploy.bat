@echo off
cd /d "%USERPROFILE%\Desktop"
git add .
git commit -m "fix: switch quote endpoint from Yahoo Finance to Twelve Data API"
git push origin main
echo.
echo Done! Render will auto-redeploy in ~2 minutes.
echo Check: https://intrival.onrender.com
echo.
pause
