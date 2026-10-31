# 匯出報告與本機驗證

TFLite／MLIR 匯出啟動下載後，搜尋欄的「最近匯出報告」可查看摘要及下載完整 `.report.json`。只保留最近一次結果，關閉／更換模型時清除，不寫入 localStorage，不傳送網路。報告含模型檔名、OP 名稱、型別與介面資訊；不含權重值、完整 attributes 或 custom options bytes。分享前請確認其中的內部名稱。

## 報告包含什麼

- 來源檔名、大小、網站 build ID、實際選取的 graph／node／type。
- 匯出模式、檔案大小、輸入／輸出對照。TFLite 邊界包含原始／新 tensor 編號、shape、dtype、量化參數；MLIR 包含 SSA 名稱、型別、條件輸出的 results 位置與出口旗標。
- TFLite 原 OP／tensor 編號對照，以及保留編號／全部 buffers 的 custom op 策略。Tensor 對照列出所選 OP 實際使用的 tensors，其餘為保留 metadata，不宣稱有使用。
- MLIR 原 OP 對照、因控制流程需要保留的 OP、新增路由／輸出 OP。輸出座標是匯出 function body 的 block／operation ordinal，巢狀 operation 另列 region／block／operation 路徑，不使用會因精簡圖切換而改變的顯示節點編號。module／function 包裝不算新增運算。選取帶 region 的父 OP 時，其內部 OP 一併保留及列出。
- 原始權重／deferred dense／resource／custom options 在來源及匯出檔中的 byte offset、byte length。這是從組合 Blob 的相同位置記錄，不重新讀取權重；多次引用同一原文會列出多個輸出範圍。
- 檢查範圍：已完成的結構檢查與尚未進行的 bytes 比對、native compiler、runtime／dialect 語意、dense 逐值檢查分開列出。
- TFLite 編輯候選另列逐 OP 的靜態規則狀態、原因與 input／output tensor 編號；動態值、超出常數預算及未支援的 OP 明列未檢查。網站每次顯示 100 筆，完整 JSON 保留全部。適用規則和交付狀態見 [OP 驗證](operator-validation.md)。

報告上限 16 MiB、最多 100,000 個原始資料範圍、MLIR 最多 50,000 個保留 OP 對照；超過時模型仍可下載，介面明示本次沒有完整報告，不以截斷對照冒充完整報告。產生報告不計算完整來源檔 SHA-256，檔名及大小不是身分驗證；報告不是簽章或數值等價性保證。

## 在公司環境比對實際下載檔

需要 Node.js 22 以上，無需額外 npm 套件或外網。保留原始模型、剛下載的子模型及其報告：

```powershell
node scripts/verify-export.mjs --report cut.mlir.report.json --source original.mlir --output cut.mlir --save cut.verification.json
```

同一指令也適用 `.tflite`。工具以最多 1 MiB 的 buffer 分段計算每個來源及輸出範圍的 SHA-256，檢查實際 bytes 相同，再串流計算完整輸出 SHA-256；不將整個模型讀入字串或 ArrayBuffer。不一致、截斷、範圍錯誤、大小不符或驗證期間檔案變動時，非零退出。沒有原文 payload 範圍的模型顯示 `not-applicable`，不冒充已驗證權重。

公開／內網部署 ZIP 亦附帶同一工具，從解壓目錄使用 `node tools/verify-export.mjs …`，不需 Git checkout。請保留整包目錄，因工具會引用同包的 `src/export-report.js`；`tools/export-reports.md` 是此份說明。

`--save` 使用新檔建立模式，不覆寫既有檔案。收據是額外產物，不修改原始報告或模型；完整來源檔仍未計算 SHA-256。只比對報告列出的範圍，不能用這個結果保證所有 OP 或未列出的 bytes 沒被修改。完整輸出 SHA-256 可供後續傳輸核對。

## 接公司 compiler

可明確指定公司允許的 MLIR compiler／`mlir-opt`：

```powershell
node scripts/verify-export.mjs --report cut.mlir.report.json --source original.mlir --output cut.mlir --compiler C:\company\bin\mlir-opt.exe --save cut.verified.json
```

編譯器使用明確的執行檔及 argv，不透過 shell；模型和報告不能指定命令或載入外掛。工具依 `mlir-opt` 慣例傳入輸出模型路徑與 `-o NUL`（Linux 為 `/dev/null`），不保留 compiler 輸出 IR。需要額外參數時重複 `--compiler-arg`；預設 timeout 120,000 ms，可用 `--compiler-timeout` 指定 1,000～3,600,000 ms。超時或非零退出會記錄失敗並令 CLI 非零退出；compiler 的 stderr 最多記錄 8 KiB，可能包含內部路徑／名稱，收據分享前也要確認。

公開 compiler 沒有公司 dialect 時，可以明確加 `--compiler-arg --allow-unregistered-dialect` 做額外語法／SSA 驗收，但這會略過未知 dialect 的自訂 verifier，不能宣稱公司語意通過。公司 compiler、dialect、runtime 與數值正負例需在內網提供及驗收；網站不會上傳模型來替代這一步。TFLite 的 custom kernel／delegate 執行另由原 runtime 處理，此接點不啟動推論。
