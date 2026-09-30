---
description: "Electron Rules"
paths: ["src/electron/**", "electron/**", "src/main/**", "src/renderer/**", "src/preload/**", ".claude/agents/**", ".claude/rules/**"]
---

# Electron Rules

## Files

- `electron.md` — Security defaults (`contextIsolation: true`, `nodeIntegration: false`), IPC channel constants, preload narrow API, main/renderer/preload separation, BrowserWindow setup

## Triggers

Inject these rules when working on: Electron, IPC, preload, main/renderer, `apps/desktop/**`,
`BrowserWindow`, `contextBridge`, `ipcMain`, `ipcRenderer`, `exposeInMainWorld`,
`webPreferences`, `contextIsolation`, `nodeIntegration`.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../ui/INDEX.md` (renderer-side React/Next.js rules)
