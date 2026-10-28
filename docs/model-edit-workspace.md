# TFLite 模型編輯工作區

## Preview.15 變更（部署驗收中）

- 已儲存 pattern 增加刪除／復原；刪除不改目前查詢，IndexedDB 交易核對所選版本，舊分頁的儲存不得復活已刪項目；同名衝突的復原保留雙方內容。
- 實際模型僅保留頂端「編輯模型」入口；進階 OP 參數位於編輯工作區，依工作區選取的原始 OP 開啟，不沿用探索側欄的舊選取。
- 模型與匯出結果各開本機模型分頁。背景只保留不可變 File、有限工作階段與編輯命令；切回重新解析、驗證探索工作階段並重建原始編輯範圍／replay history。內部切換不重新計算整個檔案的權重指紋，依同一個 File 物件繫結；外部草稿匯入仍核對完整指紋。
- 分頁切換保留選取、視角與編輯 Undo／Redo；× 關閉個別模型，「關閉全部」釋放全部來源參照。未匯出草稿的提醒含背景分頁；取消載入恢復原模型。網站關閉後需重新選檔，以已下載的工作階段／編輯草稿接續，並不保存模型本體。

本次 Node 選測已通過；GitHub Linux 的原生分頁切換、刪除／復原、手機／14 吋版面、四項發布關卡及正式部署紀錄完成後補在本節。歷史成功紀錄不代表本次候選已發布。

目前實際模型編輯僅支援 TFLite；MLIR 保留探索、搜尋、pattern 編輯及局部匯出。下方 preview.12／preview.13 的 MLIR 實際編輯屬歷史驗收，從 preview.14 起網站不再提供，舊 MLIR 編輯草稿會明確拒絕，不會套用。


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
| browser | [40610420461](https://github.com/koviankevin/tflite-explorer/actions/runs/40610420461)，八輪實體大模型編輯／下載／重開／關閉已通過，provider／來源指紋另行核對 |
| contract | [40610424400](https://github.com/koviankevin/tflite-explorer/actions/runs/40610424400)，發布合約 main 手動入口 76 項成功，零失敗／略過／取消 |
| site | [40610428484](https://github.com/koviankevin/tflite-explorer/actions/runs/40610428484)，六種隔離版本切換與 21 項原生操作成功，34 模型 Worker 關閉 |

公司 compiler／runtime、完整 TFLite kernel shape／量化語意、推論結果、其他瀏覽器及數小時操作仍未驗證；商品等級未完成項目不因本次功能而標為完成。

[四項關卡獨立核對](results/preview13-gates-review-2026-10-28.json)通過，所有測試來源相依 fingerprint 與候選一致。八輪實體模型報告見 [完整原始紀錄](results/preview13-main-browser-2026-10-28.json)及 [provider 核對](results/preview13-main-browser-review-2026-10-28.json)：24 模型 Worker 終止，60 秒自然 Blob URL 釋放、每 realm 1 MiB／累計 16 MiB 原有讀取限制不變；原檔 21,005 OP、編輯範圍 2 原始 OP＋1 複製 OP，完整候選 21,006 OP。暖機後 RSS drift 13,639,680 bytes、每輪斜率約 1.96 MiB，取樣峰值 929,910,784 bytes。每輪完整輸出 1,350,445,736 bytes、SHA-256 `76abf0ba8d8917882d9deb95f27cbc08188aac74216e3589aa7ce37794fdd045`，7 段共 1,342,177,328 bytes 權重／custom options 比對一致。這個八輪量測沒有執行草稿完整檔案 fingerprint；其分段讀取、完整 bytes 覆蓋與取消另有 Node 測試和小型原生草稿驗收，不宣稱已量測 1 GiB 草稿雜湊效能。

[Main 原生驗收](results/preview13-main-ui-2026-10-28.json)及 [provider 核對](results/preview13-main-ui-review-2026-10-28.json)成功。接下來 prepare 與正式發布仍需在固定乾淨來源重新核對完整產物；本段尚不宣稱正式站已切換。

## 已發布 preview.13

- [正式網站](https://koviankevin.github.io/tflite-explorer/)／[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.13)，build `c659375441a01f98`。
- 固定來源 `ab3db8050c4c3db096793f9bedf0890ae96463a3`、tree `5a2a2832ac7eb762b4edd048a4d57ebc742cd56f`；交付後只有說明文件變更，不改寫已發布產物。
- [準備 40611975862](https://github.com/koviankevin/tflite-explorer/actions/runs/40611975862)與 [獨立準備核對](results/preview13-prepared-review-2026-10-28.json)通過，才以精確 build／site ID 送出 [發布 40612246970](https://github.com/koviankevin/tflite-explorer/actions/runs/40612246970)。prepare／deploy／verify_live／release 全部成功。
- [正式 HTTP 報告](results/preview13-live-http-2026-10-28.json)逐檔核對全部 1,277 檔 SHA／MIME。Site ID `31bfb4137e3c8ab7fa23feee39e8a02a6b2417dea3118cd54e798aad62d34487`，manifest SHA-256 `07dbb60173d1c4a68efabf477a59c2f52757d811af440e95ed11417981e3557a`；保留永久 legacy root preview.7，以及 preview.12／preview.11。
- [正式原生報告](results/preview13-live-ui-2026-10-28.json)21 項通過、34 個模型 Worker 全關閉。含實際三 OP 選取同步、複製／接線、MUL options、seed 權重、草稿下載／重新選原模型與指紋負例、redo／視角恢復、原生 Alt 拖曳／滾輪縮放，以及 TFLite／MLIR 下載重開。原有 pattern 搜尋與分支／匯合／迴圈 SSA／控制流程亦通過。
- [正式手機 PNG](results/preview13-live-mobile-2026-10-28.png)已檢視，與 PR 合格的 32px 長名稱／分支圖截圖 bytes 完全相同，SHA-256 `1a92055e9ecb41507ca7b8188f81e96caaae7561efc17138d20d8044ed551fbc`。
- [最終獨立核對](results/preview13-publication-review-2026-10-28.json)成功。四份 Release 資產實際下載，bytes／SHA 均和原準備包一致。ZIP `model-lens-public-0.2.0-preview.13-c659375441a01f98.zip` 為 29,670,840 bytes、264 個核心檔案，SHA-256 `0a9b720b476e70bc3f0a660c3a6d36220e0c29008bd2f1f6e2bc8f041f4ec643`。Deployment `7374318664`／job `122566585918`／attempt 1，正式 root SHA-256 `740f037df930d60eec3d6ee13992251c81fd2d7f390b5700d221ccbd0b6834d1` 與整站身分一致。

驗收涵蓋 Hosted Chromium 與合成模型的有限八輪量測，尚未證明公司 runtime、完整 kernel／量化語意、其他瀏覽器、1 GiB 草稿 fingerprint 的實測效能或數小時使用；商品等級工作清單仍保留這些項目。

## preview.14 候選：僅 TFLite 編輯與控制流程回歸

所有實際模型編輯入口依格式隱藏／停用，Worker 在載入編輯模組、計算完整檔案指紋或修改 session 前拒絕 MLIR 編輯 RPC；舊 MLIR 編輯草稿於匯入時立即拒絕。MLIR 探索、pattern 編輯及局部匯出維持可用。

新增合成 TFLite：主圖含 IF／WHILE、多輸出 custom OP 與匯合，另有 then／else、condition、body 共五個子圖。驗收主圖與迴圈 body 的 32px、原生滾輪／平移後端點命中、拖曳／點選接線、草稿下載→重新選原模型→恢復視角→繼續接線→復原／重做，再匯出完整 TFLite、驗證所有子圖、控制引用、權重／custom options、重新開啟與 pattern 搜尋。custom kernel 實作未提供，結構檢查不代表推論或 runtime 語意已驗證。

功能來源 `938a4a67c9547bbddb2b13e0136bdfd124608eb4`，tree `7df3a6a3010c0e32940841d1e50c9df6de703e0d`，與合格 PR head 完整 tree 相同。[PR 原生驗收 40614544211](https://github.com/koviankevin/tflite-explorer/actions/runs/40614544211) 19 項成功、27 模型 Worker 關閉；見 [原始報告](results/preview14-pr-ui-2026-10-28.json)、[provider／來源核對](results/preview14-pr-ui-review-2026-10-28.json)及已檢視的 [32px 手機長名稱 PNG](results/preview14-pr-mobile-2026-10-28.png)。主圖與 WHILE body 的兩份完整輸出均重開為 16 OP／5 子圖；每份七段權重／custom options 比對成功，舊 MLIR 編輯草稿拒絕，MLIR 探索／搜尋及原有 pattern／局部匯出驗收仍成功。

發布選擇如下，尚在進行的關卡不能視為已通過；prepare 必須重新認證 artifact、來源與相依 fingerprint。

| 關卡 | 選定 run |
| --- | --- |
| core | [40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445)，86 個執行相依 fingerprint 不變，沿用成功 main 量測 |
| browser | [40614829170](https://github.com/koviankevin/tflite-explorer/actions/runs/40614829170)，八輪實體大模型編輯／重開通過，provider／source fingerprint 已核對 |
| contract | [40614834044](https://github.com/koviankevin/tflite-explorer/actions/runs/40614834044)，main 發布合約 76 項全通過 |
| site | [40614838124](https://github.com/koviankevin/tflite-explorer/actions/runs/40614838124)，六種版本切換、19 項原生操作與 27 模型 Worker 終止通過 |

[四項 main 關卡獨立核對](results/preview14-gates-review-2026-10-28.json)成功。實體八輪 [原始報告](results/preview14-main-browser-2026-10-28.json)與 [provider／相依核對](results/preview14-main-browser-review-2026-10-28.json)：1.25 GiB、21,005 OP，編輯範圍 2 原始 OP＋1 複製 OP，完整候選 21,006 OP。24 模型 Worker 終止，原有 60 秒自然 URL 釋放及讀取／記憶體門檻保持；暖機後 RSS drift 10,653,696 bytes、斜率約 0.99 MiB／輪、取樣峰值 932,827,136 bytes。完整輸出每輪 SHA-256 `76abf0ba8d8917882d9deb95f27cbc08188aac74216e3589aa7ce37794fdd045`，7 段共 1,342,177,328 bytes 權重／custom options 一致。

[Main 原生報告](results/preview14-main-ui-2026-10-28.json)及 [provider／來源核對](results/preview14-main-ui-review-2026-10-28.json)亦通過：19 項操作、27 模型 Worker 全關閉；含主圖／WHILE body 的 32px 變換後精確接線、草稿續改、完整五子圖匯出、重開及唯一 pattern，以及 MLIR 編輯入口／舊草稿拒絕。兩份控制模型每份七段 bytes 比對通過，手機圖區約 371.4px、長名稱無超框。公司 runtime、推論、其他瀏覽器、超長時間操作及 1 GiB 草稿 fingerprint 實測仍不宣稱已驗證；上述實體八輪未執行完整檔案 fingerprint。

目前尚待固定乾淨來源 prepare 及正式部署核對；成功 main 關卡不代表已切換正式網站。

## 已發布 preview.14

- [正式網站](https://koviankevin.github.io/tflite-explorer/)／[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.14)，build `d182aeed5d8f2901`。實際編輯僅 TFLite；MLIR 保留探索、搜尋、pattern 及局部匯出。上方「編輯模型」與圖上的「編輯工作區」目前都會進入同一工作區，後者是快捷入口。
- 固定來源 `5fc7d8e9aaef3e5652fdd3df172ec799ca1aa6f2`、tree `ada971b66cf7b380e2aab73a1927c57d82ceb015`；交付後只有說明文件改動，不改寫已發布產物。
- [準備 40616526933](https://github.com/koviankevin/tflite-explorer/actions/runs/40616526933)及 [獨立核對](results/preview14-prepared-review-2026-10-28.json)成功後，以精確 build／site ID 執行 [發布 40616867709](https://github.com/koviankevin/tflite-explorer/actions/runs/40616867709)。prepare／deploy／verify_live／release 全部成功。
- [正式 HTTP 核對](results/preview14-live-http-2026-10-28.json)涵蓋全部 1,286 檔 SHA／MIME。Site ID `345e8ce8088349f36ed2da4fd106081ee132c19831b30b8dcda2360fadfbc10c`、manifest SHA-256 `72255dcd281b51d14629d13d12eec13f002db8c2dc482e36b3817a82edd1d03d`；保留永久 preview.7 legacy root，另保留 preview.13／preview.12。
- [正式原生報告](results/preview14-live-ui-2026-10-28.json)19 項成功、27 模型 Worker 全關閉。主圖 IF／WHILE／多輸出 custom 與 WHILE body 在 32px 下經滾輪縮放、Alt 平移後精確命中端點，完成拖曳／點選接線、草稿下載、重選原模型恢復字級／縮放／平移、繼續改線、復原／重做、完整五子圖匯出重開，各找到唯一 pattern。IF `[1,2]`、WHILE `[3,4]` 引用保留，兩份輸出各七段權重／custom options 比對成功。MLIR 實際編輯入口與舊編輯草稿拒絕，探索／搜尋仍正常；既有 MLIR pattern／局部匯出亦通過。
- [正式 32px 手機圖](results/preview14-live-mobile-2026-10-28.png)已檢視，與合格 PR PNG bytes 完全相同，SHA-256 `9b43a6bbbc19dd71c82b476d00abb3197963f54da23f032f2cc49dde976d37d3`。390×844 的圖區約 371.4px，長 custom 名稱無超框。
- [最終獨立核對](results/preview14-publication-review-2026-10-28.json)通過：四份實際 Release 下載與原準備包逐份 bytes／SHA 一致，ZIP `model-lens-public-0.2.0-preview.14-d182aeed5d8f2901.zip` 為 29,673,231 bytes／265 核心檔案、SHA-256 `00ed6281950fec10fbc1c3ad2a1d2022dc292a95d00fa718c4425df62f6f6684`。Deployment `7374957588`／job `122581513524`／attempt 1 與獨立 root SHA-256 `f26b36069edd87380df5f3e84907834636c92319969b2205d2580c769f48e8dc` 一致。

上述是 Hosted Chromium、合成模型及有限八輪的結構／bytes／操作驗證，未執行 custom runtime、推論或完整 kernel verifier；其他瀏覽器、數小時使用與 1 GiB 草稿 fingerprint 效能仍未宣稱完成。
