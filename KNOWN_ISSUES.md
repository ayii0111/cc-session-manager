# Known Issues

邊界情境與待修清單，收官後留存，日後有機會再處理。

## ✅ 已修復

### PID 殘留 → session 永遠無法刪除
Claude 崩潰（kill -9、強制關機）後 `~/.claude/sessions/[pid].json` 不清除，`isSessionActive()` 永遠回傳 true，`●` 永遠亮，刪除永遠被擋。

**已修**：`src/watcher.ts` 新增 `isPidAlive()`，讀取 PID（欄位優先，否則用檔名）後以 `process.kill(pid, 0)` 驗證 process 存活；`_scan()` 與 `isSessionActive()` 皆套用。

### onAction 錯誤被吞掉
`src/index.ts` 的 `onAction` `.then()` 沒有對應的 `.catch()`。操作失敗（權限問題、檔案已刪）靜默失敗，clone tree 狀態與實際不一致。

**已修**：`src/index.ts` 的 `onAction` 整段包 try/catch，失敗時 `addLog` 顯示於 log 區（所有 await 都在 tree 變動之前，失敗時 clone tree 不會被改 → 狀態一致）；`src/tree-prompt.ts` 兩個 `.then()` 補 `.catch(() => this.render())` 防止漏渲染。

### cwd 超過 32KB → session 靜默消失
第一條訊息超長（> 32KB），`src/reader.ts` 找不到 `cwd`，`parseSessionFile` 回傳 null，session 完全不顯示。

**已修**：改為先讀 tail 再放棄 — 任何訊息行都帶 `cwd`，故從 tail 取得真實 cwd 作主要 fallback；最後手段才用 `slugToPath()` 從 slug 反推（有損，但保證不消失）。不再回傳 null。

### 刪完所有 session 後畫面空白無提示
clone tree 為空，用戶不知道需要按 Esc 退出。

**已修**：`_renderTree()` 偵測空樹時顯示「沒有 session，按 Esc 退出」；`_processEnter()` 在空樹按 Enter 時直接 return，避免操作 undefined node。

### Session 名稱含 ANSI escape sequence 可能干擾顯示
**已修**：`src/reader.ts` 新增 `sanitizeName()`，讀取時剝除 ANSI escape 與控制字元，清空後 fallback 為 `(untitled)`。

### `pnpm run setup` 完成後沒有警告 `~/.local/bin` 是否在 PATH
**已修**：`scripts/setup.js` 結尾檢查 `BIN_DIR` 是否在 `PATH`，不在則印出 export 提示。

## 待處理

### 終端機太窄時欄位換行破版
無 `process.stdout.columns` 截斷保護。需 ANSI-aware 截斷（剝色或保色截斷），改動風險較高，暫緩。

### `fs.watch` 在高負載下可能漏事件
已有 3 秒 fallback 定時器補救，影響可接受。
