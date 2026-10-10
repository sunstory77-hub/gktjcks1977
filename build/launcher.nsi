; DETAIL PAGE AI 실행기 — 콘솔 창 없이 로컬 서버를 시작하고 기본 브라우저를 연다. by BAPI
Target amd64-unicode
Unicode true
!include FileFunc.nsh
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef VERSION4
  !define VERSION4 "1.0.0.0"
!endif
Name "DETAIL PAGE AI"
OutFile "${OUTFILE}"
Icon "app.ico"
RequestExecutionLevel user
SilentInstall silent
ShowInstDetails nevershow
AutoCloseWindow true
VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=1042 "ProductName" "DETAIL PAGE AI"
VIAddVersionKey /LANG=1042 "CompanyName" "BAPI"
VIAddVersionKey /LANG=1042 "FileDescription" "DETAIL PAGE AI 실행기"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "© BAPI"
VIAddVersionKey "ProductName" "DETAIL PAGE AI"
VIAddVersionKey "CompanyName" "BAPI"
VIAddVersionKey "FileDescription" "DETAIL PAGE AI Launcher"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) BAPI"

Section
  ${GetParameters} $0
  IfFileExists "$EXEDIR\runtime\node.exe" +3 0
    MessageBox MB_OK|MB_ICONSTOP "프로그램 파일을 찾을 수 없습니다. DETAIL PAGE AI를 다시 설치해 주세요.$\r$\n$EXEDIR\runtime\node.exe"
    Quit
  SetOutPath "$EXEDIR"
  ; nsExec 는 콘솔 창을 만들지 않는다. 서버가 끝날 때까지 이 실행기도 함께 대기한다.
  nsExec::Exec '"$EXEDIR\runtime\node.exe" "$EXEDIR\app\src\server.js" $0'
  Pop $1
SectionEnd
