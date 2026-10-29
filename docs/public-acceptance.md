# 公開版驗收與使用範圍

依使用者 2026-10-29 的指示，本輪交付以外網公開版為範圍；內網版本、私有 dialect、公司 compiler／runtime 由使用者自行修改與驗收。公開版的結果不宣稱公司環境已相容。

固定版本為 [preview.25](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.25)，[正式站](https://koviankevin.github.io/tflite-explorer/)目前 build `95784ae94cb97575`，來源 `3427c4a02911edac35fe48ebf3d94fd628223e9d`。網站更新不會自動更新公司內網站台。

## 已核對的公開流程

| 使用需求 | 證據與範圍 |
| --- | --- |
| 本機開檔、搜尋及定位 | [正式交付](op-integer-precision.md#preview25-正式交付)的 30 項原生操作包含實際選檔、名稱／類型搜尋、選取與定位；模型不經遠端解析服務 |
| Pattern 圈選、修改、保存與檔案移轉 | 同一份正式操作報告驗證圈選保留、JSON 原生下載／匯入、刪除／復原及跨分頁衝突；跨 block pattern 以結構匹配，不依 block／SSA 名稱 |
| 分支、匯合、迴圈與 custom op | 正式操作涵蓋 TFLite IF／WHILE／custom，以及 MLIR diamond／loop；匯出重開後原 pattern 各一筆，連線負例拒絕 |
| MLIR 局部匯出 | [SSA／Canvas 驗收](mlir-keyboard.md)及正式操作涵蓋必要邊界、控制流程、精簡圖與重開；自動補出的介面不當成原 pattern OP |
| TFLite 實際模型編輯 | 正式操作涵蓋圖上接線、tensor 自動建立、OP 複製／builtin catalog、參數、型別亂數、Undo／Redo、完整修改與子模型下載重開 |
| 編輯草稿與模型分頁 | 正式操作涵蓋 JSON 保存／重選原模型指紋、分頁狀態、衝突／分叉及專屬測試瀏覽器強制終止後恢復；不宣稱 OS 斷電後永不遺失 |
| 手動 interpreter | [手動執行](tflite-runtime.md)及正式操作的十種參數／runtime 情境：原模型／候選、raw .bin、型別亂數、實際 IO ZIP、錯誤／取消、custom／signature 明確未驗證；開檔／一般匯出不自動推論 |
| 14 吋桌面操作與 32px | 正式流程使用 1366×640／1280×640 viewport，驗證 32px、平移／縮放後接線、選取、鍵盤焦點與下載；不測手機，也不將螢幕吋數當成固定像素尺寸 |
| 超過 1 GiB TFLite | [preview.22 三引擎歷史八輪](desktop-physical.md#preview22-候選的三引擎八輪與發布關卡)、[preview.25 Chromium 八輪](op-integer-precision.md#候選與主分支驗收)及既有獨立 Chromium 80 輪／約 2 小時 12 分；各結果來源另列，完整權重、custom options、pattern 正負例與 Worker 終止按原門檻核對，不當成全部新版／引擎長測 |
| 超大 MLIR 與大量 OP | [2.5 GiB 實體 MLIR](mlir-large-files.md#現行來源的-hosted-node-大檔驗收2026-10-29)核對權重、匯出與重開；[核心效能](performance-gate.md)另涵蓋 20,010 OP／六 blocks 的路徑快取、分段展開、切段與匯出，不把兩個不同負載混成同一次瀏覽器量測 |
| 固定部署及下載 | [最終獨立核對](results/preview25-published-2026-10-29.json)：全站 1,376 檔／SHA／MIME、root、部署身分及四份實際 Release 下載均與準備快照一致；四個工作在 attempt 1 成功 |

## 第一次使用

1. 開啟網站，先用示範模型熟悉操作，或按「開啟模型」選本機 `.tflite`／文字 `.mlir`。
2. 左側 Layers／Tensors（MLIR 為 SSA Values）可搜尋並點選定位；拖曳側欄右邊界可調整寬度。大型模型預設局部圖，可按需求開完整圖／Canvas 總覽。
3. 按「選取 pattern」後拖曳框選 OP；跨 block 可繼續加入選取。Alt＋拖曳平移、滾輪縮放，已選 OP 會保留。
4. 按「儲存並搜尋」尋找同結構；要調整搜尋條件用「編輯選取 pattern」。Pattern JSON 可匯出備份，再由另一個瀏覽器匯入。
5. 圈選後匯出局部 TFLite／MLIR，再按「開啟匯出結果」建立模型分頁；原模型留在另一頁。模型匯出與 pattern JSON 是不同檔案。
6. 要修改實際 TFLite，用頂端「編輯模型」；選 OP 後複製或從 builtin 選單新增，點選／拖曳 output 與 input 端點接線。先看變更預覽，再匯出；MLIR 不提供實際 OP 編輯。
7. 需跨電腦接續時，下載編輯草稿 JSON，另保留原模型；重新選原模型並核對完整指紋後恢復。瀏覽器本機保存不會跨 origin／電腦同步。
8. 需要執行時才開「檢查能否執行（選用）」；每個輸入選 raw `.bin`、零值或亂數，手動執行後可下載 input／output ZIP。亂數只保證所選 dtype 的數值範圍，索引／token／shape 等仍有 OP 語意限制。

## 使用界線

公開核心支援 TFLite 及文字 generic MLIR；unknown dialect 可保留型別／屬性／連線，但不代替其自訂 verifier。MLIR 的大型 dense 以 File range 保留原文，不逐值核對元素數量；結構文字上限 256 MiB，外部 resource 檔尚未支援。實際模型編輯只支援 TFLite。

手動 CPU WASM 仍有 128 MiB 模型、16 MiB IO、512 MiB 提前配置估算與 30 秒執行上限。這不是所有 kernel scratch／整個瀏覽器 RSS 的硬限制，也不包含公司 custom kernel。一次執行通過不證明所有控制流程、精度或與原模型等價。

本輪三引擎與記憶體量測在 Hosted Linux；不同 OS、固定實體硬體 SLA、其他引擎數小時負載、連續 Worker heap 峰值、OS 斷電、任意資料格式升降級及完整螢幕閱讀器驗收仍未證實。既有鍵盤流程與範圍已列上表；沒有把有限案例宣稱為全站無障礙認證。

第一次發布驗證曾出現啟動逾時，原因尚未確定，失敗及後續診斷完整保留。相同部署後續診斷與經授權的一次失敗驗證補跑皆通過；不將其寫成已修復的應用 bug。固定 tag／Release 不覆寫，後續修正以新版本交付。
