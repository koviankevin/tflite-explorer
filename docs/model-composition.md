# 從原始圖組合 TFLite 模型

本功能已在 [preview.26](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.26) 正式發布，build `5846ee3c3a5e0a37`；網站及固定下載已獨立核對，見下方正式交付。

## 操作

1. 開啟本機 TFLite，在圖上選取 OP，或搜尋並點選一筆 pattern 的實際匹配。
2. 按頂端「加入組合草稿」。目前片段會標出名稱，原模型仍留在探索區。
3. 回「探索模型」，選下一個片段，再按「加入組合草稿」。先前接線與修改保留；重疊 OP 預設共用一份，重複加入完整既有選取不增加副本。
4. 在編輯圖選 OP，以「在前方／後方複製新增」產生新算子，再由「改為其他 TFLite OP」選型別與參數。點「接出」再點「接入」，或拖曳 ports 接線；系統按依賴排序，形成循環時拒絕該次修改。
5. 在右側「模型輸入／模型輸出」確認介面。片段外且不是權重的來源成為輸入；接上已加入 OP 後會重新計算。必要輸入若取消，需先補接線才能匯出。可選擇多個輸出。
6. 按「驗證並匯出組合模型」，產生獨立 TFLite，再按「開啟修改結果」建立模型分頁。原始模型及組合草稿保留在原分頁。

一般編輯模型與組合模型有各自的接線、Undo／Redo 與視角，切換時保留草稿。平移、縮放與字級控制沿用編輯工作區。

## 保存、權重及驗證

「儲存編輯草稿」在組合模式下載 v2 JSON，包含片段、接線、輸入／輸出選擇、復原／重做與視角。換電腦匯入後重新選原模型，完整指紋及解析範圍核對成功才恢復。v1 普通編輯草稿仍可讀；舊版本網站不支援 v2 時會明確拒絕，不能用降版網站繼續編輯組合草稿。

草稿不含模型與權重。匯出透過原始 File slices 保留權重／custom options；一般 OP 會壓縮未使用的 tensor／buffer。含 custom OP 時保留原 tensor／buffer 編號和 opaque options，所有 buffers 可能一併保留，下載檔可能仍大。實際 options／權重對照可下載修改報告，再用既有 CLI 核對來源與輸出 bytes。

只有使用者按「檢查能否執行（選用）」才跑 interpreter；支援原有 raw .bin／零值／型別亂數及 input／output ZIP。CPU／30 秒及大小限制沿用公開 runtime；缺少 custom kernel 時明確列為未能驗證。通過結構或一次 CPU 測試不表示與原模型數值等價。

## 第一版範圍

- 同一個本機 TFLite、同一個 subgraph；每次加入最多 32 個 OP，來源 metadata pool 最多 64 個 OP，含新增最多 96 個 OP／128 步命令。
- 控制流程／子圖呼叫、有狀態 OP、variable／resource／variant／外部檔案 tensors 不搬移；拒絕時保留原草稿。
- 支援圖結構組合與插入新 OP；不執行 compiler kernel fusion，也不自動判定兩個 tensor 的數值用途是否適合相接。

本機回歸已驗匯入累積／重疊／Undo／Redo、拓樸排序／循環拒絕、獨立匯出／無關資料移除、custom options／權重／原編號、明確介面、v2 保存與指紋還原，以及獨立原始資料對照。Hosted 原生測試也已通過 A／B pattern、32px／14 吋版面、分頁、raw BIN CPU 與匯出重開，詳見下方原始證據與正式交付。

## 候選與主分支驗收

候選 [40814231314](https://github.com/koviankevin/tflite-explorer/actions/runs/40814231314)，來源 `9628c78b7bab6d5300985bbea755fe5b65cb3eb3`／tree `dda35bd2ec121083a7bef8bcddb29e609130456f`／build `89679378430f9ba2`，其[獨立核對](results/composition-candidate-review-2026-10-29.json)、[切換 ZIP](results/composition-candidate-site-2026-10-29.zip)及[原生 ZIP](results/composition-candidate-native-2026-10-29.zip)已驗 provider digest／CRC／乾淨來源重建。

主分支來源 `facc77600f529f5df3a0ba000f97ccf1a20df4ed` 與候選完整 tree 一致，build `a9b0e94f885da192`。[site 40814696559](https://github.com/koviankevin/tflite-explorer/actions/runs/40814696559) 的[獨立核對](results/composition-main-review-2026-10-29.json)、[原始切換](results/composition-main-site-2026-10-29.zip)與[原始操作](results/composition-main-native-2026-10-29.zip)通過六種切換、30 項原生操作、14 種參數／runtime／組合情境；47 個模型與六個 runtime Workers 關閉，沒有 page errors。

實際從兩個 A／B pattern 匹配加入，重疊 merge OP 共用；Undo／Redo 匯入及普通／組合兩份接線歷史保留。1366×640／1280×640 的 32px 圖區分別 257.5／246.5px，無水平溢出。v2 JSON 由原生下載／選檔恢復，重匯出 bytes 相同；獨立 CLI 核對權重／options ranges。使用者明確手動執行 raw BIN 後，真實 CPU／IO ZIP 輸出 `[14,28]`；custom 組合保留編號／options／權重，無 kernel 時未啟動 WASM，列為未能驗證。原模型／結果分頁與沿用舊 pattern 搜尋通過。

[四個 main 關卡](results/composition-main-gates-review-2026-10-29.json)驗 source、scope fingerprint、原始報告與產物 digest：core 沿用未變的 40700051621，browser 40814691282、contract 40814694039、site 40814696559 為新 main 成功 run。

[主分支實體八輪](results/composition-main-owned-review-2026-10-29.json)使用原 1.25 GiB／21,005 OP 的完整編輯及局部匯出流程，固定完整／局部 hash、權重、custom options、pattern 正負例、24 個模型及八個指紋 Workers 均通過。兩輪暖機後 RSS 漂移 9756672 bytes、斜率 328967.314 bytes／輪；觀察到的 6 個 PID／start-ticks 全部正常退出，無強制清理。這是既定流程的有限八輪，不等同於大型組合模式的反覆匯出或新兩小時量測。

## 本機大型 Blob 切片實驗

另有 [本機 Node 報告](results/composition-local-blob-report-2026-10-29.json)及[固定來源實驗腳本](results/composition-local-blob-harness-2026-10-29.txt)：以共享零值頁建立實際 1,349,965,216-byte File／21,005 OP，取八個 OP，匯出並完整串流比對 1.25 GiB 權重、重新解析與 options 通過。來源每次解析讀取最多 65,536 bytes；有 131,072 bytes 的正常權重區預讀，未整檔讀入。Node 峰值 RSS 447,229,952 bytes、建構約 195 ms；不當成瀏覽器／實體磁碟／有意義權重或 kernel 的驗收。

[第一版 probe 失敗](results/composition-local-blob-probe-failure-2026-10-29.json)保留：測試誤要求解析器完全不讀權重區；改為準確提供零值視窗並記錄預讀量，保留原 16 MiB 單次讀取上限，沒有修改應用或 CI 門檻。

## preview.26 正式交付

[正式站](https://koviankevin.github.io/tflite-explorer/)／[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.26)為 build `5846ee3c3a5e0a37`，來源 `f4230c9f18926cf3ceb0a70faab88451c1fdc5f5`／tree `1178c64b373652679ed44c6cdd146d96de2256f4`。準備 [40816382766](https://github.com/koviankevin/tflite-explorer/actions/runs/40816382766) 的[完整產物審閱](results/preview26-prepared-2026-10-29.json)及[獨立乾淨重建](results/preview26-rebuild-2026-10-29.json)通過，再以精確 build／site ID 執行 [40816757520](https://github.com/koviankevin/tflite-explorer/actions/runs/40816757520)；prepare／deploy／verify_live／release 在 attempt 1 成功。

[最終獨立核對](results/preview26-published-2026-10-29.json)驗 provider ZIP digest／CRC、job／來源／時段、正式站 1,380 檔 SHA／MIME／root／權威 deployment，以及四份固定 Release 實際下載與原準備包一致。30 項原生操作、14 種參數／runtime／組合情境通過，47 個模型與六個 runtime Workers 關閉。實際 A／B 匹配匯入、重疊去重、兩份編輯歷史、介面、v2 JSON、CPU `[14,28]`／IO ZIP、權重 options 對照、來源／結果分頁及舊 pattern 搜尋均通過。

原始 ZIP：[正式站驗證](results/preview26-live-release-verification-2026-10-29.zip)、[Release 驗證](results/preview26-published-release-verification-2026-10-29.zip)；完整 [site manifest](results/preview26-site-manifest-2026-10-29.json) SHA `008eecf5763c4082e228a2bfcdc2fd55d71d3642a4b7165f8032da82421dea85`，site ID `288042952e897836c708778956af40702534425867473cff050264d1ef8af467`，固定部署 ZIP SHA `813a364436f24b839f28dc22b9f28925cee6e02b40103b2b02eb55e207f0bb64`。

同版也通過多輸入 CONCATENATION 的 [1,4] 推導／匯出／CPU 與錯誤 SQUEEZE axes 拒絕匯出；先前 int64、空參考表單、取消焦點及原有 TFLite／MLIR 搜尋／pattern／匯出重開保留。未測手機或內網；跨 subgraph／有狀態搬移、完整 kernel 語意、數小時組合與其他引擎驗收及其他公開品質限制仍列為未完成。


大型組合另已完成 [實體 Hosted Chromium 八輪](composition-lifecycle.md#修正後的實體八輪)：每輪 21,005 OP 原模型加入兩片段、接線、新增 ADD，下載組合模型與 v2 自動保存備份，核對完整 1.25 GiB 非零權重／options／原始 byte ranges、重開及 pattern 正負例。40 個模型、16 個指紋 Workers 與 owned 程序清理、固定 RSS 門檻通過；有限八輪不代替數小時、其他引擎或大型手動 v2 匯入恢復。正式 preview.26 應用沒有改動或重新部署。


大型 v2 JSON 手動下載、取消、重新選原模型還原及 byte-identical 重匯出已另通過 [專項驗收](large-composition-draft.md#已核對的結果)，包含 32px 視角／Redo、權重／options 及原 pattern 正負例。
