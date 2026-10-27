# 實際模型編輯：開發中

使用者已確認要修改實際模型並重新匯出，範圍包含 TFLite 與文字 MLIR。這不是修改搜尋 pattern。此文件記錄開發分支，**正式網站仍為 preview.9，模型修改介面尚未交付**。

## 已完成的核心

- MLIR 的整份模型修改以 parser 記錄的位置新增、刪除、替換 OP 及重接 SSA，保留其他 function、block、custom dialect 原文、型別和 attributes。產生新檔前重新解析整份候選並檢查 SSA、型別、控制流程和 dominance；失敗不產生模型。跨 function 的同名 SSA 值不能冒充指定的定義。
- TFLite 的整份模型修改可從既有 OP 範本新增、刪除、排序、重接 tensor 和修改支援的 scalar builtin options；新 result tensor 接在原表後。保留其他 subgraphs、operator codes、tensor／buffer 編號、metadata、signature 及 opaque custom options。介面變更影響 signature 時要求明確同步更新，保留未變動介面的名稱對照。
- 模型原檔保持不變；大型 MLIR dense／resource 與 TFLite 權重／custom options 透過原始 File slices 組合。修改後的結構要重新開啟為新模型，不能用舊圖當作預覽。
- MLIR 既有局部匯出的結構註記有 seal；修改拓撲後失效的註記不能再隱藏修改後的 OP，也不能造成舊 pattern 誤匹配。

`test/mlir-model-edit.test.mjs` 與 `test/tflite-model-edit.test.mjs` 共 13 個核心案例已通過，涵蓋正例、懸空值、重複 producer、唯讀權重寫入、型別／dominance 錯誤、控制流程引用和 signature 更新。這些是合成資料的 Node 驗證，不是瀏覽器模型編輯驗收或 native runtime 語意保證。TFLite 現階段以既有 OP 為範本，尚非任意 OP catalog 或 kernel shape inference。

## 接續必須完成

1. 在網站提供實際模型編輯入口、OP 新增／刪除／替換、接線與參數介面；清楚區分 pattern 編輯。結果須能下載及同分頁重新開啟。
2. 將驗證及失敗原因接入 UI，保護修改期間的來源識別與非同步過期結果；原模型不得被失敗的候選取代。
3. 針對分支、匯合、迴圈與 custom OP 執行原生瀏覽器修改、下載、重開與 pattern 正負例；補測 32px、手機／14 吋和鍵盤焦點。
4. 在超過 1 GiB／20,000 OP 的實體檔驗證修改及整份模型輸出的時間、記憶體與關閉釋放；不能以既有子模型匯出量測代替。
5. 依既有來源綁定關卡部署 GitHub Pages，核對正式產物並提供固定內網更新包。公司 dialect verifier、custom kernel 和推論正確性留在內網驗收。

## 已完成的 pattern 操作驗收

獨立的圈選→pattern 草稿編輯、跨 block 結構編輯、分頁連線控制項及直接開啟匯出結果，已在來源 `4b45a99c6e042ba143cf3c23c04096b3c59776fe` 的 [隔離瀏覽器 run](https://github.com/koviankevin/tflite-explorer/actions/runs/40491646711) 通過。原始報告為 [pattern-editor-cfg-browser-2026-10-27.json](results/pattern-editor-cfg-browser-2026-10-27.json)。13 項操作、10 個模型 Worker 關閉；256 個結構節點、500 條連線的 query 只建立目前頁的 12 個連線控制項。這份結果不涵蓋後續實際模型編輯核心或介面，也不是正式部署證明。

實作參照：[TFLite schema](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/compiler/mlir/lite/schema/schema.fbs)、[MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/)。編碼以 repository 固定的 Netron schema 為準；未知新欄位仍拒絕匯出。
