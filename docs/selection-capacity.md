# 選取容量與刪除 OP

本次將圖上點選／框選、Canvas 可見範圍選取、OP ID 套用、跨 block 擷取、pattern JSON、工作階段與局部 MLIR 匯出統一提高至 256 個原始 OP。一般 pattern 最多 4,096 條連線；跨 block pattern 另限 256 blocks、4,096 個結構節點、8,192 條連線。超限時整次加入不生效，已選範圍維持原樣。

搜尋仍保留 2,000,000 次候選展開與 50,000 筆結果的原有保護，複雜結構可能回傳部分結果並提示。選取容量增加不代表任意大型 pattern 都能完整搜尋。TFLite 直接輸入 OP ID 匯出仍以有效 subgraph 範圍為準，不受 256 個限制。模型編輯工作區的 64 個原始 OP／96 個總 OP／128 步命令保持原限制，圈選提示會說明兩者容量不同。

核心測試涵蓋 256 個 TFLite OP 的擷取、JSON、搜尋、子模型重新開啟與斷線負例；256 個同 scope custom MLIR OP 的 attributes／SSA；68 個跨 block loop OP 的局部匯出、沿用 pattern 搜尋和改動控制線的負例。Windows Chrome／Edge 的獨立暫存環境以真實滑鼠框選 33 個可見 OP，再用 ID 選取 66 個 OP 儲存及搜尋，下載 TFLite 重開；另以 68 個 MLIR OP／3 blocks 保存 pattern、匯出、檢查 SSA 並重開搜尋。僅使用合成模型，不執行 interpreter。

## 刪除後的型別與接線

在編輯工作區選取 OP，按「刪除 OP」會先顯示處理連線的預覽。可選四種方式：

- 自動選擇資料輸入繞過刪除的 OP，沿下游推導 shape，預覽後一次套用（預設）。
- 刪除並一次重接所有使用者，包括編輯範圍外的 OP 與模型 outputs。
- 將仍使用的輸出改為模型 inputs，由呼叫端提供值。
- 只刪除，保留斷線位置，稍後手動接線。

每個輸出列出使用端總數、前 12 個使用端、模型輸出與 signatures。候選來源包含編輯範圍內已知的同 subgraph 上游 tensor，可用名稱／編號／型別搜尋。原輸入只有一個相容候選時才預選；多個相容候選需手動決定。相容性檢查包含 dtype、shape、shape_signature、quantization、sparsity、同一 subgraph 與產生順序。候選顯示具體差異，不自行插入 Cast、Reshape 或推測權重。

一次確認對應一個可復原／重做的草稿命令，恢復 OP 也能還原該次接線。多次刪除的替代值會逐段解析，模型輸出即使接到相同 tensor 仍保留原輸出欄位數量。組合草稿會維持刪除前的輸出選擇並套用替代對照，不會把新出現的末端 OP 全部加為輸出；可改接模型輸入或已產生的常數，但組合草稿仍需保留至少一個 OP。介面變更時，含 signatures 的模型需明確勾選同步更新；維持相同欄位數時保留 signature 輸出名稱。Signature 引用子圖 outputs 之外 tensor 的特殊介面會明確阻擋自動重接，需先調整來源 signature。

含刪除重接命令的可攜／本機恢復草稿使用 version 4；既有 v1～v3 仍可讀，舊網站會明確拒絕 v4。草稿只存命令與來源指紋，不包含模型或權重。來源型別、權重和 custom options 原樣保留。Custom OP 宣告 ports 的重接不等於驗證私有 kernel 或 opaque options 內的語意。

預覽不讀權重，每頁最多 8 個輸出、每個輸出列最多 50 個候選，候選按可見頁計算。型別差異快取限制為 16 組來源型別、每組 64 個差異；關閉對話框清除 DOM 與草稿參照。Worker 以一次掃描統計整個 subgraph，不把所有使用者或整份模型傳到主執行緒。

## 自動重接與下游 shape 推導（v1.12.0 已發布）

同樣的推導也可由編輯圖接線觸發：把來源輸出拖到目標輸入，shape 不同時先顯示確認與尺寸差異，確認後一次套用；dtype／量化差異和無法推導的情況明確拒絕。此類命令使用 v6 草稿，僅刪除推導仍可使用 v5。見 [接線差異確認](model-edit-workspace.md)。

刪除預設先找資料輸入：單輸出且有明確契約的 builtin OP 以 input 0 為資料端；ADD／MUL 等可交換運算在 input 0 是權重／常數時優先選另一個資料端。來源建議可在預覽中更換。仍檢查 dtype、量化、sparsity、同 subgraph、產生順序與循環；不插入 Cast、Reshape，也不猜測新的權重。Custom 或多輸出 OP 無法唯一決定時，可改用指定相容來源、模型 inputs 或手動模式。

推導在模型 Worker 內進行，掃描受影響 subgraph，包括編輯範圍外的使用者；支援既有靜態 unary／broadcast／spatial 規則、FC、BATCH_MATMUL，以及真實常數參數的 Reshape、Transpose、ExpandDims、Pad、Slice、Split 和 reduction 等已實作規則。FC 會核對 weights input_size／bias，不會藉改 metadata 假裝修改權重。動態／未知 shape、量化 channel 不合、custom OP 缺少規則、改變控制流程子圖的呼叫介面或其他未支援情況，會顯示負責的 OP 和原因並保留草稿。

預覽包含受影響 OP、tensor 數與前 100 筆 shape 差異；確認後套用全部變更，一次 Undo／Redo。保留編輯圖縮放和平移範圍，按「符合視窗」才重新取景。含自動推導命令的可攜／本機恢復草稿為 v5，舊 v1～v4 仍可讀；恢復和匯出時從原始 metadata、接線和實際常數重新計算，不信任匯入檔的 shape 提示。一般模型與組合草稿均可匯出並重開。

為避免大模型推導占用過多資源，限制掃描 200,000 OP、受影響 50,000 OP、變更 100,000 tensor；每 500 OP 讓出 Worker 執行並檢查取消。shape 參數只讀本機檔案切片，單 tensor 64 KiB、累計 1 MiB，最多快取 128 個常數；不整檔載入權重。21,000 個尾端 OP 的合成模型已驗證全部 shape 更新與匯出重開，主執行緒只收到前 100 筆預覽及編輯範圍內的 shape 提示。

匯出仍執行本機靜態、結構與資料驗證；interpreter 由使用者另行啟動。刪除 OP 會改變計算結果，靜態 shape 相容不表示數值等價或私有 kernel 語意通過。
