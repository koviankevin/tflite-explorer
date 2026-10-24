# 1.25 GiB Chromium：條件與 SVG 工作階段驗收

2026-10-25（台北時間）實測。基準為 GitHub main `36211521c418948d612d576fd2515af04512f469`，含筆電版面調整；當時沒有開啟中的 PR 重複本項工作。既有 `pattern-conditions.test.mjs`、`workspace.test.mjs` 已涵蓋模組語意，既有 Edge 紀錄涵蓋小型 UI 及 Node range reader；此處只補原生 Chromium 大檔整合缺口。

## 可核對來源

- 受測提交：`754f7cad8accf7a104673606f710c1de0995ea94`。
- 受測 Git tree：`8e7a1e4ba2462e96c07f6902f784d697e1f5d219`；`sourceDirty=false`。之後僅提交文件、原始報告與 log。
- [原始 JSON](../test/browser/results/conditions-workspace-2026-10-25.json)、[完整執行 log](../test/browser/results/conditions-workspace-2026-10-25.log)、[Node 測試 log](../test/browser/results/conditions-workspace-node-2026-10-25.log)。
- 命令：`LARGE_FILE_BASE_COMMIT=36211521c418948d612d576fd2515af04512f469 npm run test:large-browser`。
- Ubuntu 24.04.3 x64、Node.js v24.22.1、Playwright 1.56.1、Chromium 141.0.7390.37，headless、1440×900；使用筆電版可見的「尋找模式」。
- 這是本機執行結果。`4c78ce9`／GitHub run `40081739220` 的 11 項成功不作為新版條件／工作階段證據；尚無此來源的 GitHub 大檔 run。

## 新增驗收

沿用 `makeLargeFixture({graphCount:2,repeats:1000})`，1,343,235,364 bytes、6,002 OP；沒有建立 Node.js 巨型 Buffer，也不讀取／上傳使用者模型。

1. 經可見 UI 設定 N2 output #0 的 shape `[1,*]` AND dtype `float32`，得到 2,000 筆、每頁 100 筆；點第 101 筆顯示有界 SVG，保存的實體匹配路徑為 `[300,301,302]`。
2. 新增衝突 dtype `int8`、錯誤 shape `[2,*]`、不存在的 output port #1、缺少的 attribute，各得 0 筆；每次移除條件、按尋找模式後均回到 2,000 筆。原生 Worker 額外讀取 0 bytes。
3. 儲存含條件 pattern、下載 v3 JSON、真正選檔匯入、驗證相同 pattern 略過；清除目前條件後重新套用 library。頁面重新整理後獨立選擇 library，確認條件仍在，再進行工作階段恢復。
4. 下載 2,710 bytes 的工作階段 JSON，核對條件、精確匹配、scope、兩個 OP 選取、32px、320px 左欄、方向與 SVG camera。關閉模型並確認真實 Worker close，再匯入 JSON、重新選入原大檔。另重新整理頁面，透過「恢復上次儲存」重新選檔恢復。兩條路徑都再次下載並核對保存狀態、相同 zoom、SVG 錨點 <3px 誤差。
5. 以同一 fixture 的小型 header 修改一個 tensor dtype（FLOAT32→INT8），保留原始長度與 6,002 OP；真正選入這個有效大檔，確認結構指紋拒絕、未套用舊選取。再匯入原工作階段並選取原大檔，完整恢復。此案例無法只靠 byte length 檢查通過。

原有原生 File API、分段讀取、索引、局部圖、pattern 分頁、tensor metadata、子模型下載與重開、取消 Worker、無效大檔、同頁恢復及小型 MLIR 切換均保留。新增流程結束時清除測試選取，避免污染既有單 OP 匯出案例。重新整理前的 audit 另保存，最終檢查所有 realms 的 I/O、心跳與被替換 model Worker 終止狀態。

## 本次結果與資源

| 項目 | 實測 |
| --- | --- |
| 大型整合驗收 | 18 項通過，0 失敗 |
| `npm test` | 243 項：208 通過、35 條件式跳過、0 失敗 |
| 初次選檔至索引清單 | 374.63 ms |
| 取消／錯誤後重新載入 | 234.47 ms |
| 6 次大型模型開啟 | 每次原生讀取 1,189,156 bytes，與 range reader 統計相符 |
| 條件搜尋與工作階段指紋／保存 | 額外原生讀檔 0 bytes |
| Chromium RSS | 基準 427.32 MiB，峰值 655.26 MiB，增量 227.94 MiB，低於 768 MiB 門檻 |
| 主頁 JS heap 峰值 | 9.93 MiB；不代表 Worker heap |
| 最大 50 ms 心跳間隔 | 124.9 ms，低於 2 秒門檻 |
| crash／pageerror／Worker error／外傳請求 | 0 |

## 限制與執行隔離

首次嘗試因當下 cgroup 可用記憶體約 1.85 GiB，低於既有 3 GiB 門檻而停止，沒有啟動瀏覽器。保留 [失敗 preflight JSON](../test/browser/results/conditions-workspace-preflight-2026-10-25.json)。資源釋放後重跑，最終可用約 4.23 GiB，沒有降低門檻或停用監控。

一般 Node 測試的 35 個跳過項目為現有可選 MLIR compiler／外部檔案案例，不能聲稱已驗證。沒有真實訓練模型、非零大型權重、冷磁碟測試、Firefox／WebKit 大檔、長期洩漏測試或完整 Canvas／跨 block 工作階段大檔驗收。工作階段以 JSON 保存 SVG camera，並非把模型或權重包入 SVG；結構指紋也不是權重內容驗證。

稀疏權重、每次 1 MiB／每 realm 8 MiB 的原生讀取 guard、100 ms RSS 取樣及取消 metadata gate 的既有限制仍適用。這次 CDP 關閉後的 Browser.close 程序回收仍逾時 5 秒，已如實寫入報告 limitations；頁面驗收、資源預算與關閉前的 Worker 生命週期斷言均已完成。這不是對 host 程序回收正常的成功宣稱。

`.github/workflows/large-browser.yml` 保持只有 `workflow_dispatch`；一般 PR CI、build 與 Pages 流程不建立巨型檔。新增 helper 僅由獨立大型 runner 呼叫。
