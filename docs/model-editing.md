# 實際模型編輯：開發中

使用者已確認要修改實際模型並重新匯出，範圍包含 TFLite 與文字 MLIR。這不是修改搜尋 pattern。開發分支已有模型編輯介面及合成瀏覽器驗收，**正式網站仍為 preview.9；尚待大型模型驗收、正式來源關卡及部署**。

## 已完成的核心

- MLIR 的整份模型修改以 parser 記錄的位置新增、刪除、替換 OP 及重接 SSA，保留其他 function、block、custom dialect 原文、型別和 attributes。產生新檔前重新解析整份候選並檢查 SSA、型別、控制流程和 dominance；失敗不產生模型。跨 function 的同名 SSA 值不能冒充指定的定義。
- TFLite 的整份模型修改可從既有 OP 範本新增、刪除、排序、重接 tensor 和修改支援的 scalar builtin options；新 result tensor 接在原表後。保留其他 subgraphs、operator codes、tensor／buffer 編號、signature 及 opaque custom options。介面變更影響 signature 時要求明確同步更新，保留未變動介面的名稱對照；移除描述舊介面的 `TFLITE_METADATA`，其 buffer bytes／編號及其他 custom runtime metadata 保留。
- 模型原檔保持不變；大型 MLIR dense／resource 與 TFLite 權重／custom options 透過原始 File slices 組合。修改後的結構要重新開啟為新模型，不能用舊圖當作預覽。
- MLIR 既有局部匯出的結構註記有 seal；修改拓撲後失效的註記不能再隱藏修改後的 OP，也不能造成舊 pattern 誤匹配。

`test/mlir-model-edit.test.mjs` 與 `test/tflite-model-edit.test.mjs` 的核心案例涵蓋正例、懸空值、重複 producer、唯讀權重寫入、型別／dominance 錯誤、控制流程引用和 signature 更新；另有操作表單、200 個 SSA 使用者的批次重接、修改報告／磁碟串流比對，以及過期 metadata 正負例。這些不能代替 native runtime 語意驗證。TFLite 現階段以既有 OP 為範本，尚非任意 OP catalog 或 kernel shape inference。

## 網站操作

在 Layers 或模型圖選取一個原始 OP，再按「編輯實際模型」。基本欄位可修改接線；TFLite 可修改支援的 scalar options，或在前／後複製新增 OP，為輸出建立新的 tensor；MLIR 可修改 generic OP 名稱，也可用完整 IR 修改 attributes、properties、型別及結構。刪除後須明確指定替代值；TFLite 另可將仍使用的輸出改為模型 inputs，呼叫端須提供其數值。

按「驗證並匯出整份模型」後，在本機 Worker 重新解析實際寫出的候選 bytes；成功才提供下載及「開啟修改結果」。失敗保留原模型並在對話框顯示原因。關閉對話框／換模型後，過期結果不會下載或覆蓋目前狀態。輸入新搜尋字詞時立即停用舊結果，避免 debounce 期間點到先前同樣為一筆的清單。

可下載修改報告，包含修改來源、前後 OP 數、各 scope 介面、權重／custom options byte ranges 和明確未執行的檢查。沿用 `node scripts/verify-export.mjs --report ... --source ... --output ...` 比對實際下載檔，MLIR 可另指定公司 compiler。報告只列修改目標；完整 IR／region 修改不猜測一對一對照，也未提供所有未變動 OP 的位置映射。各 block／subgraph 介面不等同於 MLIR function ABI；不宣稱改模後與原始模型數值等價。

來源 `dad325d4044c4cbf095403883a187b338b5ce1b4` 的 [隔離瀏覽器 run 40499755998](https://github.com/koviankevin/tflite-explorer/actions/runs/40499755998) 通過 16 項操作、21 個模型 Worker 關閉，實際下載八份修改模型及八份修改報告。TFLite 權重／custom options 的報告範圍在磁碟逐段比對通過；五份 MLIR 測試沒有權重 ranges，仍計算完整輸出 SHA-256，不能寫成其權重已被比對。原始報告為 [model-edit-ui-browser-2026-10-27.json](results/model-edit-ui-browser-2026-10-27.json)。

涵蓋 TFLite 新增／參數修改／custom OP 刪除、錯誤接線與懸空輸出拒絕、進行中候選取消；MLIR 分支／匯合／迴圈、custom attributes 保留、dominance 負例、OP 新增／刪除後的 pattern 正反例。1366×640 與 390×844 在 32px 模型圖下無水平溢出，模型編輯 modal 的 Tab 邊界及 Escape 焦點還原通過。全部為公開合成資料、hosted Linux Chromium；不是正式站、實體手機或公司工具驗收。其後過期 metadata 修正另有針對性 Node 驗證，最終發布仍須核對新來源。

## 接續必須完成

1. 在超過 1 GiB／20,000 OP 的實體檔驗證修改及整份模型輸出的時間、記憶體與關閉釋放；不能以既有子模型匯出量測代替。
2. 依既有來源綁定關卡部署 GitHub Pages，核對最終來源與正式產物，提供固定內網更新包。
3. 公司 dialect verifier、custom kernel 和推論正確性仍須內網驗收；TFLite 任意新 OP catalog、所有 metadata 參數和完整全模型 OP diff 不在這版已驗證範圍。

## 已完成的 pattern 操作驗收

獨立的圈選→pattern 草稿編輯、跨 block 結構編輯、分頁連線控制項及直接開啟匯出結果，已在來源 `4b45a99c6e042ba143cf3c23c04096b3c59776fe` 的 [隔離瀏覽器 run](https://github.com/koviankevin/tflite-explorer/actions/runs/40491646711) 通過。原始報告為 [pattern-editor-cfg-browser-2026-10-27.json](results/pattern-editor-cfg-browser-2026-10-27.json)。13 項操作、10 個模型 Worker 關閉；256 個結構節點、500 條連線的 query 只建立目前頁的 12 個連線控制項。這份結果不涵蓋後續實際模型編輯核心或介面，也不是正式部署證明。

實作參照：[TFLite schema](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/compiler/mlir/lite/schema/schema.fbs)、[MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/)。編碼以 repository 固定的 Netron schema 為準；未知新欄位仍拒絕匯出。
