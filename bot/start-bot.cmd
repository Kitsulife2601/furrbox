@echo off
rem FurrBox Discord-Bot: startet den Bot und startet ihn nach einem Absturz neu.
rem Wird beim Windows-Anmelden unsichtbar über start-bot-hidden.vbs gestartet.
cd /d "%~dp0"
:loop
echo [%date% %time%] Bot startet >> bot.log
node --env-file=.env index.mjs >> bot.log 2>&1
echo [%date% %time%] Bot beendet (Code %errorlevel%), Neustart in 30 Sekunden >> bot.log
ping -n 31 127.0.0.1 > nul
goto loop
