# OP 靜態驗證與逐項報告（v1.3.0）

已在 [v1.3.0](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.3.0) 正式交付，build `44782d0412ebc0b8`；[最終收據](results/product-readiness-v1.3.0-published.json)保留正式站與固定下載核對。此項補強 TFLite 編輯匯出的本機檢查，不增加 MLIR 編輯、不自動執行 interpreter。下方候選與失敗紀錄保持各自來源及當時範圍。

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

以下候選驗收後，主分支必要關卡、正式站和固定 Release 已完成，見[正式交付](#v130-正式交付)。Windows 歷史正常關閉問題仍未修復。

## 大報告的主執行緒重讀修正

PR #190 合併後，來源 `adf7ef7` 的實體 1.25 GiB／21,005 OP 關卡在第一輪匯出失敗；尚未進入記憶體判定。原始 read audit 捕捉到主執行緒 `Blob.text()` 讀取 6,688,889 bytes：既有 `attachRuntimeReport` 為了附上未執行 interpreter 的狀態，重新讀入新增逐 OP 清單後的大型 JSON。報告本身未超過 16 MiB，問題是主執行緒的整段重讀，不能靠放寬讀取上限解決。

新候選 `e18e27e`／build `2a840cfc63ce30f5` 在模型 Worker 建立不含 verdict 的不可變 JSON prefix Blob；主執行緒直接組合 prefix 與新的 checks／runtime verdict，不重讀報告，也不累積重複欄位。原 16 MiB 報告上限、File 讀取、RSS 與計時政策不變；獨立的小型舊報告保持相容。

21 項相關選測通過，包含完整 21,005 OP metadata 報告連續附加三次狀態且零報告 body reads。Windows Chrome／Edge 皆完成實際 Worker 傳送、編輯匯出、大型報告 JSON 全部 21,006 筆，以及畫面 100→200 筆載入。此獨立報告案例使用 64-byte 合成權重，只證明完整 metadata／報告流程；不能代替實體大檔八輪。Edge 正常程序／Worker 退出，Chrome 功能通過但正常關閉仍逾時，整輪仍失敗。

[收據](results/operator-report-prefix.json)及[39 份原始證據](results/operator-report-prefix-evidence.zip)保留首次實體關卡失敗、原始 ZIP digest／CRC、縮小後的 red／green，以及兩個瀏覽器的報告、下載與截圖。以下主分支驗收接續這些候選結果；正式交付狀態另列。

## 各 OP 的常數 dtype 邊界

PAD 新增的 int8／int16／bool 常數讀取能力不會擴大其他 OP 的檢查範圍。EXPAND_DIMS／RESHAPE 保留原先 int32／int64 常數範圍；GATHER 可檢查 int16／int32／int64。未支援 dtype 明列未檢查，不能因共用讀取器或先前 PAD 的快取就誤列通過。型別範圍在讀取及快取命中之前檢查；TRANSPOSE 的 int32 強制規則不變。

序列化的 bool EXPAND_DIMS 曾重現誤列已檢查，新增 int8 RESHAPE、bool GATHER、PAD→GATHER 共用快取與合法 int16 GATHER 正負例後，相關 76 項選測通過。此項維持原本的讀取預算及未知狀態，不新增自動 interpreter。

BOOL 常數只將 0／1 當作可解讀的編碼；其他 byte 值明列未知，不把它猜成 padding 數字或 true。已讀取的 bytes 仍計入原有預算。原始 red／green 與來源見 [dtype 驗收收據](results/operator-dtype-validation.json)。

## 最後主分支的四項發布關卡

來源 `c6c36d45f81fd339c8bda97deb9b218da7faef4b`／tree `1db3085be359df76c7d129cfd03938caca895340` 的必要結果已取得 provider 原始 ZIP 並核對 digest、CRC、source scope 及原始政策，見[收據](results/operator-validation-main.json)及[115 份原始證據](results/operator-validation-main-evidence.zip)。這份原始收據記錄發布前驗收；後續部署及下載核對另見下方正式交付，不改寫早期收據。

| 關卡 | 實際結果 |
| --- | --- |
| Core | 沿用 [41159138980](https://github.com/koviankevin/tflite-explorer/actions/runs/41159138980)；實際執行的 88 檔 module closure／policy fingerprint 未變，九筆量測重判通過 |
| 實體大模型 | [41212969501](https://github.com/koviankevin/tflite-explorer/actions/runs/41212969501)：實體 1,349,965,216 bytes／21,005 OP，八輪完整、局部及組合匯出重開、權重／custom options／pattern／草稿指紋與全部 Worker／程序正常退出通過；無整段報告重讀、forced GC 或 RSS 扣除 |
| 發布契約 | [41212981022](https://github.com/koviankevin/tflite-explorer/actions/runs/41212981022)：78 項通過，零略過；另核對三次 PR 的受測 merge tree，最後 PR #192 Node 877 項中 842 通過、35 項既有選用略過、零失敗 |
| 網站操作 | [41212993072](https://github.com/koviankevin/tflite-explorer/actions/runs/41212993072)：六種版本切換、35 項完整 HTTP 候選操作、15 組 32px 文字框、19 種手動執行情境及八輪／24 次 CPU／IO 原記憶體規則通過；新增 21,006 筆報告與原生 100→200 分頁，零自動 interpreter |

實體大模型的原判定為 RSS slope 1,662,156.8 bytes／輪、drift 10,059,776 bytes、main heap drift 223,340 bytes、sampled peak 1,040,760,832 bytes。這些是有限 Linux Chromium 關卡的結果，不替代 Windows、公司 runtime 或任意模型 SLA；Windows Chrome 的歷史正常關閉失敗仍保留。一般編輯／匯出依舊只做靜態與結構檢查，推論保持手動。

部署包中的 tools/export-reports.md 使用可直接開啟的 GitHub 規則說明連結，避免相對路徑指向未隨工具文件一起複製的檔案；此文件屬建置輸入，依既有 PR 規則驗證 Node／build，其他未變 scope 沿用上述證據。

## v1.3.0 正式交付

固定來源 `7debc69df1a1c91e8ed3928a8a4932a493324180`／tree `68f73b805636224b2023871f0edcab17c68dbf17`／build `44782d0412ebc0b8` 已完成[發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41216245433)四個工作 attempt 1 全成功，權威 Pages deployment、[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.3.0)、Latest 與 tag 指向均核對。完整 site ID `2a94efad4e9e905a49344335ca17c3efd9ecdcae2bd010a934e43274e77e2242`；沿用原本三個近期版本與永久基準規則，保留 v1.2.1、v1.2.0 及原始 baseline。

正式 HTTPS 逐檔核對 1,465 個檔案及 MIME／SHA-256，323 核心檔與準備包一致。正式站 35 項操作包含原生選檔、SPLIT 匯出重開與 pattern 搜尋、動態 PAD 的未檢查原因、錯誤 SLICE 阻擋且零下載，以及完整 21,006 筆 JSON／畫面 100→200 筆分批顯示；新增情境零個自動 runtime Worker。15 組 32px 文字框、19 種手動 runtime、八輪／24 次 CPU／IO、原記憶體規則及 Worker／程序退出均依原政策核對。這是 Linux Chromium 正式站驗收；Windows 候選的 Chrome 正常關閉失敗仍保留，不能以此宣稱修好。

四份實際公開下載與準備包逐一核對：ZIP 為 41,280,015 bytes，SHA-256 `422c245dfd6736a37af9e4b30d9ee871a7265ac4a50f93d176fbf18fc9b31a60`；manifest、發布憑證與 checksum 也一致。[最終收據](results/product-readiness-v1.3.0-published.json)及[原始報告／metadata／截圖與讀取器](results/product-readiness-v1.3.0-evidence.zip)保留。資料與模型仍全程本機；靜態通過不保證任意 kernel、量化語意或數值等價，沒有規則、動態或超預算仍明列未檢查。發布後只更新文件與證據，不移動 tag、不改寫固定資產、不重跑成功部署。
