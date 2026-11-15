# 本地 GPU POC：節點代理 + 閘道 + 驗收測試

這個資料夾是「把自有 GPU 機器接進 MaaS 平台」的最小可行驗證。它在一台裝有 NVIDIA 顯示卡的電腦上，實際跑完整條路徑：節點代理註冊、GPU 切割、載入模型、OpenAI 相容 API、金鑰與限流、計量扣款、驗收報告。

所有程式都是零相依的 Node.js 腳本（Node 20 以上）。推論引擎用 Ollama。所有持久化資料都寫在 D 槽。

## 1. 先決條件

| 項目 | 這台電腦的現況 |
|---|---|
| NVIDIA GPU 與驅動 | GeForce RTX 4080 Laptop 12 GB，驅動 610.74 |
| Ollama | 0.40.16，服務在 `http://127.0.0.1:11434` |
| 模型權重 | `D:\ollama\models`（環境變數 `OLLAMA_MODELS`） |
| Node.js | 20 以上（實測用 22.15） |

POC 使用三個已下載的模型：`gemma3:4b`、`llama3.2:latest`、`hf.co/audreyt/Gemma-3-TAIDE-12b-Chat-2602-GGUF:Q4_K_M`。缺少時用 `ollama pull <名稱>` 補上。

## 2. 執行

開三個終端機，都進到這個資料夾（需要 Node.js 20 以上）：

```bash
cd poc
```

```bash
node gateway.mjs                  # 終端機 1：控制面 + 閘道，127.0.0.1:8787
node agent.mjs                    # 終端機 2：節點代理，註冊後載入切片
node bench.mjs --with-dedicated   # 終端機 3：23 項驗收 + 壓測，約 3 分鐘
```

結束時釋放 GPU 記憶體：

```bash
node agent.mjs --release
```

把最新實測結果更新到示範網站的「本地 GPU 上線」頁：

```bash
node export-snapshot.mjs          # 寫入 ../src/data/localGpuPoc.snapshot.json
```

## 3. 檔案

| 檔案 | 角色 |
|---|---|
| `poc.config.json` | 儲存位置、切片設定檔、模型對照與單價、測試租戶 |
| `gateway.mjs` | 控制面與資料面：節點註冊與心跳、期望狀態、`/v1/models`、`/v1/chat/completions`、金鑰、目錄白名單、TPM 限流、預付餘額、帳本 |
| `agent.mjs` | 節點代理：盤點 GPU、註冊、心跳、准入控制、載入與卸載模型、量測 VRAM |
| `bench.mjs` | 驗收檢查與吞吐量測試，輸出 JSON 與 Markdown 報告 |
| `export-snapshot.mjs` | 把最新報告精簡後交給示範網站 |
| `lib.mjs` | 共用工具：設定、儲存目錄、原子寫檔、記錄 |

## 4. D 槽上的儲存配置

```
D:\maas-poc-storage\
  state\     control-plane.json      租戶、餘額、金鑰雜湊、節點登錄
             agent-identity.json     這台機器的節點 ID 與節點權杖
             poc-keys.local.json     僅 POC：明文測試金鑰（管理、啟動、各租戶）
  ledger\    usage-YYYY-MM-DD.jsonl  每筆請求一行，只有中繼資料
  logs\      gateway.log、agent.log
  models\    manifest.json           這個節點可提供的權重與摘要
  reports\   poc-report-<時間>.json / .md、latest.json、latest.md

D:\ollama\models\                    模型權重（GGUF），原本就在 D 槽
```

要換位置，改 `poc.config.json` 的 `storageRoot`，或設定環境變數 `MAAS_POC_STORAGE`。在 Linux 或 macOS 上，預設的 `D:` 路徑會自動改成這個資料夾底下的 `storage/`。

在別的機器上執行時，還要依顯示卡的 VRAM 調整 `poc.config.json` 裡每個切片的 `vramMiB`，並把 `runtime.modelStore` 改成該機器的 Ollama 模型位置（這個欄位只用於記錄）。

要重來一次，先停掉閘道與代理，再刪除 `D:\maas-poc-storage\state`。下次啟動會產生新的金鑰與節點身分。

## 5. GPU 怎麼切

這張顯示卡是消費級，在 Windows 的 WDDM 驅動模式下執行。它不支援 MIG，也不支援 MPS。代理偵測到這一點後，改用 VRAM 預算切割：

1. 可用預算 = 總 VRAM 12,282 MiB − 保留給桌面的 1,536 MiB = 10,746 MiB。
2. 控制面下發期望的切片清單。代理依序准入，預算用完就拒絕後面的切片。
3. 代理請 Ollama 把模型載入並常駐，然後比對兩個數字：引擎回報的 VRAM，以及 nvidia-smi 實測的 GPU 記憶體增量。
4. 模型沒有完全在 GPU 上，或實測超過預算，切片就標成異常，閘道不會把請求送過去。

設定檔有兩種：

| 設定檔 | 切片 | 預算 | 模型 | 型態 |
|---|---|---|---|---|
| `shared-2` | slice-a | 3,840 MiB | gemma-3-4b | 共享 |
| | slice-b | 3,584 MiB | llama-3.2-3b | 共享 |
| `dedicated-1` | slice-d | 10,496 MiB | gemma-3-taide-12b | 專屬給 `t-gov` |

切換設定檔：

```bash
curl -s -X POST http://127.0.0.1:8787/admin/v1/profile \
  -H "Authorization: Bearer <管理金鑰>" -H "Content-Type: application/json" \
  -d '{"profile":"dedicated-1"}'
```

這種切法沒有硬體隔離，算力是分時共享。正式環境的資料中心卡要用 MIG，或把整顆 GPU 給一個推論引擎。

## 6. 實測結果（2026-11-15）

驗收 23 項全數通過。完整報告在 `D:\maas-poc-storage\reports\latest.md`。

| 情境 | 併發 | 總 tok/s | TTFT 中位數 |
|---|---|---|---|
| gemma-3-4b 單獨執行 | 1 | 107.7 | 58 ms |
| gemma-3-4b 單獨執行 | 4 | 111.4 | 1,297 ms |
| llama-3.2-3b 單獨執行 | 1 | 148.2 | 31 ms |
| 兩個切片同時忙碌 | 2 + 2 | 123.0 | 108 ms / 54 ms |
| gemma-3-taide-12b 整顆專屬 | 1 | 42.3 | 103 ms |

四個發現：

1. **引擎回報的 VRAM 偏低。** 兩個模型回報合計 5,190 MiB，GPU 實際多用 6,474 MiB。差額 1,284 MiB 是行程本身的佔用。預算要用實測值。
2. **併發沒有帶來吞吐。** 併發從 1 到 4，總吞吐持平，首個 token 時間卻拉長到 1.3 秒。Ollama 一次只處理一個請求。正式環境要用 vLLM 的連續批次。
3. **VRAM 切片不隔離算力。** 兩個切片同時忙碌時，gemma 只剩 58% 的速度，llama 只剩 38%。
4. **切換設定檔約 18 秒。** 專屬切片上，其他租戶的請求收到 503。

## 7. POC 與正式環境的差距

| 項目 | POC | 正式環境 |
|---|---|---|
| 作業系統 | Windows 11 | Ubuntu Server LTS |
| 切割 | VRAM 預算，無硬體隔離 | MIG 或整顆 GPU |
| 推論引擎 | Ollama（llama.cpp），一次一個請求 | vLLM 或 SGLang，連續批次 |
| 編排 | 單機、手動啟動 | Kubernetes + NVIDIA GPU Operator |
| 節點驗證 | 啟動權杖換節點權杖，走本機 HTTP | mTLS 節點憑證，可撤銷 |
| 金鑰 | 明文存在 `poc-keys.local.json` 供測試腳本使用 | 只存雜湊 |
| 帳本 | 本機 JSONL 檔 | 事件串流加資料庫，逐筆扣帳 |
| 遙測 | 代理輪詢 nvidia-smi | DCGM exporter + Prometheus |

閘道只綁定 `127.0.0.1`。不要把這個 POC 直接開放到網路上。
