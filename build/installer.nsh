; Hyper Do hides to the tray instead of quitting, and older versions may run from another install folder
; (per-user AppData vs Program Files). The default electron-builder check only looks for processes inside
; $INSTDIR, so a copy running from the other folder made the installer stop with "cannot be closed".
; This one force-closes every "Hyper Do.exe" (and its children, e.g. cloudflared) wherever it runs.
!macro customCheckAppRunning
  StrCpy $R1 0
  hyperdo_kill:
    IntOp $R1 $R1 + 1
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $0
    Sleep 1000
    nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $0
    ${if} $0 == 0
      ${if} $R1 < 3
        Goto hyperdo_kill
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY hyperdo_kill
      Quit
    ${endIf}
!macroend
