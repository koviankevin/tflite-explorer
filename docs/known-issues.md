# 公開版已知問題與限制

目前固定版本為 [preview.31](preview31.md#發布狀態)／build `3061076374227547`。本頁保留公開版仍待處理的功能界線與驗收缺口；內網及私有 dialect 依使用者指示自行修改。

## 待查：一次啟動逾時的根因

Preview.22 曾有一次正式驗證在 30 秒內等不到開檔控制項就緒。[原始失敗](results/preview22-startup-failure-review-2026-10-29.json)保留；當時缺少請求級診斷，無法確定成因。之後相同應用的診斷、經授權的一次失敗驗證補跑，以及 preview.23 的正式驗證均成功；沒有把後續成功當成已找到或修好根因。

目前已加入有上限的靜態請求／console 診斷，若再發生可追查來源；尚未取得能穩定重現該次逾時的條件。詳細證據見 [啟動診斷與正式交付](desktop-physical.md)。

## 功能限制

**輸入視窗與草稿 Worker 清理已在 preview.31 交付**：解除確認回呼、請求身分隔離及開窗失敗清理；同一輪取消不再建立指紋 Worker，終止前清除回呼。正式站 14 次一般與 24 次 IO 生命週期輸入清理、候選 Firefox 指紋 Worker 四次 native close 均核對，見[正式交付](preview31.md#發布狀態)及[原始診斷](runtime-input-cleanup.md)。這些具體缺口已修正；有限量測不等於所有物件、所有負載永不保留。

組合模型目前限同一 TFLite／subgraph，暫不搬移控制流程或有狀態 OP；大型組合已通過 [Hosted Chromium 實體八輪](composition-lifecycle.md#修正後的實體八輪)；數小時組合與其他引擎尚待驗收，見 [功能與驗收範圍](model-composition.md)。

- **新增 OP 的完整語意**：已實作結構、接線、資料長度及部分 shape／型別規則；無法自動推導的 OP 沿用明確參考 tensor。量化規則與任意 kernel 組合仍需 runtime 檢查。亂數保證所選 dtype 的數值範圍，不保證索引、token、權重或整個模型的運算語意正確。見 [模型編輯](model-edit-workspace.md)及[型別亂數](typed-random.md)。
- **手動 interpreter 的規模與支援範圍**：CPU WASM 限 128 MiB 模型、16 MiB IO、30 秒執行，另有 512 MiB 提前配置估算；此估算不含所有 kernel scratch。公開 runtime 不含任意 custom kernels，動態／未知 shape、部分 dtype 及不明確的 signature 對應會列為未能驗證。大型模型仍可探索、編輯與匯出。見 [完整限制](tflite-runtime.md)。
- **大型 MLIR 的完整驗證**：dense 大型權重保留原文與 byte ranges，不逐值解析或核對元素數量；外部 resource 檔選取尚未支援。網站的結構、SSA／dominance 檢查也不代替各 dialect 自訂 verifier。見 [大型 MLIR](mlir-large-files.md)。
- **MLIR 編輯與 pattern 範圍**：實際 OP 編輯僅支援 TFLite。MLIR 支援文字 generic 探索、搜尋、圈選及局部匯出；跨 block pattern 需位於同一 function／region，不能任意跨 function 或巢狀 region。見 [公開版指引](public-acceptance.md)。

## 尚待補齊的公開驗收

[原生入口前置探測](runtime-module-cache.md#commit-導頁仍無法讀取原生頁面)在 commit 導頁後仍只回報 about:blank，尚無 DOM URI 或物件分類；本輪停在零模型、零 Measure，沒有重跑原 RSS。接著改用有程序身分／pidfd／handler guard 的 Linux 普通報告訊號，只量獨立空白／公開 IO 控制，保留原 RSS 失敗與門檻。

最新[獨立 raw IO 與原生入口結果](runtime-module-cache.md#原生入口首次失敗與修正)已核對：原 Firefox RSS 17,782,725.49 bytes／輪仍失敗，零模型／零 WASM raw IO 也重現成長。原生頁面在導頁等待逾時，零次 Measure，尚無物件分類；接著修正診斷入口並先做獨立前置探測，沒有修改應用配置、放寬門檻或發布候選。

最新 [ZIP 重用候選](runtime-module-cache.md#zip-重用候選仍未改善-rss)仍以 18,691,686.4 bytes／輪超過 Firefox 原門檻，沒有改善剩餘 slope。應用配置調整先停止，改做獨立 raw IO／原生 about:memory 持有者診斷；原失敗、門檻和 source-bound 證據保留，preview.32 未發布。

raw BIN copy 移除後的[新一批原始結果](runtime-module-cache.md#raw-bin-候選原始結果)仍是 18,495,546.51 bytes／輪，沒有改善剩餘 Firefox RSS slope。所有功能／內容與 native 清理仍通過；接著驗證同一模型的零化 ZIP buffer 重用，候選尚未發布。較早 d0f3ff9 結果保留如下。

最新 IO ownership 候選已核對：[d0f3ff9 的 Firefox 八輪](runtime-module-cache.md#ownership-修正後仍未達標)在完整功能／IO／Worker／程序清理通過後，closed RSS slope 為 **18,457,629.26 bytes／輪，仍超過原 16 MiB 門檻**；比先前 37,970,856.23 低，仍不能宣稱問題已修復。原始失敗及讀取器已保存。沒有重跑碰綠燈、調整門檻或發布 preview.32；接著逐一驗證暫存分配。下段較早各批結果保持其來源與界線。

preview.31 相同應用另完成 [WebKit 手動 CPU／IO 八輪 RSS](desktop-runtime-io.md#首次原始結果)，24 次 CPU／八份完整 IO、URL／Worker／程序清理通過。Firefox 同次量測則在 closed-RSS slope 超過原 16 MiB／輪，原始失敗保留；最終 URL 釋放後 drift 未超限，不足以證明洩漏或排除問題。後續程序分類與無模型對照也保留原始判定，沒有修改正式應用、重跑成功部署或放寬門檻。

Firefox 的[分類診斷](desktop-runtime-io.md#分類結果與無模型對照)亦重現 slope 超標；共享欄位不變，較大波動在父程序匿名記憶體。[無模型對照](desktop-runtime-io.md#無模型對照的實際結果)已完成：空 Worker 的父程序匿名欄位相對穩定，只 fetch WASM 就重現約 155 MB 波動，沒有模型、推論或 IO ZIP。原應用仍以 slope 21,129,625.6 bytes／輪失敗；尚不能區分工具觀察與 Firefox 原生配置的所有權，也不以對照值扣除或替換 RSS。[本機 File 實測](desktop-runtime-io.md#本機-file-對照的實際結果)已完成，走勢接近空 Worker；原應用仍以 slope 24,459,088.46 bytes／輪失敗。現有[共用公開 runtime 候選修正](runtime-module-cache.md#第三批候選功能與-const-正常firefox-rss-未修復)已通過 48 項 Node、三引擎 const／草稿／CPU 功能及 Chromium／WebKit 原有記憶體驗收，但 Firefox 在八輪只下載一次 WASM 後仍以 slope 27,376,493.71 bytes／輪失敗。原始觀測與門檻保留，候選尚未發布，未宣稱已修好。[後續 IO 對照](runtime-module-cache.md#已取得的結果與下一個修正)在無 WASM Instance 時也重現約 27.7 MB／輪，File-only 與 module clone 較低；原應用仍失敗，下一步修改 IO 配置／傳送並補明確 File input 清理。

歷史 preview.30 已核對 [Firefox 142.0.1／WebKit 26.0 的十六項功能](desktop-runtime.md#最終核對結果)，包含獨立執行、分佈／const／草稿與指南；這是 Hosted Linux 的短流程，不改變下列長期、其他 OS 與完整無障礙驗收缺口。

另補齊[三引擎真實 CPU 運算中的取消與 30 秒逾時](runtime-active-compute.md#三引擎實際結果)，含 UI 回應、Worker close 及恢復執行；Chromium 32 項、Firefox／WebKit 各 17 項功能通過。這組有限合成迴圈不涵蓋所有模型、背景節流、數小時 runtime 或 RSS；跨引擎 layout Worker 最後 close 與 Firefox module request 的觀察界線保持明列。

[手動 CPU／IO 八輪](runtime-io-lifecycle.md#已核對結果)另已通過 Chromium 程序 RSS／main heap 與自然 URL 期限驗收，新增 24 次執行、8 份完整 IO bytes及程序清理；有限範圍內未觀測持續累積。數小時 interpreter、其他引擎／OS 與連續 Worker heap 峰值仍未驗收。

已核對的瀏覽器／程序量測主要來自 Hosted Linux。其他 OS／固定實體硬體 SLA、其他引擎與手動 interpreter 數小時負載、Worker 連續 heap 峰值、OS 斷電／儲存回收、任意資料格式升降級及完整螢幕閱讀器／新使用者流程仍未驗收。既有八輪／兩小時結果保持各自來源與量測範圍，見 [品質工作清單](product-readiness.md)。

## 本輪已修復

手動執行的輸入視窗以 Escape 或取消按鈕關閉後焦點遺失，已在 preview.23 修正。1280×640／32px 的兩種原生鍵盤取消、草稿／視角保留及零額外推論／下載均通過主分支與正式站驗證，見 [正式交付](runtime-keyboard.md#preview23-正式交付)。

新增 OP 沒有可用 tensor 參考時進階表單被例外取代，已在 preview.24 修正；現在保留表單、停用無法產生的亂數並提供原因。合法型別亂數及原有操作仍通過，見 [正式交付](random-reference-guard.md#preview24-正式交付)。

新增 OP 的 64-bit 整數精度問題已在 preview.25 修正並完成正式驗收；大整數請以十進位字串輸入，JSON 陣列元素需加雙引號，見 [正式交付](op-integer-precision.md#preview25-正式交付)。

合法多輸入 CONCATENATION 的固定 port 誤判、SQUEEZE 非單位 axes 仍可匯出，已在 preview.26 修正並完成正式站／CPU 正負例驗收，見 [正式交付](model-composition.md#preview26-正式交付)。

返回探索、模型分頁及草稿還原後工作區按鈕選取殘留，已在 preview.27 修正並完成正式站十二次互斥導覽驗收；原 red、修正版與正式證據分開保留，見 [正式交付](workspace-mode-state.md#preview27-正式交付)。

舊示範檔缺少 RESHAPE shape 與 TRANSPOSE permutation，造成原模型及編輯後均在配置 tensors 失敗，已於 preview.28 的新版示範檔補齊；舊下載檔不會自動修改。四種實際 CPU 與正式站驗收通過，見 [根因](demo-runtime.md)及[正式交付](contextual-model-editing.md#preview28-正式交付)。同版也完成片段操作、框選切換、重置確認及分支排版，沒有擴大任意 OP／custom kernel 的語意保證。
