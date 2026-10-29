# 共用公開 runtime module（候選，尚未部署）

目前正式站仍為 preview.31。此分支準備 preview.32；新應用尚未取得 Hosted 瀏覽器／RSS 驗收，不能宣告 Firefox 問題已修復。

[原始 File／HTTP 對照](desktop-runtime-io.md#本機-file-對照的實際結果)顯示：空 Worker 與同 bytes 的本機 File 走勢接近，HTTP fetch 則重現較大父程序波動。原應用 RSS slope 仍失敗；此修正針對反覆載入相同公開 WASM 的成本，不將診斷值扣除或放寬門檻。

第一次明確、符合 preflight 的手動執行才取得固定 LiteRT 2.6.0 WASM。串流讀取上限固定為 10,948,854 bytes，核對 MIME、完整長度與固定 SHA-256，然後非同步編譯；同一頁面的並行及後續請求共用一份 stateless `WebAssembly.Module`。失敗不自動重試，後續明確執行才可重新準備；快取不寫入 IndexedDB，也不接收模型、權重、輸入、輸出或 Instance。

[WebAssembly.Module 文件](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module)說明 compiled code 可分享給 Worker；[Emscripten instantiateWasm](https://emscripten.org/docs/api_reference/module.html#Module.instantiateWasm)提供初始化接點。本案以已封裝的固定 generated loader／wasm-utils 原始碼為準，沒有修改第三方 loader。各次 Worker 取得 module 後建立自己的 Instance、imports 與 memory；公開 code 的重用不會共用模型狀態。

30 秒的執行請求期限、取消、錯誤與 Worker 終止保留。非同步回呼只綁定明確 request slot，不捕捉 `check()` 的原始 File 參數；完成／取消／逾時會清空 payload、進度及 resolve 回呼，晚到的 module 不會再送出舊模型。已開始的公開編譯可能在背景完成，只保留這份固定 code，不能啟動已取消的模型請求。單頁至多一個公開準備工作／module；不持久化私有資料。

兩項新 client 回歸先在舊來源失敗：沒有供應已準備 module，且準備期間已送出模型。修正後轉綠。第一次 Node runner 無法序列化 assertion 裡的 WebAssembly.Module，該診斷錯誤原樣保留；改為布林 identity 斷言後取得真正的兩項失敗，再修改應用。

48 項選測通過，包括固定 SHA／MIME／大小／串流失敗、並行只下載／編譯一次、無背景重試、缺少 WASM 的環境仍能匯入、取消／30 秒期限／新舊請求與不同 client 隔離、raw BIN、四種亂數、輸入視窗清理及真實 CPU reference。新 hook 用同一個 compiled module 建立兩組不同 Instance／memory，對實際 BIN 取得 `[4, 6]`、`[40, 60]`。這是 Node 證據，不是瀏覽器或 RSS 通過。

新應用的 warm 取消改用真正的 WHILE invoke，分別按取消及切換模型分頁，要求五秒內 native close、無舊 IO 並保留原編輯歷史。舊固定版本仍暫停 WASM；原本另有的真 WHILE 30 秒逾時／恢復流程也保留。新應用不必在已 warm 的頁面重抓 WASM，不能沿用「每次執行必有 WASM GET」的假設。仍須補 fresh context 的 cold 準備取消、再次執行、單次公開下載與 native Worker close 證據，且新應用的原 RSS、完整 IO／匯出、三引擎、發布四關卡及正式站核對均尚未完成。


候選 native 流程另加入獨立 fresh context（重用已核對的示範檔，不產生新模型或 IO 檔）：先要求開檔／導覽零 WASM GET，再暫停首次公開 WASM 下載，對真正 runtime Worker 僅讀取常數 `1` 確認 context 就緒，原生按取消並觀察 close／輸入清理。放行公開下載後連續手動執行兩次，要求總共一次 WASM GET、三個 runtime 及一個 model native close、沒有舊 IO，最後正常關閉 context。此 helper 放在原記憶體驗收之後，不改其 baseline 或判定；新結果尚待 Hosted 執行，不能以語法或 unit 測試代替。


## 第一批 Firefox 原始結果與測試修正

[40933429392](https://github.com/koviankevin/tflite-explorer/actions/runs/40933429392) 來源 `774d76e7f1685fbc526e7648e1fdfc0ad40ddf2f`、tree `14af0a4bfff8c6b5e503bf2fd109dd395d91db07`、build `a71f6dd544f8449f`，在 warm 取消的載入攔截等待失敗。Provider digest／CRC、來源／job／attempt／305 檔及原圖已核對，讀取器 exit 0；[原始資料](results/runtime-module32-first-firefox.zip)和[逐檔雜湊／界線](results/runtime-module32-first-firefox.json)保留。

已完成十四項主要操作，四次實際示範模型 CPU、raw multi-input ADD／MUL 的 ZIP CRC／完整數值、亂數與 dtype 拒絕均通過；七個觀測 runtime Workers 全部 close，沒有 page error。失敗是 `Runtime loading cancellation gate not observed`，尚未到 RSS 或獨立 cold context；不能宣稱新效能通過。

原始路由記錄能看到主 Worker 與 WASM，沒有 Worker 內 transitive JS import 請求；因此新測試把 warm 取消移到實際 true-predicate WHILE，而不修改應用來重抓 WASM。兩次 runtime runs 保持：第一次手動取消，第二次關閉 loop 模型分頁，回到既有結果及原編輯頁，檢查 IO 清除與 Undo。新增 loop 模型及重啟既有結果的兩個 model contexts 明確計數並要求全部 native close，沒有降低 RSS 或 close 要求。

新 loop 檔僅由公開 `runtimeLoopFixture(true)` 序列化產生，不在 Node 執行；使用已驗證 SHA／大小／檔案身分及 flush 意圖的精確清理 helper，只允許原 WASM／新固定 `.tflite` 兩個檔名。只有 native loop model／runtime 消費者已關閉才刪除；失敗而未觀測關閉時保留並寫入報告。12 項 helper／loop 選測及語法檢查通過；其中實際 Node CPU reference 只執行 false predicate。新 native 結果仍待取得，應用程式與原 RSS flow／policy 未變。
