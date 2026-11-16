# TRANSPOSE／EXPAND_DIMS 的 metadata 檢查

已在 [v1.12.2](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.12.2) 正式交付，build `e1e4e662d7c4ab0f`；[收據](results/axis-transform-v1.12.2-published.json)保留正式站與實際固定下載核對。此項接續 OP 靜態驗證，不增加自動 interpreter。下方候選、失敗與未解診斷保留各自來源及範圍。

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

104 項相關 Node 測試與 28 項瀏覽器選測／發布證據判定測試通過。包含實際序列化正負例、讀取前拒絕、動態未檢查、複製匯出重開、原始參數 bytes、固定 LiteRT.js 2.6.0 CPU 的失敗與輸出數值對照。

首次 [PR 全套 Node](https://github.com/koviankevin/tflite-explorer/actions/runs/43887108184)有一項舊測試失敗：BOOL／int16 EXPAND_DIMS axis 原預期只列未檢查，與新的明確 dtype 拒絕不同。測試更新為要求讀取前拒絕，仍保留 PAD 共用讀取器不得擴大其他 OP dtype 的原目的；新增測試未刪除，原失敗日誌保留。其餘相同應用的 Chrome／Edge 操作證據沿用。

獨立 Windows Chrome／Edge 在 1280×640、32px 各完成六個原生操作情境：三個錯誤零下載；合法負軸、int64 scalar axis 及動態 axis 各複製匯出、下載報告、bytes 比對並重新開啟。各九個模型 Worker 關閉，零個自動 runtime Worker。[候選收據](results/axis-transform-candidate.json)綁定來源檔、受測建置、報告與截圖。這些小型候選證據不代替主分支實體大檔、正式站或固定 Release 驗證。

## Runtime 對照發現與界線

固定 CPU WASM 的 XNNPACK 路徑能執行常數二維 permutation，並得到預期數值；不能把它說成此 runtime 必定拒絕。本次 metadata 拒絕依一般 TRANSPOSE kernel 的一維契約，不因 delegate 特例擴大可攜匯出契約。EXPAND_DIMS 的非整數 axis 與多元素 axis 則在這次 CPU 實際配置失敗，原始 `invoke` 階段與訊息保留。

另一次有界診斷中，將 TRANSPOSE permutation 改成模型輸入後，合法一維及二維參數兩例都回報執行成功，但擷取輸出不符合預期 `[1,4,2,5,3,6]`。[診斷收據](results/axis-transform-runtime-diagnostic.json)保留合成模型 SHA、原始輸出及來源。接續繞過網站 execute／IO archive，直接呼叫固定 LiteRT API：執行前後讀回兩個輸入都正確，動態 permutation 的原始輸出仍不符；同程序的常數 permutation 對照則正確。這排除了「必須經過網站 IO ZIP 才發生」的解釋，仍未定位 runtime／動態介面或合成來源的所有原因，不能稱為已修復或可靠數值結果。本次不更改 runtime 或用這些動態案例證明數值正確。

接續的[值相依 shape 對照](results/value-dependent-runtime-diagnostic.json)保留八個獨立編譯案例：TRANSPOSE／EXPAND_DIMS／RESHAPE 將 shape 參數作模型輸入時，原始輸出皆不符；相應常數參數案例、整數 ADD 與含 int32 indices 的 GATHER 模型輸入對照皆正確。相同動態 TRANSPOSE 連續執行兩次仍不符，常數對照兩次皆正確。這縮小了「整數輸入一律誤配」與網站 ZIP 擷取等解釋，仍不證明完整根因，也不以重跑當作修正。官方 [LiteRT.js 入門](https://developers.google.com/edge/litert/web/get_started)要求固定 input／output 維度；本次模型宣告看似固定，但依這些 OP 的語意，輸出 shape 可隨參數值改變，其 runtime 適用性需另行釐清。

## 首次正式 HTTP 驗收失敗

[正式發布 attempt 1](https://github.com/koviankevin/tflite-explorer/actions/runs/43892112805/attempts/1)的 prepare／deploy 成功，HTTP 核對完成 840 檔後回報 `fetch failed`，未開始瀏覽器操作，也未建立固定 Release。原報告沒有 URL／transport cause，不能宣稱已定位網路根因。原 artifact `14237606355` 已保存 [42,936-byte ZIP](results/axis-transform-v1.12.2-first-live-failure.zip)，SHA-256 `b754479e9e2f556aaa189a2c15202ccad54585292ebd48b5079a11d37ba40157` 與伺服器 digest 相同。只補跑失敗驗收一次；attempt 2 的 verify_live／release 成功，prepare／deploy 的開始、結束及逐步時間與原工作完全一致，沒有重新部署或放寬規則。

## v1.12.2 正式交付

[PR #294](https://github.com/koviankevin/tflite-explorer/pull/294) 合併後，同一應用來源的四項必要關卡均核對通過；[PR #295](https://github.com/koviankevin/tflite-explorer/pull/295) 選定來源綁定證據。核心 90 檔相依範圍未變，沿用可信 main 的九筆效能量測；新來源的 1,349,965,216-byte／21,005 OP 模型完成原八輪，暖機後六輪 RSS 斜率 1,449,866.97 bytes／輪、末段漂移 10,301,440 bytes，瀏覽器正常關閉。此 Hosted Linux 結果不代替完整 Windows 大檔或任意模型 SLA。

正式來源 `6a2c67bd5b93777ebb8a43d950f4db19cc1d04a9`、build `e1e4e662d7c4ab0f`，345 核心檔、全站 1,529 檔的 bytes／SHA／MIME、52 項正式操作、191 個模型 Worker 關閉與觀察到的程序清理均通過。原生 Windows Chrome／Edge 各六情境、九個模型 Worker、32px、零個自動 runtime 與實際匯出重開另有獨立證據，不換標為 Windows 大檔驗收。

固定 Release 於 2026-11-16 23:19:04（UTC+8）發布，tag／Latest／權威 deployment 及四份實際下載均核對。ZIP 41,431,377 bytes，SHA-256 `7890b426b92aceec8b8f8b7f61c34d74c22e726c47b9546d19958c6c94e065ba`；[最終收據](results/axis-transform-v1.12.2-published.json)及[正式筆電畫面](results/axis-transform-v1.12.2-live-edge.png)保留完整來源與界線。首次 HTTP 失敗、原 PR 舊測試失敗及上方數值異常沒有改列修復。未同步 Sites／GH Studio，也未重跑成功部署。
