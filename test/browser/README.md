# >1 GiB Chromium 選檔驗收（可選）

這是獨立的大檔驗收，不會由 `npm test`、一般建置或 Pages 發布自動執行。只用合成資料，模型不會上傳。一般 Node.js 測試及靜態建置仍不需安裝 npm 套件；此項驗收才需要 Playwright 開發依賴。

## 重現

建議 Linux、Node.js 22+，暫存磁碟至少空出 4 GiB、可用記憶體至少 3 GiB。程式會先檢查磁碟及 cgroup 記憶體限制；資源不足或缺少瀏覽器時回傳非零狀態，不標示通過。

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:large-browser
```

也可在 GitHub Actions 手動啟動 **Optional large-file Chromium acceptance**。它只有 `workflow_dispatch`，不會在每次 push／PR 建立大檔；報告保留為 artifact，沒有部署權限。首次加入 workflow 的 PR 尚未合併前，GitHub 可能不提供手動啟動入口。

腳本自動建置、啟動 loopback 靜態伺服器、建立獨立暫存目錄，以 `makeLargeFixture(file, { graphCount: 2, repeats: 1000 })` 明確選擇兩個 subgraphs／6,002 operators／1.25 GiB 權重資料。產生器 CLI 維持 main 的單子圖／21,001 operators 預設。檔案邏輯長度為 **1,343,235,364 bytes**；權重是稀疏零值區，不能當作冷磁碟讀取速度測試。正常完成與一般失敗時會刪除合成檔並關閉伺服器；180 秒硬逾時／程序被強制終止時，可能留下 `model-lens-browser-*` 暫存目錄。

輸出為 `test-results/large-file.json`（成功及失敗均記錄；不進版控或部署包）。可用 `LARGE_FILE_REPORT` 改變路徑。`CHROMIUM_EXECUTABLE_PATH` 可指定已安裝的 Chromium；實際版本會寫入報告。歷次實測證據另存於 `results/`。最新整合紀錄見 [2026-10-24 整合驗證](../../docs/large-browser-integration-2026-10-24.md)。本機報告的 `sourceKind` 為 `local-integration-snapshot`，`sourceCommit` 是本機快照，`integrationBaseCommit` 指向 GitHub main，`sourceTree` 可核對測試樹；GitHub Actions 報告另以 `GITHUB_SHA` 標示真正受測提交。一般 PR 驗證只執行 Node.js 測試與小型建置，不建立巨型檔。

## 實際覆蓋

2026-10-25 新增條件／工作階段驗收，最新本機結果 **18 項通過**，受測提交 `754f7cad8accf7a104673606f710c1de0995ea94`。來源、數據及限制見 [本次紀錄](../../docs/large-browser-conditions-workspace-2026-10-25.md)。新版繼續使用相同 1,343,235,364 bytes fixture，並額外產生同大小、單一 tensor dtype 改變的稀疏模型，驗證結構指紋拒絕。`large-workspace.mjs` 僅由此手動 runner 呼叫。

| 操作 | 通過條件 |
| --- | --- |
| 檔案選取 | 點「開啟模型」捕捉 Chromium FileChooser，再以磁碟路徑 `setFiles`；瀏覽器收到正確長度的原生 File，不在 Node.js 建立巨型 Buffer，也不使用記憶體假檔。未操作桌面 OS 對話框。 |
| 索引 | 真正 module Worker／FileReaderSync／File.slice 解析出 6,002 operators，初始不繪製整張圖。 |
| 局部圖 | 搜尋 layer #1500，等待 SVG 完成，節點數為 1–100。 |
| 搜尋 | 精確編號、兩個 subgraphs 的 2,000 組 pattern、100 筆分頁、匹配局部圖及權重 tensor metadata。 |
| Metadata 條件 | N2 output #0 的 shape `[1,*]` AND dtype `float32` 得 2,000 筆；衝突 dtype、shape、不存在的 port、attribute 各得 0 筆，移除後重搜恢復；不額外讀檔。 |
| Pattern library | UI 儲存條件、v3 JSON 實際下載／選檔匯入與重複判斷；清除目前條件後重新套用、重新整理後獨立讀取 library。 |
| JSON／SVG 工作階段 | 第 101 筆匹配 `[300,301,302]`、兩個 OP 選取、條件、字級、方向、左欄寬度、SVG zoom 與錨點；下載 JSON 後選檔恢復及重新整理後「恢復上次儲存」，錨點誤差 <3px。 |
| 拒絕錯模 | 相同 byte length、相同 OP 數但 tensor dtype 改變的有效大檔被指紋拒絕，未套用舊選取；隨後原模型可恢復。 |
| 取消 | 僅此案例暫停 metadata HTTP 回應，使載入穩定處於進行中；點擊「取消載入」，確認真正 Worker close、控制項重設。這不代表已測量同步解析途中的最長取消延遲。 |
| 錯誤與恢復 | 另選同樣 >1 GiB 的無效檔，確認錯誤及重設；同頁重新選入原大檔，索引、搜尋及局部圖恢復，沒有舊載入狀態覆蓋新模型。 |
| 子模型匯出 | 大檔中選一個 builtin operator 實際下載，重新選入下載檔確認一層模型可開啟。其餘匯出語意仍由既有 Node.js 測試覆蓋。 |
| MLIR 切換煙霧測試 | 大型 TFLite 與匯出子模型之後，同頁開啟內建小型 `demo.mlir`；確認 SSA Values、MLIR 匯出按鈕、搜尋及圖形繪製。不是完整 MLIR 瀏覽器驗收。 |
| 回應與隱私 | 50 ms 頁面心跳最大間隔 <2 秒；driver 等待上限 30 秒、全程硬上限 180 秒；沒有 crash、pageerror、worker error、非同來源或非 GET 網路請求。 |
| 讀取與記憶體 | 原生讀取統計與 worker range 統計相符；每個 realm 累計 ≤8 MiB、單次 ≤1 MiB；Linux Chromium 程序樹 RSS 相對初始增量 <768 MiB。 |

## 量測與限制

- Worker 模組由測試路由加上 FileReader／Blob 觀察器，讀取仍呼叫原生 API。主頁也觀察 FileReader、Blob.arrayBuffer／text／stream／bytes；超過預算會先拒絕，避免回歸直接配置完整權重。成功案例沒有檔案 I/O 模擬或延遲。這是帶保護的驗收，沒有刻意放行 1.25 GiB 完整配置。
- `initialLoadMs`／`recoveryLoadMs` 從自動點擊開檔開始，包含 Playwright FileChooser 指定路徑、Worker 啟動、metadata 載入、解析、索引與第一頁清單。`worker.stats.parseMs` 僅是 Worker 解析與索引，不是同一指標。
- 100 ms 取樣 Chromium 程序樹 RSS（含 Worker）及主頁 JS heap。Linux 使用此測試專屬啟動標記與 host `/proc` 的 PPid 找程序樹，避免 CDP 的 namespace PID 導致誤讀零值。找不到程序或 RSS 為零視為失敗。RSS 可能重複計算共享頁，取樣也可能漏掉極短尖峰；主頁 heap 不代表 Worker 的 heap。重新整理前的 I/O／Worker／心跳觀察保存在 `auditHistory`，最終跨所有 realms 檢查預算及被替換 Worker 的終止狀態。
- 非 Linux 保留 heap 觀察並明確記錄 RSS 驗證不可用；不能聲稱已完成同等的記憶體驗收。768 MiB 是此合成案例的回歸門檻，不是所有模型的產品記憶體保證。
- 本次受管執行環境在 CDP 關閉 Chromium 後，Playwright 的程序回收仍逾時。驗收報告記錄此限制；清理等待最多 5 秒，之後結束 driver。此處不把程序包裝器的回收逾時視為頁面當機或 UI 無回應。
- 沒有使用者真實大型模型，仍不能推算原始慢速案例的改善幅度、長時間使用的洩漏率、非零權重的磁碟吞吐量，或 Firefox／WebKit 的大檔能力。

# Operator label bounds regression

Run `node test/browser/make-long-label-fixture.mjs <output.tflite>` to create a
synthetic long custom operator with two outputs and an Add join.

Using the supported browser tool, open the fixture through the real file picker
and select 32px. Pass the exported `operatorLabelBounds` probe to the browser's
read-only `evaluate()` API. Assert that the array is non-empty and every
`withinFrame` is true in each state:

- Before selecting a layer.
- After selecting the long custom operator from Layers search.
- After enabling pattern capture and selecting that operator on the graph.
- After changing font size from 14px to 32px while selected.

Also repeat with a custom operator whose outputs take separate operator branches
before joining, then save/search the captured pattern. Verify all matched labels
fit, both branches remain separate and the pattern has one physical match.

This browser measurement catches the original failure: highlighted text changed
from weight 400 to 700 after Netron measured its frame, leaving a negative right
padding. DOM geometry must be checked in a real rendered SVG; a CSS string test
does not cover it.
