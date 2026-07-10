Attribute VB_Name = "ConcurBotOperations"
Option Explicit

Public Sub RunAllProcesses()
    Dim projectRoot As String
    Dim batchPath As String
    Dim command As String
    Dim shell As Object

    If Len(ThisWorkbook.Path) = 0 Then
        MsgBox MessageSaveFirst(), vbExclamation, AppTitle()
        Exit Sub
    End If

    ThisWorkbook.Save

    projectRoot = GetProjectRootFromWorkbookPath(ThisWorkbook.Path)
    batchPath = projectRoot & "\run-all.bat"

    If Dir(batchPath) = "" Then
        MsgBox MessageRunAllMissing() & vbCrLf & _
               MessageWorkbookPlacement() & vbCrLf & _
               MessageCheckPath() & batchPath, _
               vbCritical, AppTitle()
        Exit Sub
    End If

    command = "cmd.exe /c " & QuotePath(batchPath)
    Set shell = CreateObject("WScript.Shell")
    shell.Run command, 1, False

    MsgBox MessageStarted() & vbCrLf & _
           MessageStartedDetail(), _
           vbInformation, AppTitle()
End Sub

Public Sub OpenReport()
    Dim projectRoot As String
    Dim reportPath As String
    Dim shell As Object

    If Len(ThisWorkbook.Path) = 0 Then
        MsgBox MessageSaveFirst(), vbExclamation, AppTitle()
        Exit Sub
    End If

    projectRoot = GetProjectRootFromWorkbookPath(ThisWorkbook.Path)
    reportPath = projectRoot & "\reports\sample-company-review.html"

    If Dir(reportPath) = "" Then
        MsgBox MessageReportMissing() & vbCrLf & _
               MessageRunFirst() & vbCrLf & _
               MessageCheckPath() & reportPath, _
               vbExclamation, AppTitle()
        Exit Sub
    End If

    Set shell = CreateObject("WScript.Shell")
    shell.Run QuotePath(reportPath), 1, False
End Sub

Public Sub StartBot()
    Dim projectRoot As String
    Dim batchPath As String
    Dim shell As Object

    If Len(ThisWorkbook.Path) = 0 Then
        MsgBox MessageSaveFirst(), vbExclamation, AppTitle()
        Exit Sub
    End If

    projectRoot = GetProjectRootFromWorkbookPath(ThisWorkbook.Path)
    batchPath = projectRoot & "\start-bot.bat"

    If Dir(batchPath) = "" Then
        MsgBox MessageStartBotMissing() & vbCrLf & _
               MessageCheckPath() & batchPath, _
               vbCritical, AppTitle()
        Exit Sub
    End If

    Set shell = CreateObject("WScript.Shell")
    shell.Run "cmd.exe /c " & QuotePath(batchPath), 1, False
End Sub

Private Function GetProjectRootFromWorkbookPath(ByVal workbookFolder As String) As String
    Dim fileSystem As Object

    Set fileSystem = CreateObject("Scripting.FileSystemObject")
    GetProjectRootFromWorkbookPath = fileSystem.GetParentFolderName(workbookFolder)
End Function

Private Function QuotePath(ByVal pathValue As String) As String
    QuotePath = """" & Replace(pathValue, """", """""") & """"
End Function

Private Function AppTitle() As String
    AppTitle = J("43 6F 6E 63 75 72 8FF7 5B50 9632 6B62 42 6F 74")
End Function

Private Function MessageSaveFirst() As String
    MessageSaveFirst = J("5148 306B 45 78 63 65 6C 30D5 30A1 30A4 30EB 3092 4FDD 5B58 3057 3066 304F 3060 3055 3044 3002")
End Function

Private Function MessageRunAllMissing() As String
    MessageRunAllMissing = J("72 75 6E 2D 61 6C 6C 2E 62 61 74 20 304C 898B 3064 304B 308A 307E 305B 3093 3002")
End Function

Private Function MessageWorkbookPlacement() As String
    MessageWorkbookPlacement = J("45 78 63 65 6C 30D5 30A1 30A4 30EB 304C 20 70 72 6F 6A 65 63 74 2D 72 6F 6F 74 5C 65 78 63 65 6C 5C 73 61 6D 70 6C 65 2D 63 6F 6D 70 61 6E 79 2E 78 6C 73 6D 20 306E 914D 7F6E 306B 306A 3063 3066 3044 308B 304B 78BA 8A8D 3057 3066 304F 3060 3055 3044 3002")
End Function

Private Function MessageCheckPath() As String
    MessageCheckPath = J("78BA 8A8D 5148 3A 20")
End Function

Private Function MessageStarted() As String
    MessageStarted = J("8A2D 5B9A 53CD 6620 3092 958B 59CB 3057 307E 3057 305F 3002")
End Function

Private Function MessageStartedDetail() As String
    MessageStartedDetail = J("45 78 63 65 6C 66F4 65B0 3001 63 6F 6E 66 69 67 751F 6210 3001 48 54 4D 4C 30EC 30DD 30FC 30C8 751F 6210 3001 42 6F 74 8D77 52D5 3092 9806 756A 306B 5B9F 884C 3057 307E 3059 3002")
End Function

Private Function MessageReportMissing() As String
    MessageReportMissing = J("48 54 4D 4C 30EC 30DD 30FC 30C8 304C 898B 3064 304B 308A 307E 305B 3093 3002")
End Function

Private Function MessageRunFirst() As String
    MessageRunFirst = J("5148 306B 300C 8A2D 5B9A 3092 53CD 6620 3059 308B 300D 3092 5B9F 884C 3057 3066 304F 3060 3055 3044 3002")
End Function

Private Function MessageStartBotMissing() As String
    MessageStartBotMissing = J("73 74 61 72 74 2D 62 6F 74 2E 62 61 74 20 304C 898B 3064 304B 308A 307E 305B 3093 3002")
End Function

Private Function J(ByVal codePoints As String) As String
    Dim parts() As String
    Dim index As Long
    Dim result As String

    parts = Split(codePoints, " ")
    For index = LBound(parts) To UBound(parts)
        If Len(parts(index)) > 0 Then
            result = result & ChrW(CLng("&H" & parts(index)))
        End If
    Next index

    J = result
End Function
