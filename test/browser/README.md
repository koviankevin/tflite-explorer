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

腳本自動建置、啟動 loopback 靜態伺服器、建立獨立暫存目錄，沿用 `test/make-large-fixture.mjs` 的兩個 subgraphs／6,002 operators／1.25 GiB 權重資料。檔案邏輯長度為 **1,343,235,364 bytes**；權重是稀疏零值區，不能當作冷磁碟讀取速度測試。正常完成與一般失敗時會刪除合成檔並關閉伺服器；180 秒硬逾時／程序被強制終止時，可能留下 `model-lens-browser-*` 暫存目錄。

輸出為 `test-results/large-file.json`（成功及失敗均記錄；不進版控或部署包）。可用 `LARGE_FILE_REPORT` 改變路徑。`CHROMIUM_EXECUTABLE_PATH` 可指定已安裝的 Chromium；實際版本會寫入報告。歷次實測證據另存於 `results/`。

## 實際覆蓋

| 操作 | 通過條件 |
| --- | --- |
| 檔案選取 | 點「開啟模型」捕捉 Chromium FileChooser，再以磁碟路徑 `setFiles`；瀏覽器收到正確長度的原生 File，不在 Node.js 建立巨型 Buffer，也不使用記憶體假檔。未操作桌面 OS 對話框。 |
| 索引 | 真正 module Worker／FileReaderSync／File.slice 解析出 6,002 operators，初始不繪製整張圖。 |
| 局部圖 | 搜尋 layer #1500，等待 SVG 完成，節點數為 1–100。 |
| 搜尋 | 精確編號、兩個 subgraphs 的 2,000 組 pattern、100 筆分頁、匹配局部圖及權重 tensor metadata。 |
| 取消 | 僅此案例暫停 metadata HTTP 回應，使載入穩定處於進行中；點擊「取消載入」，確認真正 Worker close、控制項重設。這不代表已測量同步解析途中的最長取消延遲。 |
| 錯誤與恢復 | 另選同樣 >1 GiB 的無效檔，確認錯誤及重設；同頁重新選入原大檔，索引、搜尋及局部圖恢復，沒有舊載入狀態覆蓋新模型。 |
| 子模型匯出 | 大檔中選一個 builtin operator 實際下載，重新選入下載檔確認一層模型可開啟。其餘匯出語意仍由既有 Node.js 測試覆蓋。 |
| 回應與隱私 | 50 ms 頁面心跳最大間隔 <2 秒；driver 等待上限 30 秒、全程硬上限 180 秒；沒有 crash、pageerror、worker error、非同來源或非 GET 網路請求。 |
| 讀取與記憶體 | 原生讀取統計與 worker range 統計相符；每個 realm 累計 ≤8 MiB、單次 ≤1 MiB；Linux Chromium 程序樹 RSS 相對初始增量 <768 MiB。 |

## 量測與限制

- Worker 模組由測試路由加上 FileReader／Blob 觀察器，讀取仍呼叫原生 API。主頁也觀察 FileReader、Blob.arrayBuffer／text／stream／bytes；超過預算會先拒絕，避免回歸直接配置完整權重。成功案例沒有檔案 I/O 模擬或延遲。這是帶保護的驗收，沒有刻意放行 1.25 GiB 完整配置。
- `initialLoadMs`／`recoveryLoadMs` 從自動點擊開檔開始，包含 Playwright FileChooser 指定路徑、Worker 啟動、metadata 載入、解析、索引與第一頁清單。`worker.stats.parseMs` 僅是 Worker 解析與索引，不是同一指標。
- 100 ms 取樣 Chromium 程序樹 RSS（含 Worker）及主頁 JS heap。Linux 使用此測試專屬啟動標記與 host `/proc` 的 PPid 找程序樹，避免 CDP 的 namespace PID 導致誤讀零值。找不到程序或 RSS 為零視為失敗。RSS 可能重複計算共享頁，取樣也可能漏掉極短尖峰；主頁 heap 不代表 Worker 的 heap。
- 非 Linux 保留 heap 觀察並明確記錄 RSS 驗證不可用；不能聲稱已完成同等的記憶體驗收。768 MiB 是此合成案例的回歸門檻，不是所有模型的產品記憶體保證。
- 本次受管執行環境在 CDP 關閉 Chromium 後，Playwright 的程序回收仍逾時。驗收報告記錄此限制；清理等待最多 5 秒，之後結束 driver。此處不把程序包裝器的回收逾時視為頁面當機或 UI 無回應。
- 沒有使用者真實大型模型，仍不能推算原始慢速案例的改善幅度、長時間使用的洩漏率、非零權重的磁碟吞吐量，或 Firefox／WebKit 的大檔能力。
