; Removes the Start with Windows entry that app.setLoginItemSettings wrote (value name = the AppUserModelId).
; isUpdated is set when a newer installer runs this uninstaller, so an upgrade keeps the setting.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.teleflow.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.teleflow.app"
  ${endIf}
!macroend
