; FurrBox installer texts (German). Included by electron-builder via nsis.include.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Willkommen bei FurrBox"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert FurrBox – deinen Team-Desktop mit Discord-Anmeldung, FurrFS, Chat und Moderation.$\r$\n$\r$\nFurrBox hält sich danach automatisch über GitHub aktuell.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "FurrBox ist bereit"
  !define MUI_FINISHPAGE_TEXT "FurrBox wurde erfolgreich installiert.$\r$\n$\r$\nBeim ersten Start trägst du einmal die Discord-Zugangsdaten ein, danach meldest du dich einfach mit Discord an."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "FurrBox jetzt starten"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
