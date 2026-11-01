; hwply NSIS installer hooks
;
; Tauri 기본 NSIS file association 처리는 .hwp/.hwpx의 기본 ProgId를 덮어쓴다. 이 hook은
; 설치·제거 전후로 사용자의 기존 기본값을 snapshot·복원해서 hwply이 Open With 후보로만
; 등록되도록 만든다. MSI는 기본값을 애초에 쓰지 않으므로 대응 hook이 없다.
;
; 계약과 가정
; - snapshot은 제품 전용 key에만 기록한다. 공유 key인 Software\Classes\.{ext}에는 hwply의
;   bookkeeping value를 남기지 않는다.
; - snapshot이 없으면 복원은 no-op이다. "기본값이 원래 없었음"과 "snapshot 자체가 없음"을
;   구분하지 못하면 사용자의 기존 기본 연결을 지우게 된다.
; - State는 snapshot의 마지막 commit marker다. 중단된 이전 작업의 committed snapshot이 있으면
;   다음 설치·제거가 덮어쓰지 않고 같은 원래 기본값을 복원한다.
; - 모든 macro는 사용하는 $R0/$R1을 Push/Pop으로 보존한다. hook 본문은 Tauri installer.nsi
;   안으로 삽입되며 주변 코드의 register 사용을 알 수 없다.
; - PRE hook의 SetRegView 64는 의도적으로 복원하지 않는다. PREINSTALL/PREUNINSTALL 뒤에 실행되는
;   Tauri file-association registry 작업까지 Registry64로 고정해야 snapshot과 실제 변경 view가 같다.
; - UPDATEFILEASSOC는 Tauri installer.nsi가 제공하는 내부 macro이며 installerHooks 공개
;   계약의 일부가 아니다. Tauri를 올릴 때 존재 여부를 확인한다.

!include "x64.nsh"

!define HWPLY_ASSOC_BACKUP_KEY "Software\hwply\FileAssocBackup"

!macro HWPLY_SNAPSHOT_EXTENSION_DEFAULT EXT OWNED_PROGID
  Push $R0
  Push $R1
  ClearErrors
  ReadRegDWORD $R1 SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "State"
  ${If} ${Errors}
    ClearErrors
    ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${If} ${Errors}
      DeleteRegValue SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "Default"
      WriteRegDWORD SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "State" 0
    ${ElseIf} "${OWNED_PROGID}" != ""
    ${AndIf} "$R0" == "${OWNED_PROGID}"
      DeleteRegValue SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "Default"
      WriteRegDWORD SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "State" 0
    ${Else}
      WriteRegStr SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "Default" "$R0"
      WriteRegDWORD SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "State" 1
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro HWPLY_RESTORE_EXTENSION_DEFAULT EXT
  Push $R0
  Push $R1
  ClearErrors
  ReadRegDWORD $R1 SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "State"
  ${IfNot} ${Errors}
    ${If} $R1 = 1
      ClearErrors
      ReadRegStr $R0 SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}" "Default"
      ${IfNot} ${Errors}
        ClearErrors
        WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "$R0"
        ${IfNot} ${Errors}
          DeleteRegKey SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}"
        ${EndIf}
      ${EndIf}
    ${ElseIf} $R1 = 0
      ClearErrors
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
      ClearErrors
      ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
      ${If} ${Errors}
        DeleteRegKey SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}\.${EXT}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro HWPLY_REGISTER_OPEN_WITH EXT PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
!macroend

!macro HWPLY_REMOVE_OPEN_WITH EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

!macro HWPLY_REMOVE_EMPTY_EXTENSION_KEYS EXT
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}"
!macroend

!macro HWPLY_REMOVE_EMPTY_BACKUP_KEYS
  DeleteRegKey /ifempty SHELL_CONTEXT "${HWPLY_ASSOC_BACKUP_KEY}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\hwply"
!macroend

!macro NSIS_HOOK_PREINSTALL
  SetRegView 64
  !insertmacro HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwp" ""
  !insertmacro HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwpx" ""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 64
  !insertmacro HWPLY_RESTORE_EXTENSION_DEFAULT "hwp"
  !insertmacro HWPLY_RESTORE_EXTENSION_DEFAULT "hwpx"
  !insertmacro HWPLY_REGISTER_OPEN_WITH "hwp" "hwply.hwp"
  !insertmacro HWPLY_REGISTER_OPEN_WITH "hwpx" "hwply.hwpx"
  !insertmacro HWPLY_REMOVE_EMPTY_BACKUP_KEYS
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; hwply setup 이 만든 것(사용자 bin 폴더·사용자 PATH 항목·표시 파일이 있는 skill)만 지운다. 실패해도 제거는 계속한다.
  ; 업데이터의 재설치(/UPDATE)에서는 지우지 않는다. 수동 업그레이드로 지워진 항목은 새 앱이 시작할 때 다시 설정을 제안한다.
  ; nsExec 는 콘솔 창을 띄우지 않는다.
  ${If} $UpdateMode <> 1
    Push $0
    nsExec::Exec '"$INSTDIR\hwply-cli.exe" setup --remove --yes'
    Pop $0 ; 종료 코드(무시)
    Pop $0 ; 원래 값 복원
  ${EndIf}
  SetRegView 64
  !insertmacro HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwp" "hwply.hwp"
  !insertmacro HWPLY_SNAPSHOT_EXTENSION_DEFAULT "hwpx" "hwply.hwpx"
  !insertmacro HWPLY_REMOVE_OPEN_WITH "hwp" "hwply.hwp"
  !insertmacro HWPLY_REMOVE_OPEN_WITH "hwpx" "hwply.hwpx"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetRegView 64
  !insertmacro HWPLY_RESTORE_EXTENSION_DEFAULT "hwp"
  !insertmacro HWPLY_RESTORE_EXTENSION_DEFAULT "hwpx"
  !insertmacro HWPLY_REMOVE_EMPTY_EXTENSION_KEYS "hwp"
  !insertmacro HWPLY_REMOVE_EMPTY_EXTENSION_KEYS "hwpx"
  !insertmacro HWPLY_REMOVE_EMPTY_BACKUP_KEYS
  !insertmacro UPDATEFILEASSOC
!macroend
