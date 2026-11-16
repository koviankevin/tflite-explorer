# TRANSPOSE／EXPAND_DIMS 的 metadata 檢查

本機候選 v1.12.2，尚未正式發布；目前正式版見 [README](../README.md)。此項接續 OP 靜態驗證，不增加自動 interpreter。

## 修正與支援範圍

先重現五項失敗：TRANSPOSE 的 `[1,2]`／`[2,1]` permutation 會被當成一般元素陣列，動態 input 也會跳過可確定的參數 rank／長度；EXPAND_DIMS 未先拒絕非整數 axis，動態資料則掩蓋可確定的元素數／output rank 矛盾。

新增共用 metadata 檢查，在編輯計畫和實際序列化常數檢查兩個入口使用。可確定的錯誤先於 payload 讀取拒絕，訊息包含 subgraph、OP 及 tensor 位置。動態維度不猜測為常數；仍缺參數值時維持未檢查。

| OP | 本次檢查 |
| --- | --- |
| TRANSPOSE | 兩個完整輸入／一個輸出、input／output dtype 相同、int32 一維 permutation、已知 permutation 長度等於 input rank、output rank 等於 input rank |
| EXPAND_DIMS | 兩個完整輸入／一個輸出、input／output dtype 相同、int32／int64 axis、已知 axis tensor 只有一個元素、output rank 為 input rank + 1 |

EXPAND_DIMS 的 axis 可是 scalar、`[1]` 或 `[1,1]`；不誤套 TRANSPOSE 的一維要求。保留負軸、int64 axis、legacy 非空 shape、明確 scalar 與未知 rank 的差異。原有常數預算、SSA／控制流程、權重、custom options、推論啟動方式與未支援 kernel 語意不變。

規則核對 TensorFlow 固定來源 [`7bc5d217d3bd79426527d0055fd3b54812f52e93`](https://github.com/tensorflow/tensorflow/tree/7bc5d217d3bd79426527d0055fd3b54812f52e93) 的 [transpose.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/transpose.cc) 與 [expand_dims.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/expand_dims.cc)。這是明列的 metadata 契約，不代表任意版本／delegate 的完整 kernel 語意已驗證。

## 本機候選證據

51 項相關 Node 測試與 28 項瀏覽器選測／發布證據判定測試通過。包含實際序列化正負例、讀取前拒絕、動態未檢查、複製匯出重開、原始參數 bytes、固定 LiteRT.js 2.6.0 CPU 的失敗與輸出數值對照。

獨立 Windows Chrome／Edge 在 1280×640、32px 各完成六個原生操作情境：三個錯誤零下載；合法負軸、int64 scalar axis 及動態 axis 各複製匯出、下載報告、bytes 比對並重新開啟。各九個模型 Worker 關閉，零個自動 runtime Worker。[候選收據](results/axis-transform-candidate.json)綁定來源檔、受測建置、報告與截圖。這些小型候選證據不代替主分支實體大檔、正式站或固定 Release 驗證。

## Runtime 對照發現與界線

固定 CPU WASM 的 XNNPACK 路徑能執行常數二維 permutation，並得到預期數值；不能把它說成此 runtime 必定拒絕。本次 metadata 拒絕依一般 TRANSPOSE kernel 的一維契約，不因 delegate 特例擴大可攜匯出契約。EXPAND_DIMS 的非整數 axis 與多元素 axis 則在這次 CPU 實際配置失敗，原始 `invoke` 階段與訊息保留。

另一次有界診斷中，將 TRANSPOSE permutation 改成模型輸入後，合法一維及二維參數兩例都回報執行成功，但擷取輸出不符合預期 `[1,4,2,5,3,6]`。[診斷收據](results/axis-transform-runtime-diagnostic.json)保留合成模型 SHA、原始輸出及來源；尚未確認是 runtime、動態參數介面還是 IO 擷取造成，不能稱為已修復或可靠數值結果。本次不更改 runtime 或用這兩例證明數值正確；後續應以輸入／原始 tensor 讀取對照縮小原因。
