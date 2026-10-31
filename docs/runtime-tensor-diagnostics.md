# Runtime tensor 錯誤的來源參照（v1.3.1 候選）

目前尚未發布。正式站與固定 Release 仍為 v1.3.0；本候選補正手動 interpreter 的錯誤對照，不修改模型或自動執行推論。

TensorFlow 官方 tflite-micro 固定來源 `9c74b4e7f9cb7afabea9859ef85f7df885148485` 的 `person_detect.tflite` 是 300,568 bytes、31 個 OP、89 個 tensor 的公開量化網路。以現有 LiteRT.js 2.6.0／CPU WASM 執行原始檔時，在 compile 階段即因部分 tensor 的量化維度超出範圍失敗，未套用輸入、未 invoke。這是這份原檔與目前 runtime 的相容性結果，不證明 tflite-micro runtime 也拒絕它；不修改量化值、權重或 bytes 來冒充原始模型可執行。

原始日誌明確回報 `Tensor 64 has invalid quantization parameters` 等編號，但網站原先只對照 `Node number … (BUILTIN)`，因此沒有來源按鈕。本候選沿用既有最多 512 個 OP、每側 32 個 ports、最後 12 行／每行 512 字元的 metadata 與日誌界線，新增 tensor 錯誤的定義來源／使用者參照。每個 tensor 最多列八個 OP，超限及 metadata 不完整會說明；重複日誌去重，不增加權重讀取。

這些按鈕用來查看參照 tensor 的 OP，**不表示該 OP 就是錯誤原因**。Tensor 編號可能是 subgraph-local 或由 delegate 重編；多個 subgraphs 的同號參照一起列為候選，不宣稱唯一定位。切換來源後仍禁止沿用舊位置。

compile 階段的失敗現在明列「發生在套用測試輸入之前」，避免誤以為換成零值、亂數或另一個 raw BIN 就能修復。輸出仍保留失敗狀態與原始 runtime 日誌，沒有把未能執行改列通過。一般編輯與匯出依舊只做靜態／結構檢查，推論保持手動。

初始三個定位回歸在未修正來源確實失敗，修正後五個相關測試通過。真實 runtime、候選瀏覽器、必要發布關卡及正式交付尚待接續，不能以此段單元測試宣稱全部交付完成。
