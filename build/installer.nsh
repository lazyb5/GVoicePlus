; Extra uninstall steps (electron-builder picks this file up automatically).
;
; The app writes its own per-user Start Menu shortcut and the .ico files it points at (see src/utils/startMenuShortcut.js
; and refreshStartMenuShortcut in src/main.js), so the installer doesn't know about them.  Remove them on uninstall so no
; dead shortcut is left behind.  APPDATA is read from the environment so this does not change the installer's shell context.
!macro customUnInstall
  ReadEnvStr $0 APPDATA
  Delete "$0\Microsoft\Windows\Start Menu\Programs\GVoicePlus.lnk"
  Delete "$0\voice-desktop-app\taskbar-*.ico"
!macroend
