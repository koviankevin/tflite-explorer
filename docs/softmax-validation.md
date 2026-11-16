# Softmax／LogSoftmax 檢查

本項已於 v1.12.4 正式交付，完整來源與固定下載見文末收據。下方保留原候選與失敗時的狀態。接續 OP 靜態驗證與報告，模型維持在本機處理，開檔、編輯及匯出不會自動執行 interpreter。

## 主分支大檔關卡失敗，尚未發布

[PR #300](https://github.com/koviankevin/tflite-explorer/pull/300) 的完整 Node 為 1,175 項通過、35 項既有環境略過；實際受測 tree 與合併來源相同。主分支契約及網站 54 項通過；核心效能 91 檔相依未變，可沿用既有成功證據。這些成功不取代失敗的大檔關卡。

原 [43924226459](https://github.com/koviankevin/tflite-explorer/actions/runs/43924226459) 完成八輪全部匯出／重開、權重、custom options、pattern 與恢復指紋，57 個 Worker、六個觀察到的程序正常關閉。但原政策重判為 `closed-rss-drift`：斜率 1,504,753.37 bytes／輪在 16 MiB／輪內，漂移 143,175,680 bytes 超過 134,217,728-byte 上限，main heap 漂移 235,548 bytes。第 2 輪總 RSS 為 599.72 MiB，第 3～8 輪為 729.88～737.61 MiB；仍不判定為無持續累積或原生 leak 已定位。

[原始失敗摘要](results/softmax-physical-gate-failure.json)保留 provider SHA-256、八輪及與先前已核對來源的比較；原 ZIP／日誌／完整 metadata 保存在本機。舊成功來源也有約 130 MiB 的高低平台，但不是同機交錯測試，不能由此排除回歸。過去同版本 Chromium 的[獨立 pool 歸還證據](renderer-release-minimization.md#已觀察到同一-renderer-的-pool-歸還)是本次假說的參考，不回推為這輪根因。

已事先限定一次 [43928071416](https://github.com/koviankevin/tflite-explorer/actions/runs/43928071416) 唯讀 native 歸屬診斷，保留原八輪／RSS／timer 規則，補充 owned PID 的 anonymous／file／shared RSS、主頁 heap／backing／DOM。診斷不可作發布證據；不以它的成功覆蓋原失敗、不重跑失敗關卡碰綠燈、不調高上限、不強制 GC，也未啟動部署。下一步依實際分類縮小可驗證的應用配置問題；商品等級目標維持未完成。

### 唯讀診斷實際結果

該次診斷已完成，原八輪政策重判通過，但用途仍是觀察而非發布。來源與失敗關卡相同，八輪共 24 份完整／局部／組合匯出 SHA-256 與原失敗逐份一致，57 個 Worker、六個觀察到的程序均正常結束。共 2,033 個完整 RSS／native 樣本、209 筆詳細資料及原五次 settle 共 40 筆，沒有退出／PID 重用缺口。原 ZIP 的 provider SHA-256、CRC、來源及全部樣本對應均核對；另一份 Python 讀取器獨立重算數值。

| 輪次 | 原關閉 RSS（MiB） | Renderer anonymous（MiB） | GPU anonymous（MiB） | 主頁 heap total（MiB） |
| --- | ---: | ---: | ---: | ---: |
| 1 | 582.23 | 90.12 | 14.34 | 8.07 |
| 2 | 599.40 | 98.74 | 14.30 | 8.07 |
| 3 | 602.73 | 100.86 | 14.32 | 8.32 |
| 4 | 729.36 | 226.94 | 14.34 | 8.07 |
| 5 | 608.18 | 105.31 | 14.33 | 8.07 |
| 6 | 606.83 | 104.81 | 14.31 | 8.57 |
| 7 | 611.46 | 107.59 | 14.32 | 8.32 |
| 8 | 609.98 | 108.05 | 14.33 | 8.32 |

表中的 native 分類是依原五次 settle 點另外觀察的中位數，不與原 RSS 混算。七輪 release phase 觀察到約 124 MiB 的 renderer anonymous 下降，對應的 renderer file／shared 與主頁 heap total 沒有同級變化；第 4 輪 settle 仍處於高平台。GPU 與主頁 backing 約 1.25 MiB 大致平穩。這支持 renderer 原生記憶體延後保留的方向，尚不能辨識具體物件／allocator，或從新診斷回推原失敗根因。

原 RSS 與 native status 並非同時讀取，最大差值 129,744,896 bytes 照實保留；第 6／8 輪的 native 大幅下降，沒有在相鄰原 RSS 點形成等量步階，不作扣除或對齊修正。新讀取器先用先前已封存的 1,720 樣本真實資料驗證，再以八種來源／樣本／重複／缺漏篡改拒絕案例及獨立 Python 重算核對，沒有依本輪數值調整門檻。

[公開數值摘要](results/softmax-native-attribution.json)保留來源、provider 雜湊、分類與釋放步階；原始資料、讀取器及原關卡失敗共 15 檔封存在本機，400,873 bytes，SHA-256 `700cae3033e5d16a24f6d165251b582e387365feedef046b1a306cf60a46b430`。原始 PID／路徑與本機日誌不公開上傳。發布判定器實際拒絕這份已通過的診斷報告；原必要關卡維持失敗，正式站與固定 Release 仍為 v1.12.3。

後續先量測目前解析／索引的實際配置成本，再用同一份 21,005 OP 結構與完整搜尋／匯出指紋比較候選。只有可證明的應用減量才進入新來源的原政策驗收，不改 pool、GC、settle、基準或 RSS 上限。

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

## v1.12.4 正式交付

[v1.12.4](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.12.4)，build `f8a2d9d3ac4f8501`：Softmax／LogSoftmax shape／dtype 檢查及報告已交付，並減少 TFLite 鄰接索引與小型 Int32 metadata 配置。355 個核心檔、全站 1,549 檔、54 項正式 HTTPS 操作及四份實際固定下載均核對；Chrome／Edge 各 10 個 32px 情境通過。1.25 GiB／21,005 OP 八輪依原政策通過，RSS 漂移 12,595,200 B；前兩次失敗原樣保留。見[正式交付收據](results/softmax-v1.12.4-published.json)及[檢查範圍](softmax-validation.md#v1124-正式交付)。模型全程本機處理，interpreter 仍由使用者手動啟動；不將有限測試擴大為任意 kernel、所有模型精度或 Windows 大檔保證。

正式 Native 兩端各有 16 個模型、四個手動 runtime 及一個 layout Worker，Chrome 另觀察到一個自動保存 recovery Worker；全部關閉。總數不同來自既有背景保存排程，未修改應用、重跑成功案例或忽略未關閉 Worker；依實際種類與來源 URL 核對。
