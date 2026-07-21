Set oWS = WScript.CreateObject("WScript.Shell")

Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

Dim desktopPath
desktopPath = oWS.SpecialFolders("Desktop")

Dim shortcutPath
shortcutPath = desktopPath & "\VigilanteVanguard.lnk"

Dim oLink
Set oLink = oWS.CreateShortcut(shortcutPath)

oLink.TargetPath       = scriptDir & "launch.bat"
oLink.WorkingDirectory = scriptDir
oLink.Description      = "VigilanteVanguard 4 — Karnataka State Police Datathon"
oLink.WindowStyle      = 1
oLink.IconLocation     = "%SystemRoot%\System32\imageres.dll, 73"

oLink.Save

Set oLink = Nothing
Set oWS = Nothing

WScript.Echo "Desktop shortcut created!" & vbCrLf & "Double-click 'VigilanteVanguard' on your desktop to launch."
