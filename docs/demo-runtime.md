# 示範模型的 LiteRT 配置錯誤

使用者回報舊 `示範模型.tflite` 編輯後用亂數或全 0 都出現 `Failed to allocate tensors`。用網站同一份示範 bytes 重現後，未編輯的原模型全 0 也失敗；原始 [Hosted red 40830588933](https://github.com/koviankevin/tflite-explorer/actions/runs/40830588933)／來源 `14f3dc9da0aa60a62ac000fc34268f7851e9a7f5` 與 ZIP digest／CRC／來源／時間已獨立核對，見 [收據](results/demo-runtime-red-review-2026-10-29.json)、[原始失敗 ZIP](results/demo-runtime-red-2026-10-29.zip)、[同次版本切換 ZIP](results/demo-runtime-red-versioning-2026-10-29.zip)。原失敗不改寫為成功。

原因是原範例為連接結構 fixture，沒有給 `RESHAPE` 的 shape input／`new_shape`，也沒有 `TRANSPOSE` 必要的 permutation input。先前 interpreter 驗收使用另一份可執行 fixture，漏掉網站這份示範檔。新版建置改用專用 executable demo generator：保留兩個 subgraphs、26 個 OP 與原有名稱／搜尋鏈，補 shape options、int32 permutation 常數及 ADD options；大型及負例用的原始 fixture 保持原生成行為。

`node --test test/executable-demo.test.mjs` 以真正 CPU WASM 驗證原模型，以及透過實際 workspace 匯出器複製 `RESHAPE`、重接 `TRANSPOSE` 後重新解析的候選；兩者分別以全 0 和固定 seed 亂數執行，四種情境均成功。Hosted 修正版 [40831216942](https://github.com/koviankevin/tflite-explorer/actions/runs/40831216942) 也已通過這四種 UI 操作，四個 runtime Workers 關閉；該次整體流程仍因草稿重置提示遮住編輯工具失敗，後續修正與完整成功證據尚待取得，不能以部分通過宣稱整個流程成功。

執行前的輕量檢查也會對缺少 shape 的 `RESHAPE`、缺少 permutation 的 `TRANSPOSE` 顯示 subgraph／OP 編號與原因，避免只出現泛用 C++ 配置錯誤。這不是所有算子的語意 verifier；公開 runtime／custom kernels／大型模型的限制維持 [既有範圍](tflite-runtime.md)。一般讀取、編輯、匯出不會自動跑 interpreter。

舊下載檔與既有編輯草稿不會偷偷修改。部署後需重新開啟網站新版示範模型，再重做或移植編輯；舊示範檔仍可能因缺參數不能執行。連接模式示範 `lora-demo.tflite` 仍是結構展示，不列為可執行模型。


preview.28 已完成 [正式交付](contextual-model-editing.md#preview28-正式交付)：四種 CPU 情境在候選、main 與正式站均通過，先前整體 red 與原始失敗證據保留。
