# Runtime tensor 錯誤的來源參照（v1.3.1 候選）

目前尚未發布。正式站與固定 Release 仍為 v1.3.0；本候選補正手動 interpreter 的錯誤對照，不修改模型或自動執行推論。

TensorFlow 官方 tflite-micro 固定來源 `9c74b4e7f9cb7afabea9859ef85f7df885148485` 的 `person_detect.tflite` 是 300,568 bytes、31 個 OP、89 個 tensor 的公開量化網路。以現有 LiteRT.js 2.6.0／CPU WASM 執行原始檔時，在 compile 階段即因部分 tensor 的量化維度超出範圍失敗，未套用輸入、未 invoke。這是這份原檔與目前 runtime 的相容性結果，不證明 tflite-micro runtime 也拒絕它；不修改量化值、權重或 bytes 來冒充原始模型可執行。

原始日誌明確回報 `Tensor 64 has invalid quantization parameters` 等編號，但網站原先只對照 `Node number … (BUILTIN)`，因此沒有來源按鈕。本候選沿用既有最多 512 個 OP、每側 32 個 ports、最後 12 行／每行 512 字元的 metadata 與日誌界線，新增 tensor 錯誤的定義來源／使用者參照。每個 tensor 最多列八個 OP，超限及 metadata 不完整會說明；重複日誌去重，不增加權重讀取。

這些按鈕用來查看參照 tensor 的 OP，**不表示該 OP 就是錯誤原因**。Tensor 編號可能是 subgraph-local 或由 delegate 重編；多個 subgraphs 的同號參照一起列為候選，不宣稱唯一定位。切換來源後仍禁止沿用舊位置。

compile 階段的失敗現在先列「發生在套用測試輸入之前」，再顯示完整原始錯誤，避免長路徑把可理解的提示推到畫面下方，也避免誤以為換成零值、亂數或另一個 raw BIN 就能修復。輸出仍保留失敗狀態與原始 runtime 日誌，沒有把未能執行改列通過。一般編輯與匯出依舊只做靜態／結構檢查，推論保持手動。

初始三個定位回歸在未修正來源確實失敗；截圖找到提示順序問題後，新增的順序斷言也先重現 red。修正後 31 項相關選測通過，包含真正的正向 CPU 控制。候選 `0537afa`／build `55e5b2f7588ff74c` 的原檔零值／raw BIN 與四種匯出共六個真正 CPU 負例仍在 compile 失敗，沒有 invoke 或 IO 成功；對照、提示與參照 OP 正確，不把它們寫成模型可執行。

完整 identity edit、整圖切出、片段組合及三 OP prefix 的實際序列化、重開、每個保留 tensor 的 shape／dtype／量化／權重、builtin options／接線與原 pattern 各一筆均核對。這證明本次結構與資料保留，因原檔 CPU 不相容而不能驗證數值等價。模型、圖片及 raw BIN bytes 都留在本機；公開證據只含固定來源與 Git blob／雜湊、metadata、診斷、來源及截圖。

Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 皆完成原生選檔、手動失敗、32px、真正鍵盤啟動參照按鈕、OP 畫出／結果焦點及換模型移除舊位置；零額外推論或 IO 下載，每端一個 runtime Worker 全部原生 close，八／十個已觀察原生程序身分正常退出。Chrome 第二候選曾在 graph busy=false 後、非同步 focus 完成前過早擷取而失敗，保留原檔；只在相同 35 秒 UI 界線內等待實際焦點再讀取，未改應用或原生關閉規則，Edge 不重跑。這些是短流程，不能宣稱歷史較長負載的 Chrome／OneDrive 關閉問題已修復。

[候選收據](results/runtime-tensor-diagnostics-candidate.json)與[71 份原始來源／失敗／成功及截圖](results/runtime-tensor-diagnostics-evidence.zip)已完成 SHA-256／ZIP CRC 核對。必要發布關卡與正式交付尚待接續；本頁目前不宣稱 v1.3.1 已發布。
