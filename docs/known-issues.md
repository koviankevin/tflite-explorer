# 公開版已知問題與限制

目前固定版本為 [v1.4.0](quantization-validation.md#v140-正式交付)／build `d36b95c7320aa6f2`。本頁保留公開版仍待處理的功能界線與驗收缺口；內網及私有 dialect 依使用者指示自行修改。

v1.3.1 已交付[手動 runtime 的 tensor 錯誤參照](runtime-tensor-diagnostics.md)：官方公開量化模型的原檔在目前 LiteRT compile 失敗，但日誌的 tensor 編號原先沒有 OP 對照。現在可查看定義／使用者，先顯示套用輸入前失敗的提示，並保留原文與失敗狀態；參照不代表 OP 就是原因。31 項相關選測、四項 main 關卡、正式站 35 項操作與四份實際下載已核對。新增的 Windows 正式站小型流程功能與正常退出通過，但整體網路守門仍失敗；後續一次診斷觀察到 Kaspersky 注入類型的請求，原始失敗及完整本機紀錄保留，沒有關閉防毒或放行外連。見[最終收據](results/runtime-tensor-v1.3.1-published.json)。

TRANSPOSE permutation 的負軸誤擋與錯誤 dtype 放行已在 v1.2.1 正式交付，56 項相關 Node 測試、四項來源關卡、1,457 個正式檔案、34 項正式操作與四份實際 Release 下載已核對，[最終收據](results/product-readiness-v1.2.1-published.json)保留完整來源。打包候選兩瀏覽器的功能與 CPU bytes 均通過，但 Chrome 最後正常關閉逾時，整輪仍失敗，Edge 整輪通過。v1.2.0 固定產物的 [Windows 完整八輪](windows-large-model.md#v120-固定產物的完整-windows-驗收)兩端均通過；後續[空白頁診斷](windows-large-model.md#空白頁的原生程序類型與等待鏈)仍重現根程序／crashpad-handler 未退出，根因與 Edge 接近原 RSS slope 上限的界線保留。

## 優先處理與交付狀態

v1.4.0 的[量化欄位檢查與報告](quantization-validation.md#v140-正式交付)已修正 legacy has_rank／單一 scale 的軸檢查，以及其他 QuantizationDetails 被錯用 affine 規則的問題。公開原檔找到 14 個量化軸失敗，原樣與切圖保留資料並明列報告；重接無效欄位則阻擋。未知 codec、INT64／INT4 等尚未實作範圍與超出預算項目明列未驗證。四項 main、正式站 36 項／1,468 檔、實際固定下載與 deployment 已核對；僅涵蓋修改／切出 scopes，不代表其他 subgraphs 或任意 kernel 語意已驗證。

v1.3.0 已完成正式站與固定 Release 核對，13 種新增 OP 靜態規則、逐 OP 報告及大報告分批顯示見[本版交付](operator-validation.md#v130-正式交付)。未知／動態參數、超出預算及沒有規則的 OP 明列未檢查，不承諾任意 kernel 可執行。下表保留仍未解的限制與較早交付修正；原始收據保持各自來源，整體目標見[商品化後續工作](product-readiness-next.md)。

| 優先 | 問題／界線 | 現況 |
| --- | --- | --- |
| 1 | Windows 大檔的整個程序與 Worker 記憶體、原生關閉 | 最新精確 v1.3.0／7de 固定產物與 SDK 1.64.1 各完成八輪：兩端原記憶體子判定及匯出通過，Edge 整輪正常退出，Chrome 最後原 10 秒關閉仍失敗。已補正 OP UI 只觀察主程序的驗收缺口，沒有修好間歇性關閉根因；原始失敗與較早 v1.2.0 通過結果分開保留，見[完整結果](windows-large-model.md#v130-固定產物與-sdk-1641) |
| 2 | 部分原模型的 activation 使用非零、沒有 data 欄位的 buffer；重建成明確空 data vector 會導致配置失敗 | 完整／局部／組合序列化修正已在 v1.2.0 交付；公開模型與實際 CPU 驗證見[階段一](results/product-readiness-stage1.json)。未提供的使用者原模型不宣稱已確認根因 |
| 3 | 排版途中切到 32px，文字更新但框仍用舊尺寸 | [真正文字邊界回歸](font-reflow.md)已在 v1.2.0 交付；Chrome／Edge 本機七組邊界及正式站 15 組實際文字框通過。34 項正式操作與固定下載已核對，原失敗保留 |
| 4 | 未知 custom 格式不能安全辨識隱含引用，因此子模型可能仍很大 | 保守保留仍是預設；可信[引用契約](custom-reference-contracts.md)才能縮減資料，不推測未知 options，也不增加公開 custom kernel |
| 5 | Resource-only MLIR 曾漏列未驗證權重編碼 | 計數與持續提示修正已在 v1.2.0 交付，原生匯出重開與 bytes 證據保留；packing／dialect 語意仍未驗證 |
| 6 | 一次歷史啟動逾時尚無可重現根因 | 已有有界診斷及恢復操作；後續成功不能證明根因已修復 |

Windows Chrome 關閉已[定位本次具體等待路徑](windows-large-model.md#已定位的-chrome-雲端資料夾統計阻塞)：Chrome startup metrics 的 OneDrive 狀態查詢停在 Windows storage／Cloud Files API，主執行緒等待 thread pool shutdown。四個函式範圍、同版原始碼及兩個各一次的空白頁對照已核對；原設定再次失敗，僅停用該統計功能的隔離對照約 191 ms 正常退出。這是外部等待機制的證據；Windows／provider 底層缺陷與所有歷史失敗仍未證實。必要 Chrome 驗收不加入此診斷旗標，原失敗不改列通過；沒有修改 OneDrive、個人設定或正式網站。見[收據](results/windows-cloud-metric.json)。

## 待查：一次啟動逾時的根因

Preview.22 曾有一次正式驗證在 30 秒內等不到開檔控制項就緒。[原始失敗](results/preview22-startup-failure-review-2026-10-29.json)保留；當時缺少請求級診斷，無法確定成因。之後相同應用的診斷、經授權的一次失敗驗證補跑，以及 preview.23 的正式驗證均成功；沒有把後續成功當成已找到或修好根因。

目前已加入有上限的靜態請求／console 診斷，若再發生可追查來源；尚未取得能穩定重現該次逾時的條件。詳細證據見 [啟動診斷與正式交付](desktop-physical.md)。

## 功能限制

**v1.4.1 候選的大模型 RSS slope 未通過**：同一次主分支實體八輪的輸出／權重／options／pattern、Worker 與程序退出通過，但 RSS slope 約 24.39 MiB／輪超過原 16 MiB；原失敗保留，沒有發布。階梯波動的記憶體歸屬仍待診斷；這不證明 v1.4.0 沒有同類波動，也不代表已確認持續洩漏。見[主分支失敗與原始證據](legacy-shape-validation.md#主分支驗收失敗尚未發布)。

**手動 runtime 的 padded／strided 輸出封存尚未支援**：新的公開合成 legacy FC 負例在 invoke 後因輸出 shape 不符失敗，接著 IO ZIP 被 runtime 的 `Tensors with strides or padding are not yet supported` 拒絕；目前回報 ioError，不能宣稱輸入／輸出已保存。此問題與[legacy shape 候選修正](legacy-shape-validation.md)分開，仍待修正；沒有修改已發布 v1.4.0 或重跑其成功部署。

**資料庫連線重試已在 v1.0.1 修正**：同步開啟失敗不再永久快取拒絕結果，舊 error／versionchange 不會清除新連線。三種 adapter 的 Node 邊界測試及既有原生保存／恢復通過，不冒充真實瀏覽器權限切換或 OS 斷電驗收，見 [交付與範圍](database-open-retry.md)。

**探索草稿寫入失敗已在 preview.34 修正**：持續顯示尚未儲存，保留操作與 Undo／Redo，明確重試並保留跨分頁衝突保護；真實容量上限／備份／移除／重試及重載恢復通過。這不代表 OS 磁碟已滿或斷電已驗收，見 [交付與範圍](workspace-storage.md)。

**輸入視窗與草稿 Worker 清理已在 preview.31 交付**：解除確認回呼、請求身分隔離及開窗失敗清理；同一輪取消不再建立指紋 Worker，終止前清除回呼。正式站 14 次一般與 24 次 IO 生命週期輸入清理、候選 Firefox 指紋 Worker 四次 native close 均核對，見[正式交付](preview31.md#發布狀態)及[原始診斷](runtime-input-cleanup.md)。這些具體缺口已修正；有限量測不等於所有物件、所有負載永不保留。

組合模型目前限同一 TFLite／subgraph，暫不搬移控制流程或有狀態 OP；大型組合已通過 [Hosted Chromium 實體八輪](composition-lifecycle.md#修正後的實體八輪)；數小時組合與其他引擎尚待驗收，見 [功能與驗收範圍](model-composition.md)。

- **新增 OP 的完整語意**：已實作結構、接線、資料長度及部分 shape／型別規則；無法自動推導的 OP 沿用明確參考 tensor。v1.1.0 已補 FC／BATCH_MATMUL／GATHER；v1.3.0 另補 PAD／切片／split／reduction 等[靜態規則與逐 OP 清單](operator-validation.md)，保留既有常見 shape、dtype、量化 metadata 與常數讀取預算，錯誤包含 OP／tensor 位置；未知或超預算明列未檢查，任意 kernel 組合仍需 runtime 檢查。亂數保證所選 dtype 的數值範圍，不保證索引、token、權重或整個模型的運算語意正確。見 [模型編輯](model-edit-workspace.md)及[型別亂數](typed-random.md)。
- **手動 interpreter 的規模與支援範圍**：CPU WASM 限 128 MiB 模型、16 MiB IO、30 秒執行，另有 512 MiB 提前配置估算；此估算不含所有 kernel scratch。公開 runtime 不含任意 custom kernels，動態／未知 shape、部分 dtype 及不明確的 signature 對應會列為未能驗證。大型模型仍可探索、編輯與匯出。見 [完整限制](tflite-runtime.md)。
- **大型 MLIR 的完整驗證**：dense 大型權重保留原文與 byte ranges；支援型別的元素數與 byte-aligned hex 長度已串流核對，未知 packing／resource 與逐值語意仍未驗證；外部 resource 檔選取尚未支援。網站的結構、SSA／dominance 檢查也不代替各 dialect 自訂 verifier。見 [大型 MLIR](mlir-large-files.md)。
- **MLIR 編輯與 pattern 範圍**：實際 OP 編輯僅支援 TFLite。MLIR 支援文字 generic 探索、搜尋、圈選及局部匯出；跨 block pattern 需位於同一 function／region，不能任意跨 function 或巢狀 region。見 [公開版指引](public-acceptance.md)。

## 尚待補齊的公開驗收

目前 [v1.3.0](operator-validation.md#v130-正式交付)的必要 Chromium、發布及正式站／固定下載核對均已完成；SDK 1.64.1 更新後的[正式站 35 項](https://github.com/koviankevin/tflite-explorer/actions/runs/41225507999)亦通過。最新固定 v1.3.0 的 [Windows 實體八輪](windows-large-model.md#v130-固定產物與-sdk-1641)維持混合結果：Edge 整輪通過，Chrome 記憶體／匯出通過但最後正常關閉失敗。較早 v1.1.0 的原生 UI／儲存驗收與 v1.2.0 的兩端大檔正常退出保持各自原來源，不換標成 v1.3.0 全項 Windows 驗收。OS 斷電、實體磁碟耗盡及瀏覽器權限設定切換仍未驗證，原 RSS 規則未放寬。Firefox／Safari／WebKit 為選做，必要範圍只保留 Chrome／Edge。歷史 [preview.33 啟動失敗恢復](startup-recovery.md)已完成五情境、大檔八輪及正式站／固定 Release 核對；它不代表已重現或修復上述歷史逾時根因。

<details>
<summary>歷史驗收與失敗紀錄（包含目前選做的 Firefox／WebKit）</summary>

以下保留各輪歷史診斷中的來源及當時狀態；其中「最新／尚未發布」不覆蓋本段現況。

最新[冷熱原生證據](runtime-module-cache.md#冷熱原生報告完整核對與本機-response-候選)已完整驗證，原 RSS 18,839,727.54 bytes／輪仍失敗。公開 IO 熱對照在 URL 都 revoke 後仍有六份 8 MiB memory-file-data；這是分類線索，不是持有者或洩漏定論。候選改用本機 Response 消費 IO ZIP，保持原 URL／RSS／runtime 計時；54 項選測通過，實際改善仍待 Hosted，尚未發布。

最新[普通訊號報告](runtime-module-cache.md#取得第一份完整原生報告與解析缺口)已取得並驗證空白 Firefox 的 4,304 筆完整原生量測，但原應用 RSS 仍以 19,285,723.43 bytes／輪失敗。熱 IO 報告遇到 parser 的 PID 假設，該輪原文未保留，不能回推分類；已補可空 PID 與先持久化原文再清理的修正，等待新的 Hosted，沒有發布。

[原生入口前置探測](runtime-module-cache.md#commit-導頁仍無法讀取原生頁面)在 commit 導頁後仍只回報 about:blank，尚無 DOM URI 或物件分類；本輪停在零模型、零 Measure，沒有重跑原 RSS。接著改用有程序身分／pidfd／handler guard 的 Linux 普通報告訊號，只量獨立空白／公開 IO 控制，保留原 RSS 失敗與門檻。

最新[獨立 raw IO 與原生入口結果](runtime-module-cache.md#原生入口首次失敗與修正)已核對：原 Firefox RSS 17,782,725.49 bytes／輪仍失敗，零模型／零 WASM raw IO 也重現成長。原生頁面在導頁等待逾時，零次 Measure，尚無物件分類；接著修正診斷入口並先做獨立前置探測，沒有修改應用配置、放寬門檻或發布候選。

最新 [ZIP 重用候選](runtime-module-cache.md#zip-重用候選仍未改善-rss)仍以 18,691,686.4 bytes／輪超過 Firefox 原門檻，沒有改善剩餘 slope。應用配置調整先停止，改做獨立 raw IO／原生 about:memory 持有者診斷；原失敗、門檻和 source-bound 證據保留，preview.32 未發布。

raw BIN copy 移除後的[新一批原始結果](runtime-module-cache.md#raw-bin-候選原始結果)仍是 18,495,546.51 bytes／輪，沒有改善剩餘 Firefox RSS slope。所有功能／內容與 native 清理仍通過；接著驗證同一模型的零化 ZIP buffer 重用，候選尚未發布。較早 d0f3ff9 結果保留如下。

最新 IO ownership 候選已核對：[d0f3ff9 的 Firefox 八輪](runtime-module-cache.md#ownership-修正後仍未達標)在完整功能／IO／Worker／程序清理通過後，closed RSS slope 為 **18,457,629.26 bytes／輪，仍超過原 16 MiB 門檻**；比先前 37,970,856.23 低，仍不能宣稱問題已修復。原始失敗及讀取器已保存。沒有重跑碰綠燈、調整門檻或發布 preview.32；接著逐一驗證暫存分配。下段較早各批結果保持其來源與界線。

preview.31 相同應用另完成 [WebKit 手動 CPU／IO 八輪 RSS](desktop-runtime-io.md#首次原始結果)，24 次 CPU／八份完整 IO、URL／Worker／程序清理通過。Firefox 同次量測則在 closed-RSS slope 超過原 16 MiB／輪，原始失敗保留；最終 URL 釋放後 drift 未超限，不足以證明洩漏或排除問題。後續程序分類與無模型對照也保留原始判定，沒有修改正式應用、重跑成功部署或放寬門檻。

Firefox 的[分類診斷](desktop-runtime-io.md#分類結果與無模型對照)亦重現 slope 超標；共享欄位不變，較大波動在父程序匿名記憶體。[無模型對照](desktop-runtime-io.md#無模型對照的實際結果)已完成：空 Worker 的父程序匿名欄位相對穩定，只 fetch WASM 就重現約 155 MB 波動，沒有模型、推論或 IO ZIP。原應用仍以 slope 21,129,625.6 bytes／輪失敗；尚不能區分工具觀察與 Firefox 原生配置的所有權，也不以對照值扣除或替換 RSS。[本機 File 實測](desktop-runtime-io.md#本機-file-對照的實際結果)已完成，走勢接近空 Worker；原應用仍以 slope 24,459,088.46 bytes／輪失敗。現有[共用公開 runtime 候選修正](runtime-module-cache.md#第三批候選功能與-const-正常firefox-rss-未修復)已通過 48 項 Node、三引擎 const／草稿／CPU 功能及 Chromium／WebKit 原有記憶體驗收，但 Firefox 在八輪只下載一次 WASM 後仍以 slope 27,376,493.71 bytes／輪失敗。原始觀測與門檻保留，候選尚未發布，未宣稱已修好。[後續 IO 對照](runtime-module-cache.md#已取得的結果與下一個修正)在無 WASM Instance 時也重現約 27.7 MB／輪，File-only 與 module clone 較低；原應用仍失敗，下一步修改 IO 配置／傳送並補明確 File input 清理。

歷史 preview.30 已核對 [Firefox 142.0.1／WebKit 26.0 的十六項功能](desktop-runtime.md#最終核對結果)，包含獨立執行、分佈／const／草稿與指南；這是 Hosted Linux 的短流程，不改變下列長期、其他 OS 與完整無障礙驗收缺口。

另補齊[三引擎真實 CPU 運算中的取消與 30 秒逾時](runtime-active-compute.md#三引擎實際結果)，含 UI 回應、Worker close 及恢復執行；Chromium 32 項、Firefox／WebKit 各 17 項功能通過。這組有限合成迴圈不涵蓋所有模型、背景節流、數小時 runtime 或 RSS；跨引擎 layout Worker 最後 close 與 Firefox module request 的觀察界線保持明列。

[手動 CPU／IO 八輪](runtime-io-lifecycle.md#已核對結果)另已通過 Chromium 程序 RSS／main heap 與自然 URL 期限驗收，新增 24 次執行、8 份完整 IO bytes及程序清理；有限範圍內未觀測持續累積。數小時 interpreter、其他引擎／OS 與連續 Worker heap 峰值仍未驗收。

已核對的瀏覽器／程序量測主要來自 Hosted Linux。其他 OS／固定實體硬體 SLA、其他引擎與手動 interpreter 數小時負載、Worker 連續 heap 峰值、OS 斷電／儲存回收、任意資料格式升降級及完整螢幕閱讀器／新使用者流程仍未驗收。既有八輪／兩小時結果保持各自來源與量測範圍，見 [品質工作清單](product-readiness.md)。

</details>

## 本輪已修復

手動執行的輸入視窗以 Escape 或取消按鈕關閉後焦點遺失，已在 preview.23 修正。1280×640／32px 的兩種原生鍵盤取消、草稿／視角保留及零額外推論／下載均通過主分支與正式站驗證，見 [正式交付](runtime-keyboard.md#preview23-正式交付)。

新增 OP 沒有可用 tensor 參考時進階表單被例外取代，已在 preview.24 修正；現在保留表單、停用無法產生的亂數並提供原因。合法型別亂數及原有操作仍通過，見 [正式交付](random-reference-guard.md#preview24-正式交付)。

新增 OP 的 64-bit 整數精度問題已在 preview.25 修正並完成正式驗收；大整數請以十進位字串輸入，JSON 陣列元素需加雙引號，見 [正式交付](op-integer-precision.md#preview25-正式交付)。

合法多輸入 CONCATENATION 的固定 port 誤判、SQUEEZE 非單位 axes 仍可匯出，已在 preview.26 修正並完成正式站／CPU 正負例驗收，見 [正式交付](model-composition.md#preview26-正式交付)。

返回探索、模型分頁及草稿還原後工作區按鈕選取殘留，已在 preview.27 修正並完成正式站十二次互斥導覽驗收；原 red、修正版與正式證據分開保留，見 [正式交付](workspace-mode-state.md#preview27-正式交付)。

舊示範檔缺少 RESHAPE shape 與 TRANSPOSE permutation，造成原模型及編輯後均在配置 tensors 失敗，已於 preview.28 的新版示範檔補齊；舊下載檔不會自動修改。四種實際 CPU 與正式站驗收通過，見 [根因](demo-runtime.md)及[正式交付](contextual-model-editing.md#preview28-正式交付)。同版也完成片段操作、框選切換、重置確認及分支排版，沒有擴大任意 OP／custom kernel 的語意保證。
