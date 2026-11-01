# FULLY_CONNECTED 型別與 optional bias（v1.4.4 候選）

目前正式站與固定下載是 [v1.4.3](gather-validation.md#v143-正式交付)。以下為尚未發布候選的實際修正與有限本機證據；一般編輯／匯出不自動執行 interpreter。

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
