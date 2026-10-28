# 大型手動編輯草稿驗收

這份獨立 Hosted Linux 驗收已補足 preview.16「超過 1 GiB 原模型，下載 JSON 後重新選檔恢復」的量測。網站程式未變，正式站仍為 preview.16／build `855f8ca810f04f4d`；本次只新增驗收與證據，不重新發布固定產物。

執行 `.github/workflows/large-edit-draft.yml`。修改該驗收本身時會在 PR 執行，也保留手動入口。只在本儲存庫的 Hosted Ubuntu 24.04／Chromium 執行，不啟動本機瀏覽器、不測手機、不上傳模型、權重或草稿。以 1366×640 儲存、1280×640 恢復，兩者皆為 32px。

案例沿用實際順序寫滿、fsync 與完整 SHA-256 讀回的 1,349,965,216 bytes／21,005 OP 合成 TFLite，含 1.25 GiB 權重及 custom options。獨立 Node 使用每次最多 1 MiB 讀取計算版本化 `sha256-chunks-v1`；與瀏覽器原生選檔、手動下載的草稿指紋比對。

在圖形編輯工作區新增 OP、保留 Undo／Redo、32px 與視角後下載 JSON。關閉來源及 Worker，重新原生選檔恢復，第一次在完整核對期間按取消，確認介面回應、停止讀取且沒有套用部分編輯；再次關閉後匯入原 JSON 並選原模型，驗證完整恢復、繼續 Redo、實際下載整份修改模型及重新開啟。下載的輸出另由 Node 串流核對權重／custom options 的來源範圍，並搜尋原有 prefix 與分支／匯合 pattern，各須恰有一筆。

手動指紋與解析器使用不同的讀取紀錄。只有 CI 注入到 `editFileFingerprint` 參數邊界的 facade 可讀完整指定原檔，必須每次最多 1 MiB、依序、不重複且恰好覆蓋全檔；正式演算法不修改。其他 parser／main 原生 Blob／FileReader 呼叫仍受原本每 realm 16 MiB、單次 1 MiB 上限約束。取消案例保留未完成讀取量，不偽記完整核對。

預先固定門檻：每個手動操作最多 90 秒；50ms 主執行緒計時器的最大間隔及 Long Task 各不得超過 750ms；原生取消操作至可操作狀態最多 1,500ms；500ms 取樣整棵所屬 Chromium 程序 RSS 的最大成長不超過 768 MiB；模型 Worker 檢查點的 V8／backing storage 各不超過 512 MiB。最後等待原生 60 秒 Blob URL 撤銷，確認四個模型 Worker 真正關閉、選檔清空。門檻不因當次結果自動放寬。

這是固定 CI 環境的一次大檔恢復／取消驗收，不代表固定實體筆電 SLA、其他瀏覽器、公司 runtime／compiler、OS 斷電、數小時負載或永遠不洩漏。一般崩潰恢復與原八輪生命週期仍見 [本機編輯草稿恢復](edit-recovery.md)，不以此案例取代既有發布關卡。


## 已核對的結果

[最終 run 40639097683](https://github.com/koviankevin/tflite-explorer/actions/runs/40639097683)成功，六個流程檢查全部通過；[原始報告](results/large-draft-native-2026-10-28.json)與 [獨立 provider／來源核對](results/large-draft-review-2026-10-28.json)已保存。受測 PR head `f0d61a99dc95e260973dd0b92e6af623218aff95`，實際 checkout `811218764db052c27f7feeec9d43d55563f74303`，tree `c6335248539515cab7e50b23ed11584f7910c803`；實際 checkout 與分支完整 Git tree 一致。證據包 `12794024186`／`sha256:74add7393240d6e5222157216e9c4df75763b3d7e3737ceb06585a1ba3f42ef3`，報告 SHA-256 `d19a4fc0a308b8db0add431d30063a430157eb7cd212e2b411b302aecf965871`。審查重新核對工作流程／job、時段／attempt、實際 archive digest／CRC、來源父節點及 tree，並從原始數值重驗門檻。

| 實際操作 | 耗時 | 主執行緒最大計時間隔 | 最大 Long Task |
| --- | ---: | ---: | ---: |
| 原生下載編輯 JSON | 9.27 秒 | 63.6ms | 0ms |
| 重新選原模型並恢復 | 9.08 秒 | 94.1ms | 0ms |
| 恢復後下載完整修改模型 | 17.22 秒 | 64.1ms | 0ms |

取消回應 32ms，停止於 7,340,032 bytes；之後讀取量不再增加，沒有套用部分變更。兩次完整指紋各讀 1,349,965,216 bytes／1288 次，最多 1 MiB／次，與獨立 Node 指紋 `4914251fbad45fa0811ca29f3898092014aae5d3d6b53638c24d1fbed9639734` 一致。這是版本化編輯指紋鏈，不是標準整檔 sha256sum。可攜 JSON 僅 973 bytes，不含模型或權重。

1366×640 保存、1280×640 恢復：32px、原選取、縮放／捲動與 Redo 保留，繼續 Redo 後新增輸出。完整輸出為 1,350,445,736 bytes／21,006 OP，SHA-256 `76abf0ba8d8917882d9deb95f27cbc08188aac74216e3589aa7ce37794fdd045`，與原八輪修改結果一致。七段共 1,342,177,328 bytes 的權重／custom options 串流比對通過；重開後 prefix 與分支／匯合 pattern 各一筆。[1280×640 匯出重開後的分支 pattern 搜尋結果清單](results/large-draft-reopen-2026-10-28.png)已保存。

整棵 Chromium 程序 RSS 取樣峰值 899,080,192 bytes，相對基線成長 393,637,888 bytes；三個模型 Worker 檢查點的 V8 與 backing storage 均低於原 512 MiB 上限。解析器單次實際最大 65,536 bytes，所有 realm 仍低於原 16 MiB；完整指紋另計，不放寬解析上限。

模型關閉與瀏覽器關閉各自保留快照：四個模型 Worker 關閉時皆已 terminate 並收到 close；Netron 頁面級排版 Worker 可留待同頁再次排版，保留其 `terminated:false` 原值；整個測試瀏覽器關閉後所有實際 Worker close 及所屬 OS 程序終止均通過。Blob URL 等待應用原生 60 秒撤銷，未強制 GC。

既有失敗不改寫：第一輪 [40637741724](https://github.com/koviankevin/tflite-explorer/actions/runs/40637741724)把新增 OP 的 output 設定誤當第二筆變更，見 [原始失敗](results/large-draft-initial-failure-2026-10-28.json)／[來源核對](results/large-draft-initial-review-2026-10-28.json)；第二輪 [40638261043](https://github.com/koviankevin/tflite-explorer/actions/runs/40638261043)把排版 Worker 計入四個模型 Worker，見 [原始失敗](results/large-draft-redo-failure-2026-10-28.json)／[來源核對](results/large-draft-redo-review-2026-10-28.json)；第三輪 [40638626480](https://github.com/koviankevin/tflite-explorer/actions/runs/40638626480)在頁面尚未關閉時要求頁面級 Worker close，見 [原始失敗](results/large-draft-workers-failure-2026-10-28.json)／[來源核對](results/large-draft-workers-review-2026-10-28.json)。修正的是測試預期及檢查時間點，沒有放寬效能上限，也沒有修改正式網站程式。

計時包含原生操作、CI 觀察器及完整指紋讀取的開銷；不把此數值承諾為所有實機的延遲。公司實模／compiler／runtime、其他引擎、固定實體硬體 SLA、長時間負載及其餘商品化條件仍待驗收。
