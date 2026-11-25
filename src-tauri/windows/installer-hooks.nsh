; Hooks that Tauri's NSIS template calls (`bundle.windows.nsis.installerHooks` in
; `tauri.conf.json`).
;
; Antigravity keeps `quay-relay.exe` running for each of its sessions, and Windows will not replace
; a running program's file, but it will rename one (#774). The install hooks rename the relay aside
; and delete what earlier updates left. No relay is stopped. Quay also deletes the old relays, each
; time it starts (`src-tauri/src/slices/connect/relay_leftovers.rs`).
;
; The macros keep the registers they use, and leave the error flag clear.

!include "LogicLib.nsh"

; Deletes the old relays, or asks Windows to delete at its next start the ones it can't. Windows
; takes that only from an elevated installer, and Quay's asks for no elevation, so a relay that is
; still running usually stays for Quay to delete. The operator is not asked to restart Windows for it.
!macro QUAY_DELETE_OLD_RELAYS
  Push $R8
  StrCpy $R8 0
  ${If} ${RebootFlag}
    StrCpy $R8 1
  ${EndIf}

  Delete /REBOOTOK "$INSTDIR\quay-relay.exe.old*"

  ${If} $R8 = 0
    SetRebootFlag false
  ${EndIf}
  ClearErrors
  Pop $R8
!macroend

; Renames the relay to the first of `quay-relay.exe.old`, `quay-relay.exe.old.1` and so on that is
; free or can be freed, and puts a copy back in its place, for the installer to replace. The copy is
; there because the operator can still cancel the installer: the template asks to close a running
; Quay after this hook. If the rename fails, the relay stays as it was and the installer does what it
; does without the hook.
!macro NSIS_HOOK_PREINSTALL
  Push $R8
  Push $R9

  ${If} ${FileExists} "$INSTDIR\quay-relay.exe"
    StrCpy $R8 "$INSTDIR\quay-relay.exe.old"
    StrCpy $R9 0
    Delete "$R8"
    ${While} ${FileExists} "$R8"
      ${If} $R9 >= 99
        ${Break}
      ${EndIf}
      IntOp $R9 $R9 + 1
      StrCpy $R8 "$INSTDIR\quay-relay.exe.old.$R9"
      Delete "$R8"
    ${EndWhile}

    ClearErrors
    ; Fails if the name is taken after all
    Rename "$INSTDIR\quay-relay.exe" "$R8"
    ${IfNot} ${Errors}
      System::Call 'kernel32::CopyFileW(w "$R8", w "$INSTDIR\quay-relay.exe", i 1)'
    ${EndIf}
  ${EndIf}

  ClearErrors
  Pop $R9
  Pop $R8
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro QUAY_DELETE_OLD_RELAYS
!macroend

; The template deletes the files it installed and then removes the folder only if it is empty.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro QUAY_DELETE_OLD_RELAYS
!macroend
