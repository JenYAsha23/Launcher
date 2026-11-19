@echo off
setlocal
cd /d "%~dp0"
title MC Launcher
echo === MC Launcher ===
if not exist package.json goto nozip
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist node_modules goto install
goto run

:nozip
echo package.json not found.
echo You are probably running this file from inside the ZIP.
echo Right click the zip - Extract All - then run start.bat from the extracted folder.
pause
exit /b 1

:nonode
echo Node.js not found.
echo Install the LTS version from https://nodejs.org , restart the PC, then run this file again.
pause
exit /b 1

:install
echo First run: installing dependencies, wait 2-5 minutes...
call npm install
if errorlevel 1 goto fail
goto run

:run
call npm start
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo ERROR. Copy all text above and send it to Claude.
pause
exit /b 1
