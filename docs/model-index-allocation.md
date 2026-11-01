# 模型索引配置減量（v1.4.1 候選）

目前正式站與固定下載仍為 v1.4.0；本候選尚未發布。接續[已觀察到的 V8 pool 保留](renderer-release-minimization.md#已觀察到同一-renderer-的-pool-歸還)，先減少實際模型結構處理的配置，不更動 browser flags、pool policy、GC、RSS／timer 判定或 interpreter 模式。

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
