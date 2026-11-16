# 選取容量與刪除 OP

本次將圖上點選／框選、Canvas 可見範圍選取、OP ID 套用、跨 block 擷取、pattern JSON、工作階段與局部 MLIR 匯出統一提高至 256 個原始 OP。一般 pattern 最多 4,096 條連線；跨 block pattern 另限 256 blocks、4,096 個結構節點、8,192 條連線。超限時整次加入不生效，已選範圍維持原樣。

搜尋仍保留 2,000,000 次候選展開與 50,000 筆結果的原有保護，複雜結構可能回傳部分結果並提示。選取容量增加不代表任意大型 pattern 都能完整搜尋。TFLite 直接輸入 OP ID 匯出仍以有效 subgraph 範圍為準，不受 256 個限制。模型編輯工作區的 64 個原始 OP／96 個總 OP／128 步命令保持原限制，圈選提示會說明兩者容量不同。

核心測試涵蓋 256 個 TFLite OP 的擷取、JSON、搜尋、子模型重新開啟與斷線負例；256 個同 scope custom MLIR OP 的 attributes／SSA；68 個跨 block loop OP 的局部匯出、沿用 pattern 搜尋和改動控制線的負例。Windows Chrome／Edge 的獨立暫存環境以真實滑鼠框選 33 個可見 OP，再用 ID 選取 66 個 OP 儲存及搜尋，下載 TFLite 重開；另以 68 個 MLIR OP／3 blocks 保存 pattern、匯出、檢查 SSA 並重開搜尋。僅使用合成模型，不執行 interpreter。

## 刪除後的型別與接線

在編輯工作區選取 OP，按「刪除 OP」會先顯示處理連線的預覽。可選三種方式：

- 刪除並一次重接所有使用者，包括編輯範圍外的 OP 與模型 outputs。
- 將仍使用的輸出改為模型 inputs，由呼叫端提供值。
- 只刪除，保留斷線位置，稍後手動接線。

每個輸出列出使用端總數、前 12 個使用端、模型輸出與 signatures。候選來源包含編輯範圍內已知的同 subgraph 上游 tensor，可用名稱／編號／型別搜尋。原輸入只有一個相容候選時才預選；多個相容候選需手動決定。相容性檢查包含 dtype、shape、shape_signature、quantization、sparsity、同一 subgraph 與產生順序。候選顯示具體差異，不自行插入 Cast、Reshape 或推測權重。

一次確認對應一個可復原／重做的草稿命令，恢復 OP 也能還原該次接線。多次刪除的替代值會逐段解析，模型輸出即使接到相同 tensor 仍保留原輸出欄位數量。組合草稿會維持刪除前的輸出選擇並套用替代對照，不會把新出現的末端 OP 全部加為輸出；可改接模型輸入或已產生的常數，但組合草稿仍需保留至少一個 OP。介面變更時，含 signatures 的模型需明確勾選同步更新；維持相同欄位數時保留 signature 輸出名稱。Signature 引用子圖 outputs 之外 tensor 的特殊介面會明確阻擋自動重接，需先調整來源 signature。

含刪除重接命令的可攜／本機恢復草稿使用 version 4；既有 v1～v3 仍可讀，舊網站會明確拒絕 v4。草稿只存命令與來源指紋，不包含模型或權重。來源型別、權重和 custom options 原樣保留。Custom OP 宣告 ports 的重接不等於驗證私有 kernel 或 opaque options 內的語意。

預覽不讀權重，每頁最多 8 個輸出、每個輸出列最多 50 個候選，候選按可見頁計算。型別差異快取限制為 16 組來源型別、每組 64 個差異；關閉對話框清除 DOM 與草稿參照。Worker 以一次掃描統計整個 subgraph，不把所有使用者或整份模型傳到主執行緒。

目前不會自動沿整個既有模型傳播刪除造成的 shape 變更。已支援的 shape 推導仍適用新增 builtin OP。不相容時可改接其他 tensor、提升為模型 inputs、取消刪除或手動修正。匯出保持本機靜態、結構與資料驗證，interpreter 仍由使用者另外啟動；通過驗證不代表數值等價。

### 後續可做

依已支援 OP 規則預覽下游 shape 變更與介面影響。Reshape／Transpose 的 tensor-valued shape／permutation 需讀取常數與驗證；Conv、FC 的權重、通道與 bias 不能只修改 tensor metadata。動態維度、控制流程與 custom OP 無規則時停止推導。必要的 Reshape、Cast、Quantize／Dequantize 應列為獨立建議操作，顯示參數和精度影響後確認。
