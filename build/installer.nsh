; Aether NSIS installer customization (included by electron-builder).
; Standard wizard experience: welcome → license → directory → shortcuts →
; progress → finish-with-launch (electron-builder provides these; this file
; adds the data-directory and uninstall-data hooks).
;
; Program files vs user data are STRICTLY separate (spec Section 4.1):
;   - install dir: chosen in the wizard (default %LOCALAPPDATA%\Programs\Aether)
;   - data dir:    %APPDATA%\Aether — created here if missing, never modified
;                  by updates, and only removed on uninstall AFTER asking.

!macro customInit
  ; Ensure the data directory exists before first launch so restricted
  ; accounts never hit a missing-dir edge; the backend also mkdirs on boot.
  CreateDirectory "$APPDATA\Aether"
!macroend

!macro customUnInstall
  ; Ask before touching user data — never delete silently (spec Section 1.5).
  ; deleteAppDataOnUninstall is false in electron-builder.json; this prompt is
  ; the only path that removes %APPDATA%\Aether.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Also delete your Aether data?$\r$\n$\r$\n(Settings, task history, memory, checkpoints in:$\r$\n$APPDATA\Aether)$\r$\n$\r$\nChoose No to keep your data for a future reinstall." \
    IDYES delete_aether_data
  Goto done_data
  delete_aether_data:
    RMDir /r "$APPDATA\Aether"
  done_data:
!macroend
