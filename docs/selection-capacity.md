# 選取容量與刪除 OP

本次將圖上點選／框選、Canvas 可見範圍選取、OP ID 套用、跨 block 擷取、pattern JSON、工作階段與局部 MLIR 匯出統一提高至 256 個原始 OP。一般 pattern 最多 4,096 條連線；跨 block pattern 另限 256 blocks、4,096 個結構節點、8,192 條連線。超限時整次加入不生效，已選範圍維持原樣。

搜尋仍保留 2,000,000 次候選展開與 50,000 筆結果的原有保護，複雜結構可能回傳部分結果並提示。選取容量增加不代表任意大型 pattern 都能完整搜尋。TFLite 直接輸入 OP ID 匯出仍以有效 subgraph 範圍為準，不受 256 個限制。模型編輯工作區的 64 個原始 OP／96 個總 OP／128 步命令保持原限制，圈選提示會說明兩者容量不同。

核心測試涵蓋 256 個 TFLite OP 的擷取、JSON、搜尋、子模型重新開啟與斷線負例；256 個同 scope custom MLIR OP 的 attributes／SSA；68 個跨 block loop OP 的局部匯出、沿用 pattern 搜尋和改動控制線的負例。Windows Chrome／Edge 的獨立暫存環境以真實滑鼠框選 33 個可見 OP，再用 ID 選取 66 個 OP 儲存及搜尋，下載 TFLite 重開；另以 68 個 MLIR OP／3 blocks 保存 pattern、匯出、檢查 SSA 並重開搜尋。僅使用合成模型，不執行 interpreter。

## 刪除後的型別與接線

目前工作區刪除 OP 後會標示失效來源，要求重新接線；可明確將仍需使用的輸出改為模型 inputs。接線會檢查 dtype、shape、shape_signature、quantization、sparsity、同一 subgraph 與產生順序。已支援的輸出 shape 推導主要適用新增 builtin OP；目前不會自動沿整個既有模型傳播刪除造成的型別變更。

建議另做「刪除並重接」預覽，依以下順序處理，此文件不代表已實作。

1. 列出被刪 OP 每個輸出 tensor 的全部使用者，以及模型 outputs／signature 是否受影響。
2. 建議原 OP 輸入或其他上游 tensor 作為替代來源。dtype、shape、量化、sparsity 與執行順序相容時，可一次重接多個使用者，但仍由使用者確認，因為移除相容的 ReLU／Add 也會改變模型數值。
3. 不相容時明示差異，例如 `float32[1,128] → float32[1,32,4]`、dtype 或 per-axis quantization。提供手動接線、將切口提升為模型 inputs、取消刪除等選擇。
4. 使用明確的已支援 OP 規則，依拓撲順序預覽下游 shape 變更與新增／變動的模型介面。Reshape／Transpose 的 tensor-valued shape／permutation 需讀取常數與驗證；Conv、FC 的權重、通道與 bias 不能僅修改 tensor metadata。動態維度、控制流程與 custom OP 無規則時停止推導，交由使用者或 dialect／runtime adapter 提供資訊。
5. 若需要插入 Reshape、Cast 或 Quantize／Dequantize，將它列為獨立的建議操作並預覽參數。Cast／重新量化可能改變精度，Reshape 只在元素數等條件符合時才可能使用，不能為通過檢查而自動塞入。
6. 一次確認／Undo／Redo 整組刪除與重接；匯出前做結構、tensor、builtin、資料範圍與介面驗證。Interpreter 繼續獨立、手動執行，檢查可執行性也不等於數值等價。
