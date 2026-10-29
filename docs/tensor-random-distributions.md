# 亂數資料規則與預設

開發中的 preview.29 在「執行模型」的測試輸入與「編輯模型 → 補上亂數權重／常數」共用一套規則。選擇用途後可以直接產生，seed 與數值參數收在「進階參數」，不需要先理解統計名詞。

| 用途／dtype | 預設 | 說明 |
| --- | --- | --- |
| 浮點測試輸入 | Normal，平均 0、標準差 1 | 適合已標準化、以 0 為中心的資料 |
| 新增浮點 const／權重 | Truncated Normal，平均 0、標準差 0.05，範圍 −0.1～0.1 | 小幅度數值；不是已訓練的權重 |
| boolean | Bernoulli，機率 0.5 | 只產生 0／1，適合二元 mask |
| uint8 | Uniform，0～255 | 原始 8-bit 整數資料；量化 tensor 仍使用儲存值 |
| 其他整數 | Uniform，0～1 | 保守的小整數；索引、軸、token ID 等仍需依模型用途設定 |

也可切換到 Uniform（範圍內平均取樣）、Normal（以平均值為中心）、Truncated Normal（只保留上下界內的常態樣本）或 Bernoulli（依機率產生 0／1）。Uniform 浮點測試輸入預設 0～1，浮點權重預設 −0.05～0.05；Bernoulli 可調低機率來產生多數為 0 的 mask。Normal／Truncated Normal 僅支援浮點，不將常態樣本暗中轉成整數。

Normal 的平均值與標準差定義採 [NIST 的常態分佈定義](https://csrc.nist.gov/glossary/term/Normal_Distribution)；Truncated Normal 採在指定區間內的條件分佈，見 [SciPy truncnorm](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.truncnorm.html)。超界樣本會重新取樣，不把超界數值壓在邊界上，也不默默改成 Uniform。

所有設定會檢查 seed、dtype 可表示範圍、有限值、正標準差、合法機率與有效上下界。Normal 要求平均值 ± 8 倍標準差在 dtype 範圍內；不合適的截斷區間在產生前拒絕，每個樣本另有 256 次重試上限。原有單 tensor／單次權重及 runtime IO 預算保留，不產生無限重試。

這些預設是常見資料用途的起點，無法從 shape／dtype 自動推知前處理、資料相關性或模型語意。量化資料不自動套用 scale／zero point；有真實測試資料時仍可使用 raw BIN。

舊 Uniform 草稿仍使用原有 `xorshift32-v1`，不改既有 seed 對應的 bytes。帶新分佈的編輯草稿使用版本 3，包含分佈、seed 與適用參數，支援本機保存、匯入及 Undo／Redo；無新分佈的既有原模型／組合草稿維持版本 1／2。舊版網站會拒絕版本 3，而不把新分佈誤解為 Uniform。

測試 IO ZIP 記錄分佈、seed、參數及演算法名稱，並保存實際生成的 BIN。相同實作與數值環境可重現；不同引擎的浮點數學函式末位可能不同，嚴格逐 bytes 重播請使用已保存的 BIN／匯出模型。

驗收涵蓋固定 seed 統計平均／變異、截斷後的條件變異與遠端窄區間、Bernoulli 比例、dtype／溢位拒絕、const 與測試輸入逐 bytes 相同、版本 1／2 相容、版本 3 草稿／Redo／本機復原，以及 Hosted 瀏覽器的實際 CPU／IO 與匯出重開。正式部署與 Hosted 結果尚待本版驗收完成後記錄。
