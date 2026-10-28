# 本機編輯草稿恢復（已發布 preview.16）

preview.16 已正式發布；主分支、實體八輪、完整部署包與正式網址的恢復驗收皆已通過。

指紋核對需要可用 WebCrypto（HTTPS／localhost）；不支援時會明示未保存，不假裝恢復保護已啟用。

TFLite 編輯工作區預設自動保存。第一次變更後，獨立 Worker 以最多 1 MiB 的區塊核對完整原模型，接線操作可繼續。成功取得原模型指紋後，IndexedDB 以嚴格 durability 的交易保存命令、Undo／Redo、視角與指紋；不保存模型或權重。只有交易完成才顯示「已保存本機編輯草稿」，首次核對或新修改尚待保存時，不宣稱已受保護。

從頂端「編輯草稿」可匯入 JSON、選取本機記錄下載或恢復，也可暫停自動保存。恢復時需重新選原模型，沿用既有完整檔案指紋與編輯範圍核對，通過後才套用接線及歷史。同大小、同結構但權重不同的檔案仍須拒絕；MLIR 仍不能實際編輯，也不接受 MLIR 編輯恢復記錄。

每份記錄最多 256 KiB，保留目前及上次成功版本，最多 20 份。版本不支援、格式損壞或儲存配額不足時不覆蓋有效舊資料，畫面明示尚未保存；可繼續下載編輯 JSON。不同分頁恢復同一份記錄時以 revision 核對寫入，衝突保留雙方的目前編輯，可明確「另存副本」。刪除後，過期的保存不會復活同一 key。

網站內模型分頁使用不含 File／模型的恢復識別，晚完成的寫入仍繫結原來源。切換回來沿用該分頁最新 revision；關閉或取消未完成的核對會終止指紋 Worker，完成的指紋只以同一不可變 File 作 WeakMap 快取。

瀏覽器清除網站資料、磁碟故障、尚未完成的首次核對與最後一次成功交易之後的新修改，不能靠這份本機記錄保證恢復。重要工作仍需下載 JSON；JSON 不含模型，換電腦仍要帶原模型。不同瀏覽器、作業系統斷電、公司環境與長時間使用仍須另驗收。

## 驗收

- Node 選測：交易候選／上次成功資料、未知版本保留、大小上限 round trip、並行 revision 衝突、副本、配額／不可用的失敗呈現、延遲保存不串模型、分頁切回不使用過期 revision，以及 Worker 取消／晚回覆／快取。
- Hosted Linux 原生瀏覽器（main 已通過）：獨立暫存 profile，保存完成後對自行啟動的 Chromium 程序樹送 SIGKILL，重新啟動同一 profile；重選原模型恢復 32px 接線／視角／redo、錯誤權重負例、跨頁衝突及副本、刪除不復活、實際 TFLite 下載／重開與權重／custom options 收據。
- 大檔（main 已通過）：沿用 1.25 GiB／21,005 OP 實體八輪與原有解析／程序 RSS／Worker／URL 限制。恢復指紋另由專用 Worker 讀完整原模型，每次讀取不超過 1 MiB、總量恰為一份原模型；與獨立 Node 的完整指紋比對，不放寬解析器原有的 16 MiB 總讀取門檻。
- 版面只測筆電 1366×640／1280×640 與 32px，不跑手機。正式四項 main 關卡與部署完成前不宣稱候選已發布。

## 已完成的主分支證據

Main [40632649670](https://github.com/koviankevin/tflite-explorer/actions/runs/40632649670) 的 [原始報告](results/preview16-main-ui-2026-10-28.json)、[provider／來源核對](results/preview16-main-ui-review-2026-10-28.json)與 [筆電恢復畫面](results/preview16-main-laptop-recovery-2026-10-28.png)已保存。24 項操作全部通過：含正常功能回歸、強制終止測試瀏覽器後重啟同一暫存 profile、相同 key 的 IndexedDB 記錄、錯誤權重負例、恢復 32px 接線／視角／redo、實際匯出重開與權重／custom options 比對、雙分頁衝突副本、暫停以及刪除後過期保存不復活。

SIGKILL 後部分 Worker 未送達 DevTools close 事件，原始事件值保留為 false；另以該測試所擁有的整棵 Chromium 程序樹確認終止，分別記錄 SIGKILL 與 normal-close 的 PID 集合及 allTerminated，不把遺失的事件偽記為已收到。主 context 的 27 個模型 Worker 與模型分頁 context 的六個模型 Worker 仍以原 close 事件核對，均通過。

發布選擇 core 40503475445（86 份相依 fingerprint 相同，沿用）、browser 40632642765（完整原模型指紋與原八輪量測通過）、contract 40632646401（main 76 項通過）、site 40632649670（六種隔離切換與 24 項原生操作通過）。原始檔未包含公司模型。

## 正式交付

- [正式網站](https://koviankevin.github.io/tflite-explorer/)／[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.16)，版本 preview.16／build `855f8ca810f04f4d`。固定來源 `fa333255acbdcdfe3c4c6f772672bb31ffc26281`、tree `5d83c03e9ad5402c2d0520afed502fa730cd061c`；後續只有交付文件提交，不改寫已發布產物。
- [四關卡獨立審查](results/preview16-gates-review-2026-10-28.json)通過。準備 [40634210233](https://github.com/koviankevin/tflite-explorer/actions/runs/40634210233)及 [部署包審查](results/preview16-prepared-review-2026-10-28.json)成功後，使用精確 build／site ID 執行 [正式發布 40634626785](https://github.com/koviankevin/tflite-explorer/actions/runs/40634626785)，prepare／deploy／verify_live／release 全成功。
- [實體八輪原始量測](results/preview16-main-browser-2026-10-28.json)與 [provider／相依核對](results/preview16-main-browser-review-2026-10-28.json)通過。來源 21,005 OP／1,349,965,216 bytes，含 1.25 GiB 實體權重。每輪完整指紋讀取上限 1 MiB、總量恰為一份原模型，八次 `sha256-chunks-v1` 指紋均為 `4914251fbad45fa0811ca29f3898092014aae5d3d6b53638c24d1fbed9639734`，與獨立 Node 讀取一致。此數值是編輯指紋鏈，不是標準整檔 sha256sum。
- 八次指紋耗時 5.81～7.22 秒，8 個指紋 Worker 及 24 個模型 Worker 全終止。原解析器仍每 realm 最多 16 MiB，實際最大單次解析讀取 65,536 bytes；不把完整指紋讀取混進解析上限，也未放寬原記憶體／URL 門檻。兩輪暖機後 RSS drift 5,586,944 bytes、斜率 382683.43 bytes／輪、取樣峰值 995,958,784 bytes。完整修改模型 21,006 OP，每輪輸出 SHA-256 `76abf0ba8d8917882d9deb95f27cbc08188aac74216e3589aa7ce37794fdd045` 相同，七段共 1,342,177,328 bytes 權重／custom options 比對成功。
- [正式 HTTP 審查](results/preview16-live-http-2026-10-28.json)驗證 1,302 檔 SHA／MIME；site ID `4a283d72d32a9df762027512c41cdfd1f7a5ecc2b0c87512e7fae231f172e2fd`、manifest SHA-256 `28f11f997bd85a722e3cb7a98944bf5dd2f0d0917ed07be67c6e62300f65bf2b`、root SHA-256 `965c9dff9a6ecf10cf9358775f999567fbf4030221dddfb5a783d9069f653255`。永久 preview.7 legacy root 保留，另保留 preview.15／preview.14。
- [正式原生報告](results/preview16-live-ui-2026-10-28.json)24 項成功，包括瀏覽器 SIGKILL、同一暫存 profile 重啟後重選原模型、錯誤權重拒絕、接線／32px 視角／redo 恢復、跨分頁副本與刪除不復活。兩次恢復測試所擁有的程序樹皆確認終止，保留事件遺失的原始 false 值及 OS 終止證據；27 個主 context 模型 Worker 與六個模型分頁 context 模型 Worker 的 close 事件仍全部通過。
- 依使用者範圍驗收筆電，不跑手機。既有 1366×640／1280×640 的 32px 接線、草稿／匯出重開、pattern、分支／迴圈／custom 回歸通過；編輯區 497px、圖區約 257.5px，名稱無溢出。[正式刪除後拒絕過期重寫的畫面](results/preview16-live-laptop-recovery-2026-10-28.png) SHA-256 `46f0b34fda95e899c430fd41284ea046f498cc5be5241a25e6687abc96876c81`。
- [最終獨立交付審查](results/preview16-publication-review-2026-10-28.json)成功，四份實際 Release 下載與原準備包 bytes／SHA 一致；`model-lens-public-0.2.0-preview.16-855f8ca810f04f4d.zip` 為 29,713,368 bytes／273 核心檔案，SHA-256 `c7ca481120ed1007ec7fae4f751b818afe5b518a3e0d83de1bb4f28973e3d097`。Deployment `7377462440`／job `122638807672`／attempt 1 與固定來源、整站及獨立 root 相符。

此次大型檔量測覆蓋自動保存的獨立完整指紋 Worker，原始八輪未含大型手動 JSON 匯入／恢復；後續已在相同網站程式上補齊 1.25 GiB 手動恢復的介面延遲、取消、繼續編輯及完整輸出重開，見 [獨立大型草稿驗收](large-edit-draft.md)。OS 斷電、瀏覽器清除／回收網站資料、其他引擎／平台、數小時使用、公司實模／compiler／runtime 仍需另外驗收。上述恢復功能交付不代表整個商品等級目標完成。
