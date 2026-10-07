@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Car Radar: publish changes to GitHub ===
set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update dashboard"
git add index.html assets config scripts issues data/manual .github README.md publish.bat
git diff --cached --quiet
if %errorlevel%==0 (
  echo No local changes to publish. Pulling latest from GitHub...
  git pull --rebase --autostash
) else (
  git commit -m "%MSG%"
  git pull --rebase --autostash
  git push
)
if %errorlevel%==0 (echo. & echo Done. The site will update in about 3-5 minutes.) else (echo. & echo Something went wrong - copy the messages above to Claude.)
pause
