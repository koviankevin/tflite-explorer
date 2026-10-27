# 獨立模型編輯工作區

同一網站右上切換「探索模型／編輯模型」。探索圖上可先選取或框選原始 OP，再進入「編輯工作區」；沒有選取時從目前 block／subgraph 第一個 OP 開始。探索範圍、選取與視角保留，返回後可繼續搜尋。

點來源輸出端，再點目標輸入端即可接線；桌面也支援從輸出端拖到輸入端。點 OP 標題選取範本，以「在前方／後方複製新增」產生新的 OP；output tensor／SSA 名稱自動建立，沿用型別、shape、量化、參數與 custom options。第一版以既有 OP 為範本，沒有任意 OP catalog 或自動 shape inference。

右側顯示選取 OP 的 ports、變更預覽與接線問題。支援復原／重做、清除草稿、刪除和恢復 OP；TFLite 可明確將刪除後仍被使用的輸出提升為模型 inputs，或將新增 OP 輸出加入模型 outputs。型別／shape／量化不相容、同 block 後向接線會拒絕；跨 block 的完整 SSA／dominance 於匯出時驗證。MLIR 控制流程以藍色虛線顯示，基礎工作區保留 terminators、successors 與 regions。

空白草稿可開啟「進階單一 OP 表單」修改名稱、scalar options 或完整 generic IR。這項操作與工作區草稿分開產生候選；已有未匯出草稿時先保留於工作區。

工作區只載入最多 64 個原始 OP 的選取與直接相鄰範圍，連同新增 OP 最多 96 個、128 步操作、4,096 個值；ports 分頁顯示。可返回探索選取其他 OP，再按「加入探索選取」，保留原有草稿。模型和權重維持在本機 Worker／原始 File，進出工作區不重新讀取模型或繪製全模型。

「驗證並匯出模型」一次匯出整份修改模型，保留未改動 scopes／subgraphs；重新解析實際候選 bytes，通過 TFLite 結構或 MLIR 型別／SSA／控制流程／dominance 檢查後才開始下載。可直接「開啟修改結果」，或下載含變更預覽、介面及資料範圍的修改報告。尚未執行推論、數值等價或公司 compiler／custom runtime 語意驗證。

編輯草稿只保存在目前分頁記憶體，切換探索／編輯會保留；關閉或更換模型、離開頁面前會提示未匯出的變更。探索工作階段 JSON／自動草稿不包含模型編輯命令。匯出後請保存新模型與報告。

本機工作區 12 項測試通過，包含 21,004 OP 有限範圍、提前 metadata 限量、實際 TFLite weights／custom options、deferred MLIR 權重複製與報告。Hosted Chromium 的 19 項原生操作已通過，27 個模型 Worker 關閉；含點選／拖曳接線、自動輸出、復原／重做、TFLite 下載重開，以及分支／匯合／迴圈 custom MLIR 的 SSA、控制流程和 pattern 搜尋。

## 手機版面修正與環境診斷

初版 main [40555286507](https://github.com/koviankevin/tflite-explorer/actions/runs/40555286507) 的舊斷言雖通過，原始數據卻顯示 390×844 的標頭高達 592／752px；只檢查邊界不足以證明可用。後續改用獨立緊湊手機標頭，並要求工作區至少為視窗 65%、可見圖區至少 200px。

[強化版原生驗收 40556673985](https://github.com/koviankevin/tflite-explorer/actions/runs/40556673985) 通過；實際手機標頭 93px、工作區 721px、圖區約 371px，長名稱無超框，另保存原生截圖。1366×640 的工作區 534px、圖區 375px。匯出結果綁定精確版本，改變 signature 選項或另一份匯出取代結果時，不提供過期的「開啟修改結果」。

舊來源 [40556008400](https://github.com/koviankevin/tflite-explorer/actions/runs/40556008400) 停在 Azure apt 套件下載，25.9 MB 耗時 9min29s；取消的安裝不列為原生操作通過。[40558217127](https://github.com/koviankevin/tflite-explorer/actions/runs/40558217127) 使用官方 Ubuntu HTTPS 鏡像，保留原 signed apt／Playwright `--with-deps`、版本與必要操作後成功。安裝器限制在本 repository 的 Ubuntu 24.04 hosted CI，並納入 browser／site 相依指紋；不在使用者電腦開瀏覽器，也不略過驗收。

## 正式發布證據選擇

功能來源 `699dcafb99cc37e2b7c5596c73dc3eaa237c3e0d`，tree `117a9f133522ef2b5f4ecf1d40142749e2135091`。`release-evidence.json` 選定下列 run IDs；此選擇不代表尚在進行中的量測已通過。prepare 必須重新核對 provider digest、原始報告、source fingerprint、完整產物及乾淨來源重建。

| 關卡 | 選擇與實際狀態 |
| --- | --- |
| [core 40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445) | 86 個執行依賴 fingerprint 與既有成功 main 量測相同，沿用九筆核心量測；發布前重新認證 artifact |
| [browser 40558827707](https://github.com/koviankevin/tflite-explorer/actions/runs/40558827707) | [八輪實際工作區量測通過](results/preview12-main-browser-2026-10-28.json)，2 個原始 OP＋1 新 OP 的有限圖，完整模型 21,006 OP；24 個模型 Worker 終止、自然 URL 釋放與 bytes 比對均通過 |
| [contract 40558833474](https://github.com/koviankevin/tflite-explorer/actions/runs/40558833474) | [76 項通過](results/preview12-main-contract-2026-10-28.json)，零失敗／略過／取消；含安裝器限制與完整性拒絕案例 |
| [site 40558838921](https://github.com/koviankevin/tflite-explorer/actions/runs/40558838921) | [六種隔離切換](results/preview12-main-site-2026-10-28.json)與 [19 項原生 UI](results/preview12-main-ui-2026-10-28.json)成功，27 個模型 Worker 關閉 |

[四項 provider／fingerprint 核對](results/preview12-gates-review-2026-10-28.json)通過，原生 UI 另有 [provider digest／版面核對](results/preview12-main-ui-review-2026-10-28.json)。八輪前兩輪暖機後，RSS 漂移約 11.6 MiB、每輪斜率約 0.75 MiB、取樣峰值約 889.7 MiB，維持原始門檻與 60 秒自然 URL 壽命；完整輸出每輪 SHA-256 一致，7 段共 1,342,177,328 bytes 權重／options 逐段比對成功。正式網站與固定 Release 尚待本次受控發布完成。結構檢查、合成資料 bytes 比對與有限八輪量測不代表公司 compiler／runtime、數值等價、其他瀏覽器或數小時操作已驗證；商品等級未完成項目仍見 [工作清單](product-readiness.md)。
