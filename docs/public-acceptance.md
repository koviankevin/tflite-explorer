# 公開版驗收與使用範圍

依使用者 2026-10-29 的指示，本輪交付以外網公開版為範圍；內網版本、私有 dialect、公司 compiler／runtime 由使用者自行修改與驗收。公開版的結果不宣稱公司環境已相容。

固定版本為 [preview.31](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.31)，[正式站](https://koviankevin.github.io/tflite-explorer/)目前 build `3061076374227547`，來源 `adc870fee659611bf1a0fa78113642c1a3961afc`；[本版正式交付](preview31.md#發布狀態)已核對。外網更新不會自動更新公司內網站台。

## 已核對的公開流程

| 使用需求 | 證據與範圍 |
| --- | --- |
| 本機開檔、搜尋及定位 | [正式交付](model-composition.md#preview26-正式交付)的 30 項原生操作包含實際選檔、名稱／類型搜尋、選取與定位；模型不經遠端解析服務 |
| Pattern 圈選、修改、保存與檔案移轉 | 同一份正式操作報告驗證圈選保留、JSON 原生下載／匯入、刪除／復原及跨分頁衝突；跨 block pattern 以結構匹配，不依 block／SSA 名稱 |
| 分支、匯合、迴圈與 custom op | 正式操作涵蓋 TFLite IF／WHILE／custom，以及 MLIR diamond／loop；匯出重開後原 pattern 各一筆，連線負例拒絕 |
| MLIR 局部匯出 | [SSA／Canvas 驗收](mlir-keyboard.md)及正式操作涵蓋必要邊界、控制流程、精簡圖與重開；自動補出的介面不當成原 pattern OP |
| TFLite 實際模型編輯 | 正式操作涵蓋圖上接線、tensor 自動建立、OP 複製／builtin catalog、參數、型別亂數、Undo／Redo、完整修改與子模型下載重開 |
| 片段組合模型 | [組合模型](model-composition.md#preview26-正式交付)驗證 A／B 匹配分次加入、重疊去重、新 OP 接線、獨立普通／組合歷史、輸入／輸出選擇、v2 草稿、CPU `[14,28]`、custom options／權重／編號及匯出重開；目前限同一 TFLite／subgraph |
| 編輯草稿與模型分頁 | 正式操作涵蓋 JSON 保存／重選原模型指紋、分頁狀態、衝突／分叉及專屬測試瀏覽器強制終止後恢復；不宣稱 OS 斷電後永不遺失 |
| 手動 interpreter | [手動執行](tflite-runtime.md)及正式操作的 19 種執行／分佈情境：目前分頁已開啟的原模型、編輯／組合／子模型匯出重開、raw .bin、四種亂數、實際 CPU／IO ZIP、錯誤／取消、custom／signature 明確未驗證；編輯與一般匯出不自動推論 |
| 真實運算中的取消／逾時 | [固定 preview.30 三引擎驗收](runtime-active-compute.md#三引擎實際結果)：實際 WHILE invoke 時 UI 可回應、手動取消、正常 30 秒 watchdog 終止 Worker、無舊 IO，重開正常模型再執行得到 `7`。未以暫停下載或 fake timer 代替；不當成數小時／RSS 證據 |
| 手動執行與 IO 生命週期 | [Chromium 八輪／24 次 CPU](runtime-io-lifecycle.md#已核對結果)：4 MiB const／input／output、8 份完整 IO bytes、自然 60 秒 URL 釋放與程序／專用 Worker 清理通過；411 次 RSS／main heap 取樣未超過既有門檻。不代替數小時、其他引擎或連續 Worker heap 峰值 |
| 14 吋桌面操作與 32px | 正式流程使用 1366×640／1280×640 viewport，驗證 32px、平移／縮放後接線、選取、鍵盤焦點與下載；不測手機，也不將螢幕吋數當成固定像素尺寸 |
| 超過 1 GiB TFLite | [preview.22 三引擎歷史八輪](desktop-physical.md#preview22-候選的三引擎八輪與發布關卡)、[preview.26 Chromium 八輪](model-composition.md#候選與主分支驗收)及既有 Chromium 80 輪；各結果保持原來源及流程。另通過 [大型組合 Chromium 實體八輪](composition-lifecycle.md#修正後的實體八輪)，含 A／B 接線、新增 OP、v2 備份、權重／options、重開與 RSS／Worker；另通過 [大型 v2 手動儲存／取消／還原](large-composition-draft.md#已核對的結果)，不代替數小時組合或其他引擎 |
| 超大 MLIR 與大量 OP | [2.5 GiB 實體 MLIR](mlir-large-files.md#現行來源的-hosted-node-大檔驗收2026-10-29)核對權重、匯出與重開；[核心效能](performance-gate.md)另涵蓋 20,010 OP／六 blocks 的路徑快取、分段展開、切段與匯出，不把兩個不同負載混成同一次瀏覽器量測 |
| Firefox／WebKit 現行程式候選功能 | [preview.31 同程式來源核對](preview31.md#固定候選驗收)：Hosted Linux Firefox 142.0.1／WebKit 26.0 各 17 項原生操作、63 model／20 runtime Workers close、14 次輸入清理、19 種執行／分佈情境及五組指南。Firefox 指紋 Worker 四個 native close 全部觀察到；原失敗與 final-page layout 觀察界線保留，不代替數小時或其他 OS |
| 固定部署及下載 | [preview.31 最終獨立核對](results/preview31-published-final.json)：1,406 檔 SHA／MIME、root、權威部署及四份實際固定下載一致；33 項原生操作、五組指南、19 種執行／分佈情境、82 model／44 runtime Workers close、14＋24 次輸入清理及八輪 CPU／IO 通過；四工作 attempt 1 成功 |

## 第一次使用

1. 開啟網站，頂端「說明」或 F1 可查看五主題指南並前往對應工作區；先用示範模型熟悉操作，或按「開啟模型」選本機 `.tflite`／文字 `.mlir`。指南閱讀保留目前選取、草稿和縮放；執行仍需另外手動啟動。
2. 左側 Layers／Tensors（MLIR 為 SSA Values）可搜尋並點選定位；拖曳側欄右邊界可調整寬度。大型模型預設局部圖，可按需求開完整圖／Canvas 總覽。
3. 按「選取 pattern」後拖曳框選 OP；跨 block 可繼續加入選取。Alt＋拖曳平移、滾輪縮放，已選 OP 會保留。
4. 按「儲存並搜尋」尋找同結構；要調整搜尋條件用「編輯選取 pattern」。Pattern JSON 可匯出備份，再由另一個瀏覽器匯入。
5. 圈選後匯出局部 TFLite／MLIR，再按「開啟匯出結果」建立模型分頁；原模型留在另一頁。模型匯出與 pattern JSON 是不同檔案。
6. 要修改實際 TFLite，用頂端「編輯模型」；選 OP 後複製或從 builtin 選單新增，點選／拖曳 output 與 input 端點接線。先看變更預覽，再匯出；MLIR 不提供實際 OP 編輯。
7. 需跨電腦接續時，下載編輯草稿 JSON，另保留原模型；重新選原模型並核對完整指紋後恢復。瀏覽器本機保存不會跨 origin／電腦同步。
8. 要試跑時，先開啟目標 TFLite，再進入頂端「執行模型」，按「設定輸入並執行一次」。每個輸入可選 raw `.bin`、全 0 或有預設的亂數規則；確認後才執行，可下載 input／output ZIP。局部或編輯結果須先匯出並開啟；執行不使用草稿，亂數也不保證索引／token 等 OP 語意正確。

## 使用界線

公開核心支援 TFLite 及文字 generic MLIR；unknown dialect 可保留型別／屬性／連線，但不代替其自訂 verifier。MLIR 的大型 dense 以 File range 保留原文，不逐值核對元素數量；結構文字上限 256 MiB，外部 resource 檔尚未支援。實際模型編輯只支援 TFLite。

手動 CPU WASM 仍有 128 MiB 模型、16 MiB IO、512 MiB 提前配置估算與 30 秒執行上限。這不是所有 kernel scratch／整個瀏覽器 RSS 的硬限制，也不包含公司 custom kernel。一次執行通過不證明所有控制流程、精度或與原模型等價。

本輪三引擎與記憶體量測在 Hosted Linux；不同 OS、固定實體硬體 SLA、其他引擎數小時負載、連續 Worker heap 峰值、OS 斷電、任意資料格式升降級及完整螢幕閱讀器驗收仍未證實。既有鍵盤流程與範圍已列上表；沒有把有限案例宣稱為全站無障礙認證。

第一次發布驗證曾出現啟動逾時，原因尚未確定，失敗及後續診斷完整保留。相同部署後續診斷與經授權的一次失敗驗證補跑皆通過；不將其寫成已修復的應用 bug。固定 tag／Release 不覆寫，後續修正以新版本交付。
