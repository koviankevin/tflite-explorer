# 依 dtype 產生權重與測試輸入

新增 OP 的「補上亂數權重／常數」及手動執行的「亂數」輸入使用同一套型別範圍與產生器。選取 tensor 參考後顯示該 dtype 的合法範圍，提供安全預設；整數欄位使用整數步進。越界、NaN、Infinity、反向範圍、整數的小數值與非法 seed 都在配置／執行前拒絕。

| dtype | 建議預設 | 規則 |
| --- | --- | --- |
| float32／float64 | -0.05～0.05 | 只產生可表示的有限值；不產生 NaN／Infinity |
| int8／uint8／int16／uint16／int32／uint32 | 0～1 | 整數，且在該 dtype 上下界之內 |
| bool | 0～1 | 只產生 0 或 1 |
| int64／uint64 | 0～1 | 以 JavaScript 可精確表示的整數為產生範圍；raw .bin 輸入仍可保存完整 64-bit 整數 |
| 量化整數 tensor | 0～1 原始整數 | 保留模型的量化設定；不自動把此範圍換算成實數分布 |

浮點數的巨大正負端點可能使 `max-min` 溢位，產生器對此使用不會形成無限差值的插值；整數固定值與大 64-bit 區間則避免加法捨入越界。相同 seed 與範圍可重現；既有小範圍 v1 草稿的產生 bytes 保持相同。最小值等於最大值時產生常數，例如 ADD 所需的 0 或 MUL 所需的 1，但其 shape 仍須相容。

float16 測試輸入另受瀏覽器 Float16Array 支援及有限範圍 ±65,504 限制；新增權重目前不支援 float16、bfloat16、字串、sparse 或動態 shape，會明確拒絕。原本每個權重 tensor 16 MiB、單次權重匯出 32 MiB、執行 IO 16 MiB 預算保持不變。

型別合法不代表 OP 語意或模型效果正確。索引、token ID、shape tensor、axis、permutation、stride／padding 等需符合對應運算的規則；亂數不會改動這些 OP 屬性。訓練過的權重應從既有相容 OP 複製或由模型提供。interpreter 僅在手動點選時執行一次，沒有自動推論或準確率保證。

本機已驗證 11 種權重／輸入 dtype 的完整允許範圍、有限值、固定上界、非法範圍、seed 與舊 bytes 相容性；草稿／匯出重開與實際 CPU WASM 回歸也通過。

## Preview.21 候選驗收

候選來源 `b0f7fe13a315a96d40687c93dae98e2a7da3eaad`／tree `1d10aeb91bd569580bccf2e48c0bc587256ca9d0`，本機乾淨重建及 hosted 原生網站的 build 都是 `197b3c6d31d49392`，292 個核心檔。[四關卡獨立核對](results/preview21-main-gates-2026-10-28.json)已完成 provider／digest／ZIP CRC、來源相依及原始政策檢查：core 沿用 [40700051621](https://github.com/koviankevin/tflite-explorer/actions/runs/40700051621)，實際 fingerprint 未變；新八輪 [40717132364](https://github.com/koviankevin/tflite-explorer/actions/runs/40717132364)、contract [40717138628](https://github.com/koviankevin/tflite-explorer/actions/runs/40717138628)、site [40717145009](https://github.com/koviankevin/tflite-explorer/actions/runs/40717145009)成功。

[原始候選操作](results/preview21-ui-candidate-2026-10-28.json)、[provider 核對](results/preview21-ui-candidate-2026-10-28-review.json)與 [完整原始 ZIP](results/preview21-ui-candidate-2026-10-28.zip)保留。30 項主要操作及七種 runtime 情境通過，36 個模型與四個 runtime Workers 全部關閉，沒有 page error。新增原生案例從新增 MUL 的表單產生合法權重、拒絕超出 float32 範圍的測試輸入且不啟動 WASM，再以合法資料執行，實際 ADD／MUL 輸出與下載 IO ZIP 的 bytes、CRC 及 seed 一致。14 吋 1366×640／1280×640、32px 流程仍通過，沒有測手機。

這是公開合成案例的候選結果；正式 preview.21 部署仍待受控發布確認，也不代表公司 kernel、準確率、其他引擎的大檔峰值或新版數小時負載已通過。

## Preview.21 正式交付

固定正式來源 `ed2414a20633765c9bbbdb818c6a14c7a5ca09d0`／tree `99a80eba605032835e65c6574bfe00d9ce79b6aa`，build `c4346bf8617a020e`。[準備 40719831256](https://github.com/koviankevin/tflite-explorer/actions/runs/40719831256) 完成後，先 [獨立核對整份 Pages tar／固定 ZIP](results/preview21-prepared-review-2026-10-28.json)，再以精確 build／site ID 執行 [40720219760](https://github.com/koviankevin/tflite-explorer/actions/runs/40720219760)，prepare／deploy／verify_live／release 全成功，attempt 1。

[正式交付獨立核對](results/preview21-publication-review-2026-10-28.json)確認 1,371 個正式站檔案、root／MIME／所有 SHA 與原準備 snapshot 相同；30 項原生操作及七種 runtime 情境通過，36 個模型與四個 runtime Workers 關閉。八份編輯匯出收據與四份 [固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.21) 實際下載 bytes 都符合原準備包；部署權威及獨立 root 也一致。正式 14 吋 1366×640／1280×640、32px 流程通過，沒有測手機。

新增 OP 選取型別參考後，即可在「補上亂數權重／常數」看到合法範圍；手動「檢查能否執行（選用）」中的每個 input 選「亂數」也有相同提示。執行後可下載實際 input／output `.bin` 與 JSON。128 MiB 模型、16 MiB IO、30 秒及 custom kernel 等既有限制保持；不自動執行，也不以有限值保證 OP 語意或模型精度。公司實模、其他引擎的大檔峰值及本來源數小時驗收仍待補齊。
