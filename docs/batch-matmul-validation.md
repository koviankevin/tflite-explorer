# BATCH_MATMUL 型別與 rank 驗證（v1.4.2 候選）

目前正式站與固定下載為 [v1.4.1](model-index-allocation.md#v141-正式交付)；本修正尚未發布。編輯／匯出維持本機靜態檢查，interpreter 仍須手動執行。

原本的 BATCH_MATMUL 只核對已知的矩陣維度與 batch broadcast，沒有檢查 output dtype，且略過動態 shape 時連已知 rank 也一起略過。float32 lhs／rhs 配上 int32 output 的實際編輯仍可匯出；LiteRT.js 2.6.0 CPU 對這個錯誤模型還會回報執行完成，把 `[1,2,3,4]` 的浮點 bytes 當成 `[1065353216,1073741824,1077936128,1082130432]` 整數輸出。這是公開合成案例，不代表使用者先前未提供的公司模型也是同一原因，也顯示執行成功本身不等於模型型別正確。

## 規則與界線

規則對照固定 TensorFlow 來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [TFL_BatchMatMulOp](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td#L1206)、[CPU Prepare／Eval](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/batch_matmul.cc#L286)、[官方 hybrid／量化測試](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/batch_matmul_test.cc)及 [OP version 選擇](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/tools/versioning/op_version.cc#L919)。

- Inputs 的格式型別為 float32／float16／int8／int16；output 與 lhs 相同，只有兩個 inputs 都是 int8 時允許 int32 accumulator。
- 已知 input rank 必須介於 2～5；動態維度不會抹掉已知 rank。空 shape 且 has_rank=false 仍是未知 rank，不猜成 scalar。Legacy 非空 shape 及原 rank flag 保留。
- 已知維度核對 adj_x／adj_y、contracting dimensions、不同 batch rank 的 broadcast、零維度與完整 output shape。動態／未知尺寸明列未檢查。
- float32／int8 hybrid、int16／int8，以及 int8／int8→int32 保留。其他已允許的混合精度組合明列未檢查，不從純 shape 推論 kernel 可執行。

編輯驗證與序列化後的逐 OP 報告共用規則。報告說明檢查的是 dtype／rank／靜態 shape；不讀權重、不消耗常數檢視預算，不代表量化運算語意、任意 kernel 或數值等價通過。float16 是格式層正例，不宣稱目前 CPU 已支援其運算。其他 OP 的原 1 MiB／tensor、4 MiB／輪預算與未知狀態不變。

## 本機候選驗證

原實作的回歸為八項中七項失敗，保留原始輸出；新增動態 rank 正負例也先重現失敗，再修正。125 項相關測試通過，涵蓋真正編輯拒絕、原始 subgraph／OP／tensor 位置、零權重讀取的報告、混合精度原因、合法輸出重開與 exact weight／量化／adjoint 保留。

另用既有 LiteRT.js 2.6.0 compat CPU，對十種真正編輯／匯出／重開的模型核對每個 output 值與原始權重 bytes：四種 adjoint、不同 batch rank 的 broadcast、對稱／非對稱 hybrid、int8→int32、量化 int8 及 int16／int8。合法整數案例精確相符，hybrid 使用事先指定的絕對誤差上限 0.025。沒有因為非法 output 的 CPU 回報成功就放行匯出。

Chrome／Edge 的獨立選測入口為 `node test/browser/windows-operator-validation.mjs <channel> <build> <output> --allow-local-browser --matmul-only`，使用公開合成模型、原生選檔與接線、1280×640／32px、六份實際下載及重開搜尋，要求八個 model Workers 與所有觀察到的自有程序正常退出。它與原正式 38 項 smoke 分開保存來源，沒有延長既有 runtime／URL timer、工作流程期限或 RSS 上限。此入口、PR／main 必要關卡與正式交付仍待完成；本頁不宣稱 v1.4.2 已發布。

第一輪兩瀏覽器都正確拒絕非法 dtype／rank，hybrid 匯出與下載 bytes 也已核對；新 flow 以同一容器尋找 summary 時，同時命中量化與逐 OP 兩個正常標題，整輪仍判失敗。修正只將選擇器與列數限制到逐 OP 區段，保留原始失敗，不修改網站或移除量化顯示；後續完整結果仍待核對。
