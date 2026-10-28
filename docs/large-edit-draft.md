# 大型手動編輯草稿驗收

這份獨立驗收補足 preview.16 尚未量測的「超過 1 GiB 原模型，下載 JSON 後重新選檔恢復」流程。目前新增測試尚待 Hosted Linux CI 實際執行；不是新的網站版本或已通過的發布證據。

執行 `.github/workflows/large-edit-draft.yml`。修改該驗收本身時會在 PR 執行，也保留手動入口。只在本儲存庫的 Hosted Ubuntu 24.04／Chromium 執行，不啟動本機瀏覽器、不測手機、不上傳模型、權重或草稿。以 1366×640 儲存、1280×640 恢復，兩者皆為 32px。

案例沿用實際順序寫滿、fsync 與完整 SHA-256 讀回的 1,349,965,216 bytes／21,005 OP 合成 TFLite，含 1.25 GiB 權重及 custom options。獨立 Node 使用每次最多 1 MiB 讀取計算版本化 `sha256-chunks-v1`；與瀏覽器原生選檔、手動下載的草稿指紋比對。

在圖形編輯工作區新增 OP、保留 Undo／Redo、32px 與視角後下載 JSON。關閉來源及 Worker，重新原生選檔恢復，第一次在完整核對期間按取消，確認介面回應、停止讀取且沒有套用部分編輯；再次關閉後匯入原 JSON 並選原模型，驗證完整恢復、繼續 Redo、實際下載整份修改模型及重新開啟。下載的輸出另由 Node 串流核對權重／custom options 的來源範圍，並搜尋原有 prefix 與分支／匯合 pattern，各須恰有一筆。

手動指紋與解析器使用不同的讀取紀錄。只有 CI 注入到 `editFileFingerprint` 參數邊界的 facade 可讀完整指定原檔，必須每次最多 1 MiB、依序、不重複且恰好覆蓋全檔；正式演算法不修改。其他 parser／main 原生 Blob／FileReader 呼叫仍受原本每 realm 16 MiB、單次 1 MiB 上限約束。取消案例保留未完成讀取量，不偽記完整核對。

預先固定門檻：每個手動操作最多 90 秒；50ms 主執行緒計時器的最大間隔及 Long Task 各不得超過 750ms；原生取消操作至可操作狀態最多 1,500ms；500ms 取樣整棵所屬 Chromium 程序 RSS 的最大成長不超過 768 MiB；模型 Worker 檢查點的 V8／backing storage 各不超過 512 MiB。最後等待原生 60 秒 Blob URL 撤銷，確認四個模型 Worker 真正關閉、選檔清空。門檻不因當次結果自動放寬。

這是固定 CI 環境的一次大檔恢復／取消驗收，不代表固定實體筆電 SLA、其他瀏覽器、公司 runtime／compiler、OS 斷電、數小時負載或永遠不洩漏。一般崩潰恢復與原八輪生命週期仍見 [本機編輯草稿恢復](edit-recovery.md)，不以此案例取代既有發布關卡。
