# 共用公開 runtime module（候選，尚未部署）

目前正式站仍為 preview.31。此分支準備 preview.32；新應用尚未取得 Hosted 瀏覽器／RSS 驗收，不能宣告 Firefox 問題已修復。

[原始 File／HTTP 對照](desktop-runtime-io.md#本機-file-對照的實際結果)顯示：空 Worker 與同 bytes 的本機 File 走勢接近，HTTP fetch 則重現較大父程序波動。原應用 RSS slope 仍失敗；此修正針對反覆載入相同公開 WASM 的成本，不將診斷值扣除或放寬門檻。

第一次明確、符合 preflight 的手動執行才取得固定 LiteRT 2.6.0 WASM。串流讀取上限固定為 10,948,854 bytes，核對 MIME、完整長度與固定 SHA-256，然後非同步編譯；同一頁面的並行及後續請求共用一份 stateless `WebAssembly.Module`。失敗不自動重試，後續明確執行才可重新準備；快取不寫入 IndexedDB，也不接收模型、權重、輸入、輸出或 Instance。

[WebAssembly.Module 文件](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module)說明 compiled code 可分享給 Worker；[Emscripten instantiateWasm](https://emscripten.org/docs/api_reference/module.html#Module.instantiateWasm)提供初始化接點。本案以已封裝的固定 generated loader／wasm-utils 原始碼為準，沒有修改第三方 loader。各次 Worker 取得 module 後建立自己的 Instance、imports 與 memory；公開 code 的重用不會共用模型狀態。

30 秒的執行請求期限、取消、錯誤與 Worker 終止保留。非同步回呼只綁定明確 request slot，不捕捉 `check()` 的原始 File 參數；完成／取消／逾時會清空 payload、進度及 resolve 回呼，晚到的 module 不會再送出舊模型。已開始的公開編譯可能在背景完成，只保留這份固定 code，不能啟動已取消的模型請求。單頁至多一個公開準備工作／module；不持久化私有資料。

兩項新 client 回歸先在舊來源失敗：沒有供應已準備 module，且準備期間已送出模型。修正後轉綠。第一次 Node runner 無法序列化 assertion 裡的 WebAssembly.Module，該診斷錯誤原樣保留；改為布林 identity 斷言後取得真正的兩項失敗，再修改應用。

48 項選測通過，包括固定 SHA／MIME／大小／串流失敗、並行只下載／編譯一次、無背景重試、缺少 WASM 的環境仍能匯入、取消／30 秒期限／新舊請求與不同 client 隔離、raw BIN、四種亂數、輸入視窗清理及真實 CPU reference。新 hook 用同一個 compiled module 建立兩組不同 Instance／memory，對實際 BIN 取得 `[4, 6]`、`[40, 60]`。這是 Node 證據，不是瀏覽器或 RSS 通過。

現有 warm 取消案例在新應用改為暫停 Worker 內的 execution-module 動態 import；舊固定版本仍暫停 WASM。兩種情況都要求原生取消、Worker close、無舊 IO 及模型分頁切換；真 WHILE invoke 取消／逾時另照原流程。新應用不必在已 warm 的頁面重抓 WASM，不能沿用「每次執行必有 WASM GET」的假設。仍須補 fresh context 的 cold 準備取消、再次執行、單次公開下載與 native Worker close 證據，且新應用的原 RSS、完整 IO／匯出、三引擎、發布四關卡及正式站核對均尚未完成。


候選 native 流程另加入獨立 fresh context（重用已核對的示範檔，不產生新模型或 IO 檔）：先要求開檔／導覽零 WASM GET，再暫停首次公開 WASM 下載，對真正 runtime Worker 僅讀取常數 `1` 確認 context 就緒，原生按取消並觀察 close／輸入清理。放行公開下載後連續手動執行兩次，要求總共一次 WASM GET、三個 runtime 及一個 model native close、沒有舊 IO，最後正常關閉 context。此 helper 放在原記憶體驗收之後，不改其 baseline 或判定；新結果尚待 Hosted 執行，不能以語法或 unit 測試代替。
