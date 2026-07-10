@echo off
setlocal
cd /d "%~dp0"

echo 1/4 Update sample-company Excel validation file
where npm >nul 2>nul
if errorlevel 1 (
  call node scripts\update-excel-template.js sample-company
) else (
  call npm run update:excel sample-company
)
if errorlevel 1 goto error

echo.
echo 2/4 Generate sample-company config.json
where npm >nul 2>nul
if errorlevel 1 (
  call node scripts\generate-config.js sample-company
) else (
  call npm run generate:config sample-company
)
if errorlevel 1 goto error

echo.
echo 3/4 Export sample-company HTML report
where npm >nul 2>nul
if errorlevel 1 (
  call node scripts\export-report.js sample-company
) else (
  call npm run export:report sample-company
)
if errorlevel 1 goto error

echo.
echo 4/4 Start React app
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
