; DETAIL PAGE AI 설치 프로그램 (사용자별 설치 — 관리자 권한 불필요). by BAPI
Target amd64-unicode
Unicode true
SetCompressor /SOLID lzma
!include MUI2.nsh
!include LogicLib.nsh

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef VERSION4
  !define VERSION4 "1.0.0.0"
!endif
!define APPNAME "DETAIL PAGE AI"
!define PUBLISHER "BAPI"
!define LAUNCHER "DETAIL PAGE AI.exe"
!define REGKEY "Software\${APPNAME}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME} ${VERSION}"
BrandingText "${APPNAME} by ${PUBLISHER}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "${REGKEY}" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=1042 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1042 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1042 "FileDescription" "${APPNAME} 설치 프로그램"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "© ${PUBLISHER}"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) ${PUBLISHER}"

!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} 설치"
!define MUI_WELCOMEPAGE_TEXT "AI 상품 상세페이지 제작 프로그램 ${APPNAME} ${VERSION} (by ${PUBLISHER})을 설치합니다.$\r$\n$\r$\n• 관리자 권한이 필요하지 않습니다.$\r$\n• 작업 자료는 설치 폴더 밖에 저장되어 업데이트해도 보존됩니다.$\r$\n• Node.js 등 개발 도구를 따로 설치할 필요가 없습니다."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${LAUNCHER}"
!define MUI_FINISHPAGE_RUN_TEXT "지금 ${APPNAME} 실행"
!define MUI_FINISHPAGE_TITLE "설치가 끝났습니다"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license-ko.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

; 실행 중인 이전 버전을 먼저 종료한다(파일 교체 잠금 방지). 사용자 자료는 건드리지 않는다.
Function StopRunning
  ReadRegStr $R0 HKCU "${REGKEY}" "InstallDir"
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\runtime\node.exe"
    nsExec::Exec '"$R0\runtime\node.exe" "$R0\app\src\server.js" --quit'
    Pop $R1
    Sleep 1500
  ${EndIf}
FunctionEnd

Section "프로그램 설치" SecMain
  SectionIn RO
  Call StopRunning
  SetOverwrite on
  ; 앱 파일은 항상 새로 교체(이전 버전 잔여 파일 제거). 작업 자료는 $LOCALAPPDATA\${APPNAME} 에 따로 있어 영향 없음.
  ; 선택한 폴더에 우리 앱이 있을 때만 교체(엉뚱한 폴더의 app 을 지우지 않도록 표식 파일 확인)
  ${If} ${FileExists} "$INSTDIR\app\src\server.js"
    RMDir /r "$INSTDIR\app"
  ${EndIf}
  SetOutPath "$INSTDIR\runtime"
  File "stage\runtime\node.exe"
  File "stage\runtime\LICENSE-node.txt"
  !include "files.nsh"
  SetOutPath "$INSTDIR"
  File "stage\${LAUNCHER}"
  File "stage\사용설명서.html"
  File "stage\LICENSES.md"
  File "stage\app.ico"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\사용 설명서.lnk" "$INSTDIR\사용설명서.html"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME} 종료.lnk" "$INSTDIR\${LAUNCHER}" "--quit" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\제거.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; 실행 중이면 종료
  ${If} ${FileExists} "$INSTDIR\runtime\node.exe"
    nsExec::Exec '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\src\server.js" --quit'
    Pop $R1
    Sleep 1500
  ${EndIf}
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  ; 설치 폴더 전체가 아니라 우리가 설치한 항목만 지운다.
  ${If} ${FileExists} "$INSTDIR\app\src\server.js"
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\runtime"
  ${EndIf}
  Delete "$INSTDIR\${LAUNCHER}"
  Delete "$INSTDIR\사용설명서.html"
  Delete "$INSTDIR\LICENSES.md"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "${REGKEY}"
  ; 사용자 자료는 묻고 지운다(기본값: 보존, 무인 제거 시 항상 보존).
  IfFileExists "$LOCALAPPDATA\${APPNAME}\projects\*.*" 0 done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "작업 자료(프로젝트·이미지)도 함께 삭제할까요?$\r$\n$\r$\n위치: $LOCALAPPDATA\${APPNAME}$\r$\n$\r$\n[아니요]를 선택하면 자료가 보존되어 나중에 다시 설치해도 이어서 쓸 수 있습니다." /SD IDNO IDNO done
    RMDir /r "$LOCALAPPDATA\${APPNAME}"
  done:
SectionEnd
