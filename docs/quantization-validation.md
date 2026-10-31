# Affine 量化欄位檢查與報告（v1.4.0 候選）

目前尚未發布；正式站與固定下載仍為 [v1.3.1](runtime-tensor-diagnostics.md#v131-正式交付)。本候選增加量化欄位的靜態結果，不自動執行 interpreter，也不修改原始權重或量化參數。

TensorFlow 固定來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [interpreter_builder.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/core/interpreter_builder.cc#L615) 會依非空 shape 核對 affine 量化軸，並不以舊檔的 `has_rank=false` 略過；單一 scale 也仍須檢查非空 shape 的軸範圍。[schema](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/schema/schema.fbs#L157) 另規定 QuantizationDetails 會取代 affine 欄位，不能把未知編碼當成 affine 錯誤或已驗證的 codec。

舊版共用檢查只在多個 scale 且完整 known(shape) 時檢查軸，因此漏掉非空 shape／has_rank=false 的來源；同時會錯把其他量化編碼的 affine 欄位拿來判斷。現在共用模組會核對 scale／zero point 數量、有限正 scale、非空 shape 的 quantized_dimension、可知的 per-axis channel 數，以及已支援 dtype 的 zero point 範圍。未知 rank／channel、其他 QuantizationDetails 及超出檢視預算都明列未驗證。

修改／新增／重接 builtin OP 時，確定無效的欄位會附 OP／port 位置阻擋匯出。原樣保留或切出的來源仍可下載，報告列明量化失敗，避免為了通過檢查而修改舊模型。量化檢查通過只代表本段列出的 metadata 規則，不保證 kernel、custom runtime 或數值等價。

報告中的 tensor 編號屬匯出結果。每輪最多檢查 262,144 個 metadata 值、列出 65,536 筆 tensor；省略筆數也計入未驗證。畫面一次只增加 100 筆，完整下載保留同一份界線。既有 4 MiB 常數讀取預算、16 MiB 報告上限、自然 URL／runtime 計時及安全規則不變。檢查只讀已解析 metadata，不增加權重讀取。

四個最小回歸在修改前皆確實失敗，修正後 84 項相關選測及 11 項發布版本選擇通過。真正的 LiteRT.js 2.6.0／CPU WASM 另核對四次有效 int8 ADD 的輸出 bytes（原始、舊 rank flag、重接及切圖），以及只改量化軸後 compile 失敗、零 invoke／IO。第一版 CPU 測試曾要求 runtime 回傳未實際提供的詳細欄位文字而失敗；原文保留，後續用有效軸／無效軸的差異控制，不宣稱取得不存在的詳細日誌。

官方固定 person_detect 原檔的 88 個量化 tensor 中，靜態檢查找到 14 個確定無效的軸，包含舊日誌最後六個；其餘 74 個的本項 metadata 通過。原樣及整圖切出重開後，14 個失敗、量化欄位與 57 份權重 payload 均保留；沒有宣稱原檔 CPU 已可執行。另四份既有官方小型模型的量化 metadata 沒有新增誤擋，原 CPU／dynamic policy 證據保持各自範圍。

模型、輸入與完整診斷留在本機。候選的 32px／Chrome／Edge 操作、正式發布關卡與交付仍待完成；本頁不以未執行的計畫宣告已完成。

