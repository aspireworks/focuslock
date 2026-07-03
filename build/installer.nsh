# Spawncamp NSIS hooks (included via electron-builder.yml -> nsis.include).
#
# customUnInstall runs inside the uninstall section BEFORE files are removed,
# so $INSTDIR\Spawncamp.exe still exists when the cleanup mode runs. It is
# skipped for auto-update uninstalls (${isUpdated}) — updating must never
# strip the user's hosts blocks or protection.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    # Stop everything Spawncamp left running (main, guardian, task-fired instances).
    ExecWait 'taskkill /F /IM Spawncamp.exe /T'
    # Undo machine changes: autostart, SpawncampGuard task, hosts entries + DoH
    # policies (one UAC prompt, only if a managed hosts block actually exists).
    # The exe exits 0 even on partial failure — uninstall is never blocked.
    ExecWait '"$INSTDIR\Spawncamp.exe" --uninstall-cleanup'
    # Belt and braces in case the cleanup run itself was killed.
    ExecWait 'schtasks /Delete /F /TN "SpawncampGuard"'
    # Deliberate: %APPDATA%\spawncamp (settings, streak history) is kept, so a
    # reinstall after a relapse resumes the user's streak record.
  ${endif}
!macroend
