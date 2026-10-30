# 模型檢查與保存補強（v1.1.0）

本輪依使用者指示完成五項重要工作；Windows Chrome／Edge、main 四項關卡與實體 2.5 GiB MLIR 均已通過並獨立核對；固定準備包、正式站與四份 Release 下載已驗證，v1.1.0 正式交付。

## 編輯匯出

新增 FC 的 flatten／keep_num_dims／bias 元素數、BATCH_MATMUL 的轉置／batch broadcast／contracting dimensions、GATHER 的 axis／batch_dims／indices dtype，以及量化 scale／zero point／per-axis 維度檢查。合法的單 input RESHAPE 仍可透過 options 提供 new_shape；hybrid FC 不要求 input 與 weights dtype 相同。

改線和修改原始 OP 也走既有參數檢查；錯誤帶 subgraph、候選與來源 OP、input／output tensor 編號。序列化後重新解析的候選另檢查可讀的 TRANSPOSE permutation、RESHAPE shape、EXPAND_DIMS axis 及 GATHER indices。單次最多讀 4 MiB 常數、單 tensor 1 MiB，預算不足或未知值明列未檢查，不讀完整權重。

一般開檔、編輯、匯出不跑 interpreter。手動 runtime 若在載入／配置 tensors 階段失敗，提示此時尚未套用測試輸入，保留原始診斷，不暗示切換零值或亂數能修復配置錯誤。結構與常數檢查不保證任意 kernel、custom runtime 或數值等價。

規則對照 TensorFlow 的 [FC](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/fully_connected.cc)、[BATCH_MATMUL](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/batch_matmul.cc)與 [GATHER](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/kernels/gather.cc)；runtime 支援仍以實際封裝版本為準。

## 草稿與 pattern

三個 IndexedDB adapter 的異常 close 只清除自己的連線快取，舊 close 不會清掉新連線。探索／編輯草稿的讀取要等交易 complete 才算成功，abort 不套用半途讀到的資料。已 commit 的探索草稿保存／移除不受通知通道例外影響。

Node 邊界測試先取得五個失敗、修正後與既有保存／恢復等 53 項通過。這不冒充真實 browser quota、權限設定或 OS 斷電驗收；Windows 驗收另使用獨立 context 的實際 Chromium quota override 及本機測試 origin 資料清除。候選測試只清除新建 localhost context 的資料；正式站補驗只清除新建隔離 context 的正式站 IndexedDB，不接觸個人 profile、其他分頁或伺服器資料。OS 斷電及實體磁碟耗盡仍不在此測試範圍。

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

兩個實際修改 RPC 改用同一個統計函式，回報 `parseBytesRead`、`semanticBytesRead` 及兩者總量；不調整獨立 FileReaderSync 觀察值或減去任何讀取。記憶體內既有常數的檢視另外計 `inspectedBytes`，不假裝成 File 讀取。真實序列化 TRANSPOSE 的小型案例先重現 1104／1112 的差異，修正後連同資料保留、報告與既有修改等 24 項通過；修正後 main 的實體八輪與完整讀取量對帳已通過，原失敗仍保留。

## 固定候選驗收

來源 `b30f42dd724deb3673baac80ba0b89f2f2b0c2da`／tree `4b9d9f72222c8736c482f294e393820ef7495278`／build `046a929575350202`，315 核心檔。PR #177 最終 head 與 main 完整 tree 相同；五項功能來自 PR #176，必要 Linux Node／建置／合約與效能成功；沒有在 main 重跑相同 Node 套件。

- [core 41073913643](https://github.com/koviankevin/tflite-explorer/actions/runs/41073913643)：provider 原始 ZIP、digest、CRC、來源與 scope 核對通過。
- [browser 41073918917](https://github.com/koviankevin/tflite-explorer/actions/runs/41073918917)：provider 原始 ZIP、digest、CRC、來源與 scope 核對通過。
- [contract 41073924463](https://github.com/koviankevin/tflite-explorer/actions/runs/41073924463)：provider 原始 ZIP、digest、CRC、來源與 scope 核對通過。
- [site 41073929648](https://github.com/koviankevin/tflite-explorer/actions/runs/41073929648)：provider 原始 ZIP、digest、CRC、來源與 scope 核對通過。

Windows Chrome／Edge 分別為 156.0.8078.76／156.0.4314.50，觀察到的全部 Workers（模型／圖形）均已原生關閉；1280×640／32px 的編輯與配額失敗截圖已核對。真實配額為 1 byte；獨立對照證實該 Chrome 的零配額仍可寫入，因此沒有把零配額結果冒充拒絕驗收。早期失敗、控制與成功檔案均保留，舊第五輪名為32px的最終圖實際為14px，不作為32px證據；第六、七輪明確設定字級並驗證幾何。

[實體 MLIR 41073935420](https://github.com/koviankevin/tflite-explorer/actions/runs/41073935420)：2,684,355,495 bytes、1342177280 個 i8 元素，dense hex 計數／SHA、SSA／dominance、分支迴圈 pattern 各一筆與匯出重開通過；Node peak RSS 288,948,224 bytes，開啟約 9.47 秒，非瀏覽器或公司 verifier 驗收。

[候選原始資料](results/model-safety-candidate-originals.zip)與[逐檔 SHA／reader 實際退出](results/model-safety-candidate-originals.json)保留。正式站與固定 Release 已發布，最終證據如下。

## 正式發布

[v1.1.0 固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.1.0)及[正式站](https://koviankevin.github.io/tflite-explorer/)已交付。發布來源 `697d9dfb6d128a522ac213c10cf8f072f643cab9`／tree `75924bef7f57207158ea9b8025b526806e92e28b`／build `9338194b51c14371`；315 核心檔、全站 1,432 檔。

[準備 41078001959](https://github.com/koviankevin/tflite-explorer/actions/runs/41078001959)的原始產物與獨立乾淨重建相同；[發布 41078689147](https://github.com/koviankevin/tflite-explorer/actions/runs/41078689147)四工作均 attempt 1 成功。權威 deployment `7441806221`、全站檔案與 root、版本歷史及四份實際 Release 下載一致。固定 ZIP SHA-256 為 `db77bda84cdb3933366847858c173a49634ac3ed3527dbb0736636ded7a13ada`，site ID 為 `af02f3beb6ae54b78b30111d0c6b612a93c684ae900ca4f3b166af4d2095e83a`。

正式站 Hosted Chromium 的 33 項原生操作、五組指南、19 種執行／分佈情境、86 model／44 runtime Worker close、14＋24 次輸入清理、既有 30／60 秒自然計時、容量／啟動恢復及八輪 CPU／IO 均通過；不更動 workflow、安全或 RSS／timer 規則。候選到發布來源只有已排除的文件／憑證變更，實際執行 scope fingerprint 相同，必要成功關卡沿用，沒有重跑成功部署。

發布後另用已安裝的 Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 開正式 HTTPS 站，核對 model Worker 都來自 build `9338194b51c14371`。兩者在 1280×640／32px 完成 native 選檔、搜尋定位、大小預覽、子模型下載重開／分頁、clone／接線、JSON 草稿下載／重選原模型恢復、Undo／Redo、修改模型下載重開、真實 1-byte quota 拒絕／備份／重試，以及隔離 context 的 IndexedDB 清除後保留操作並另存草稿；全部觀察到的 Worker 原生 close，無 pageerror。已檢視正式 Windows quota 與編輯截圖；不代表 OS 斷電、實體磁碟耗盡、權限設定切換、固定硬體 SLA 或所有 kernel／dialect 已驗證。

[正式獨立核對](results/model-safety-published-final.json)、[原始 provider／Windows 截圖與小型下載](results/model-safety-published-originals.zip)及[逐檔 SHA／實際退出](results/model-safety-published-originals.json)保留。41 MB 固定部署 ZIP 在 Release 保留，不重複放入驗收 ZIP，也不包含瀏覽器 profile。後續只補交付文件，不重新部署同一版本。
