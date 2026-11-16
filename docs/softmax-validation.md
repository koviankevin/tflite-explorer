# Softmax／LogSoftmax 檢查

本項是未發布的 v1.12.4 候選；目前正式站及固定下載仍是 README 記載的 v1.12.3。接續 OP 靜態驗證與報告，模型維持在本機處理，開檔、編輯及匯出不會自動執行 interpreter。

## 問題與修正

修正前，兩個 OP 的錯誤 output shape 和 float32→int32 宣告可通過編輯準備與序列化檢查。六項最小回歸測試先以 `Missing expected exception` 重現；共用規則現在同時用於編輯計畫、匯出後的實際 FlatBuffer 和手動執行前檢查。

獨立 ai-edge-litert 2.3.0 Interpreter 有更重要的觀察：錯誤的 SOFTMAX float32→int32 模型仍可 Allocate／Invoke，輸出的六個 int32 是浮點數位元。兩種 resolver 均回傳 `[1035493875,1048222234,1059736891,1035493875,1048222234,1059736891]`。不能單靠「runtime 回報成功」判定這個模型合法。因此已知 shape／dtype 矛盾會在建立 Worker、下載 WASM 或讀取模型 body 前阻擋；顯示 subgraph、OP 與原因，不回報執行通過。

| 規則 | 本次行為 |
| --- | --- |
| 介面 | 1 個完整 input、1 個完整 output |
| Dtype | SOFTMAX 接受 float32、float16、uint8、int8、int16；LOG_SOFTMAX 接受 float32、uint8、int8。通常 input／output 同型別；保留 CPU 合法的 SOFTMAX uint8／int8→int16 |
| Shape | 已知 rank 及每個可確定的維度相同；SOFTMAX input rank 至少為 1。動態 placeholder 不當作最終大小，仍檢查可確定的矛盾 |
| Beta | 有限 float32 的 0、負數、正數均保留；缺少或非有限係數明列未完成檢查，不擅自宣告合法或要求一定為正 |
| 報告 | 靜態 float32 只對上述 metadata 規則列為已檢查；float16、量化／混合 encoding、未知 shape 和未驗證 scalar 路徑明列未檢查及原因 |

已檢查不代表數值等價、所有 kernel 版本、量化運算契約或每條控制路徑通過。量化參數的一般結構檢查仍另列；本次不把量化模型整體列為靜態驗證通過。Custom op 不會因名稱與 builtin 相同而套用這些規則。

## 來源與獨立對照

規則對照 TensorFlow 固定 commit `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [activations.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/activations.cc) 與 [tfl_ops.td](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td)。實際抓取的原檔 SHA-256 分別為 `2f2de868fe0b542295a399d7dc945d723c8232d9b20664be79bd1127ec53bed0` 和 `f7035997e12a558e3f8cdcaa84948a33eb6057850c58ec79b689bde4b1ca7b98`。CPU 的 uint8／int8→int16 路徑比 MLIR 的 same-element-type trait 寬，已用原生執行確認，不直接照該 trait 誤擋。

15 個合成 FlatBuffers／BIN 有完整 SHA：11 個正例、4 個非法 metadata 對照。獨立 Python 3.13.17／NumPy 2.3.5／ai-edge-litert 2.3.0 分別使用 default 和 BUILTIN_WITHOUT_DEFAULT_DELEGATES，22 個正例數值對照通過。正例包含 float32、beta=0／-1、uint8／int8 同型別、uint8／int8→int16 及 int16 SOFTMAX。負例的原生接受／拒絕原樣保存，沒有把錯誤 int32 位元輸出算為正例。

網站既有 LiteRT.js 2.6.0 CPU WASM 另執行相同 11 個正例，依原始 BIN 檢查輸出及 IO ZIP。預期值獨立計算穩定的 last-axis softmax／log-softmax，量化輸出依原宣告解碼；容差只適用這些合成資料，不是一般精度保證。

## 候選瀏覽器驗收

Windows Chrome／Edge 獨立暫存環境、1280×640、32px 各 10 個情境通過：4 個錯誤模型的手動執行與編輯匯出均拒絕；4 個浮點模型手動載入實際 BIN，數值／IO ZIP 一致；6 個合法模型複製 OP、下載報告、匯出並重開。混合量化的報告維持未檢查，兩個輸出 OP 的 shape、dtype、量化參數都獨立核對。各 16 個模型 Worker、4 個手動 runtime Worker 及觀察到的其他 Worker 均關閉。一般編輯與匯出沒有自動 runtime。

第一輪瀏覽器的測試預期錯誤保留：沒有權重的合成模型，byte-range 比對正確回報 not-applicable，測試卻要求 passed。只修正測試，沒有修改應用或驗證器；後續兩引擎完成，24 個匯出 output tensor 再由下載檔獨立核對。這批模型沒有權重，不能宣稱已做權重 bytes 比對。

新發布的正式 HTTPS 關卡必須保留原 53 項並加入本組第 54 項，核對固定模型 SHA、實際數值、零下載負例、合法混合型別未檢查狀態、匯出重開與 Worker 清理。候選本機驗收不代替主分支必要關卡、正式部署及固定 Release 核對；完成前不宣告已交付。

原始負例、原生環境版本與 30 筆結果、實際模型／BIN、第一次瀏覽器失敗、後續兩引擎全部輸出及獨立複核保留於[候選原始證據](results/softmax-validation-candidate-evidence.zip)（126 檔、1,776,751 bytes，SHA-256 `32792246004eb75948b76edaf07c8a34e0f842957909c1bd87803d445fb2926f`）。其中應用 build 為 `98181abbabdb4817` 的本機未提交候選，不能換標為正式版本或乾淨來源關卡。
