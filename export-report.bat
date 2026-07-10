@echo off
setlocal
cd /d "%~dp0"

echo Export sample-company HTML report
where npm >nul 2>nul
if errorlevel 1 (
  call node scripts\export-report.js sample-company
) else (
  call npm run export:report sample-company
)
if errorlevel 1 goto error

echo.
echo Done.
goto end

:error
set EXIT_CODE=1
echo.
echo Failed. Please check the message above.

:end
if not defined NO_PAUSE pause
if defined EXIT_CODE exit /b %EXIT_CODE%
exit /b 0
