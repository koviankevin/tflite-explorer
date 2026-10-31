# Runtime tensor 錯誤的來源參照（v1.3.1）

已在 [v1.3.1 固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.3.1) 正式交付，build `960b708cb9389164`；[正式站](https://koviankevin.github.io/tflite-explorer/)與四份實際下載已核對，完整證據見[正式交付](#v131-正式交付)。手動 interpreter 的錯誤對照不修改模型，也不自動執行推論。

## 候選階段紀錄

TensorFlow 官方 tflite-micro 固定來源 `9c74b4e7f9cb7afabea9859ef85f7df885148485` 的 `person_detect.tflite` 是 300,568 bytes、31 個 OP、89 個 tensor 的公開量化網路。以現有 LiteRT.js 2.6.0／CPU WASM 執行原始檔時，在 compile 階段即因部分 tensor 的量化維度超出範圍失敗，未套用輸入、未 invoke。這是這份原檔與目前 runtime 的相容性結果，不證明 tflite-micro runtime 也拒絕它；不修改量化值、權重或 bytes 來冒充原始模型可執行。

原始日誌明確回報 `Tensor 64 has invalid quantization parameters` 等編號，但網站原先只對照 `Node number … (BUILTIN)`，因此沒有來源按鈕。本候選沿用既有最多 512 個 OP、每側 32 個 ports、最後 12 行／每行 512 字元的 metadata 與日誌界線，新增 tensor 錯誤的定義來源／使用者參照。每個 tensor 最多列八個 OP，超限及 metadata 不完整會說明；重複日誌去重，不增加權重讀取。

這些按鈕用來查看參照 tensor 的 OP，**不表示該 OP 就是錯誤原因**。Tensor 編號可能是 subgraph-local 或由 delegate 重編；多個 subgraphs 的同號參照一起列為候選，不宣稱唯一定位。切換來源後仍禁止沿用舊位置。

compile 階段的失敗現在先列「發生在套用測試輸入之前」，再顯示完整原始錯誤，避免長路徑把可理解的提示推到畫面下方，也避免誤以為換成零值、亂數或另一個 raw BIN 就能修復。輸出仍保留失敗狀態與原始 runtime 日誌，沒有把未能執行改列通過。一般編輯與匯出依舊只做靜態／結構檢查，推論保持手動。

初始三個定位回歸在未修正來源確實失敗；截圖找到提示順序問題後，新增的順序斷言也先重現 red。修正後 31 項相關選測通過，包含真正的正向 CPU 控制。候選 `0537afa`／build `55e5b2f7588ff74c` 的原檔零值／raw BIN 與四種匯出共六個真正 CPU 負例仍在 compile 失敗，沒有 invoke 或 IO 成功；對照、提示與參照 OP 正確，不把它們寫成模型可執行。

完整 identity edit、整圖切出、片段組合及三 OP prefix 的實際序列化、重開、每個保留 tensor 的 shape／dtype／量化／權重、builtin options／接線與原 pattern 各一筆均核對。這證明本次結構與資料保留，因原檔 CPU 不相容而不能驗證數值等價。模型、圖片及 raw BIN bytes 都留在本機；公開證據只含固定來源與 Git blob／雜湊、metadata、診斷、來源及截圖。

Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 皆完成原生選檔、手動失敗、32px、真正鍵盤啟動參照按鈕、OP 畫出／結果焦點及換模型移除舊位置；零額外推論或 IO 下載，每端一個 runtime Worker 全部原生 close，八／十個已觀察原生程序身分正常退出。Chrome 第二候選曾在 graph busy=false 後、非同步 focus 完成前過早擷取而失敗，保留原檔；只在相同 35 秒 UI 界線內等待實際焦點再讀取，未改應用或原生關閉規則，Edge 不重跑。這些是短流程，不能宣稱歷史較長負載的 Chrome／OneDrive 關閉問題已修復。

[候選收據](results/runtime-tensor-diagnostics-candidate.json)與[71 份原始來源／失敗／成功及截圖](results/runtime-tensor-diagnostics-evidence.zip)已完成 SHA-256／ZIP CRC 核對。必要發布關卡與正式交付尚待接續；本頁目前不宣稱 v1.3.1 已發布。

最後另補「同一行先說 Tensor 1 成功、再說 Tensor 2 失敗」的誤對照負例，先 red 再收緊為 tensor 編號後緊接已知失敗語法。來源 `bad7a72`／build `f4a92b2cc2c2f632` 的六個真實 CPU 負例、所有匯出 bytes／資料保留結果及定位物件／原因文字均與前候選逐項相同；31 項相關測試再次通過。src／vendor 僅此辨識條件變動，UI renderer、傳輸、runtime、CSS 與模型資料未變，因此沿用上述 Windows 實際操作證據，沒有宣稱另跑新版 Windows。[後續收據](results/runtime-tensor-parser-followup.json)及[原始 red／green、實際結果與相同性核對](results/runtime-tensor-parser-followup-evidence.zip)保留明確的來源與沿用界線。

## 主分支發布前驗收

PR #200 合併來源 `9885c97c58e30eb81f827df5a3da7520f502caa5`／tree `32128382bc42a2fa8e766e9f9aa66a556df02d59` 的四項 main／workflow_dispatch 關卡全部成功。以下結果完成原始 provider ZIP、digest／CRC、source scope 及原政策重判，[收據](results/runtime-tensor-main.json)與[原始報告及讀取器](results/runtime-tensor-main-evidence.zip)保留；這是發布前驗收，尚不代表 v1.3.1 已部署。

| 關卡 | 結果 |
| --- | --- |
| 核心效能 | [41240620248](https://github.com/koviankevin/tflite-explorer/actions/runs/41240620248)，九筆量測依原政策通過 |
| 實體大模型 | [41240629890](https://github.com/koviankevin/tflite-explorer/actions/runs/41240629890)，1,349,965,216 bytes／21,005 OP 的八輪完整、局部與組合匯出重開；權重、custom options、pattern、草稿來源及 Worker／程序正常退出通過 |
| 發布契約 | [41240638397](https://github.com/koviankevin/tflite-explorer/actions/runs/41240638397)，78 項通過，零略過 |
| 網站操作 | [41240648865](https://github.com/koviankevin/tflite-explorer/actions/runs/41240648865)，六種版本切換、35 項正常 HTTP 候選操作、15 組實際 32px 文字框、19 種手動 runtime，以及八輪／24 次 CPU／IO 與原記憶體規則通過 |

大模型原判定為 RSS slope 1,549,341.26 bytes／輪、drift 12,795,904 bytes、main heap drift 175,276 bytes、sampled peak 1,107,017,728 bytes。這些有限 Linux Chromium 結果不替代 Windows 原生關閉失敗、任意模型數值等價或公司 kernel 驗收。所有模型與輸入仍留在執行端本機，公開封存不含原始模型、權重、BMP 或 BIN。

## v1.3.1 正式交付

固定來源 `8946d3473ae6952f12fd54d124f2d5f645b6c4a2`／tree `86227033a2e8fbe0b8d9ffdbe1a29de0e05de185`／build `960b708cb9389164` 已完成[發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41242450193)，四個工作 attempt 1 全成功。權威 Pages deployment `7464451347`、[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.3.1)、Latest 與 tag 指向均已核對；完整 site ID 為 `aab00d1e7b9c71f7b138fe971e5077cb3af6a22bea95d8c27067f8ce5737f54f`。保留 v1.3.0、v1.2.1 與原永久基準，不修改舊 tag 或附件。

正式 HTTPS 核對整站 1,466 個檔案，含網站索引；323 個核心檔與準備包一致。正式站 35 項操作、15 組實際 32px 文字框、19 種手動 runtime、八輪／24 次 CPU／IO、原記憶體規則與 Worker／程序退出均通過。四份實際公開下載的 bytes／SHA-256 與準備包一致：ZIP 為 41,282,247 bytes，SHA-256 `bb321ec7921ec6233d66e2ebc4449633d0d4d935ac1f88fda9da8023e548548b`。結果見[最終收據](results/runtime-tensor-v1.3.1-published.json)與[57 份公開原始報告／metadata／讀取器](results/runtime-tensor-v1.3.1-evidence.zip)。

另以 Windows Chrome／Edge 直接開啟正式 HTTPS，核對本機官方模型的 tensor 錯誤、32px 鍵盤定位、切換模型移除舊參照，以及 runtime／model Worker 和八／十個原生程序身分正常退出；功能均通過。**兩端整體驗收仍失敗**，因嚴格網路守門各攔下兩筆未知請求，不能將功能通過改寫為全通過。

接續一次預先限定的 Chrome 診斷，在相同封鎖條件下記錄到 Kaspersky 網域的 script／stylesheet GET；準備包 HTML 與 src／vendor 沒有該引用，與[官方說明的網頁注入機制](https://support.kaspersky.com/help/Kaspersky/Win21.7/en-US/201001.htm)一致。這是本機環境的判讀，不宣稱已記錄到首輪 Edge 的同一 URL。沒有停用防毒、放寬網路／原生關閉規則，或重跑以求綠燈；完整請求 query 與原生診斷留在本機，公開收據只保留來源類型、原始報告 SHA-256 與界線。

官方量化模型的原始 compile 失敗仍保留，不宣稱數值等價；歷史 Chrome 長負載／OneDrive 關閉問題也仍未解。本次正式交付不代表任意 kernel、公司 dialect 或整體商品化目標已完成。一般編輯／匯出維持靜態檢查，推論維持手動，模型與輸入全程本機處理。
