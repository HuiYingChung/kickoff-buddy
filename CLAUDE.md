# kickoff-buddy — Repo 規則

> 全域規則見 ~/.claude/CLAUDE.md。本檔只放這個 repo 特有的事。

## 這個專案是什麼
AI World Cup companion：即時足球講解，兩段式 AI pipeline
（GPT-4o ＋ IBM Granite），面向足球新手。

## 技術棧與部署
- Vercel serverless functions（api/），前端 vanilla。
- 本機開發有 proxy.js（單一 process）。

## 適用的共用標準
- [x] standards/serverless-ai-proxy.md（每次動 api/ 或 lib/ 必讀）
- [x] standards/verification.md

## 這個 repo 的驗證方式
- serverless-ai-proxy.md 的「上線後驗證」curl 清單
- 限流改動需有單元測試（mock fetch，參考 ways-of-healing
  的 test_ratelimit.js 寫法）

## 已知的坑與待辦
- **待辦（高優先）**：`lib/ratelimit.js` 目前為 in-memory Map，
  serverless 上僅 best-effort（檔案頂部註解已自述）。
  依 SETUP.md 修復 3c 移植為 Redis REST 做法；
  key prefix 用 `kb:rl:`。
- **保留**：`clientIp()` 的防偽造寫法（不信任 x-forwarded-for
  第一值）是三個專案中的正確範本，移植 Redis 時不要動它。
- 對外介面 `{ allowed, message }` 有兩個呼叫端依賴，改內部實作
  時介面不可變。
