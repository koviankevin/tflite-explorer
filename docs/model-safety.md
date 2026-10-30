# 模型檢查與保存補強（v1.1.0 候選）

本輪依使用者指示完成五項重要工作；目前程式為候選，尚待 Windows 實測、main 發布關卡、正式站與固定 Release 核對，不宣稱已發布。

## 編輯匯出

新增 FC 的 flatten／keep_num_dims／bias 元素數、BATCH_MATMUL 的轉置／batch broadcast／contracting dimensions、GATHER 的 axis／batch_dims／indices dtype，以及量化 scale／zero point／per-axis 維度檢查。合法的單 input RESHAPE 仍可透過 options 提供 new_shape；hybrid FC 不要求 input 與 weights dtype 相同。

改線和修改原始 OP 也走既有參數檢查；錯誤帶 subgraph、候選與來源 OP、input／output tensor 編號。序列化後重新解析的候選另檢查可讀的 TRANSPOSE permutation、RESHAPE shape、EXPAND_DIMS axis 及 GATHER indices。單次最多讀 4 MiB 常數、單 tensor 1 MiB，預算不足或未知值明列未檢查，不讀完整權重。

一般開檔、編輯、匯出不跑 interpreter。手動 runtime 若在載入／配置 tensors 階段失敗，提示此時尚未套用測試輸入，保留原始診斷，不暗示切換零值或亂數能修復配置錯誤。結構與常數檢查不保證任意 kernel、custom runtime 或數值等價。

規則對照 TensorFlow 的 [FC](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/fully_connected.cc)、[BATCH_MATMUL](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/batch_matmul.cc)與 [GATHER](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/gather.cc)；runtime 支援仍以實際封裝版本為準。

## 草稿與 pattern

三個 IndexedDB adapter 的異常 close 只清除自己的連線快取，舊 close 不會清掉新連線。探索／編輯草稿的讀取要等交易 complete 才算成功，abort 不套用半途讀到的資料。已 commit 的探索草稿保存／移除不受通知通道例外影響。

Node 邊界測試先取得五個失敗、修正後與既有保存／恢復等 53 項通過。這不冒充真實 browser quota、權限設定或 OS 斷電驗收；Windows 驗收另使用獨立 context 的實際 Chromium quota override 及本機測試 origin 資料清除。清除只作用於新建的 localhost 測試 origin，不接觸正式站或個人資料。OS 斷電及實體磁碟耗盡仍不在此測試範圍。

## Custom 子模型大小

在圈選工具列按「查看匯出大小」，依 metadata 顯示保留的 buffer 數量及資料 bytes，並列出 custom op 不明引用所需保守保留的額外資料量。預覽不讀權重、不建立候選、不下載；最終 TFLite 另含結構、metadata、options 與對齊。

未知 custom options 可能內嵌 tensor／buffer 編號，因此仍保留全部原始 buffers／編號。額外保留不代表無用；沒有安全的引用契約時不猜測刪除。已有一般 builtin 匯出壓縮能力保持原範圍。

## 大型 MLIR dense

在既有單次分段讀取中累計數值 token 或 hex digits，不保留完整值陣列，不增加一次全檔讀取。支援的靜態 tensor／vector 型別會核對元素數與常用 byte-aligned hex 長度，支援 scalar splat；型別／packing／編碼不明列為未檢查。匯出候選沿用完整 literal 的計數，重新核對當前型別，拒絕 count 不符；原始 File slices 仍保持原文。

這是 [MLIR dense elements](https://mlir.llvm.org/docs/Dialects/Builtin/#densetypedelementsattr)的計數與長度檢查，不是逐值數值範圍、resource packing 或 dialect verifier。外部 resource 選檔仍未支援。

## Windows 驗收入口

`node test/browser/windows-acceptance.mjs <乾淨候選目錄> <全新報告目錄> --allow-local-browser` 僅在 Windows 且使用者明確允許時執行，不安裝瀏覽器、不用個人 profile。依序開啟已安裝的 Chrome／Edge，驗證 native 選檔、搜尋、32px、大小預覽、子模型分頁、clone／接線、JSON 草稿匯入與重選原模型、Undo／Redo、匯出重開、實際 quota 失敗／備份／重試及測試 origin 儲存清除後的恢復。

兩個瀏覽器都必須成功；未知能力、未安裝或測試錯誤不略過。原始 JSON、bytes hashes 與截圖保留，正式發布仍遵守既有 main-only 關卡，不變更 workflow、安全、RSS 或計時門檻。

## 新常數讀取的統計修正

首個 main 實體八輪 [41069901739](https://github.com/koviankevin/tflite-explorer/actions/runs/41069901739)完成八輪功能／bytes 比對，但在最後的讀取量對帳失敗：每個修改／組合候選新增 16 bytes 常數讀取，原先的 `roundTripStats.bytesRead` 只包含重新解析。原始 provider ZIP／JSON 已認證保留，該輪仍列失敗，不宣稱已通過 RSS 或整個關卡。

兩個實際修改 RPC 改用同一個統計函式，回報 `parseBytesRead`、`semanticBytesRead` 及兩者總量；不調整獨立 FileReaderSync 觀察值或減去任何讀取。記憶體內既有常數的檢視另外計 `inspectedBytes`，不假裝成 File 讀取。真實序列化 TRANSPOSE 的小型案例先重現 1104／1112 的差異，修正後連同資料保留、報告與既有修改等 24 項通過；新 main 實體關卡仍待完成。
