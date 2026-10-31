# Legacy shape 驗證修正（v1.4.1 候選）

目前正式站與固定下載仍為 [v1.4.0](quantization-validation.md#v140-正式交付)。本候選修正舊 TFLite 的非空 shape 被 `has_rank=false` 略過的問題，不修改原始 shape、rank flag、量化或權重，不自動執行 interpreter。

固定 TensorFlow 來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [interpreter_builder.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/core/interpreter_builder.cc#L786) 直接將 shape 轉為 dims；[schema](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/schema/schema.fbs#L321) 的 rank flag 另用於區分空 shape 的 scalar 與未知 rank。網站原本把非空舊 shape 也視為未知，造成實際重新接線的 FC 尺寸錯誤漏擋，以及可讀 TRANSPOSE 常數未檢查。

以真正序列化、解析及編輯流程建立差異控制：同樣的 FC `[2,3]`／weights `[5,4]`，只有 false flag 會漏擋；合法 TRANSPOSE `[2,3] → [3,2]` 則原先列為未檢查。修正後共用 shape 判定套用於語意、spatial、operand 與常數檢查：非空 concrete shape 可用，空 shape／false flag、負維度 signature 仍列未知／動態。最多 128 維及 int32 尺寸，保持常數讀取 1 MiB／tensor、4 MiB／輪；若 data／output 已知動態，直接略過，不先讀參數常數。

108 項相關選測通過；抽出共用合成 fixture 後的六項 caller／動態／維度邊界與十二項版本選擇亦通過。五個 hash 固定官方模型的前後 metadata／常數檢查沒有新增拒絕；micro_speech 與 person_detect 各多一個可檢查 OP。每份原樣匯出與整圖切出均重新解析，shape／rank／量化與所有 payload 保留；person_detect 原有 14 個量化失敗不會變成通過。這些有限公開案例不代表任意 kernel 或公司模型已驗證。

真正 LiteRT.js 2.6.0 CPU WASM 對 canonical、legacy、legacy 編輯及切出 FC 的輸出均為 `[10,10,10,10,10,26,26,26,26,26]`。不整除的 legacy FC 負例會執行後才由輸出 shape 契約判失敗，`invoked=true`；不能寫成 compile／allocation 失敗或零 invoke。該負例也回報 `Tensors with strides or padding are not yet supported`，因此沒有 IO ZIP；這個原有 runtime 封存限制尚未修正。

最初測試 harness 曾缺少 FC 第三個輸入，且誤把切圖報告當成編輯常數檢查入口；已保留初版並修到真正 caller red。另保留先前 CPU 測試錯誤假設「負例不得 invoke／必有 IO」的失敗，後續依實際 pinned runtime 判定，不修改 runtime 或放寬規則。瀏覽器、PR／main 關卡及正式交付仍待完成；不覆蓋 v1.4.0 的發布證據。
