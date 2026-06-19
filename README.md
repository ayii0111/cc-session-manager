# ccs — Claude Code Session manager

一個 TUI 工具，用來管理 [Claude Code](https://claude.com/claude-code) 的會話 (session)。
在終端機裡瀏覽、切換、重命名、刪除各專案的 cc sessions，選定後直接接續對話，**離開時自動 `cd` 回該專案目錄**。

## 功能

- 📂 依專案目錄分組列出所有 cc sessions，顯示名稱、檔案大小、最後活動時間
- 🟢 即時標示**進行中**的 session（`●`），並擋下對活躍 session 的刪除
- ↩️ 選定 session → 啟動 `claude -r` 接續；選目錄 → 在該目錄開新會話
- ✏️ 重命名 session（寫入 custom title）
- 🗑️ 刪除單一 session / 整個目錄的所有 sessions / 連同目錄與 memory
- 🖱️ 支援方向鍵與滑鼠點選
- 📍 退出後自動 `cd` 回原專案目錄（透過 zsh 整合）

## 安裝

需要 [pnpm](https://pnpm.io/)。下載後在專案目錄執行：

```shell
pnpm install
pnpm run setup   # build + 安裝指令 + 詢問是否寫入 ~/.zshrc shell 整合
```

`setup` 會：
1. 把工具裝到 `~/.local/share/ccs/`，並在 `~/.local/bin/ccs` 建立指令
2. 詢問是否在 `~/.zshrc` 加入 shell 整合函式（讓退出後能自動 `cd`）

完成後執行 `source ~/.zshrc` 或重開終端機即可生效。

> 若提示 `~/.local/bin` 不在 `PATH`，依畫面指示把它加入 `~/.zshrc` 即可。

## 使用

啟動：

```shell
ccs
```

| 按鍵 | 動作 |
|------|------|
| `↑ / ↓` | 移動聚焦（也可用滑鼠點選） |
| `→ / ←` | 展開目錄 / 在操作列切換選項 |
| `Enter` | 進入操作 / 確認 |
| `Esc` | 上一步 / 退出 |

### 互動流程

```
瀏覽列表 → Enter → 選擇操作 → （需確認的操作）→ 二次確認
                              → （重命名）→ 輸入新名稱
                              → （一般操作）→ 執行並離開
```

- **目錄**上的操作：新會話、刪除所有 sessions、刪除目錄（含 memory）
- **session**上的操作：回到會話、重命名、刪除
- 刪除類操作都需二次確認，最後一個選項永遠是「取消」

## 運作原理

- **Sessions 來源**：`~/.claude/projects/[slug]/*.jsonl` — 每個 `.jsonl` 是一段 cc 對話紀錄，從中解析名稱、原始專案路徑 (`cwd`)、時間戳
- **活躍偵測**：掃描 `~/.claude/sessions/[pid].json`，並用 `process.kill(pid, 0)` 驗證進程仍存活（避免 cc 崩潰後的殘留 PID 誤判）
- **自動 cd**：`ccs` 離開前把目標目錄寫入 `/tmp/ccs-cwd`，`~/.zshrc` 的 wrapper 函式讀取後執行 `cd`。
  （`cd` 無法由子進程改變父 shell 的目錄，因此必須靠 shell 函式橋接）

## 開發

```shell
pnpm dev          # 用 tsx 直接執行，免 build
pnpm build        # 用 tsup 打包到 dist/index.js
pnpm run deploy   # build + 部署（代碼更新後用，不動 .zshrc）
pnpm start        # 執行 dist/index.js
```

原始碼結構與架構說明見 [`CLAUDE.md`](./CLAUDE.md)，開發者安裝流程見 [`INSTALL.md`](./INSTALL.md)。

## 已知問題

邊界情境與待修清單見 [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)。
