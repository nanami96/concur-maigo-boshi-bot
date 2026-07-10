@echo off
setlocal
cd /d "%~dp0"

echo Start React app
echo Open the URL shown below in your browser.
where npm >nul 2>nul
if errorlevel 1 (
  call node node_modules\vite\bin\vite.js %VITE_ARGS%
) else (
  call npm run dev -- %VITE_ARGS%
)
if errorlevel 1 goto error

goto end

:error
set EXIT_CODE=1
echo.
echo Failed. Please check the message above.

:end
if not defined NO_PAUSE pause
if defined EXIT_CODE exit /b %EXIT_CODE%
exit /b 0
