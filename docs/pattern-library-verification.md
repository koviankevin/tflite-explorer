# Pattern 清單驗收（2026-10-27）

版本 `0.2.0-preview.4`；Windows、Node.js 24.19.0、實際 Edge。候選產物 `6f314b04ef1d0090`；正式來源與交付版本以發布包的 `release.json` 及 manifest 為準。

## 選測範圍

本次修改清單保存及 app 的保存呼叫端，未修改模型解析、圖形渲染、pattern matching 或模型匯出器。最終 31 項 Node 案例通過：`pattern-store`、`pattern-library`、`pattern-conditions`、`workspace-session`、`workspace`。涵蓋遷移、未知／損壞資料、容量、不同名稱合併、同名衝突、重試去重、CFG ports／條件、TFLite 與 MLIR 搜尋，以及工作階段／歷史的相關回歸。純函式案例不當作 IndexedDB 交易的實測。

## 實際分頁與下載

兩個實際 Edge 分頁載入同一份 `Reshape → Transpose → Reshape`。A 修改精確連線設定並保存；B 收到清單更新時仍保留自己尚未保存的兩節點文字結構。B 保存後自動建立 `並行驗收 20261027（2）`，原名稱仍是 A 的三節點版本。再讓兩分頁各自選擇 JSON 檔案，同時提交不同名稱的匯入；下載全部清單後確認兩個修改版本與兩個新增項目共四筆完整存在。

重新開啟新版分頁後，清單第 6 版及四個項目仍在。以實際 File chooser 恢復跨五個 blocks 的工作階段並選取原 MLIR，五個來源 OP 選取完整保留。透過「儲存並搜尋」保存為 `並行保護 跨 block 20261027`；清單第 7 版、14 個 pattern 節點（含 block 定義）、24 條連線，搜尋一筆。下載的 version 2 CFG pattern JSON 與畫面一致。

五個選取 OP 匯出為 7,460 bytes 的局部 MLIR，瀏覽器的語法／SSA／dominance 檢查通過。下載完整報告後使用 native IREE `iree-opt.exe --allow-unregistered-dialect` 檢查成功；輸出 SHA-256 為 `06ba6d4d081ea82a0f603bb3a9e464df124a221ab3df24aa4967f5a3cffcbb0a`。實際重開下載檔並套用剛保存的 pattern，仍只匹配一次，包含分支、匯合、迴圈及 custom op。

1366×768 筆電與 390×844 CSS viewport、圖字 32px 已檢視。手機 document clientWidth 與 scrollWidth 同為 375px（含原生捲軸），搜尋結果區保留 90px，新狀態文字換行，沒有水平溢位。圖形可自行平移／捲動，其可捲動範圍不視為文件溢位。

## 界線

舊版本原始 key 保留與損壞／未知版本拒絕由 Node 案例驗證；正式 origin 的既有清單遷移另於部署後核對。不將 localStorage 假儲存當作真實 IndexedDB 驗收。公司模型、私有 dialect、公司 compiler／runtime、硬崩潰及儲存回收未在這輪驗收。Native generic 檢查不代表 custom op 語意或 runtime 數值等價性。
