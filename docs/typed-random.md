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

本機已驗證 11 種權重／輸入 dtype 的完整允許範圍、有限值、固定上界、非法範圍、seed 與舊 bytes 相容性；草稿／匯出重開與實際 CPU WASM 回歸也通過。新版 hosted 原生操作及正式部署尚待驗證，不以 Node 結果代替。
