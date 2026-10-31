# TRANSPOSE permutation 驗證修正

v1.2.1 候選修正，尚未發布；目前固定正式站仍為 [v1.2.0](product-readiness-v1.2.md)。

含 `TRANSPOSE`、permutation 為 `[-1, 0]` 的合法模型，原檔可由內建 LiteRT CPU 執行，但在編輯區複製另一顆 `ADD` 後，匯出會被誤判為 permutation 不合法。原生 Windows Chrome／Edge 均已重現此錯誤；最小案例只需一顆 OP、一維輸入及 `[-1]`。

修正先檢查 `[-rank, rank)` 範圍，再把負軸轉成對應正軸，用於唯一性與 output shape 比較。`[-1, 1]` 這種轉換後重複的 axis 仍拒絕；越界與不符的 output shape 也仍拒絕。這只改驗證計算，不改寫原始 permutation、權重或 tensor 編號，常數讀取預算仍為 4 MiB。

同一欄位原本錯誤允許 `int64`。兩份只有 permutation dtype／資料寬度不同的小模型中，`int32` 可執行，`int64` 在內建 LiteRT 配置失敗；另以真正 8-byte 對齊及逐值 readback 排除對齊／序列化因素。現在新增 OP 的 metadata 與匯出候選的常數檢查都要求 permutation 使用 `int32`，並在讀取資料前指出原因與 OP／tensor 位置。`GATHER` 合法的 `int64` indices 保持可用，不對所有整數 tensor 作全域限制。

規則對照固定來源的 [TRANSPOSE kernel](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/transpose.cc)及 [TFL_TransposeOp 定義](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td)。五個原始小型正／負軸模型的真實 CPU 輸出，以及修改、重新解析與雙輸出的 CPU 回歸均已核對；目前 56 項相關 Node 測試通過。打包後原生候選的修正後驗收仍待完成，不能由這些測試宣稱正式站已更新。

一般編輯與匯出仍只做本機結構／資料檢查；需要執行時先開啟匯出結果，再手動到「執行模型」選 raw `.bin` 或其他既有輸入。沒有自動啟動 interpreter，也沒有把這組公開合成模型的配置失敗當成使用者未提供模型的既定根因。
