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

目前相關 Node 選測 136 項通過，含 14 組真正 CPU／逐 output bytes。乾淨候選 `54a8b6a`／build `d0c7296728a41a1b` 的 Windows Chrome／Edge 原生選檔、SPLIT 匯出重開與權重 ranges 比對、動態 PAD 原因及錯誤 SLICE 零下載通過；編輯區新增「查看驗證報告」，可直接查看逐 OP 清單。1280×640／32px 的實際截圖與每個觀察到的 Worker close 已核對，零個自動 runtime Worker。

Chrome 的功能通過，但最後正常關閉超過 10 秒，整輪仍判失敗；SDK 後續強制清理不能當成正常退出。Edge 整輪與原生程序正常退出通過。第一輪報告入口藏在探索側欄的 UI 失敗、原始關閉失敗與修正後資料都保留在[候選收據](results/operator-validation-candidate.json)及[45 檔原始證據](results/operator-validation-candidate-evidence.zip)。

主分支必要關卡、正式站和固定 Release 尚待完成；不以候選結果宣告正式交付，也不宣稱 Windows 歷史關閉問題已修復。

## 大報告的主執行緒重讀修正

PR #190 合併後，來源 `adf7ef7` 的實體 1.25 GiB／21,005 OP 關卡在第一輪匯出失敗；尚未進入記憶體判定。原始 read audit 捕捉到主執行緒 `Blob.text()` 讀取 6,688,889 bytes：既有 `attachRuntimeReport` 為了附上未執行 interpreter 的狀態，重新讀入新增逐 OP 清單後的大型 JSON。報告本身未超過 16 MiB，問題是主執行緒的整段重讀，不能靠放寬讀取上限解決。

新候選 `e18e27e`／build `2a840cfc63ce30f5` 在模型 Worker 建立不含 verdict 的不可變 JSON prefix Blob；主執行緒直接組合 prefix 與新的 checks／runtime verdict，不重讀報告，也不累積重複欄位。原 16 MiB 報告上限、File 讀取、RSS 與計時政策不變；獨立的小型舊報告保持相容。

21 項相關選測通過，包含完整 21,005 OP metadata 報告連續附加三次狀態且零報告 body reads。Windows Chrome／Edge 皆完成實際 Worker 傳送、編輯匯出、大型報告 JSON 全部 21,006 筆，以及畫面 100→200 筆載入。此獨立報告案例使用 64-byte 合成權重，只證明完整 metadata／報告流程；不能代替實體大檔八輪。Edge 正常程序／Worker 退出，Chrome 功能通過但正常關閉仍逾時，整輪仍失敗。

[收據](results/operator-report-prefix.json)及[39 份原始證據](results/operator-report-prefix-evidence.zip)保留首次實體關卡失敗、原始 ZIP digest／CRC、縮小後的 red／green，以及兩個瀏覽器的報告、下載與截圖。修正版的主分支實體八輪及正式交付仍待完成。

## 各 OP 的常數 dtype 邊界

PAD 新增的 int8／int16／bool 常數讀取能力不會擴大其他 OP 的檢查範圍。EXPAND_DIMS／RESHAPE 保留原先 int32／int64 常數範圍；GATHER 可檢查 int16／int32／int64。未支援 dtype 明列未檢查，不能因共用讀取器或先前 PAD 的快取就誤列通過。型別範圍在讀取及快取命中之前檢查；TRANSPOSE 的 int32 強制規則不變。

序列化的 bool EXPAND_DIMS 曾重現誤列已檢查，新增 int8 RESHAPE、bool GATHER、PAD→GATHER 共用快取與合法 int16 GATHER 正負例後，相關 76 項選測通過。此項維持原本的讀取預算及未知狀態，不新增自動 interpreter。

BOOL 常數只將 0／1 當作可解讀的編碼；其他 byte 值明列未知，不把它猜成 padding 數字或 true。已讀取的 bytes 仍計入原有預算。原始 red／green 與來源見 [dtype 驗收收據](results/operator-dtype-validation.json)。
