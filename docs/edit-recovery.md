# 本機編輯草稿恢復（preview.16 主分支驗收中）

目前正式版本仍是 preview.15；preview.16 的主分支功能與恢復驗收已通過，仍待實體八輪及正式發布關卡完成。

指紋核對需要可用 WebCrypto（HTTPS／localhost）；不支援時會明示未保存，不假裝恢復保護已啟用。

TFLite 編輯工作區預設自動保存。第一次變更後，獨立 Worker 以最多 1 MiB 的區塊核對完整原模型，接線操作可繼續。成功取得原模型指紋後，IndexedDB 以嚴格 durability 的交易保存命令、Undo／Redo、視角與指紋；不保存模型或權重。只有交易完成才顯示「已保存本機編輯草稿」，首次核對或新修改尚待保存時，不宣稱已受保護。

從頂端「編輯草稿」可匯入 JSON、選取本機記錄下載或恢復，也可暫停自動保存。恢復時需重新選原模型，沿用既有完整檔案指紋與編輯範圍核對，通過後才套用接線及歷史。同大小、同結構但權重不同的檔案仍須拒絕；MLIR 仍不能實際編輯，也不接受 MLIR 編輯恢復記錄。

每份記錄最多 256 KiB，保留目前及上次成功版本，最多 20 份。版本不支援、格式損壞或儲存配額不足時不覆蓋有效舊資料，畫面明示尚未保存；可繼續下載編輯 JSON。不同分頁恢復同一份記錄時以 revision 核對寫入，衝突保留雙方的目前編輯，可明確「另存副本」。刪除後，過期的保存不會復活同一 key。

網站內模型分頁使用不含 File／模型的恢復識別，晚完成的寫入仍繫結原來源。切換回來沿用該分頁最新 revision；關閉或取消未完成的核對會終止指紋 Worker，完成的指紋只以同一不可變 File 作 WeakMap 快取。

瀏覽器清除網站資料、磁碟故障、尚未完成的首次核對與最後一次成功交易之後的新修改，不能靠這份本機記錄保證恢復。重要工作仍需下載 JSON；JSON 不含模型，換電腦仍要帶原模型。不同瀏覽器、作業系統斷電、公司環境與長時間使用仍須另驗收。

## 驗收

- Node 選測：交易候選／上次成功資料、未知版本保留、大小上限 round trip、並行 revision 衝突、副本、配額／不可用的失敗呈現、延遲保存不串模型、分頁切回不使用過期 revision，以及 Worker 取消／晚回覆／快取。
- Hosted Linux 原生瀏覽器（main 已通過）：獨立暫存 profile，保存完成後對自行啟動的 Chromium 程序樹送 SIGKILL，重新啟動同一 profile；重選原模型恢復 32px 接線／視角／redo、錯誤權重負例、跨頁衝突及副本、刪除不復活、實際 TFLite 下載／重開與權重／custom options 收據。
- 大檔（main 執行中）：沿用 1.25 GiB／21,005 OP 實體八輪與原有解析／程序 RSS／Worker／URL 限制。恢復指紋另由專用 Worker 讀完整原模型，每次讀取不超過 1 MiB、總量恰為一份原模型；與獨立 Node 的完整指紋比對，不放寬解析器原有的 16 MiB 總讀取門檻。
- 版面只測筆電 1366×640／1280×640 與 32px，不跑手機。正式四項 main 關卡與部署完成前不宣稱候選已發布。

## 已完成的主分支證據

Main [40632649670](https://github.com/koviankevin/tflite-explorer/actions/runs/40632649670) 的 [原始報告](results/preview16-main-ui-2026-10-28.json)、[provider／來源核對](results/preview16-main-ui-review-2026-10-28.json)與 [筆電恢復畫面](results/preview16-main-laptop-recovery-2026-10-28.png)已保存。24 項操作全部通過：含正常功能回歸、強制終止測試瀏覽器後重啟同一暫存 profile、相同 key 的 IndexedDB 記錄、錯誤權重負例、恢復 32px 接線／視角／redo、實際匯出重開與權重／custom options 比對、雙分頁衝突副本、暫停以及刪除後過期保存不復活。

SIGKILL 後部分 Worker 未送達 DevTools close 事件，原始事件值保留為 false；另以該測試所擁有的整棵 Chromium 程序樹確認終止，分別記錄 SIGKILL 與 normal-close 的 PID 集合及 allTerminated，不把遺失的事件偽記為已收到。主 context 的 27 個模型 Worker 與模型分頁 context 的六個模型 Worker 仍以原 close 事件核對，均通過。

發布選擇 core 40503475445（86 份相依 fingerprint 相同，沿用）、browser 40632642765（完整 1.25 GiB 指紋與原八輪量測執行中）、contract 40632646401（main 76 項通過）、site 40632649670（六種隔離切換與 24 項原生操作通過）。原始檔未包含公司模型；成功的功能測試不代表已部署，也不代表 OS 斷電或公司環境驗收完成。
