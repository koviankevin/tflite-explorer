# 條件與工作階段驗證（2026-10-24）

驗證基準 `ec31522`；交付建置 release `6c76cced0e0a8fe9`。Node.js 24.19.0、Windows 11、Edge 155。依影響分批選測，72 個不同案例通過；不是全套測試。

- 首批：`node --test test/pattern-conditions.test.mjs test/workspace.test.mjs test/pattern-library.test.mjs test/subgraph.test.mjs test/mlir-cross-block.test.mjs test/mlir-reexport.test.mjs test/pattern-overview.test.mjs test/overview-canvas.test.mjs test/svg-viewport.test.mjs test/performance.test.mjs`，67 例通過。
- 新增總覽穩定身分與 v2→v3 library 保護後，重跑 `pattern-library`、`pattern-conditions`、`workspace`，14 例通過。新增案例分別驗證總覽省略連線不影響匹配身分、舊分頁不能覆寫新條件清單。
- 路徑分段影響另跑 `mlir-connection-pages`，3 例通過，含 5000 隱藏 OP 與超過 20000 OP 匯出重開。未修改的既有搜尋、匯出與 viewport 案例沿用首批結果。

實際 Edge 選檔與 UI 驗證：

- TFLite `Reshape → Transpose → Reshape`，指定 N2 輸出 #0 shape `[1,*]`、dtype `float32` 得 4 筆；再加 `int8` 得 0 筆。儲存／下載 v3 JSON 後實際匯入，正確略過一組相同 pattern 並保留條件。
- MLIR custom split 的 `tag = custom op`、第二輸出 #1 `f32` 得 1 筆；錯誤 tag 得 0 筆。實際下載局部 MLIR，重新選檔後同一條件 pattern 仍為 1 筆。
- SVG 工作階段下載檔約 3 KiB，實際匯入／重新選模及重新整理後的「恢復上次儲存」通過。兩個已選 OP、32px、550px 左欄及搜尋恢復；縮放 0.9，原錨點 `(595.90,331.75)` 還原為 `(596.04,331.75)`。收合 pattern 另測能還原。
- 選錯 MLIR 模型時顯示結構／檔案大小不符，未套用舊選取。非同步讀取 JSON 後使用明確的「選取模型以恢復」按鈕，避免瀏覽器阻擋檔案選擇器。
- 三 block 迴圈加 `company.step` 輸出 dtype `i32`，重開恢復 4 個選取 OP／3 blocks、1 個匹配與控制連線。
- Canvas 總覽 1803 個顯示節點／600 匹配，全數展開後儲存兩個選取 OP；重新選模恢復相同狀態，camera `{zoom:1.5,x:504,y:571.3333333333334}` 完全相同。當時只繪製 3 個可見節點。
- 局部 MLIR 155 個隱藏輔助節點，分為兩段；第 2／2 段儲存重開仍為第 2／2 段，原始 OP 選取保留。
- 390×844 條件面板展開，頁面 client／scroll 均 375px，結果區保留 90px，沒有水平溢出。

實體 1,349,965,216 bytes／21005 OP 合成 TFLite，以本機 Node range reader 單次量測：結構指紋 140.8 ms，有兩個 metadata 條件的搜尋 144.3 ms／7000 匹配，兩項操作額外檔案讀取均 0 bytes。此量測不包含瀏覽器繪圖，不代表內部實際模型的效能；未執行 custom kernel。

工作階段為手動保存，結構指紋不讀取或驗證權重。跨 block 原始層與 Canvas／SVG 顯示各自保存原始身分；模型與所有處理留在本機。長路徑快取仍限量重建，必要時提示繼續分析。操作及限制見 [說明](conditions-workspace.md)。
