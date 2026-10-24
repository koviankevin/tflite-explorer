# Pattern 條件與工作階段

Pattern 分頁的「條件篩選」可指定 OP 別名、輸入／輸出方向及從 0 起算的 tensor value port，再加入 shape 或 dtype 條件；port 依所有 argument groups 的 tensor values 順序計算。Attribute 條件指定名稱與詳細資料顯示值，採去除首尾空白的完全相等比對。所有條件以 AND 組合，未指定條件的 OP 仍只比對類型與結構。

Shape 以逗號分隔，`1, *, 128` 的 `*` 代表該維度任意值，`?`（或輸入 `-1`）代表動態維度；維度數須相同，`[]` 代表 scalar。無法確認 rank 的 MLIR unranked tensor 不符合 shape 條件。Dtype 使用詳細資料的名稱，例如 TFLite `float32`、MLIR `f32`，忽略大小寫但不自行推斷不同名稱等價。不存在的 port／attribute、不支援的 attribute 值或截短預覽不會視為符合。每 OP 最多 16 個條件，attribute 值最多 2048 字元，不讀取 tensor initializer／權重。

「儲存目前 pattern 與條件」將目前結構及條件存入此瀏覽器的 pattern 清單；可沿用既有 JSON 匯入／匯出。有條件時使用 version 3，仍可讀取 version 1／2；未加條件的舊 pattern 行為不變。條件可用於單 block／TFLite 連接結構與 MLIR 跨 block、分支、匯合、迴圈。新增或移除條件後按「尋找模式」重新搜尋。

搜尋欄上方「儲存工作階段」會下載最多 2 MiB 的 JSON，並嘗試在此瀏覽器保留上次儲存。包含目前搜尋類別、字詞、範圍、pattern 及條件、目前匹配、選取 OP、跨 block 選取、完整／局部圖、pattern 收合／個別展開、輔助路徑與分段、字級、方向、左欄寬度，以及 SVG／Canvas 的縮放與位置。這是手動儲存，不會自動保存每一步，也不儲存模型、權重、整個 pattern library 或詳細資料側欄內容。

「恢復上次儲存」可使用同一瀏覽器的記錄；「恢復檔案」可匯入下載的 JSON，接著按「選取模型以恢復」。瀏覽器仍需重新選取本機模型。恢復前核對格式、檔案大小與模型結構 SHA-256 指紋，涵蓋 OP、連線、型別、shape、可用 attributes 與 MLIR successors；不雜湊權重負載，因此相同結構、相同大小但權重不同的模型可恢復。模型重命名不是權重一致性的證明；此功能不提供權重檔案認證。

不符合的模型不套用舊選取；已修改但未重搜的條件若使原匹配消失，保留搜尋及有效選取，回到目前 subgraph 並提示。超過 1500 OP 的 SVG 完整圖恢復為局部圖，可手動確認完整繪圖；Canvas 總覽仍可依保存的收合／展開狀態恢復。新開模型不保留舊 worker 路徑快取；長路徑若仍待分析，保留目標分段並提示按「繼續分析」，沿用每次限量保護。不同視窗尺寸以可用空間還原附近位置，可能略有調整。瀏覽器拒絕 localStorage 時仍可使用檔案保存／恢復；所有處理均在本機。

測試範圍：`pattern-conditions`、`workspace`、`pattern-library`、`subgraph`、`mlir-cross-block`、`mlir-reexport`、`pattern-overview`、`overview-canvas`、`svg-viewport`、`performance`。瀏覽器另驗證實際 TFLite／MLIR、條件正負例、v3 pattern 下載／匯入、工作階段檔案下載／匯入、重新選模、錯誤模型拒絕、SVG 縮放定位、三 block 迴圈與 Canvas 總覽、390px 手機無水平溢出。
