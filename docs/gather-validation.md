# GATHER 動態 metadata 與空常數（v1.4.3）

已於 [v1.4.3](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.3) 正式交付，build `bbb977e791849a92`。一般編輯／匯出仍只做靜態檢查，interpreter 保持手動。以下候選及失敗紀錄維持原受測來源與當時狀態；目前交付見[正式交付](#v143-正式交付)。

## 已重現的問題

GATHER 原先把 indices 型別、params／output 型別、axis／batch_dims 與 rank 檢查，都放在三個 tensor 的完整靜態 shape 已知之後。動態 shape 因而略過可確定的錯誤。公開合成的六份檔案，分別包含錯誤 output dtype、浮點 indices、超出 rank 的選項或 scalar params，均能實際編輯、匯出、重新解析並通過結構檢查；常數階段只回報未檢查。這不是使用者未提供的公司模型，不宣稱已找到其歷史 allocation 失敗根因。

初始五項回歸中三項失敗；再分開檢查實際編輯及序列化報告，十七項中十五項失敗、兩個控制通過。原始失敗及六份原始 bytes 留在本機。修正後直接重讀同六份檔案，編輯與序列化兩個入口都拒絕，錯誤保留 subgraph／OP／input、output tensor 位置，且不先讀取權重或 indices。

## 共用規則與界線

編輯及序列化報告共用 `checkGatherMetadata`。先核對必要 ports、整數 indices、params／output dtype 相等、已知 input／output rank 與 axis／batch_dims；動態維度不抹掉已知 rank。負值依可知 rank 正規化，rank 未知則保留未知。已知 shape 再檢查 batch prefix 與完整 output shape；可讀 indices 的範圍仍受既有單 tensor 1 MiB／本輪 4 MiB 預算約束，GATHER 不讀 params 權重。

未知尺寸與尚無規則的 params encoding 明列未檢查，不以較強的型別檢查冒充任意 kernel／量化數值語意通過。float16、bfloat16 或依 kernel 建置開關而定的 encodings 只表示 metadata 規則可處理，不保證網站所用 CPU 全部可執行。部分 metadata 可確定不相容時仍拒絕，不讓「未檢查」掩蓋已知錯誤。

規則對照 TensorFlow 固定修訂 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [Gather 定義](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/ir/tfl_ops.td#L1263)、[CPU Prepare](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/gather.cc#L49)、[官方正負例](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/gather_test.cc)及 [OP version](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/tools/versioning/op_version.cc#L278)。格式定義及 kernel 的 encoding 範圍並非完全相同，因此不從其中一份清單推論所有 runtime 的支援。

## 空 indices 的額外回歸

合法零元素 indices 常數先被完整編輯誤認為缺少 producer；修正後，子模型切圖又把它轉成多餘的模型輸入，原始失敗保留。現在完整編輯與切圖共用零元素常數判定：必須使用非預設 buffer、明確存在的零長度 data vector、已知含零維度的 dense 數值型別。Buffer 0、缺少 data、非零／動態 shape、字串的缺少 header、opaque reference 與 sparse encoding 都不因此取得來源。

沒有把 absent Buffer.data 轉成 empty vector；原始資料存在性、編號及 source ranges 仍保留。明確的模型輸入也不因零元素而消失。完整、局部及組合匯出重開後，合法空 indices 維持常數，沒有新增模型輸入。

## 本機驗證

140 項受影響檢查通過，包含完整編輯、子模型／組合、原有 Buffer.data 存在性、constant cache／預算、PAD 及 BATCH_MATMUL 控制。既有兩個 GATHER bool-indices 測試原本預期未檢查，現在改要求拒絕；PAD 先讀兩個 bytes 暖快取後，GATHER 也必須在使用快取前拒絕錯誤型別，沒有移除負例或放寬判定。

LiteRT.js 2.6.0 compat CPU 另執行十二組真正匯出重開的案例：三種 indices encoding、負 axis、scalar indices、負 batch_dims、batch 等於 indices rank、int16／int8 量化資料，以及空 indices 的完整／局部／組合三條路徑。每份 output BIN 都與預期精確相同，可讀原始常數 bytes 保留。這些是本機 CPU 案例，沒有加入網站自動推論，也不代替 Windows Chrome／Edge、實體大模型及正式站驗收。

原生操作、必要 PR／main 關卡、正式 HTTPS 及新不可變 Release 尚待接續。歷史 Windows Chrome 雲端統計／網路注入及其他商品化未完成項目保留，完整目標仍進行中。

原生第一輪兩端均正確拒絕動態型別負例，負 batch_dims 的接線、下載及重開通過；空 indices 下載也已獨立核對其兩個 OP、單一模型輸入、明確空 data vectors 及零常數讀取。腳本卻把沒有非空 payload 時的 byte comparison「不適用」要求為「通過」，整輪因此維持失敗。修正僅將該零 byte 案例改為精確要求不適用、零 ranges／bytes，並核對實際空 buffer；其他案例仍要求非空 bytes 比對通過。沒有修改產品、上限或 timer，後續完整原生驗收仍待完成。

## 候選原生驗收已核對

來源 `1b811a127ce205ade95bbeed04bb6d6389069eba`／tree `cceae92a3949d9b291ab862661cba20f3ea128cb`、build `225b89e77479a107` 的 Chrome 156.0.8078.76／Edge 156.0.4314.50 各完成五組原生情境。動態型別負例零下載；負 batch_dims、空 indices 與合法動態模型可接線、匯出、重開搜尋。合法動態模型的兩個 OP 仍列未檢查，沒有啟動 interpreter。1280×640／32px 的實際 OP 列截圖已檢視，兩端各九個 Worker／八個 model Workers 與八／十一個觀察到的自有程序均正常退出，原 10 秒關閉要求不變。

十二份實際模型／JSON 下載逐一核對，兩端同案例模型 SHA 相同；非空 indices 的原 bytes 相同，空案例精確要求零 ranges／bytes 與明確空 vectors，沒有多餘模型輸入。單節點 GATHER pattern 各找兩筆，沒有連線的連續雙節點負例維持零筆。四份實際下載的合法模型另經既有 CPU 執行，兩個 outputs 都與預期精確一致，四份 IO ZIP 的 CRC 及 BIN 長度另行核對。

[候選數值收據](results/gather-candidate.json)只含固定來源、雜湊與計數；原始本機資料未公開。140 項選測、十三項版本選擇及十二組 CPU 在應用來源 `c4d0609` 通過，之後僅修改原生腳本與說明，沒有為此重跑無關測試。正式站仍為 v1.4.2；必要 PR／main 與 v1.4.3 固定交付尚未完成，完整商品化目標及歷史限制保留。

## 送 PR 前追加的零元素 activation 回歸

較早候選的空 data 判定還未區分 producer。三個新增回歸揭露：合法零元素 activation 的非預設空 buffer 被當作唯讀常數；切圖漏掉其外部 producer 邊界；相同空值也可能掩蓋先用後定義。對同一份真實檔案執行既有 CPU 已通過、輸出 BIN 為零 bytes，排除「CPU 本來不接受格式」的解釋。原始三項失敗、檔案與 CPU IO 保留。

現在零元素常數 lookup 以整個 subgraph 的 producer 為準。有 producer 的值保持 activation，切圖保留外部輸入，完整編輯也不把可寫零元素輸出視為權重。Producer 索引僅在實際遇到符合空資料條件的候選時才建立，留在當次驗證／匯出的區域，不新增跨模型快取。Buffer 0、absent data 與字串／opaque／sparse 的保守界線不變。

修正後 143 項相關檢查通過，CPU 擴為十三組，含非預設零元素 output 的完整／局部／組合匯出，以及保留外部 activation 的零 byte input。先前 140 項與來源 `1b811a1` 的原生證據保留其實際範圍；新來源原生案例已改用非預設空 output buffer，仍待驗收，不能把舊結果直接換標成新來源。

## Producer 修正後的新來源驗收

來源 `1e87eb4d8c5be40777d6fc889064917f704ab744`／tree `0b85b05b0e5517dd04ee1a1c6a439c4fa1ec2e0e`、build `c57eaef95204c8e5` 的兩個原生流程完成且已獨立核對。這輪空案例直接使用非預設空 output buffer；實際下載保留三個明確空 vectors、原有 producer、單一 input 與兩個 outputs。每端八個 model Workers／共九個 Worker，八／十一個觀察到的自有程序均依原要求正常退出，零自動 interpreter。兩張本輪 32px 實際 OP 列截圖已檢視。

十二份實際模型／報告逐份核對，單節點 pattern 各兩筆、沒有連線的雙節點負例零筆。兩份新的空輸出下載實際交給 CPU，兩個 outputs 都是正確空 BIN，ZIP CRC 與長度通過；非空控制模型的完整 bytes 與 runtime 程式未變，以相同 SHA 沿用前輪兩份真正 CPU／CRC 結果，沒有把沿用寫成新執行。最早六份錯誤檔案仍被拒絕；原來被誤擋的零 activation 檔已可編輯、匯出、重開及真正 CPU 執行。

[最終候選數值收據](results/gather-candidate-final.json)保留 143 項選測、十三項版本選擇、十三組實際 CPU 案例、新／沿用原生證據與 scope。舊 `c4d0609`／`1b811a1` 的收據、失敗與有限成功不覆寫，也不改標新來源。必要 PR／main、正式 HTTPS 與 v1.4.3 固定交付仍待接續；公開版仍為 v1.4.2。

## 四項主分支關卡已核對（尚未發布）

[PR #224](https://github.com/koviankevin/tflite-explorer/pull/224) 已合併為 `6ca895e64a9f00fa12a7c418ebef9a5821e75b8e`，完整 tree 與實際 PR checkout 相同。979 項 Node 檢查中 944 通過、35 個既有選做略過，79 項契約及九筆 PR 核心量測的原始報告均已核對。核心 88 檔範圍不變，正式發布沿用可信 main `41269145087` 的原始九筆量測，已重新讀取 provider 狀態、digest／CRC 與 scope；PR artifact 不冒充主分支 dispatch。

[四項 main 數值收據](results/gather-main.json)對應來源 `6ca895e64a9f00fa12a7c418ebef9a5821e75b8e`／tree `cd6a9036df45a3ab6d49d43a70278beb60234c3d`、build `6f136a242d842c75`。新來源的 79 項契約零略過、六種版本切換、823 檔 HTTP 候選及 38 項操作通過，包含 15 組 32px 文字框、19 種手動 runtime、部分 IO 及八輪 CPU／IO。五組 GATHER 原生案例仍獨立保存其受測來源，不宣稱它們字面包含在原 38 項 smoke。

[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41282013897)使用原 1,349,965,216-byte／21,005 OP fixture，完整／局部／組合匯出重開、權重／custom options／pattern 與正常關閉均通過。關閉後 RSS slope 1,740,565.94 bytes／輪、drift 24,842,240 bytes、main heap drift 206,352 bytes；sampled peak 1,109,446,656 bytes，57 個 Worker 與 6 個觀察到的自有程序正常退出。原政策重算通過，沒有 forced GC、RSS 扣除、timer、pool 或門檻變更；有限八輪不代表任意模型／長期記憶體保證。

v1.4.3 正式 HTTPS、固定 Release 及四份實際下載仍待接續；目前正式版為 v1.4.2，歷史失敗與完整商品化目標保留。

## v1.4.3 正式交付

固定來源 `0d1f15198696f88f9dad0f4b0d951cdcebfc78a4`／tree `99106ab87295e9d398ccaadd8a5116c0e8174a3d`、build `bbb977e791849a92` 已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41284224153)完成，四項工作 attempt 1 全成功。328 核心檔、全站 1,477 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對。正式站包含 15 組 32px 文字框、搜尋／pattern／MLIR 與 TFLite 匯出重開、逐 OP／量化／legacy shape 報告、部分 IO、19 種手動 runtime 及八輪／24 次 CPU／IO。獨立 GATHER 原生 Chrome／Edge 五組案例另有候選來源；不宣稱它們字面新增在原 38 項 smoke 中。

固定 ZIP 41,303,364 bytes，SHA-256 `074374cda8800d5473094c3e135394f6069d3701aa291d6547bcd9ca3fcb7087`；四份實際下載與準備產物一致，tag／Latest／權威 Pages deployment 已核對。Site ID `5168d93f68c689f52c3c410447bc6f8476b902347d203979b84867a81654b99a`，保留 v1.4.2／v1.4.1 與永久 baseline。舊 v1.4.2 tag 和四份 asset 未改寫。[最終收據](results/gather-v1.4.3-published.json)僅含來源、雜湊、計數與有限結果；原始報告、截圖、環境與程序身分完整留在本機。成功部署沒有重跑，沒有同步 Sites／GH Studio。

本版修正已知 metadata 錯誤與零元素的 producer／邊界判定。合法 encoding 不等於 CPU kernel 全部支援；動態資料、量化數值語意、私有 dialect／runtime、歷史 Windows Chrome／網路注入與長期記憶體 SLA 仍保留界線。完整商品等級目標未完成。
