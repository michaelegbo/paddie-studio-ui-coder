; Custom NSIS hooks for Paddie Studio installer
; Kills the sidecar process before install/uninstall so the binary can be overwritten.

!macro NSIS_HOOK_PREINSTALL
  ; Kill the sidecar if it's still running, otherwise the File command
  ; silently fails and the old binary stays on disk.
  nsExec::ExecToLog 'taskkill /F /IM "opencode-cli.exe"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "opencode-cli.exe"'
!macroend
