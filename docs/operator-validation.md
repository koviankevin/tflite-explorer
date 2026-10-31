# OP 靜態驗證與逐項報告（v1.3.0 候選）

目前開發候選，尚未發布；正式站仍為 v1.2.1。此項補強 TFLite 編輯匯出的本機檢查，不增加 MLIR 編輯、不自動執行 interpreter。

## 新增規則

| OP | 檢查範圍 |
| --- | --- |
| PAD／PADV2 | paddings 的型別、`[rank, 2]` 形狀與非負值、output shape／dtype、PADV2 單一填充值的型別與元素數 |
| SLICE | begin／size 相同 int32 或 int64 型別、一維且長度等於 rank、begin 範圍、size 的 -1 剩餘尺寸及每維界線、output shape |
| STRIDED_SLICE | int32 索引向量、長度、非零 stride、正反向切片與端點截取、begin／end／ellipsis／new-axis／shrink-axis masks、所有 output 維度 |
| SPLIT／SPLIT_V | num_splits 與輸出數量、單一 int32 axis、負軸、整除、size_splits 的 int32／int64 向量與最多一個 -1、總和，以及每個 output shape／dtype |
| MEAN／SUM／REDUCE_PROD／REDUCE_MIN／REDUCE_MAX／REDUCE_ANY／REDUCE_ALL | int32 axes、負軸與重複軸正規化、空 axes、keep_dims、output shape／dtype，ANY／ALL 的 bool 型別 |

規則對照 TensorFlow 固定來源 [`7bc5d217d3bd79426527d0055fd3b54812f52e93`](https://github.com/tensorflow/tensorflow/tree/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels) 的 pad.cc、slice.cc、strided_slice.cc、split.cc、split_v.cc、reduce.cc；實際公開執行器仍是既有 LiteRT.js 2.6.0，不能從靜態檢查推論任意 kernel 版本均可執行。

既有 Netron port metadata 將 SPLIT 的第一個 output 當作唯一 output，曾誤擋合法多輸出編輯。現在以 num_splits 明確核對輸出數量，保留必要輸入與每個輸出的檢查。

## 報告與界線

編輯匯出後，「最近匯出報告」的「逐 OP 靜態驗證」依 subgraph、OP、input／output tensor 編號列出狀態與原因。每次顯示 100 筆，可繼續載入；下載 JSON 保留完整清單。狀態只涵蓋本次修改／組合的 subgraphs，其他 subgraphs 不冒充已檢查。沒有規則的 OP 和 custom op 也列為未檢查；零個適用規則不顯示為常數檢查通過。

未知／動態 shape、模型輸入或其他 OP 產生的動態參數不會被當成常數。單個 tensor 最多檢視 1 MiB、每次 subgraph 驗證最多 4 MiB，沿用既有預算；共享常數快取避免重複讀取，檔案讀取和記憶體檢視分開計數。預算不足與尚未支援的編碼／組合都說明原因。超過 31 個有效維度、多重 ellipsis，以及 offset 與 ellipsis／new-axis 組合尚未驗證，不猜測結果。

已檢查代表列出的靜態規則通過；不包括所有資料 dtype 的 kernel 支援、量化運算語意、scratch allocation、custom kernel 或數值等價。權重值、custom options bytes 不進入報告。模型仍全程在本機；手動推論須開啟匯出結果後切換「執行模型」。

## 驗收

保留修正前未檢查的原始失敗，以及實際匯出找到的 SPLIT 多輸出拒絕。選測涵蓋正負例、序列化常數、預算、所有 outputs、實際編輯／匯出／重開及報告；小型公開模型另以固定 CPU WASM 核對結果與原始參數 bytes。瀏覽器驗收包含原生選檔、SPLIT 複製匯出重開、動態 PAD 未檢查原因、錯誤 SLICE 阻擋下載、1280×640／32px，以及零個自動 runtime Worker。

目前相關 Node 選測 136 項通過。瀏覽器、主分支必要關卡、正式站和固定 Release 尚待完成；不以候選結果宣告正式交付，也不宣稱 Windows 歷史關閉問題已修復。
