# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案簡介

`ccs` (Claude Code Session manager) 是一個 TUI CLI 工具，用於管理 Claude Code (cc) 的會話 (session)。用戶可以瀏覽、切換、重命名、刪除 cc sessions，並在退出後自動 `cd` 回原專案目錄。

## 指令

```bash
pnpm dev          # 直接用 tsx 執行（開發用，無需先 build）
pnpm build        # 用 tsup 打包到 dist/index.js
pnpm run deploy   # build + 複製到 ~/.local/share/ccs/ + 建立 symlink（代碼更新後用）
pnpm run setup    # build + deploy + 詢問是否寫入 ~/.zshrc shell 整合（初次安裝用）
pnpm start        # 執行 dist/index.js
```

沒有測試套件。

## 架構

### 資料來源
- **Sessions**：`~/.claude/projects/[slug]/*.jsonl` — 每個 `.jsonl` 是一個 cc 會話的對話紀錄
- **Active sessions**：`~/.claude/sessions/[pid].json` — cc 正在執行時的 PID 檔案
- **cd 橋接**：`/tmp/ccs-cwd` — `ccs` 離開後寫入目錄路徑，zsh wrapper 讀取並執行 `cd`

### 核心模組

| 檔案 | 職責 |
|------|------|
| `src/index.ts` | 主程式：建 tree 資料、初始化 TUI、處理所有 `onAction` 回呼 |
| `src/reader.ts` | 解析 `.jsonl` 取得 session 名稱、cwd、時間戳；大檔案用 head+tail 避免全量讀取（閾值 64KB） |
| `src/watcher.ts` | `ActiveSessionWatcher`：`fs.watch` + 3 秒 fallback 定時器，持續掃描 active sessions |
| `src/operations.ts` | rename/delete/new/resume session 的實作；resume 會啟動 `claude -r <session_id>` 子進程 |
| `src/tree-prompt.ts` | `TwoPhaseTreePrompt`：繼承 `inquirer-tree-prompt`，增加 action / confirm / input 三個 phase |
| `src/format.ts` | 顯示格式化工具（相對時間、檔案大小、ANSI-aware 可見寬度）|
| `src/types.ts` | `ProjectInfo`、`SessionInfo`、`TreeNodeValue` 型別定義 |

### TUI 互動流程

```
tree phase → (Enter) → action phase → (Enter on confirm-required action) → confirm phase
                                    → (Enter on input action) → input phase
                                    → (Enter on normal action) → doFinalSubmit
```

- **tree phase**：瀏覽 project 目錄與 session 列表，支援滑鼠點選
- **action phase**：`←/→` 切換操作，`Esc` 退回 tree
- **confirm phase**：需二次確認的操作（刪除），最後一個選項永遠是「取消」
- **input phase**：需文字輸入的操作（重命名）

### 部署路徑

```
dist/index.js → ~/.local/share/ccs/ccs.js → symlink: ~/.local/bin/ccs
```

zsh wrapper（由 `pnpm setup` 寫入 `~/.zshrc`）攔截 `ccs` 指令，在執行後讀取 `/tmp/ccs-cwd` 並執行 `cd`。

## 已知重要問題

詳見 `KNOWN_ISSUES.md`。最關鍵的兩個：

1. **PID 殘留**：cc 崩潰後 `~/.claude/sessions/*.json` 不清除，active 狀態永遠為 true → 修法在 `src/watcher.ts`，用 `process.kill(pid, 0)` 驗證 process 存活
2. **onAction 錯誤被吞**：`src/index.ts` 的 `onAction` `.then()` 沒有 `.catch()`，操作失敗靜默消失
