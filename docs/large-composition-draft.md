# 大型 v2 組合草稿手動還原

新增驗收尚待 Hosted 瀏覽器結果，不以 Node 或既有小模型還原當成 >1 GiB 已通過。正式站維持 preview.26；此輪只補驗收，不重新部署應用。

## 實際操作與固定門檻

沿用 `large-edit-draft.yml`，保留原 v1 的手動 JSON、完整指紋、途中取消、32px 視角／Redo、完整修改模型匯出重開及 pattern 檢查。另在同一個 Chromium／context／頁面完成 v2：

1. 原生選檔開啟實際寫滿並讀回 SHA 的 1,349,965,216-byte／21,005 OP TFLite，從 prefix 與分支／匯合的實際匹配各加入四個 OP。
2. 接起兩段並複製新增 ADD，設定明確輸入／輸出。Undo 最後一個輸出介面命令，留下六步歷史／一步 Redo；以 1366×640／32px 縮放、平移後，真正按「儲存編輯草稿」下載 v2 JSON。
3. 核對兩組片段、完整原模型指紋、八個來源 OP、接線、介面、Redo 及視角；Redo 後先實際匯出，核對所有權重／custom options 與既定組合 SHA。
4. 關閉模型，匯入 JSON 並重新選原模型，在完整指紋 IO 途中取消，確認讀取停止且未套用任何 OP、接線或介面。
5. 再關閉並以新的原生 File 重新選取原模型，在 1280×640 還原。核對圖上九個 OP、分組、每個 input port、介面選項、32px、縮放／捲動及 Redo；繼續 Undo／Redo，實際重匯出並比對還原前後所有 bytes。
6. 關閉來源，以原生選檔開啟重匯出的九 OP 模型。原 prefix／branch pattern 各一筆、錯誤連線 pattern 零筆、預設 reshape／transpose pattern 一筆。

原有門檻不變：每項操作 90 秒、50ms 主執行緒探針與 Long Task 各最多 750ms、取消回應最多 1,500ms、500ms 取樣 RSS 峰值成長最多 768 MiB、Worker heap／backing storage 各最多 512 MiB。指紋只在指定參數邊界使用有序完整讀取 facade，每次最多 1 MiB；parser／main 仍是單次 1 MiB、每 realm 16 MiB，不能利用指紋放寬解析器。

新增 v2 後，報告版本為 2：八個模型 Worker 均須 terminate 並有原生 close，六次指紋觀察中四次完整、兩次取消。程序 RSS 改用既有 PID／start-ticks 所有權追蹤，包含曾觀察後被 reparent 的後代；瀏覽器關閉後所有觀察到的程序都須退出。報告保留取樣及量測界線，不宣稱連續 Worker 峰值或獨立 Worker OS RSS。

仍保留自然 60 秒 URL 撤銷、不強制 GC、不重啟或重載頁面清空記憶體；只上傳有上限的數值報告及截圖，沒有模型、權重或草稿。原 v1 歷史證據見 [大型手動草稿](large-edit-draft.md)，有限八輪組合另見 [組合生命週期](composition-lifecycle.md)。本項一次大檔恢復驗收不代替數小時、其他引擎、OS 斷電或公司環境。

28 項本機相關 Node 檢查與兩份腳本語法檢查已通過，涵蓋指紋讀取保護、v1／v2 還原及程序所有權；這些不是瀏覽器成功證據。真實 Hosted 結果及獨立產物核對取得後另列。
