# 核心效能門檻

`Core performance gate` 在相關核心程式／測試／policy 的 PR 自動執行，也可從 GitHub Actions 手動執行。它使用固定 Ubuntu 24.04 x64 runner 類別、Node.js 22.23.3，不安裝瀏覽器、不建立 GB 級磁碟檔；不在 Pages 發布時重複跑同一份測量。CI 僅讀儲存庫，不具有部署或模型上傳權限。

本機重現：

```sh
node --test test/performance-policy.test.mjs test/performance.test.mjs
node scripts/accept-performance.mjs --out test-results/new-performance-run.json
```

輸出檔必須尚未存在，避免把上次成功報告誤當本次結果。需要至少 2 GiB 可用記憶體；資源不足、逾時、少一筆量測、子程序失敗、未知／非有限數值、耗時／RSS 等應有量測被記成零、結構不符或測試途中來源改變，均不標示通過。沒有自動縮小 fixture 或重試。三種案例各啟動三個全新 Node 子程序，所有九筆均須符合門檻；不是把最好的一筆當結果，也不是同程序長時間洩漏率測試。

## 固定案例

| 案例 | 內容與必要檢查 |
| --- | --- |
| TFLite 3,001 OP | 單 subgraph、邏輯長度 1,342,706,636 bytes；精確搜尋、1,000 組 RTR、可取消搜尋、局部快照、收合後 1,001 節點 |
| TFLite 21,001 OP | 單 subgraph、邏輯長度 1,345,874,636 bytes；精確搜尋、7,000 組 RTR、可取消搜尋、局部快照、Canvas 資料總覽 7,003 節點（含輸入／輸出邊界） |
| Generic MLIR 20,010 OP | 六個 blocks、custom op、分支／匯合／迴圈、20,000 個隱藏路徑 OP；跨五 block pattern 一筆、局部匯出重開一筆、SSA／dominance、路徑發現、20 次切段／收起、快取重用與切段前後匯出 bytes 相同 |

TFLite 用固定 header SHA-256 與虛擬零權重 range reader，遇到單次 >1 MiB／累計 >32 MiB 的讀取，先拒絕再配置；不是原生 File、實體大檔或冷磁碟量測。MLIR 使用 1,238,572 bytes 的結構文字及固定 SHA-256，不含巨型 dense 權重；既有實體 2.5 GiB MLIR 驗收仍獨立保留。

## 已訂門檻

完整 machine-readable 值在 [performance-policy.json](../test/performance-policy.json)，與來源一同版控並在報告記錄 policy SHA-256。門檻在初次量測前設定，不由當次結果自動放寬。

- TFLite：解析 ≤5s、單次精確搜尋 ≤250ms、pattern／總覽準備各 ≤5s、取消或完成 ≤500ms；無截斷且匹配數量精確。取消測試以真正待處理 timer 發出要求，任務須合作中止，或在 50ms 內提早完成。
- MLIR：解析 ≤10s、pattern ≤5s、匯出／重開／再次匯出各 ≤10s；路徑發現 ≤5s，快取後單次切段 ≤500ms。
- 每個子程序 OS high-water RSS ≤1 GiB，包含 fixture 建立；不是小型 orchestrator 自己的記憶體。Node heap 上限 768 MiB，每個子程序硬逾時 60s。
- 路徑發現每次 work ≤50,000、可見 helpers ≤512；相同的首／尾分段熱身後，20 次操作新增模板為零，cached work=0、cache hit=1，重複匯出逐位元組相同。

MLIR 重開前會釋放來源 index 與匯出暫時 provenance 的參照，只保留輸出 Blob 和舊 pattern；切段前後以串流 SHA-256 比對匯出內容，避免測試自己留著多份字串／解析結果。沒有呼叫強制 GC。

## 證據及界線

報告包含 source commit／tree／dirty、相關程式逐檔 SHA-256 與整體 fingerprint、policy、每次子程序結果、環境 CPU／Node／runner image 版本及所有失敗。CI 使用每個 run／attempt 獨立的 runner 暫存檔，artifact 保留 30 天。判定需同時看工作流程 conclusion、報告 status、來源及九筆量測，不能只看到 artifact 內的 passed 字串。CI 若不符合固定 runner 類別會失敗；其他本機環境會標示 non-reference，不能冒充 CI 證據。

固定的是 runner 類別與 Node patch 版本，hosted runner CPU 與 image version 仍可能變動，所以這是防止明顯回歸的絕對上限，不是固定實體硬體的 latency SLA。這一層不證明瀏覽器／Worker 記憶體回收、SVG／Canvas 手感、公司模型／dialect、native compiler 或數值等價性。也未把手動主分支發布改成需要 CI 核准；完整發布關卡及瀏覽器長時間驗收仍列後續。

工作流程的 runner 暫存路徑只在 step 使用；job env 只保存 run／attempt 檔名，符合 [GitHub context 可用位置](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)。
