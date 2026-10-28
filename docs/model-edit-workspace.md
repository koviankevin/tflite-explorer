# 獨立模型編輯工作區

同一網站右上切換「探索模型／編輯模型」。探索圖上可先選取或框選原始 OP，再進入「編輯工作區」；沒有選取時從目前 block／subgraph 第一個 OP 開始。探索範圍、選取與視角保留，返回後可繼續搜尋。

滑鼠拖曳空白處可平移，滾輪以游標位置為中心縮放；Alt＋拖曳或中鍵可從 OP 上平移，保留選取與草稿。點來源「接出」，再點目標「接入」即可接線；接線中顯示來源、相容／不相容提示與取消按鈕；桌面也支援從輸出端拖到輸入端。點 OP 標題選取範本，以「在前方／後方複製新增」產生新的 OP；output tensor／SSA 名稱自動建立，沿用型別、shape、量化、參數與 custom options。可從現有 OP 複製，包括 custom OP。新增的 TFLite OP 可在右側展開「改為其他 TFLite OP」，從內建 catalog 選型別、版本、介面數量與 schema 參數；output tensor 自動建立，型別／shape／量化參考原始 tensor，沒有自動 shape inference。CUSTOM 的 code／options 請從現有 custom OP 複製。

右側顯示選取 OP 的 ports、變更預覽與接線問題。支援復原／重做、清除草稿、刪除和恢復 OP；TFLite 可明確將刪除後仍被使用的輸出提升為模型 inputs，或將新增 OP 輸出加入模型 outputs。型別／shape／量化不相容、同 block 後向接線會拒絕；跨 block 的完整 SSA／dominance 於匯出時驗證。MLIR 控制流程以藍色虛線顯示，基礎工作區保留 terminators、successors 與 regions。

空白草稿可開啟「進階單一 OP 表單」修改名稱、scalar options 或完整 generic IR。這項操作與工作區草稿分開產生候選；已有未匯出草稿時先保留於工作區。

工作區只載入最多 64 個原始 OP 的選取與直接相鄰範圍，連同新增 OP 最多 96 個、128 步操作、4,096 個值；ports 分頁顯示。可返回探索選取其他 OP，再回到編輯模式會自動同步新選取，也可按「同步圖上選取」；原有接線與復原／重做歷史保留。模型和權重維持在本機 Worker／原始 File，進出工作區不重新讀取模型或繪製全模型。

「驗證並匯出模型」一次匯出整份修改模型，保留未改動 scopes／subgraphs；重新解析實際候選 bytes，通過 TFLite 結構或 MLIR 型別／SSA／控制流程／dominance 檢查後才開始下載。可直接「開啟修改結果」，或下載含變更預覽、介面及資料範圍的修改報告。尚未執行推論、數值等價或公司 compiler／custom runtime 語意驗證。

使用「儲存編輯草稿」下載 JSON；換電腦或瀏覽器後按右上「匯入草稿」，再選取原模型。保存命令、接線、復原／重做、字級與視角；不包含原模型或權重。首次儲存／恢復會以 1 MiB 區塊讀完整原檔，核對版本化 SHA-256 chunk chain（不是標準整檔 SHA-256），可取消。同大小、同名但權重不同的模型也會拒絕；檔名改變但 bytes 相同可恢復。草稿上限 256 KiB、128 步命令。探索工作階段 JSON／自動草稿另行保存，不包含模型編輯命令。

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

[四項 provider／fingerprint 核對](results/preview12-gates-review-2026-10-28.json)通過，原生 UI 另有 [provider digest／版面核對](results/preview12-main-ui-review-2026-10-28.json)。八輪前兩輪暖機後，RSS 漂移約 11.6 MiB、每輪斜率約 0.75 MiB、取樣峰值約 889.7 MiB，維持原始門檻與 60 秒自然 URL 壽命；完整輸出每輪 SHA-256 一致，7 段共 1,342,177,328 bytes 權重／options 逐段比對成功。正式網站與固定 Release 已完成以下受控發布及獨立核對。結構檢查、合成資料 bytes 比對與有限八輪量測不代表公司 compiler／runtime、數值等價、其他瀏覽器或數小時操作已驗證；商品等級未完成項目仍見 [工作清單](product-readiness.md)。

## 已發布 preview.12

- [正式網站](https://koviankevin.github.io/tflite-explorer/)／[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.12)，build `52d46a06925bd391`。
- 固定來源 `2bfacb746476b34f17e43f32a677616b443ffb9f`，tree `e1bbe58f67b8e0924409b81d57103d1ee78ff723`；本次交付後僅補說明文件，不改寫已發布產物。
- [準備 40561368107](https://github.com/koviankevin/tflite-explorer/actions/runs/40561368107)及 [獨立準備核對](results/preview12-prepared-review-2026-10-28.json)通過，才以精確 build／site ID 送出 [發布 40561724699](https://github.com/koviankevin/tflite-explorer/actions/runs/40561724699)。prepare／deploy／verify_live／release 全部成功。
- [正式 HTTP 報告](results/preview12-live-http-2026-10-28.json)：1,269 檔實際 SHA／MIME 與候選一致。Site ID `b686d4a33adb2b5f310965bd18b99d99282c4d325915666458c016c3cdb049fc`，manifest SHA-256 `6127a0728c615ef323f5d57122a8e1875ba87b2ba58f27bac9b9feda8f3549a6`；永久 legacy root preview.7 保留，另外保留 preview.11／preview.10。
- [正式原生報告](results/preview12-live-ui-2026-10-28.json)：19 項操作、11 份實際改模匯出／報告、27 個模型 Worker 關閉；[手機長名稱截圖](results/preview12-live-mobile-2026-10-28.png)與已檢視的合格版面 PNG bytes 完全相同。TFLite 權重／options 實際比對通過；兩份新增 MLIR fixture 沒有權重，bytes 比對標為 not-applicable。
- [最終獨立核對](results/preview12-publication-review-2026-10-28.json)：四份 Release 資產實際下載，逐份 bytes／SHA 均與原準備包相同。ZIP `model-lens-public-0.2.0-preview.12-52d46a06925bd391.zip` 為 29,607,972 bytes，SHA-256 `0f25e9d5424cdc42425106eefd37f3649c744e35900e5b75c0eef0373af25bac`。Deployment `7367213646`／job `122392578180`／attempt 1 與整站身分、獨立 root SHA `d483b9aabe56535785620f1d4506e50ca6c87b226f0b8d15272d96306b5cd7c0` 一致。

## 補齊權重與驗證範圍

新增 TFLite OP 的輸入可沿用現有 tensor，或以原始 tensor 的 dtype、shape 與量化參數產生亂數權重。固定 seed、範圍和 xorshift32-v1 演算法隨草稿保存，重開可產生相同 bytes；不隨機修改 stride、padding、axis 等結構參數。支援已知 shape 的數值／boolean dense tensor；不支援動態 shape、sparse、字串／complex／float16。整數／量化範圍使用 raw integer 值；單個 tensor 16 MiB、整次匯出 32 MiB，超出前拒絕配置。

匯出檢查完整索引、producer 順序、介面／signature、subgraph 引用，檢查新 OP 的參數型別／列舉／正值規則、port 數量，以及已實作的二元運算 dtype／broadcast、reshape 元素數。這不是完整 TFLite kernel verifier：卷積／量化運算等其他 shape 與數值規則、版本支援、custom kernel、推論結果仍須以目標 runtime 驗證；網站明示此範圍。未知 runtime 語意不標為已驗證。

## preview.13 發布候選

新增可攜編輯草稿、既有 OP 複製／相容範本切換、TFLite builtin catalog、固定 seed 亂數權重，以及編輯圖拖曳平移／游標中心滾輪縮放。修正既有 2 OP 草稿忽略後來 3 OP 選取、參數欄位尚未掛載便初始化導致節點重疊，以及恢復視角尚未套用便顯示就緒的問題。接線提示保留固定空間，不擠動圖形。

功能 PR #34 的 [原生驗收 40610077786](https://github.com/koviankevin/tflite-explorer/actions/runs/40610077786) 21 項成功、34 個模型 Worker 關閉；[原始報告](results/preview13-pr-ui-2026-10-28.json)、[provider／來源核對](results/preview13-pr-ui-review-2026-10-28.json)及 [32px 手機截圖](results/preview13-pr-mobile-2026-10-28.png)已保存。原生覆蓋新分頁草稿恢復、錯誤完整檔案指紋拒絕、redo／字級／縮放、原始三 OP 同步、MUL options、亂數權重 bytes、原始 weights／custom options，以及 MLIR 迴圈 SSA 匯出重開。1366×640 圖區約 294.5px、390×844 約 371.4px，長名稱無超框。

合併功能來源 `f3374ed2ac9fd1de5ef7cef03c14955592a42229`，tree `22b717361bfa910b6bc9bde0233f75ffa5de0185`，與合格 PR head 的完整 tree 相同。發布選擇如下；選定 run 不代表尚未完成的關卡已通過，prepare 必須重新認證所有 artifact、source fingerprint 及乾淨來源。

| 關卡 | 選定證據 |
| --- | --- |
| core | [40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445)，86 個執行相依 fingerprint 不變，可沿用既有成功 main 量測 |
| browser | [40610420461](https://github.com/koviankevin/tflite-explorer/actions/runs/40610420461)，八輪實體大模型編輯／下載／重開／關閉，等待完成後核對 |
| contract | [40610424400](https://github.com/koviankevin/tflite-explorer/actions/runs/40610424400)，發布合約 main 手動入口 |
| site | [40610428484](https://github.com/koviankevin/tflite-explorer/actions/runs/40610428484)，隔離版本切換與同份來源原生操作 |

公司 compiler／runtime、完整 TFLite kernel shape／量化語意、推論結果、其他瀏覽器及數小時操作仍未驗證；商品等級未完成項目不因本次功能而標為完成。
