# 真實 CPU 運算中的取消與逾時驗收

現有 native 取消案例暫停同源 WASM 下載，30 秒 deadline 則有 mock-timer 單元案例。這些結果不能證明 kernel 已開始計算時，主頁仍可操作、Worker 能被取消／逾時終止，或之後仍可正常執行。因此本輪補一組實際運算驗收，不修改應用、timeout、workflow 或固定 preview.30，也不重新部署或跑兩小時負載。

使用公開合成 TFLite：主 graph 有 WHILE，condition graph 回傳常數 BOOL，body 以 ADD 將狀態加一。false／true 兩份檔案只差一個 boolean byte，shape、dtype、options、介面及 graph 都相同；不以 malformed／custom／動態模型假裝 kernel 忙碌。false 版本已在有外部 15 秒程序上限的 Node 子程序，以真正 CPU WASM 驗證 raw input `7` → output `7`；true 版本在本機只解析及核對 byte，不在無外部 guard 的程序執行。

Hosted 流程只用真實 chooser、鍵盤、按鈕、下載及 read-only DOM：

1. 開 false 模型，以 raw `.bin` 執行成功，下載 ZIP 核對模型 SHA 與 output `7`。
2. 開 true 模型，等網站回報已進入「使用指定測試輸入執行」階段；沒有 route hold／fake timer。此時用 F1 開說明再關閉，確認 Worker 仍活著、Run 仍忙碌、UI 可在五秒內回應，再原生點取消，要求五秒內收到 close、顯示未驗證及取消原因、不提供舊 IO。
3. 對同一 true 模型重新執行，確認已進入 invoke，等待網站自己的 30 秒 timer。必須顯示未驗證／超過 30 秒並終止 Worker，不能誤判 passed；原生觀測的 Worker 壽命要求 25～40 秒，保留實際值而不把排程延遲當成精確硬即時保證。測試另有 45 秒觀察上限。
4. 關閉後重新開 false 模型，再以同一 raw input 得到 `7`，核對新 IO ZIP／模型 SHA，證明取消與逾時後仍可恢復操作。

新流程預期增加三個模型 Workers、四個 runtime Workers 並要求全部收到 close。每個引擎四組子情境；Chromium 原生檢查預期由 31 增至 32、模型由 71 增至 74、runtime 由 16 增至 20；Firefox／WebKit 則各 17 項檢查、63 模型／20 runtime Workers。這些是待執行的驗收要求，不是 CI 結果。

只在既有 Hosted Linux 工作流程，以同一固定 preview.30／build `f3ff13b75b83ee57` 實測。只有獨立 Run 及指南模組皆存在的版本啟用新流程，較早固定版本保留原有覆蓋。原十九種 runtime、CPU／IO、分佈／const、草稿、pattern、TFLite／MLIR 匯出重開及指南驗收都保留。實際三引擎結果、原始 provider ZIP／SHA／CRC、invoke／UI 回應／Worker wall time、恢復輸出與截圖仍待核對。

這組有界測試不等於所有長迴圈、背景分頁節流、所有模型／OS、數小時 interpreter、完整 RSS／持續 heap 峰值或 custom kernels 驗收。既有跨引擎頁面 layout Worker 與 network 事件的[觀察界線](desktop-runtime.md#觀察界線)也不改寫。
