# 模型索引配置減量（v1.4.1）

已於 [v1.4.1](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.1) 正式交付，build `c64f4143bf8463a2`。減少模型結構處理的暫時配置；沒有更動 browser flags、pool、GC、RSS／timer 判定或 interpreter 模式。 以下候選與失敗紀錄維持其原受測來源與當時狀態；目前交付見[正式交付](#v141-正式交付)。

`indexModel()` 原本為每組 ports、每個 output 的 consumers 與搜尋文字建立多層短命陣列，並為每個 tensor 建立臨時 Set。現在直接走訪既有 value／consumer 集合，名稱沒有換行時直接沿用字串；仍保留必要的 producer／consumer maps、相鄰集合與完整搜尋 records。沒有刪減模型資訊、權重、custom options、dtype／shape 或 MLIR 控制流程。

先在原實作確認兩項行為回歸：分支／迴圈、重複 producer 與 use、非 array／無 identifier 值、tensor 覆寫及插入順序；以及跨 subgraph 編號、scalar shape、名稱第一行與 callback 後的資料。修改後 58 項選測通過，另涵蓋 TFLite custom 分支切圖／組合匯出與權重／options、pattern overview，以及 generic MLIR 分支／迴圈跨 block 搜尋、匯出重開。必要 PR／瀏覽器及正式發布關卡另行核對，不能由這些 Node 結果代替。

以同一份實際 8,836,512-byte、21,005 OP／1 MiB 權重合成 TFLite，前後各三個新 Node 程序，使用同樣的讀取與觀察程式、不強制 GC。完整 records、Map／Set 順序、adjacency 與 pattern 清單的 SHA-256 均為 `8172269bb0dd76671da990e5a63830e71d8753b097065503e954b7fcd3525b95`；21,005 layers、21,011 tensors、7,000 個 RESHAPE→TRANSPOSE 匹配及讀取 bytes 相同。

| Node 觀察 | 修改前 | 修改後 |
| --- | --- | --- |
| index 階段 heap capacity 增量，中位數 | 56,348,672 bytes | 30,773,248 bytes |
| index 完成時 heap capacity，中位數 | 244,457,472 bytes | 228,147,200 bytes |
| index 完成時 used heap，三次 | 122,679,752／113,441,824／115,700,464 bytes | 141,913,544／140,429,336／139,605,368 bytes |
| parse 時間，三次 | 1,614／1,175／1,130 ms | 471／504／475 ms |

這是同機 Node 24.22.1／V8 13.6 的有界觀察，兩組依序執行，host cache／排程與自然 GC 會影響數值。修改後 used heap 上升而 capacity 下降，因此不能把 capacity 減量解讀為 live-object 留存已減少，也不從三次時間直接宣稱一般速度保證。它不是 browser V8 15.6、原生 RSS 或原實體八輪修復的證據；實際 browser／完整原政策仍待驗證。

[候選數值摘要](results/model-index-allocation-candidate.json)只含固定來源、雜湊、計數與觀察。原始基準、初版 collector 的 `.items` API 失誤與修正結果留在本機；模型與權重不放入公開摘要。一般編輯／匯出仍只做靜態檢查，interpreter 保持手動。

## 四項主分支關卡已核對（尚未發布）

來源 `c0dd77c89cde95b215b0d6b7990bfdda07c814d0`／tree `3f42b92f1d85b2ede0f36f1f9e65834c60f43e0f`、候選 build `3eae83697720ddfa` 的[四項原始關卡收據](results/model-index-allocation-main.json)已完成 digest、CRC、來源、scope 與原政策核對。Core 九筆量測、發布契約 79 項零略過，以及六種版本切換和完整 HTTP 候選 38 項操作通過。網站驗收另包含 15 組 32px 文字框、19 種手動 runtime、部分 IO 保存及八輪 CPU／IO；編輯匯出本身零自動推論。

[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41269145608)使用原 1,349,965,216-byte／21,005 OP fixture，完整／局部／組合匯出重開、權重／custom options／pattern、草稿指紋與讀取規則通過。關閉後 RSS slope 為 −834,413.71 bytes／輪、drift 1,912,832 bytes、main heap drift −157,008 bytes；sampled peak 1,102,385,152 bytes，57 個 Worker 及六個觀察到的程序正常退出。沒有 forced GC、RSS 扣除、改動 pool、timer 或驗收上限。舊 [41252363060](https://github.com/koviankevin/tflite-explorer/actions/runs/41252363060) 的 slope 失敗保留；新結果是實際索引程式修改後的新來源驗收，不改列舊結果。

同政策的獨立 browser 觀察也顯示 21,005 OP Worker heap capacity 由 133,767,168 降至 119,353,344 bytes，used heap 由 67,373,412 升至 76,781,188 bytes；不將 capacity 降低解讀為一般 live-object 或 RSS 保證。診斷不作發布證據。Windows Chrome／Edge 在來源相同的 PR tree 完成原生選檔、SPLIT 匯出重開、invalid SLICE 零下載、dynamic PAD 未檢查原因及 21,006 OP 報告 100→200 分批；六份下載獨立核對，兩端 Worker／程序正常退出。這是隔離原始 HTML fixture，不冒充 Windows 正式 HTTPS 或大模型 RSS。

正式 HTTPS 部署、固定 Release 與四份實際公開下載核對仍待接續；目前正式版仍為 v1.4.0，完整商品化目標及歷史 Windows Chrome 問題沒有因本次有限驗收而完成。

## v1.4.1 正式交付

固定來源 `25e7debc8ccb793ddc3fefe8fd3e2dff8fb70704`／tree `b25b113c8c6fcd79b86b76956e0c14a59e992328`、build `c64f4143bf8463a2` 已完成[發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41270750871)，四個工作第一次 attempt 全成功。325 核心檔、全站 1,470 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對。正式站包含 15 組 32px 文字框、搜尋／pattern／MLIR 與 TFLite 匯出重開、逐 OP／量化／legacy shape 報告、部分 IO、19 種手動 runtime 及八輪／24 次 CPU／IO。一般編輯匯出零自動推論；失敗／未知與有意的 crash recovery 不冒充通過或正常關閉。

固定 ZIP 41,294,984 bytes，SHA-256 `5ac4467b5052dc1ee7b79248571e0f06c8f6cd50b7239bca00b67ff831f7b8df`；checksum、manifest、gates 四份實際下載皆與準備工件一致，tag／Latest／權威 Pages deployment 已核對。Site ID `c4976f5eab2708e87299c97fdd817c0bb3a38150c4bd3a094f3c757c4babdaa1`，保留 v1.4.0／v1.3.1 與永久 baseline。[最終收據](results/model-index-v1.4.1-published.json)只含來源、雜湊、計數與有限結果；原始報告、截圖、環境及程序身分完整留在本機，沒有上傳本機原始紀錄。舊 tag／assets 不改寫，成功部署不重跑，沒有同步 Sites／GH Studio。歷史 Windows Chrome／網路守門與任意 kernel／公司 dialect／長期 SLA 的界線仍保留，完整商品等級目標未完成。
