# 公開版已知問題與限制

目前固定版本為 preview.25／build `95784ae94cb97575`。本頁列出公開版仍待處理的現象、功能界線與驗收缺口；內網與私有 dialect 依使用者指示自行修改。

## 待查：一次啟動逾時的根因

Preview.22 曾有一次正式驗證在 30 秒內等不到開檔控制項就緒。[原始失敗](results/preview22-startup-failure-review-2026-10-29.json)保留；當時缺少請求級診斷，無法確定成因。之後相同應用的診斷、經授權的一次失敗驗證補跑，以及 preview.23 的正式驗證均成功；沒有把後續成功當成已找到或修好根因。

目前已加入有上限的靜態請求／console 診斷，若再發生可追查來源；尚未取得能穩定重現該次逾時的條件。詳細證據見 [啟動診斷與正式交付](desktop-physical.md)。

## 功能限制

Preview.25 新發現合法多輸入 `CONCATENATION` 被固定 port 數拒絕，以及非單位維度的 `SQUEEZE` axes 仍可匯出；[本機修正與回歸](op-shape-validation.md)以及 Hosted 候選／main 原生操作已通過，正式部署尚待完成。

- **新增 OP 的完整語意**：已實作結構、接線、資料長度及部分 shape／型別規則；無法自動推導的 OP 沿用明確參考 tensor。量化規則與任意 kernel 組合仍需 runtime 檢查。亂數保證所選 dtype 的數值範圍，不保證索引、token、權重或整個模型的運算語意正確。見 [模型編輯](model-edit-workspace.md)及[型別亂數](typed-random.md)。
- **手動 interpreter 的規模與支援範圍**：CPU WASM 限 128 MiB 模型、16 MiB IO、30 秒執行，另有 512 MiB 提前配置估算；此估算不含所有 kernel scratch。公開 runtime 不含任意 custom kernels，動態／未知 shape、部分 dtype 及不明確的 signature 對應會列為未能驗證。大型模型仍可探索、編輯與匯出。見 [完整限制](tflite-runtime.md)。
- **大型 MLIR 的完整驗證**：dense 大型權重保留原文與 byte ranges，不逐值解析或核對元素數量；外部 resource 檔選取尚未支援。網站的結構、SSA／dominance 檢查也不代替各 dialect 自訂 verifier。見 [大型 MLIR](mlir-large-files.md)。
- **MLIR 編輯與 pattern 範圍**：實際 OP 編輯僅支援 TFLite。MLIR 支援文字 generic 探索、搜尋、圈選及局部匯出；跨 block pattern 需位於同一 function／region，不能任意跨 function 或巢狀 region。見 [公開版指引](public-acceptance.md)。

## 尚待補齊的公開驗收

已核對的瀏覽器／程序量測主要來自 Hosted Linux。其他 OS／固定實體硬體 SLA、其他引擎與手動 interpreter 數小時負載、Worker 連續 heap 峰值、OS 斷電／儲存回收、任意資料格式升降級及完整螢幕閱讀器／新使用者流程仍未驗收。既有八輪／兩小時結果保持各自來源與量測範圍，見 [品質工作清單](product-readiness.md)。

## 本輪已修復

手動執行的輸入視窗以 Escape 或取消按鈕關閉後焦點遺失，已在 preview.23 修正。1280×640／32px 的兩種原生鍵盤取消、草稿／視角保留及零額外推論／下載均通過主分支與正式站驗證，見 [正式交付](runtime-keyboard.md#preview23-正式交付)。

新增 OP 沒有可用 tensor 參考時進階表單被例外取代，已在 preview.24 修正；現在保留表單、停用無法產生的亂數並提供原因。合法型別亂數及原有操作仍通過，見 [正式交付](random-reference-guard.md#preview24-正式交付)。

新增 OP 的 64-bit 整數精度問題已在 preview.25 修正並完成正式驗收；大整數請以十進位字串輸入，JSON 陣列元素需加雙引號，見 [正式交付](op-integer-precision.md#preview25-正式交付)。
