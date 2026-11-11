# Claude Code Session manager

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

需要 Node.js 18 以上。

```shell
curl -fsSL https://raw.githubusercontent.com/ayii0111/cc-session-manager/main/install.sh | sh
```

安裝程式會：
1. 把工具裝到 `~/.local/share/sm/`，並在 `~/.local/bin/sm` 建立指令
2. 在 `~/.zshrc` 或 `~/.bashrc` 加入 shell 整合區塊（讓退出後能自動 `cd`，並確保 `~/.local/bin` 在 `PATH` 中）

完成後重開終端機即可生效。

## 移除

```shell
curl -fsSL https://raw.githubusercontent.com/ayii0111/cc-session-manager/main/uninstall.sh | sh
```

會移除指令、安裝檔與 shell 整合區塊，不會動到 `~/.claude` 內的 session 資料。

## 使用

啟動：

```shell
sm
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

- **目錄**上的操作：新會話、切換目錄、刪除所有 sessions、僅刪除 memory、刪除 claude 專案（含 memory，只刪 `~/.claude/projects/` 下的紀錄，不動實際專案目錄）
- **session**上的操作：回到會話、重命名、刪除
- 刪除類操作都需二次確認，最後一個選項永遠是「取消」

## 運作原理

- **Sessions 來源**：`~/.claude/projects/[slug]/*.jsonl` — 每個 `.jsonl` 是一段 cc 對話紀錄，從中解析名稱、原始專案路徑 (`cwd`)、時間戳
- **活躍偵測**：掃描 `~/.claude/sessions/[pid].json`，並用 `process.kill(pid, 0)` 驗證進程仍存活（避免 cc 崩潰後的殘留 PID 誤判）
- **自動 cd**：`sm` 離開前把目標目錄寫入 `/tmp/sm-cwd`，shell 設定檔裡的 wrapper 函式讀取後執行 `cd`。
  （`cd` 無法由子進程改變父 shell 的目錄，因此必須靠 shell 函式橋接）

## 開發

```shell
pnpm dev          # 用 tsx 直接執行，免 build
pnpm build        # 用 tsup 打包到 dist/index.js
pnpm run reinstall  # 以當前原始碼重新安裝（先移除再安裝）
pnpm start        # 執行 dist/index.js
```

推送 `v*` tag 會由 GitHub Actions 建立 Release 並附上打包檔，`curl` 安裝下載的就是最新 Release。

原始碼結構與架構說明見 [`CLAUDE.md`](./CLAUDE.md)，開發者安裝流程見 [`INSTALL.md`](./INSTALL.md)。

## 已知問題

邊界情境與待修清單見 [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)。
