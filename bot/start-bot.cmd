@echo off
rem FurrBox Discord-Bot: startet den Bot und startet ihn nach einem Absturz neu.
rem Exponentielles Backoff (15s -> max 300s); nach erfolgreichem Connect (bot.ready) wieder 15s.
rem Wird beim Windows-Anmelden unsichtbar ueber start-bot-hidden.vbs gestartet.
cd /d "%~dp0"
set DELAY=15
set MAXDELAY=300

:loop
if exist bot.ready del bot.ready >nul 2>&1
echo [%date% %time%] Bot startet (Backoff bei Fehler: %DELAY%s) >> bot.log
node --env-file=.env index.mjs >> bot.log 2>&1
set EXITCODE=%errorlevel%

if exist bot.ready (
  rem Bot war verbunden - Backoff zuruecksetzen
  set DELAY=15
  del bot.ready >nul 2>&1
)

echo [%date% %time%] Bot beendet (Code %EXITCODE%), Neustart in %DELAY% Sekunden >> bot.log
set /a PINGS=%DELAY%+1
ping -n %PINGS% 127.0.0.1 > nul

set /a DELAY=%DELAY%*2
if %DELAY% GTR %MAXDELAY% set DELAY=%MAXDELAY%
goto loop
