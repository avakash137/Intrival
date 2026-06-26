@echo off
cd /d "%USERPROFILE%\Desktop"
git add .
git commit -m "feat: real-time market data via Yahoo Finance (NSE + US)"
git push origin main
echo.
echo Done! Render will auto-redeploy in ~2 minutes.
echo Check: https://intrival.onrender.com
echo.
pause
