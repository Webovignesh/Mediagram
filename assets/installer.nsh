; Enforces in-place updates: preserves user's chosen installation folder (e.g. D:\Mediagram)
; and prevents creating a duplicate installation on C: partition.
!macro customInit
  ReadRegStr $0 HKCU "Software\com.mediagram.app" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend

; Records install location for future updates and purges any temporary updater folder
!macro customInstall
  WriteRegStr HKCU "Software\com.mediagram.app" "InstallLocation" "$INSTDIR"
  RMDir /r "$LOCALAPPDATA\mediagram-updater"
!macroend

; Removes the Start with Windows entry that app.setLoginItemSettings wrote (value name = the AppUserModelId).
; isUpdated is set when a newer installer runs this uninstaller, so an upgrade keeps the setting.
; Both identities are cleared: a build from before the rename wrote com.teleflow.app, current builds
; write com.mediagram.app (electron/main.ts setAppUserModelId), and leaving either behind plants a
; Run entry that points at an exe the uninstaller just deleted.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.mediagram.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.mediagram.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.teleflow.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.teleflow.app"
    DeleteRegKey HKCU "Software\com.mediagram.app"
    RMDir /r "$LOCALAPPDATA\mediagram-updater"
  ${endIf}
!macroend

