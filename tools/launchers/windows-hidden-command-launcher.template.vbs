Option Explicit

' Copy this file to an ignored local path and set CommandPath to the local
' .cmd/.ps1 launcher. Point the desktop shortcut to:
'   C:\Windows\System32\wscript.exe "path\to\this-file.vbs"
' WScript runs the launcher without creating a visible console window.

Dim shell, commandPath, workingDirectory, arguments, i

Set shell = CreateObject("WScript.Shell")

commandPath = "<path-to-local-launcher.cmd>"
workingDirectory = "<path-to-working-directory>"

arguments = ""
For i = 0 To WScript.Arguments.Count - 1
    arguments = arguments & " " & QuoteArgument(WScript.Arguments(i))
Next

If Len(workingDirectory) > 0 Then
    shell.CurrentDirectory = workingDirectory
End If

shell.Run QuoteArgument(commandPath) & arguments, 0, False

Function QuoteArgument(value)
    QuoteArgument = """" & Replace(CStr(value), """", """""") & """"
End Function
