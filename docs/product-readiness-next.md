# 商品等級後續工作（進行中）

使用者於 2026-10-31 將目標接續為「商品等級」。目前正式版仍為 v1.1.0／build `9338194b51c14371`；本文件記錄其後的工作，不把開發中功能當成正式交付。目標是公開核心可供工程師可靠日常使用，保留全部尚未完成項目；不以單個合成模型或綠燈宣告完成。

沿用使用者範圍：模型、權重、測試輸入及診斷全程本機；Chrome／Edge、14 吋桌面與 32px；不測手機、Firefox／WebKit，不自行啟動兩小時負載；內網模型、私有 dialect／compiler／custom runtime 由使用者處理。一般編輯／匯出不自動執行 interpreter。既有安全、RSS 與 runtime／URL timer 不放寬。

| 工作 | 要證明的行為 | 狀態 |
| --- | --- | --- |
| 編輯合法性與錯誤定位 | 常用 OP 的 shape、dtype、常數／量化正負例；實際序列化、原始權重／options 保留與 CPU 結果；runtime 錯誤可對照 OP／tensor，無法唯一對應時明列候選 | 進行中：卷積／pooling 共用靜態推導與檢查；已取得真正 LiteRT allocation 失敗的 kernel/node 診斷，UI 尚待驗收 |
| Custom 子模型資料保留 | 未知引用保守保留；有可信引用契約才能安全縮減；預覽與實際匯出一致、契約負例拒絕、擴充不污染公開包 | 尚待處理，v1.1.0 僅提供 metadata 大小預覽 |
| Windows 大模型可靠性 | 在明確環境的有限輪數操作中觀察整個瀏覽器／Worker、原生關閉及匯出後釋放；權重、options、pattern、草稿／視角保留 | 尚待處理；先前 Windows 小型 UI 與 Linux 大檔證據分開保留，不混成 Windows 大檔記憶體通過 |
| Generic MLIR 支援邊界 | 支援型別的 dense／hex 計數、SSA／dominance；外部 resource／packing 有明確契約或明列未驗證；公司 dialect 接點可獨立建置 | 計數與既有擴充已交付；resource／packing 等仍待處理，不宣稱通過公司 verifier |
| 啟動與診斷 | 公開請求／啟動問題可收集不含模型的白名單診斷；中斷後可恢復；歷史失敗保留，根因須由可重現證據確認 | 歷史 preview.22 的一次啟動逾時仍未重現，不反覆重跑成功部署冒充修好 |
| 保存、操作及發布 | 草稿／pattern 異常與遷移可恢復；主要新手流程與鍵盤可操作；固定產物、相依 scope、必要關卡、正式站與 Release 一致，回退不破壞使用者資料 | 既有功能與交付證據沿用；新功能仍須補受影響驗收；OS 斷電、完整螢幕閱讀器與任意格式遷移仍未證實 |

## 卷積／pooling 與 allocation 診斷

新增 metadata 規則對照 TensorFlow 固定來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/conv.cc)、[depthwise_conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/depthwise_conv.cc)、[pooling.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/pooling.cc)及 padding.h。編輯推導與匯出檢查共用同一模組；不讀權重、不跑 runtime。涵蓋 NHWC、SAME／VALID、stride／dilation、grouped channel、depthwise filter layout、bias 與 output shape；動態／未知 shape 保留明確參考，不虛構推導。Hybrid filter 不強制與浮點 input 同 dtype，depthwise multiplier 依 filter／input channels 推導，不誤用舊參數作判定。

本機的真實 LiteRT.js 2.6.0 CPU WASM 已執行五種小型公開合成模型（CONV_2D、DEPTHWISE_CONV_2D、AVERAGE_POOL_2D、MAX_POOL_2D、L2_POOL_2D），核對匯出重開、數值結果、錯誤輸出拒絕與 filter／bias bytes 保留；這不代替任意 kernel、量化或公司模型驗收。

實際的 channel 負例出現 `Node number 0 (CONV_2D) failed to prepare`，allocation 失敗是在 `run()` 階段才回報。診斷保留原階段及原文，不能單憑「invoke」判斷為測試輸入問題。來源對照最多帶 512 個 OP／每側 32 個 port，截斷明列；依 node 編號與 builtin 名稱列出候選，重複日誌去重，多 subgraph／delegate 或不完整 context 不冒充唯一定位。來源模型改變後不得用舊位置導覽。

這些仍是開發中結果；尚未發布、尚未完成新 UI／打包後瀏覽器與現行必要關卡。先前使用者那份 allocation 失敗模型並未提供，不宣稱已確認其根因。

## 公開模型驗收找到的空 buffer 問題

另取 TensorFlow 官方 tflite-micro 固定修訂 `9c74b4e7f9cb7afabea9859ef85f7df885148485` 的 hello_world_float、hello_world_int8、micro_speech_quantized 與 seanet/conv/conv10 共四份小型模型；原始 bytes、Git blob SHA、SHA-256、來源及 Apache License 保留於本機 QA。它們不是公司模型，也不包含新增的私有 dialect。

第一次驗收中，micro_speech_quantized 與 int16 conv10 原檔都成功 CPU invoke，完整 identity edit 後卻失敗：`Tensor ... is invalidly specified in schema`／`required_bytes <= bytes`。直接檢查 FlatBuffer 欄位後，將缺陷縮成三個確定失敗的回歸：整份模型、子模型及組合模型都把原本不存在的 `Buffer.data` 欄位重建成明確存在的零長度 vector。若 activation tensor 使用非零 buffer 編號，runtime 會將其視為不足長度的唯讀資料。

修正只保留欄位的原始存在性：不存在維持 null，明確空 vector 仍存在；非空權重仍以原始 File range 保留，不讀整份權重或合併 buffer 編號。三個存在性回歸及解析、切圖、custom、組合、真正 CPU 等受影響 35 項已通過；真實公開模型的修正後驗收尚待完成。

兩個 hello_world 原檔宣告 dynamic shape signature，現行手動 runtime 按既有政策拒絕；不為了讓樣本通過而抹掉 signature 或放寬限制。仍應驗證其結構、匯出重開及保留 bytes，執行結果列為未能驗證，不冒充 CPU 通過。
