# FULLY_CONNECTED 型別與 optional bias（v1.4.4）

已於 [v1.4.4](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.4) 正式交付，build `14d6d1628c5136c5`。一般編輯／匯出仍只做靜態檢查，interpreter 保持手動。以下候選及失敗紀錄維持原受測來源與當時狀態；目前交付見[正式交付](#v144-正式交付)。

## 實際重現

浮點 input／weights 配 int32 output，原先可實際編輯、序列化及重新開啟，結構檢查通過，逐 OP 報告僅列未檢查。另兩份動態 output dtype／三維 weights 的錯誤模型也被接受。三份原始檔與雜湊留在本機；修正後以完全相同 bytes 重讀，編輯與序列化兩個入口均在讀權重之前拒絕，保留 subgraph、OP、input／output tensor 位置。

真正的 LiteRT.js 2.6.0 CPU 對照確認，第一份錯誤原檔在 prepare 拒絕 `INT32 != FLOAT32`，尚未 invoke；合法浮點控制與無 bias 原檔則算出 `[1, 2, 3]`。這不是使用者未提供的公司模型，不將它當成歷史 allocation 錯誤的根因。

移除 bias 的縮減過程另找到誤擋：原本 Netron port metadata 把三個 FC inputs 都列成必要，合法的兩個 slots 或第三 slot 為 `-1` 都無法編輯。官方 CPU Prepare 明確接受兩或三個 slots，bias 可省略；現在只覆寫 FC 的 cardinality，保留其他 OP 的規則。SHUFFLED4x16INT8 有兩個 outputs，不能當作一般單 output 的 DEFAULT。

## 修正與界線

共用 `checkFullyConnectedMetadata` 接到編輯與序列化報告。dtype、weights rank、已知 output rank、bias 元素數及 input／weights 可確定的尺寸關係不再依賴整組 output 完全靜態才檢查；`keep_num_dims` 與 flatten 保留 BigInt 元素數檢查。中間結果和未知尺寸不讀取權重，也不啟動 runtime。

格式定義與 CPU encoding 清單不同：合法 float16／uint16／uint32 格式和未實作的 mixed dtype 明列未檢查，CPU 接受的 int64 quantized bias 不被誤擋。非空 `quant_spec` 表示非標準量化契約，保留原 bytes 並列未檢查；shuffled workspace／packing、零 input_size 的特殊路徑也不冒充已驗證。Custom op 即使名稱為 FULLY_CONNECTED 也不套用 builtin 規則。靜態通過不代表任意 kernel、量化數值或公司契約可執行。

依據為 TensorFlow 固定修訂 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [FC 格式定義](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td#L1135)、[CheckTypes／Prepare](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/fully_connected.cc#L270)、[官方案例](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/fully_connected_test.cc)及 [OP version](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/tools/versioning/op_version.cc#L172)。原始檔、授權與 SHA-256 留存於本機，沒有上傳模型或權重。

## 目前驗收範圍

初始三項檢查二項失敗、一個合法控制通過；增加 optional bias 與動態已知錯誤後二十二項有二十項失敗。原始失敗均保留。修正後 199 項受影響測試通過，包括實際編輯、匯出重開、原始 weights／bias bytes、逐 OP 報告、未檢查計數與既有 GATHER／BATCH_MATMUL、量化及編輯／組合流程。

其中十三種實際匯出後 CPU 正例涵蓋 float、row bias、兩種無 bias slots、flatten、keep_num_dims、兩種 hybrid、int8／uint8、int16＋int8／int64 bias，以及無 bias 的切圖與組合輸出；數值、原始常數 bytes、量化欄位與 OP version 均核對。這些是小型公開合成模型，沒有拿有限 CPU 結果代替任意模型保證。

Chrome／Edge 的獨立原生驗收已完成：[候選數值收據](results/fully-connected-candidate.json)對應乾淨來源 `a52c88934227f15ade630ac71b4ea1a812eb1fb3`／tree `2c76108be3e3f3cff8421b592c0e2fdb7dd1ced1`、build `80e3229c02d36e06`，329 核心檔。每端六種情境，合計十六份實際模型／報告下載；兩種已知錯誤零下載，無 bias／int64 bias 的原生接線、未知 quant_spec／動態未檢查狀態、32px 報告與重新開啟搜尋通過。每端十一個 Worker（十個 model Worker）與觀察到的自有程序均依原十秒政策正常退出，沒有自動 runtime。兩張實際截圖另已查看。

八份模型下載均獨立串流比對原始權重／bias、型別／shape／signature／量化欄位、options 與 OP version；每份 singleton FC pattern 為兩筆，未連接的 FC→FC pattern 為零筆。四份已知合法下載另外真正 CPU invoke，兩個 outputs 都是 `[1, 2, 3]`，四份 IO ZIP 的 digest 與 CRC 通過。未知 quant_spec／動態案例未拿來冒充 CPU 通過。這些原生資料不是正式 HTTPS 或實體大檔 RSS 證據。

相依範圍核心 88 檔未變，可接續重新核對可信 main 證據；browser 351、contract 673、site 398 檔已改變，仍須完成來源綁定的新 main 關卡。正式 HTTPS／固定 v1.4.4 Release 尚待接續，目前公開版仍是 v1.4.3；沒有同步 Sites／GH Studio、重跑成功部署、調整 timer／GC／RSS 門檻或改寫歷史失敗。完整商品等級目標保留。

## 四項主分支關卡已核對（尚未發布）

[PR #227](https://github.com/koviankevin/tflite-explorer/pull/227) 已合併為 `11dbe657ae63d3c05cd3e7f6f5a9cdcf1206a358`，完整 tree 與實際 PR checkout 相同。Node 1,004 項中 969 通過、35 個既有選做略過；79 項契約與九筆 PR core 原始報告也已核對。正式 core 沿用相同 88 檔 scope 的可信 main `41269145087`，重新核對 provider 狀態、digest／CRC、原政策與相依檔；PR core artifact 不冒充主分支 dispatch。

[四關卡數值收據](results/fully-connected-main.json)對應來源 `11dbe657ae63d3c05cd3e7f6f5a9cdcf1206a358`／tree `0d50cb707b8a712e0d29b168d7c05e8f76e5a09d`、build `581db5eeeffac7b2`。新來源的 79 項契約零略過、六種版本切換及 824 檔 HTTP 候選／38 項操作通過，含 15 組 32px 文字框、19 種手動 runtime、部分 IO 與八輪 CPU／IO。六組 FC 原生案例另有各自的候選來源，不宣稱它們字面包含在原 38 項 smoke。

[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41287520246)使用原 1,349,965,216-byte／21,005 OP fixture，完整／局部／組合匯出重開、權重／custom options／pattern 及正常關閉通過。關閉後 RSS slope -1,269,760.00 bytes／輪、drift -135,168 bytes、main heap drift 176,276 bytes，sampled peak 1,099,788,288 bytes；57 個 Worker 與 6 個觀察到的自有程序正常退出。原政策重算通過，沒有 forced GC、RSS 扣除、timer、pool 或門檻變更；有限八輪不代表任意模型或長期記憶體保證。

上述主分支驗收完成當時，正式 HTTPS、固定 Release 與四份實際下載尚待接續，公開版為 v1.4.3；後續 v1.4.4 交付見下節。完整商品等級目標與歷史失敗保留。

## v1.4.4 正式交付

固定來源 `d68ebecab156f3b2ef6aac04f66a73de5bfa3bd2`／tree `d0d14db5714f950bdb8bd8f10dff709cd562a85e`、build `14d6d1628c5136c5` 已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41290477405)完成，四項工作 attempt 1 全成功。329 核心檔、全站 1,481 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對，包含 15 組 32px 文字框、搜尋／pattern／MLIR 與 TFLite 匯出重開、逐 OP／量化／legacy shape 報告、部分 IO、19 種手動 runtime 及八輪／24 次 CPU／IO。獨立 FC 原生 Chrome／Edge 六組案例保留其候選來源；不宣稱它們字面新增在原 38 項 smoke 中。

固定 ZIP 41,308,579 bytes，SHA-256 `2c2749bcd1cca2a359ef7d6e25576633afd58d6b970b98a2d008383ea1185679`；四份實際公開下載與準備產物一致，tag／Latest／權威 Pages deployment 已核對。Site ID `ec9ffcc4896e964b800e9c9d1f8140d2b08de9e3032dd49d6d7fc75835ecaf2f`，保留 v1.4.3／v1.4.2 與永久 baseline。舊 v1.4.3 tag 與四份 asset 未改寫。[最終收據](results/fully-connected-v1.4.4-published.json)僅含來源、雜湊、計數與有限結果；原始報告、截圖、環境與程序身分完整留在本機。官方 REST 的 job 時間與原始日誌約差一小時，原因未定；報告來源以同一 job 的原始測試步驟時間、完整 checks 摘要、checkout、build／site ID 及 artifact ID／雜湊／大小核對，原始時間保留且未正規化。成功部署沒有重跑，沒有同步 Sites／GH Studio。

本版修正已知 dtype／rank／尺寸矛盾及 optional bias 的誤擋。格式允許的 encoding 不等於 CPU kernel 全部支援；未知 quant_spec、packing、零寬特殊路徑、量化數值、公司契約、歷史 Windows Chrome／網路注入及長期記憶體 SLA 保留原界線。完整商品等級目標未完成。
