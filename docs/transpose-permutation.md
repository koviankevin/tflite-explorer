# TRANSPOSE permutation 驗證修正

v1.2.1 候選修正，尚未發布；目前固定正式站仍為 [v1.2.0](product-readiness-v1.2.md)。

含 `TRANSPOSE`、permutation 為 `[-1, 0]` 的合法模型，原檔可由內建 LiteRT CPU 執行，但在編輯區複製另一顆 `ADD` 後，匯出會被誤判為 permutation 不合法。原生 Windows Chrome／Edge 均已重現此錯誤；最小案例只需一顆 OP、一維輸入及 `[-1]`。

修正先檢查 `[-rank, rank)` 範圍，再把負軸轉成對應正軸，用於唯一性與 output shape 比較。`[-1, 1]` 這種轉換後重複的 axis 仍拒絕；越界與不符的 output shape 也仍拒絕。這只改驗證計算，不改寫原始 permutation、權重或 tensor 編號，常數讀取預算仍為 4 MiB。

同一欄位原本錯誤允許 `int64`。兩份只有 permutation dtype／資料寬度不同的小模型中，`int32` 可執行，`int64` 在內建 LiteRT 配置失敗；另以真正 8-byte 對齊及逐值 readback 排除對齊／序列化因素。現在新增 OP 的 metadata 與匯出候選的常數檢查都要求 permutation 使用 `int32`，並在讀取資料前指出原因與 OP／tensor 位置。`GATHER` 合法的 `int64` indices 保持可用，不對所有整數 tensor 作全域限制。

規則對照固定來源的 [TRANSPOSE kernel](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/transpose.cc)及 [TFL_TransposeOp 定義](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td)。五個原始小型正／負軸模型的真實 CPU 輸出，以及修改、重新解析與雙輸出的 CPU 回歸均已核對；目前 56 項相關 Node 測試通過。

## 打包候選與實際下載

乾淨來源 `4b0822e0df200bfb969a8fa7ea7ab9d387d98484`／build `32a2194e23e040a1` 的 322 個核心檔案由原驗證器核對。Windows Chrome／Edge 在 1280×640、32px 以原生選檔開啟負軸模型，複製另一顆 ADD，匯出三顆 OP 的 TFLite，再直接開啟結果、搜尋及定位 TRANSPOSE，最後手動用 raw BIN 執行。兩份實際下載的 SHA-256 相同，獨立 Python FlatBuffer 讀取器核對原始連線與 `[-1, 0]` 的 signed int32 bytes；IO ZIP 的 CRC、輸入及兩份輸出 `[2, 8, 4, 10, 6, 12]` 也都核對。

Edge 整輪與正常退出通過。Chrome 完成功能、五個 Worker 都原生 close，但最後 `browser.close()` 超過原 10 秒上限，**Chrome 整輪仍失敗**；SDK 後續的 force kill 已記錄，不能當成正常退出。補跑的只有原本未執行的 Edge 案例，沒有重跑 Chrome 或修改 timer。這是仍待查的間歇性關閉問題，不因功能輸出正確而抹除。完整[收據](results/transpose-permutation.json)及[原始失敗／成功、截圖、模型、IO、讀取器與來源](results/transpose-permutation-evidence.zip)保留。

候選功能修正已經 [PR #187](https://github.com/koviankevin/tflite-explorer/pull/187) 合併至 `8bf6c9bbeedb2b083f8791e33c9d28d3a4a2bd32`；最終 PR 的實際 checkout／合併後完整 tree 都是 `25de84fe66ac128a7153b10343fe300e1b74fc01`。必要 Node／建置檢查為 785 passed、35 個原有選做 skips、零失敗，發布契約 78 項零略過；新負軸 CPU 回歸確實執行。應用與測試內容與原生候選 `4b0822e` 相同，沒有把不同 commit 換標成同一份原生驗收。

## 主分支關卡與尚未發布的候選

`8bf6c9b`／build `45837dc98a0009a7` 的[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41200613873)、[發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/41200623742)與[網站操作](https://github.com/koviankevin/tflite-explorer/actions/runs/41200635819)均在 attempt 1 完成，provider digest／ZIP CRC／來源／原 policy 及實際報告已核對。核心的 88 檔相依範圍未變，沿用重新核對的既有 main 關卡，沒有重做相同量測。完整[收據](results/transpose-main-verification.json)與[70 份原始證據](results/transpose-main-evidence.zip)保留。

Linux 實體檔為 1,349,965,216 bytes／21,005 OP；八輪含兩輪暖機，closed RSS slope 約 2.1 MiB／輪、drift 約 14.3 MiB，完整／局部／組合的權重、custom options、pattern、草稿及 57 個原生 Worker close／正常程序退出均核對。網站另有 34 項具名情境、15 個 32px 文字框、19 種手動 runtime 情境、八輪／24 次 CPU／IO 與 150 個觀察到的主流程 Worker 全數 close；其中 86 個為模型 Worker，刻意 crash recovery 的程序另記，不能當成正常 close。

目前仍待成功產物準備、精確 build／site 發布與正式站／固定下載核對，**正式站仍為 v1.2.0**。Windows [空白頁關閉診斷](windows-large-model.md#空白頁的原生程序類型與等待鏈)也保留失敗，這些 Linux 成功不等於已修復 Chrome 間歇性關閉。

一般編輯與匯出仍只做本機結構／資料檢查；需要執行時先開啟匯出結果，再手動到「執行模型」選 raw `.bin` 或其他既有輸入。沒有自動啟動 interpreter，也沒有把這組公開合成模型的配置失敗當成使用者未提供模型的既定根因。
