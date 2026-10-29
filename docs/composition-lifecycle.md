# 大型 TFLite 組合生命週期驗收

修正後的 Hosted Chromium 實體八輪已通過，原始產物及獨立核對見下方。正式網站維持 preview.26，這次只改測試及發布證據判定，不重新部署應用。

## 工作負載

既有 `browser-lifecycle.yml` 的八輪模式增加組合操作；原完整編輯、子模型匯出、權重／custom options、pattern 正負例及自然釋放流程全部保留。兩小時 soak 仍採原 v2 範圍，不因本次新增驗收而重新執行或延後部署。

每輪使用同一個實際寫入、fsync、完整讀回 SHA-256 的 1,349,965,216-byte／21,005 OP TFLite。原生選檔再次開啟來源，從 prefix 與分支／匯合的實際搜尋結果各加入四個 OP，Undo／Redo 第二次匯入，將前段輸出接到後段入口，再複製新增 ADD 並接線。明確模型介面為一個 input、兩個 outputs；匯出結果只含八個來源 OP 及一個新增 OP。

從真正的本機自動保存清單下載該輪新增的組合草稿，核對 v2、完整原模型指紋、八個來源 OP、七步命令、兩次 import 及 32px。這項操作是已保存草稿的下載，不是手動「儲存編輯草稿」的另一次模型 Worker 指紋讀取，也不宣稱大型 v2 手動匯入恢復已測。

每輪實際下載組合 TFLite 及修改報告、關閉原模型、以原生選檔重開下載檔。重開必須是九個 OP，沿用原 prefix／branch pattern 各一筆、錯誤連線 pattern 零筆、預設 RESHAPE → TRANSPOSE → RESHAPE 一筆。Node 另外以有上限的讀取重新解析，核對接線、tensor／buffer 編號、兩個 custom options、完整非零 1.25 GiB 權重 SHA 與獨立 byte-range 報告；八輪組合輸出必須 byte-identical。

## 固定判定

`MODEL_COMPOSITION_LIFECYCLE_POLICY` 為 v3，與 v1／v2 的數值門檻完全相同：八輪、前兩輪暖機、每 500ms 取樣、自然 60 秒 URL 壽命與五筆關閉後樣本；768 MiB 瀏覽器 RSS 峰值成長、128 MiB 關閉 RSS 漂移、16 MiB／輪斜率、32 MiB main heap 漂移、512 MiB Worker heap／backing storage，以及每次最多 1 MiB／每 realm 16 MiB 解析讀取。

每輪五個模型 Worker 檢查點，含原模型、整份修改結果、子模型、組合來源、組合結果。全程須有 40 個模型 Worker 的 terminate 紀錄及原生 close、16 次實際候選解析、16 個完整原檔指紋 Worker 及原生 close，最後所有 Blob URL 撤銷、File input 清空、owned Chromium PID／start-ticks 正常退出。發布判定重新計算原始量測，不只相信 passed 標示。舊 v1／v2 歷史結果仍依各自範圍核對。

1280×640／32px 下還需無水平溢出、組合圖區至少 200px。此工作負載不呼叫 interpreter，不重新啟動瀏覽器、不重載清快取、不強制 GC，也不縮短下載 URL 壽命。只上傳有上限的數值／驗證報告，不上傳模型或權重。

## 目前證據

38 項本機 Node 檢查通過，涵蓋 v1／v2 相容、v3 缺少組合／指紋／原生 close／candidate parse／清理時拒絕，以及原兩小時門檻。另以完整 21,005 OP 拓樸、64-byte 縮小權重核對同一套組合命令、輸入／輸出、custom options 及權重 bytes；它不是 >1 GiB 或瀏覽器記憶體證據。

Hosted 真實八輪的 source、job、provider artifact digest／CRC、原始報告及獨立判定見下方。有限八輪不能證明永不洩漏，也不涵蓋大型組合兩小時、Firefox／WebKit、公司模型或 custom kernel 執行。

## 首次實測：Node 核對器 callback 錯誤

[40819329430](https://github.com/koviankevin/tflite-explorer/actions/runs/40819329430) 來源 `f4f8134d3ee9d36fc8acee6d5881844f90e73c2a` 在第一輪失敗；[原始 provider ZIP](results/composition-physical-first-failure-2026-10-29.zip)及[來源／digest／CRC 核對](results/composition-physical-first-review-2026-10-29.json)保留 failed，不能視為八輪成功。瀏覽器已走完組合下載重開與 pattern 斷言，五個 heap 檢查點都有數值；隨後 Node `verifyComposition` 把 async callback 傳給同步 `RangeStream`，讀取結果成為 Promise，因而回報「檔案讀取長度不完整」。不是應用解析器或記憶體門檻失敗。

新增實際檔案核對器回歸，以完整 21,005 OP 拓樸、64-byte 權重匯出九個 OP 後，呼叫與 Hosted 相同的 `readCompositionIndex`。修正前穩定重現相同錯誤；改用有界 `readSync` callback 後三項 fixture 測試通過。保留所有原始讀取、權重與記憶體上限；網站程式、工作流程和正式部署沒有改動。修正後的真實八輪結果見下節。


## 修正後的實體八輪

[40819856581](https://github.com/koviankevin/tflite-explorer/actions/runs/40819856581) 來源 `3bbbf73badde1f2eda46eb7926cf5bab8c23659e`／tree `cca31b67fd8f817db386f1c62411b7a3ce4952e9`／本機獨立重建與 CI build `f9da8008c30d0650`，在 attempt 1 通過。[provider 原始 ZIP](results/composition-physical-2026-10-29.zip)與[獨立核對](results/composition-physical-review-2026-10-29.json)已驗 run／job／來源、digest／CRC、原始量測、舊完整／局部輸出固定 hash 與原檔指紋。首次失敗仍保留，沒有改動原門檻。

八輪全部完成真實 A／B 匹配匯入、Undo／Redo、接線、新增 ADD、明確介面與 v2 自動保存草稿下載；每輪來源 21,005 OP、組合結果九個 OP，完整非零 1.25 GiB 權重、兩份 custom options、所有 byte ranges、重開與 pattern 正負例通過。組合輸出每輪 `1345938408` bytes、SHA `7652cbcfe610e6c9c2e49b6e53ce26fce5e2505a87c12bb52def9b824ec08086`，八輪 bytes 一致；原生下載耗時 7621～7955ms，這不是所有硬體 SLA。

兩輪暖機後六輪量測 RSS 漂移 10887168 bytes、斜率 1083099.4285714286 bytes／輪，main heap 漂移 220312 bytes；取樣峰值 995848192 bytes、相對 baseline 成長 485543936 bytes。Worker 檢查點 used heap 最高 96281908 bytes、backing storage 最高 15998287 bytes；不是連續 Worker 峰值或獨立 OS RSS。40 個模型及 16 個指紋 Workers 都有原生 close，16 次候選解析；觀察到的 6 個 PID／start-ticks 全部正常退出，無強制清理。每輪所有 URL 自然撤銷、File input 清空，1280×640／32px 圖區與水平寬度檢查通過。

[四關卡相依及 provider 核對](results/composition-physical-gates-review-2026-10-29.json)確認 browser 與 [main contract 40819859749](https://github.com/koviankevin/tflite-explorer/actions/runs/40819859749) 為修正後新結果，[原始契約 ZIP](results/composition-physical-contract-2026-10-29.zip)保留；core 40700051621 與 site 40814696559 的模組 scope fingerprint 完全相同，可沿用。正式站程式、套件及工作流程未變，不重新部署。

此結果只涵蓋所列 Hosted Chromium 的有限八輪。大型 v2 手動匯入恢復、數小時組合、其他引擎、公司模型與 custom kernel 執行仍不在此證據範圍。
