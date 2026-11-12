# 多語言（i18n）慣例

語系：`zh-TW`（預設、來源語言）、`en`、`ja`。備援鏈：ja → en → zh-TW。缺鍵時渲染 zh-TW，絕不渲染空白。

## 檔案
- `types.ts` 語系定義；`core.ts` 查詢／插補／複數／語言狀態；`format.ts` 數字與日期格式；`index.tsx` React hooks 與輔助函式。
- 字典：`dict/<locale>/<area>.ts`，每個檔案匯出平面物件 `{ 'key': '文案' }`。三種語系同一區域的鍵集合必須完全相同（測試會檢查）。
- 區域與負責範圍：

| 區域檔 | 內容 |
|---|---|
| common | 全站共用按鈕、狀態、欄位（已存在，其他區域不得重複定義） |
| shell | AppShell、頁首、導覽、語言切換、導覽引擎外框、錯誤頁、共用元件 |
| overview | 總覽頁、操作指引頁 |
| data | src/data 的枚舉標籤、模型描述、供應商、叢集、商業常數 |
| server | src/server 與 src/auth 的錯誤訊息、稽核原因、角色、示範角色 |
| guides | 12 則操作指引（src/data/guides.ts） |
| flows | 12 張情境流程圖（src/data/guideFlows.ts） |
| hub | 模型中心、申請測試、試用與方案、試用申請 |
| billing | 用量與帳單、定價與帳務、設定、儲值 |
| ops | 推論叢集、部署、模型目錄、供應商、路由 |
| customer | API 金鑰、Playground、租戶與專案 |
| admin | IAM、稽核紀錄、範圍選擇器 |

## 鍵命名（固定規則，讓渲染端與字典端可分開完成）
- 一般 UI：`<area>.<page>.<element>`，例如 `hub.hero.title`、`billing.statement.total`。
- 枚舉標籤：`data.<MAP_NAME>.<value>`，例如 `data.CLUSTER_STATUS_LABELS.waiting`。渲染端用 `tl(t, 'CLUSTER_STATUS_LABELS', value, CLUSTER_STATUS_LABELS[value])`。
- 模型：`data.model.<modelId>.description`、`data.model.<modelId>.displayName`（只有顯示名含中文時才需要）。
- 示範角色：`server.persona.<personaId>.label`、`server.persona.<personaId>.description`；角色：`server.role.<roleId>.name`、`server.role.<roleId>.description`。
- 指引：`guides.<guideId>.<field>`、步驟 `guides.<guideId>.step.<stepId>.<field>`（field 與 guides.ts 的屬性名相同，例如 title、body、hint）。
- 流程圖：`flows.<flowId>.title`、`flows.<flowId>.lane.<laneId>`、`flows.<flowId>.node.<nodeId>.label`、`flows.<flowId>.node.<nodeId>.note`、`flows.<flowId>.edge.<from>.<to>`。
- 伺服器錯誤：`server.err.<CODE>`（同一錯誤碼有多種句子時加後綴，例如 `server.err.VALIDATION.keyName`）；稽核原因 `server.audit.<slug>`。

## 寫法
- 元件：`const t = useT();` 然後 `t('hub.hero.title')`、插補 `t('x', { n: 3 })`（字典內寫 `{n}`）、複數 `t.n('common.items', count)`。
- 資料驅動的文字：`tf(t, key, fallbackZh)`；枚舉：`tl(t, MAP, value, fallbackZh)`。
- 資料模組（非 React）需要 zh-TW 文字時：`zh('key', params)`（例如伺服器的 `message` 欄位）。這讓 zh-TW 字典成為唯一的中文來源。
- 伺服器錯誤：回傳 `{ message: zh(key, params), messageKey: key, params }`；UI 一律用 `apiMessage(t, err)` 顯示。
- 稽核原因：`reason: zh(key, params), reasonKey: key, reasonParams: params`；UI 用 `keyedText(t, ev.reason, ev.reasonKey, ev.reasonParams)`。
- 種子名稱：租戶 `tenantLabel(t, id, name)`（`server.tenant.<id>.name`）、使用者／金鑰服務主體 `principalLabel(t, id, name)`（`server.user.<id>.displayName`、`server.const.keyPrincipalName`）；其餘種子文字用 `tf(t, 'server.<種類>.<id>.<欄位>', 原值)`（例如 `server.seedTrial.*`、`server.assignment.<id>.justification`）。
- 數字與日期：`const L = useLocale();` 然後 `L.fmtDateTime(iso)`、`L.fmtDate(iso)`、`L.fmtNumber(n)`。US$ 金額格式各語系相同，可保留既有寫法。
- **zh-TW 的輸出必須與改版前逐字相同**（既有 600 多個測試以中文文案斷言）。

## 翻譯風格
- en：產品行銷品質的美式英文，簡潔；術語：tenant、project、API key、dedicated deployment、spillover、self-hosted、proxied、prepaid credits、rate-limit tier。
- ja：自然的商務日文（です・ます調只用於說明句，按鈕與標籤用名詞形）；術語：テナント、プロジェクト、API キー、専用デプロイ、スピルオーバー、自社ホスト、プロキシ、プリペイド残高。
- 模型名稱、產品名稱、程式碼、HTTP 標頭、錯誤碼不翻譯。示範專有名詞（租戶、專案、金鑰、機房名稱、人名）列在 `allowlist.json`，可保留中文；人名在 en/ja 用羅馬拼音（梁小姐 → Ms. Liang）。

## 測試門檻
- `__tests__/i18n.test.ts`：三語系鍵集合相同、值非空、en 字典無 CJK、ja 字典無繁體專用字、原始碼掃描（`import.meta.glob` ?raw；去除註解含 JSX `{/* */}` 與 CRLF）無殘留中文、en／ja 掛載時導覽＝字典值且無 zh-TW 外漏。
- `__tests__/routes.i18n.test.tsx`：3 語系 × owner／tenant-admin／gov-admin × 全部路由（含 12 則指引）：畫面文字與 aria-label／title／placeholder 不得有未解析鍵、不得有 `[i18n] missing key` 警告；en 不得有 CJK（allowlist 除外）；ja 不得逐字出現與 ja 不同的 zh-TW 字典文案（≥ 3 字），也不得有繁體專用字（`leakUtil.ts` 的 `TRAD_ONLY`）。
