' Startet start-bot.cmd ohne sichtbares Konsolenfenster.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & dir & "\start-bot.cmd""", 0, False
