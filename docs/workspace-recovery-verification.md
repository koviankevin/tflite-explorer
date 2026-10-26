# 本機工作草稿驗收（2026-10-27）

版本 `0.2.0-preview.3`；Windows、Node.js 24.19.0、實際 Edge。固定發布來源以 `release.json`／manifest 為準。使用合成 custom TFLite 及六 block 的 generic MLIR，包含分支、匯合、迴圈和 custom op；沒有公司模型。

## 測試

- 工作階段／新 controller 最終 13 項通過：v1／v2、未完成文字及視覺結構、未提交條件欄位、未知新版本保護、損壞 head／上次成功版本、歷史數量／bytes 上限、Undo 後重新編輯、視角量化後仍可 Redo、儲存不可用、兩分頁 CAS／分叉、舊寫入不跨模型、關模時仍有寫入／搜尋中的最後快照，以及排版穩定後才建立操作快照。
- 另執行 24 項條件清單及 SVG／Canvas 視角相關案例、40 項圈選／Canvas／MLIR 重複匯出及公開／內網封裝案例。重疊案例不加總成不同案例，後續僅對新修改補測 controller／UI。
- Controller 的並行／失敗案例以可控制的儲存介面測試；真實 IndexedDB 與 BroadcastChannel 另由兩個實際瀏覽器分頁驗收，不把記憶體 adapter 當成真實資料庫驗證。

## 實際瀏覽器流程

1. 實際 File chooser 載入 custom TFLite，保存 source layer #1。Undo 清除、Redo 還原同一個來源 OP；重新載入頁面、從本機草稿選擇記錄，再實際選模，成功恢復選取。
2. 兩個分頁恢復同一記錄。第二分頁搜尋 `Add` 並保存，第一分頁收到衝突提示後搜尋 `InternalSplitFoo`，自己的操作仍保留。另開草稿後兩份 JSON 分別下載，確認兩個搜尋值同時存在，沒有互相覆蓋。
3. 保存未完成的 `N1:Reshape ->`，重載後文字模式與原文仍在，顯示未完成提示。帶這份草稿開另一模型時，先以 Layers 開模，保留原文，不再把搜尋式錯誤當成模型開檔失敗。
4. 六 block MLIR 跨五個 blocks 選取五個 OP，下載約 13 KiB 草稿；重載、重新選模後，五個選取及 pattern 均恢復，匹配一次。再匯出局部 MLIR，使用 native IREE `iree-opt.exe --allow-unregistered-dialect` 檢查成功；實際重開子模型後原 pattern 仍匹配一次。這不是公司 dialect verifier 或 runtime 的語意驗證。
5. 實際匯入 v1 工作階段 JSON，再選取其原模型，來源 OP 選取恢復。v1 localStorage key 未由新版覆寫；新版手動保存使用 v2 key，IDB 另使用獨立資料庫。
6. 在獨立新來源開啟精簡跨 block 圖，選五個 blocks 後清除：一次 Ctrl Z 恢復五個，一次 Ctrl Shift Z 清除，再一次 Ctrl Z 恢復。建立快照及還原視角會等待排版穩定，避免自動 reflow 多記成一個使用者操作。

1366×768 筆電、390×844 CSS viewport、32px 圖字已檢視。手機文件 client width 與 scrollWidth 同為 375px（含原生捲軸），草稿視窗可在畫面內操作，沒有橫向溢位。新 UI 包含草稿下載及移除前的明確確認；本輪未刪除既有使用者草稿，不以這次測試宣稱完整的資料生命週期驗收。

## 大型模型

實際載入 1,349,965,216 bytes、21,005 OP 的 TFLite，索引後完成自動草稿。介面讀取量仍為 7.55 MiB、解析約 0.59 秒；下載的 v2 草稿只有 11,321 bytes，包含結構指紋與操作資料。未新增完整權重讀取或把模型放進 IndexedDB；沒有以這一筆量測宣稱整個瀏覽器／Worker 的長時間記憶體結果。

## 限制與後續

本輪證明的是完成 transaction 後的頁面重載恢復及並行保護，未刻意終止整個瀏覽器程序、清除儲存或執行公司內網驗收。即將關閉分頁時尚未完成的 transaction 不保證保存，介面以實際成功時間為準。Undo／Redo 是本分頁工作狀態，pattern library 仍使用既有儲存流程，其並行寫入另列商品化後續工作。
