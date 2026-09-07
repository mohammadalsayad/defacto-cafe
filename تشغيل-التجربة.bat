@echo off
chcp 65001 >nul
title DeFacto Cafe - رابط تجربة
cd /d "%~dp0"

echo ============================================
echo   جاري تشغيل سيرفر DeFacto Cafe...
echo ============================================
start "DeFacto Server" cmd /c "node server.js"

timeout /t 3 >nul

echo.
echo ============================================
echo   جاري إنشاء الرابط العام (انتظر شوي)...
echo   الرابط رح يظهر تحت: https://xxxxx.trycloudflare.com
echo ============================================
echo.
echo   لا تسكّر هالنافذة طول ما بدك الرابط شغّال.
echo.

npx --yes cloudflared tunnel --url http://localhost:8090

pause
