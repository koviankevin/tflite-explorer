# 實際模型編輯

自 preview.14 起，網站實際模型編輯僅支援 TFLite。此頁 MLIR OP 編輯內容為歷史說明；MLIR 仍可探索、搜尋、編輯 pattern 及匯出局部模型。最新操作與驗收見 [TFLite 模型編輯工作區](model-edit-workspace.md)。

使用者已確認要修改實際模型並重新匯出，範圍包含 TFLite 與文字 MLIR。這不是修改搜尋 pattern。核心與介面已合併 main，最終來源的大型模型及四關卡均通過；**最新 preview.12 已部署，提供同網站獨立圖形編輯、接線、自動輸出與變更預覽；正式站與固定 Release 驗收通過**。見 [最新交付與原始證據](model-edit-workspace.md)。本頁保留進階單一 OP 表單的能力與驗收；主要入口改為右上「編輯模型」，原表單現名「進階 OP 表單」。

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

## 仍須內網驗收的範圍

公司 dialect verifier、custom kernel 和推論正確性仍須內網驗收；TFLite 任意新 OP catalog、所有 metadata 參數和完整全模型 OP diff 不在這版已驗證範圍。

## 最終來源驗收

此節保留 preview.10 的原始來源驗收；preview.11 的多選修正、最新來源關卡與正式交付見 [多選編輯驗收](model-edit-multiselect.md)。

受測 main 為 `d28e42fb70d0f81329dd49d08b6f5db8b136f7db`、tree `6c6956d42735b03b7247b992356df0586dfcebc5`；四個 workflow_dispatch 均成功。後續只補操作說明、原始證據及 run 選擇；prepare 仍須重新核對相依 fingerprint、API、artifact digest、原始量測與乾淨候選重建。

| 關卡 | 結果 |
| --- | --- |
| [核心效能 40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445) | 九筆固定 policy 量測通過 |
| [實體大檔 40503469247](https://github.com/koviankevin/tflite-explorer/actions/runs/40503469247) | 八輪新增 OP、整份匯出、直接重開、子模型匯出、原生重開、關閉與自然 URL 撤銷通過；[原始量測](results/model-edit-final-browser-2026-10-27.json) |
| [封裝契約 40503480942](https://github.com/koviankevin/tflite-explorer/actions/runs/40503480942) | 75 項測試，零失敗／略過／取消；[原始報告](results/model-edit-final-contract-2026-10-27.json) |
| [隔離站台 40503488236](https://github.com/koviankevin/tflite-explorer/actions/runs/40503488236) | 六種升降版切換，另有 16 項原生 UI／鍵盤操作與 21 個模型 Worker 關閉；[切換報告](results/model-edit-final-site-2026-10-27.json)、[UI 報告](results/model-edit-final-ui-2026-10-27.json) |

大型 corpus 是實體寫滿、完整 readback SHA-256 的 1,349,965,216-byte／21,005 OP 合成 TFLite，每輪輸出為 1,350,445,736 bytes／21,006 OP。完整修改模型重開後仍找到 prefix 與分支 pattern 各一次；再匯出四 OP 子模型，原生選檔重開後正例一次、另一結構零次。八份完整輸出 SHA-256 均為 `6371d2132d4f1816666c04f3132ae0f395de5f54777d6adcab55f0c07ea6665b`，權重 SHA-256 與原始 1.25 GiB 權重一致；每份修改報告七個 ranges、1,342,177,328 bytes 的串流逐段比對通過，含 opaque custom options。

完整修改、候選重新解析及原生下載合計約 11.5～16.0 秒／輪。整個 Chromium 程序樹的 sampled peak RSS 約 872.1 MiB（相對初始增加 391.4 MiB）；扣除兩輪 warmup，closed RSS drift 約 9.1 MiB、slope 約 -0.22 MiB／輪，main heap drift 約 303 KiB。24 個模型 Worker 全部終止，八個 source Worker 的原始加候選實際讀取各為 16,318,536 bytes，單次最多 65,536 bytes，均低於既有 16 MiB／realm 與 1 MiB／read 門檻。未強制 GC、未縮短 60 秒 URL 壽命；全部 Blob URLs 自然撤銷，整個瀏覽器最後關閉。

這是 hosted Linux Chromium 八輪、500ms RSS 取樣及三個時點的 Worker V8／backing storage 量測；不能證明長時間絕不洩漏、連續峰值或公司硬體 SLA。UI 以 1366×640 和 390×844、32px 模型圖檢查 modal 版面；不是實體手機或公司 compiler／runtime 驗收。MLIR 五份合成輸出沒有權重 ranges，其 byte comparison 明列 not-applicable，未冒充權重驗證。

## 已完成的 pattern 操作驗收

獨立的圈選→pattern 草稿編輯、跨 block 結構編輯、分頁連線控制項及直接開啟匯出結果，已在來源 `4b45a99c6e042ba143cf3c23c04096b3c59776fe` 的 [隔離瀏覽器 run](https://github.com/koviankevin/tflite-explorer/actions/runs/40491646711) 通過。原始報告為 [pattern-editor-cfg-browser-2026-10-27.json](results/pattern-editor-cfg-browser-2026-10-27.json)。13 項操作、10 個模型 Worker 關閉；256 個結構節點、500 條連線的 query 只建立目前頁的 12 個連線控制項。這份結果不涵蓋後續實際模型編輯核心或介面，也不是正式部署證明。

實作參照：[TFLite schema](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/compiler/mlir/lite/schema/schema.fbs)、[MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/)。編碼以 repository 固定的 Netron schema 為準；未知新欄位仍拒絕匯出。
