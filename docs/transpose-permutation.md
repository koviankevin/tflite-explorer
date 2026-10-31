# TRANSPOSE permutation 驗證修正

v1.2.1 候選修正，尚未發布；目前固定正式站仍為 [v1.2.0](product-readiness-v1.2.md)。

含 `TRANSPOSE`、permutation 為 `[-1, 0]` 的合法模型，原檔可由內建 LiteRT CPU 執行，但在編輯區複製另一顆 `ADD` 後，匯出會被誤判為 permutation 不合法。原生 Windows Chrome／Edge 均已重現此錯誤；最小案例只需一顆 OP、一維輸入及 `[-1]`。

修正先檢查 `[-rank, rank)` 範圍，再把負軸轉成對應正軸，用於唯一性與 output shape 比較。`[-1, 1]` 這種轉換後重複的 axis 仍拒絕；越界與不符的 output shape 也仍拒絕。這只改驗證計算，不改寫原始 permutation、權重或 tensor 編號，常數讀取預算仍為 4 MiB。

同一欄位原本錯誤允許 `int64`。兩份只有 permutation dtype／資料寬度不同的小模型中，`int32` 可執行，`int64` 在內建 LiteRT 配置失敗；另以真正 8-byte 對齊及逐值 readback 排除對齊／序列化因素。現在新增 OP 的 metadata 與匯出候選的常數檢查都要求 permutation 使用 `int32`，並在讀取資料前指出原因與 OP／tensor 位置。`GATHER` 合法的 `int64` indices 保持可用，不對所有整數 tensor 作全域限制。

規則對照固定來源的 [TRANSPOSE kernel](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/transpose.cc)及 [TFL_TransposeOp 定義](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td)。五個原始小型正／負軸模型的真實 CPU 輸出，以及修改、重新解析與雙輸出的 CPU 回歸均已核對；目前 56 項相關 Node 測試通過。

## 打包候選與實際下載

乾淨來源 `4b0822e0df200bfb969a8fa7ea7ab9d387d98484`／build `32a2194e23e040a1` 的 322 個核心檔案由原驗證器核對。Windows Chrome／Edge 在 1280×640、32px 以原生選檔開啟負軸模型，複製另一顆 ADD，匯出三顆 OP 的 TFLite，再直接開啟結果、搜尋及定位 TRANSPOSE，最後手動用 raw BIN 執行。兩份實際下載的 SHA-256 相同，獨立 Python FlatBuffer 讀取器核對原始連線與 `[-1, 0]` 的 signed int32 bytes；IO ZIP 的 CRC、輸入及兩份輸出 `[2, 8, 4, 10, 6, 12]` 也都核對。

Edge 整輪與正常退出通過。Chrome 完成功能、五個 Worker 都原生 close，但最後 `browser.close()` 超過原 10 秒上限，**Chrome 整輪仍失敗**；SDK 後續的 force kill 已記錄，不能當成正常退出。補跑的只有原本未執行的 Edge 案例，沒有重跑 Chrome 或修改 timer。這是仍待查的間歇性關閉問題，不因功能輸出正確而抹除。完整[收據](results/transpose-permutation.json)及[原始失敗／成功、截圖、模型、IO、讀取器與來源](results/transpose-permutation-evidence.zip)保留。

候選功能修正已取得上述證據；受保護 PR、來源綁定發布關卡與正式交付尚未完成，不能宣稱正式站已更新。後續文件／證據提交須核對應用與測試內容與這份候選相同，不能把不同 commit 直接標成同一份原生驗收來源。

一般編輯與匯出仍只做本機結構／資料檢查；需要執行時先開啟匯出結果，再手動到「執行模型」選 raw `.bin` 或其他既有輸入。沒有自動啟動 interpreter，也沒有把這組公開合成模型的配置失敗當成使用者未提供模型的既定根因。
