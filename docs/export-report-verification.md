# 匯出報告驗收（2026-10-27）

版本：`0.2.0-preview.2`。本機 Windows、Node.js `v24.19.0`、實際 Edge 瀏覽器；發布來源及檔案雜湊以正式站 `release.json`／`release-manifest.json` 為準。以下均為公開／合成模型，沒有公司模型或內部 runtime。

## 功能與負例

- 選測 TFLite 匯出、inline／external／large custom options、MLIR SSA／CFG slice、deferred dense／resources：51 項通過。
- 補測 CFG／dominance、結構對照、舊 pattern 和反覆匯出：57 項通過。後續只調整報告資料與包裝，沿用不受影響的模型文字／bytes 回歸結果。
- 最終報告測試涵蓋實際檔案比對、來源或輸出 options 被修改、超界／重疊 ranges、錯誤大小、巢狀 OP 對照、50,000 OP 報告預算及 CLI 退出碼。
- 本機 IREE 所附 native `iree-opt.exe` 以 `--allow-unregistered-dialect` 通過 generic MLIR 正例；刻意改動 SSA 定義、保留相同檔案大小及 payload bytes 的負例，bytes 比對仍通過，但 compiler 必須失敗、CLI 必須非零退出。這證明 bytes 與 SSA／語意檢查分開，不將其中一個結果冒充另一個。
- 公開／內網建置、真實 module Worker adapter、ZIP CRC、manifest、私有包禁止公開等既有發布測試另驗證；部署 ZIP 包含 `tools/verify-export.mjs` 及說明，可在無 Git checkout 的解壓目錄使用。

## 實體大檔

從既有實體來源建立新的子模型及報告，再對磁碟上的來源／輸出串流比對、重新解析匯出檔；未把整份模型轉成字串或 ArrayBuffer。

| 來源 | OP 數 | 匯出 bytes | 報告 bytes | 報告產生時間 | 比對原始資料 bytes | 本輪 Node process peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TFLite 1,349,965,216 bytes | 21,005 | 1,345,937,304 | 4,905 | 約 3.3 ms | 1,342,177,312 | 約 412 MiB |
| MLIR 2,684,355,495 bytes | 10（大型 dense） | 2,684,362,324 | 7,389 | 約 0.8 ms | 2,684,354,564 | 約 354 MiB |

TFLite 子圖為四個 OP，包含 custom op；全部必要原始 buffers／options 的 ranges 比對成功。MLIR 包含分支、匯合、迴圈及 custom op；匯出重開後 SSA／dominance 通過，既有 pattern 找到一次。兩者的完整輸出 SHA-256 另存驗證收據。時間為單次量測；Node RSS 包含解析、匯出和比對，不等於整個瀏覽器或 Worker 記憶體，也不是硬體無關效能承諾。未對 2.5 GiB MLIR 執行 native compiler 或 runtime。

## 瀏覽器流程

實際 File chooser 開啟 custom TFLite，選取 custom op、下載子模型與 JSON 報告，另以 CLI 驗證下載的權重／options。實際開啟六 block 的分支／迴圈 MLIR，在五個 blocks 選取五個 OP、匯出與下載報告；原生 compiler 驗證實際下載檔，重開後沿用原 pattern，結果一次且無重複。報告使用 Escape 關閉後保留圈選，關閉模型後清除報告。

版面驗收包含 1366×768 筆電、390×844 CSS viewport（頁面捲軸後 client width 375px）、32px 圖字。報告在窄畫面轉成直式欄位並於視窗內捲動，沒有橫向文件溢位。原圖圈選／縮放不因報告資料生成而重畫；未宣稱實機手機或其他引擎均已驗收。

正式部署後另核對發布 manifest 與實際靜態檔、正式站實際匯出／下載／重開。公司 dialect／compiler／custom runtime 與真實模型仍待內網驗收；商品等級完整清單持續保留於 [product-readiness.md](product-readiness.md)。
