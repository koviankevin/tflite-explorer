# 商品等級後續工作（進行中）

使用者於 2026-10-31 將目標接續為「商品等級」。目前正式版為 [v1.4.5](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.5)／build `bb21d924c10706b3`，329 核心檔、全站 1,484 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對；[本版收據](results/spatial-metadata-v1.4.5-published.json)保留來源與範圍。完整商品化目標仍進行中，保留尚未完成項目；不以單個模型或綠燈宣告完成。

卷積／pooling 的動態 rank／bias metadata 漏檢與逐 OP 報告已於 [v1.4.5](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.5) [正式交付](spatial-metadata-validation.md#v145-正式交付)。四份原始錯誤匯出檔、23 項新回歸／170 項相關測試，以及 Chrome／Edge 每端六組原生情境、十二份實際下載、四份下載後 CPU／IO、pattern 正負例、32px 與正常退出，保留[原候選來源](results/spatial-metadata-candidate.json)。正式 HTTPS／固定下載另有獨立來源綁定；不擴大任意 kernel／量化或公司契約的完成主張。

FULLY_CONNECTED 的 dtype／已知 rank／尺寸漏檢及合法無 bias 誤擋，已於 [v1.4.4](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.4) [正式交付](fully-connected-validation.md#v144-正式交付)。199 項相關檢查、十三組真正 CPU 正例，以及 Chrome／Edge 每端六組原生情境、十六份實際下載、四份下載後 CPU、pattern 正負例、32px 與正常退出，維持[原候選來源](results/fully-connected-candidate.json)。正式 HTTPS 與固定下載另有獨立來源綁定，不將有限結果擴大為任意 kernel／量化或公司契約已驗證。

GATHER 動態 shape 掩蓋已知型別／rank 錯誤，以及零元素常數／activation 的 producer 與切圖邊界修正，已在 [v1.4.3](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.3) [正式交付](gather-validation.md#v143-正式交付)。較早 140 項／十二組 CPU 與 Chrome／Edge 證據維持[原候選收據](results/gather-candidate.json)；最終來源的 143 項相關檢查、十三組 CPU，以及十二份原生下載、32px 與正常退出維持[最終候選收據](results/gather-candidate-final.json)。本版正式 HTTPS 與固定下載另有獨立來源綁定，不以後來成功改寫早期失敗或擴大任意 kernel 語意。

沿用使用者範圍：模型、權重、測試輸入及診斷全程本機；Chrome／Edge、14 吋桌面與 32px；不測手機、Firefox／WebKit，不自行啟動兩小時負載；內網模型、私有 dialect／compiler／custom runtime 由使用者處理。一般編輯／匯出不自動執行 interpreter。既有安全、RSS 與 runtime／URL timer 不放寬。

## 目前交付狀態

階段一的序列化／常用 OP 修正、階段二的 custom 引用契約、resource-only MLIR 未檢查計數及字級排版修正，已在 v1.2.0 正式交付。[最終收據](results/product-readiness-v1.2-published.json)核對完整來源、部署、34 項正式操作與四份實際固定下載。下表保留各階段的工作界線；早期收據的「待執行／未發布」維持其當時狀態，不覆蓋目前交付結果。

精確 v1.2.0 固定產物的最新 [Windows 實體八輪](windows-large-model.md#v120-固定產物的完整-windows-驗收)在 Chrome／Edge 均通過原判定及正常退出；Edge slope 接近原上限，不宣稱有寬裕餘量。[階段三證據](results/product-readiness-stage3.json)及[後續原始證據](results/product-readiness-stage3-update.json)中的歷史失敗仍保留，根因尚未證實。後續小型 TRANSPOSE 候選又重現 Chrome 正常關閉逾時，不能把功能或稍後 PID 消失寫成整輪通過；新證據見下段。

TRANSPOSE permutation 合法負軸被擋與 int64 錯誤放行已在 v1.2.1 正式交付，56 項相關測試通過。打包來源 `4b0822e` 的兩瀏覽器實際編輯／匯出／重開／搜尋／raw BIN CPU 內容均核對；Edge 整輪通過，Chrome 最後正常關閉逾時仍判失敗。[原始收據](results/transpose-permutation.json)保留此差別。PR #187 已合併，`8bf6c9b` 的新主分支大檔八輪、78 項發布契約及 34 項網站操作均已核對；核心 88 檔範圍未變而沿用既有量測。PR #188 納入[四關卡收據](results/transpose-main-verification.json)後，以精確來源 `2160757` 準備、發布並核對 1,457 個正式檔案及四份實際固定下載，[最終收據](results/product-readiness-v1.2.1-published.json)與原始封存保留。完整商品化目標與 Windows 原生關閉根因仍未完成。

另在實際截圖中發現 32px 字級與框線不同步，原先「沒有頁面溢位」的數值檢查不足。已在未修改候選穩定重現[字級排版回歸](font-reflow.md)，修正非同步 layout 期間 target 暫空的提前返回；來源 `7068a7e` 的 Chrome／Edge 完整七組文字邊界與實際截圖已核對，v1.2.0 正式站另核對 15 組實際文字框。舊來源成功不抵銷曾有的視覺缺口。

字級修正已經 [PR #184](https://github.com/koviankevin/tflite-explorer/pull/184) 合併至 `bb3bd37`，完整 tree 與實際 PR checkout 相同。[新 main 網站關卡](https://github.com/koviankevin/tflite-explorer/actions/runs/41174045604)的六種版本切換、正常 HTTP 候選與 34 項實際操作已完成 digest／CRC／來源／原判定核對；新增字級情境的 13 個 OP、兩個輸入／輸出文字框皆符合 32px。19 種手動 runtime 情境及八輪／24 次 CPU、IO 與原記憶體規則通過；[發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/41174041946) 78 項亦核對通過。[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41174035077)亦已取得原始報告並核對通過；四項關卡的[收據](results/product-readiness-main-verification.json)與[原始證據](results/product-readiness-main-evidence.zip)保留。後續以精確來源 `f592e3d9df7ed48fae2ca19e353c7215638959a3` 完成 v1.2.0 準備、部署及固定下載核對；這些 Linux 結果不取代 Windows 的原始關閉失敗。

目前外部使用者以 v1.3.0 為準；[發布工作流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41216245433)四個工作 attempt 1 全成功，1,465 個正式檔案、35 項操作、四份實際固定下載及權威 deployment 已核對。新增 PAD／切片／split／reduction 靜態規則與逐 OP 報告，保留[候選失敗、最後四項關卡及正式交付](operator-validation.md#v130-正式交付)。沒有規則、動態或超預算明列未檢查，Chrome 原生關閉與任意 kernel／dialect 語意仍未解。發布後文件更新不移動 tag、不改寫固定資產、不重跑成功部署；舊版證據保持原來源。

最新[Windows v1.3.0／SDK 1.64.1](windows-large-model.md#v130-固定產物與-sdk-1641)已各完成原始實體 1.25 GiB／21,005 OP 八輪，兩端功能、權重／options／pattern 與原記憶體子判定通過；Edge 整輪正常退出，Chrome 最後仍超過原 10 秒關閉上限。已修正 OP UI driver 只有 root、未取樣子程序的觀察缺口，並更新 SDK 與受防護的原生 chooser adapter；[PR #195](https://github.com/koviankevin/tflite-explorer/pull/195)必要 CI 與來源相同的 merge tree 已核對。新版工具的[正式站 35 項](https://github.com/koviankevin/tflite-explorer/actions/runs/41225507999)完成，混合結果與原始證據見[本次收據](results/windows-v1.3-sdk1641.json)。此處修好的是驗收覆蓋，Chrome 原生關閉根因及完整商品等級目標仍未完成。

另補[原生 stack 診斷取樣](windows-large-model.md#原生-stack-診斷取樣)：官方固定 debugger DLL 完整性／簽章及自有合成程序的 stack／detach／繼續執行／exit 0 已核對，Node→Python 中文字路徑的 UTF-8 傳遞缺口已重現並修正。原始 OP 關閉失敗保留；後續正常對照及最多三次重現採樣沒有觸發取樣，因此尚未取得實際失敗的 Chrome stack，不宣稱根因已定位或驗收修復。這批只保存診斷工具與[原始證據](results/windows-close-diagnostics.json)，正式 app／v1.3.0 固定交付不變。

再接續一次事先限定的[實體八輪失敗取樣](windows-large-model.md#實體八輪的失敗-stack)，已取得真正 Chrome 原 10 秒失敗時的 43 個執行緒 stack 並 detach。匯出／權重／options／pattern 與原記憶體子判定通過，整輪仍因正常關閉逾時失敗；後續 SDK 強制清理不算修復。新[收據](results/windows-physical-stack.json)更新上述當時尚缺 stack 的狀態，保存原始與離線符號核對；目前仍未證實等待物件或關閉根因，不修改正式 app 或固定交付。

接著以獨立的有界 public-symbol 讀取、stock PE 函式範圍及同版原始碼，已[定位這次等待機制](windows-large-model.md#已定位的-chrome-雲端資料夾統計阻塞)：主執行緒等 TaskTracker shutdown，Chrome 自身的 OneDrive 啟動統計停在 Windows storage／Cloud Files 查詢。兩個預先限定、各一次的空白頁對照中，原設定再次失敗並捕捉相同函式，只有停用該統計功能的隔離對照約 191 ms 正常退出。這更新前段仍缺具體函式的狀態；Windows／provider 底層缺陷及全部歷史失敗尚未證實，必要驗收的設定與失敗判定保持原樣。沒有重跑模型或成功部署，應用不做無證據的資源清理改動；[收據](results/windows-cloud-metric.json)保存來源與界線。

## 各階段原始計畫與範圍

新一輪公開真實模型補測找到 tensor-only runtime 診斷沒有 OP 參照的缺口，已在 [v1.3.1](runtime-tensor-diagnostics.md#v131-正式交付)交付。原始公開模型的量化參數與目前 LiteRT 不相容，仍保留 compile 失敗，不修改權重／量化或聲稱數值等價。31 項相關測試、六個真正 CPU 負例、四種資料保留匯出，以及兩個 Windows 候選瀏覽器的 32px／鍵盤定位／來源替換／Worker 和正常退出已核對。四項 main 發布關卡、正式 HTTPS 的 1,466 檔／35 項操作及四份實際下載完成[最終核對](results/runtime-tensor-v1.3.1-published.json)。Windows 正式 HTTPS 功能與正常退出通過，但整體仍因兩筆網路守門失敗而保留失敗；一次獨立診斷記錄到 Kaspersky script／style，未更改防毒或封鎖規則。這與前述 Chrome 長負載的雲端統計阻塞分開處理，完整商品等級目標仍未完成。

| 工作 | 要證明的行為 | 狀態 |
| --- | --- | --- |
| 編輯合法性與錯誤定位 | 常用 OP 的 shape、dtype、常數／量化正負例；實際序列化、原始權重／options 保留與 CPU 結果；runtime 錯誤可對照 OP／tensor，無法唯一對應時明列候選 | 卷積／pooling 共用靜態規則、真正 allocation 負例及 Windows 小型 UI 已通過，四項 main 關卡與 v1.2.0 正式交付已核對。v1.3.0 另交付 PAD／切片／split／reduction 的 13 種有界規則與逐 OP 報告；其他 OP／任意 kernel 語意仍未驗證，不把結構通過寫成可執行保證 |
| Custom 子模型資料保留 | 未知引用保守保留；有可信引用契約才能安全縮減；預覽與實際匯出一致、契約負例拒絕、擴充不污染公開包 | [引用契約](custom-reference-contracts.md)本機證據已核對：建置隔離與十二份 Windows 下載的原始 bytes／編號／pattern；公開程序 exit 0，合成內網報告通過但退出碼遺失。公開支援已在 v1.2.0 正式交付；未知格式仍完整保留，不宣稱任意 custom kernel 已可執行 |
| Windows 大模型可靠性 | 在明確環境的有限輪數操作中觀察整個瀏覽器／Worker、原生關閉及匯出後釋放；權重、options、pattern、草稿／視角保留 | 最新固定 v1.3.0 的[實體 1.25 GiB 八輪](windows-large-model.md#v130-固定產物與-sdk-1641)兩端功能及原記憶體子判定通過，Edge 整輪正常退出，Chrome 原 10 秒關閉失敗；新版 canonical OP driver 亦重現。已補正原生子程序觀察，根因仍未完成。歷史 v1.2.0 通過與其他失敗保留，不互相換標 |
| Generic MLIR 支援邊界 | 支援型別的 dense／hex 計數、SSA／dominance；外部 resource／packing 有明確契約或明列未驗證；公司 dialect 接點可獨立建置 | Resource-only 漏列未檢查段已修正；44 項選測及 Windows Chrome／Edge 打包後原生開檔、32px、pattern 各一筆、匯出重開通過，12,012 bytes resource 原文比對一致、每個瀏覽器三個 Worker 關閉。修正已在 v1.2.0 正式交付；packing／公司 verifier 未驗證，外部 resource 選檔尚未支援 |
| 啟動與診斷 | 公開請求／啟動問題可收集不含模型的白名單診斷；中斷後可恢復；歷史失敗保留，根因須由可重現證據確認 | 歷史 preview.22 的一次啟動逾時仍未重現，不反覆重跑成功部署冒充修好 |
| 保存、操作及發布 | 草稿／pattern 異常與遷移可恢復；主要新手流程與鍵盤可操作；固定產物、相依 scope、必要關卡、正式站與 Release 一致，回退不破壞使用者資料 | 既有功能與交付證據沿用；新功能仍須補受影響驗收；OS 斷電、完整螢幕閱讀器與任意格式遷移仍未證實 |

接續 OP 驗證的 [v1.4.0 量化欄位與報告](quantization-validation.md#v140-正式交付)已正式交付：補上非空 shape／legacy has_rank=false 與單一 scale 的量化軸檢查，未知 QuantizationDetails／尚未實作 dtype 範圍列為未驗證。重接無效欄位阻擋、原樣來源資料保留、100→200 分批、真正 CPU 差異控制，以及 Chrome／Edge 候選 32px／匯出重開均有各自來源證據。四項 main 關卡、正式站 1,468 檔／36 項操作、四份實際 Release 下載與權威 deployment 均已[最終核對](results/quantization-v1.4.0-published.json)。新增流程零自動 runtime，原政策未放寬；這不修復上述原生 Chrome 問題，也不代表所有 OP 或公司模型語意已驗證。

## 卷積／pooling 與 allocation 診斷

新增 metadata 規則對照 TensorFlow 固定來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/conv.cc)、[depthwise_conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/depthwise_conv.cc)、[pooling.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/pooling.cc)及 padding.h。編輯推導與匯出檢查共用同一模組；不讀權重、不跑 runtime。涵蓋 NHWC、SAME／VALID、stride／dilation、grouped channel、depthwise filter layout、bias 與 output shape；動態／未知 shape 保留明確參考，不虛構推導。Hybrid filter 不強制與浮點 input 同 dtype，depthwise multiplier 依 filter／input channels 推導，不誤用舊參數作判定。

本機的真實 LiteRT.js 2.6.0 CPU WASM 已執行五種小型公開合成模型（CONV_2D、DEPTHWISE_CONV_2D、AVERAGE_POOL_2D、MAX_POOL_2D、L2_POOL_2D），核對匯出重開、數值結果、錯誤輸出拒絕與 filter／bias bytes 保留；這不代替任意 kernel、量化或公司模型驗收。

實際的 channel 負例出現 `Node number 0 (CONV_2D) failed to prepare`，allocation 失敗是在 `run()` 階段才回報。診斷保留原階段及原文，不能單憑「invoke」判斷為測試輸入問題。來源對照最多帶 512 個 OP／每側 32 個 port，截斷明列；依 node 編號與 builtin 名稱列出候選，重複日誌去重，多 subgraph／delegate 或不完整 context 不冒充唯一定位。來源模型改變後不得用舊位置導覽。

上述修正已在 v1.2.0 正式交付；本節的本機 CPU 與 Windows 小型 UI 保持原受測來源及範圍，必要正式關卡與實際下載核對另見頁首收據。先前使用者那份 allocation 失敗模型並未提供，不宣稱已確認其根因。

## 公開模型驗收找到的空 buffer 問題

另取 TensorFlow 官方 tflite-micro 固定修訂 `9c74b4e7f9cb7afabea9859ef85f7df885148485` 的 hello_world_float、hello_world_int8、micro_speech_quantized 與 seanet/conv/conv10 共四份小型模型；原始 bytes、Git blob SHA、SHA-256、來源及 Apache License 保留於本機 QA。它們不是公司模型，也不包含新增的私有 dialect。

第一次驗收中，micro_speech_quantized 與 int16 conv10 原檔都成功 CPU invoke，完整 identity edit 後卻失敗：`Tensor ... is invalidly specified in schema`／`required_bytes <= bytes`。直接檢查 FlatBuffer 欄位後，將缺陷縮成三個確定失敗的回歸：整份模型、子模型及組合模型都把原本不存在的 `Buffer.data` 欄位重建成明確存在的零長度 vector。若 activation tensor 使用非零 buffer 編號，runtime 會將其視為不足長度的唯讀資料。

修正只保留欄位的原始存在性：不存在維持 null，明確空 vector 仍存在；非空權重仍以原始 File range 保留，不讀整份權重或合併 buffer 編號。三個存在性回歸及解析、切圖、custom、組合、真正 CPU 等受影響 35 項已通過；修正後四份公開模型的結構、identity／切圖／組合匯出重開通過；其中兩個可執行模型共八次真正 CPU invoke 的輸出 bytes 與原檔一致，八份 IO ZIP 已獨立核對 CRC。另兩個 dynamic 模型仍明列 runtime 未驗證，不讀取 body 或啟動 runtime。

兩個 hello_world 原檔宣告 dynamic shape signature，現行手動 runtime 按既有政策拒絕；不為了讓樣本通過而抹掉 signature 或放寬限制。仍應驗證其結構、匯出重開及保留 bytes，執行結果列為未能驗證，不冒充 CPU 通過。

## 本機階段證據（當時未發布）

[階段收據](results/product-readiness-stage1.json)與[原始模型／授權、失敗及成功報告、截圖、IO、檢查程式](results/product-readiness-stage1-originals.zip)保留。打包來源 `e48fc535a914bbc7ade3d3aa6f4ab081f88b57d3`／build `6a38729a362a50dc`，317 核心檔；仍為開發候選，不能用其版本欄位冒充公開 v1.1.0 的固定產物。

Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 均在新建的隔離 context 完成原生選檔、真正 CPU allocation 負例、日誌／IO 候選對照、點選後實際 OP 畫出且焦點回到結果、32px，以及非零 absent-data buffer 的切圖和 clone／編輯匯出重開／CPU。每個瀏覽器觀察到的 12 個 Workers 全部原生 close、無 pageerror；沒有讀取個人 profile。早期定位圖在 render 完成前擷取，保留為較弱觀察，不作最終完成證據。

這些原始收據記錄當時的本機階段，不改寫成後來版本的證據。後續 custom 引用契約與新版本正式關卡已依上表完成增量交付；Windows Chrome 正常關閉與其餘未驗證範圍仍繼續處理。沒有重跑成功部署、修改安全規則或放寬記憶體／timer 門檻。

## v1.4.1 的索引與驗證候選

Legacy concrete shape、手動 runtime 部分 IO 保存及[模型索引配置減量](model-index-allocation.md)已合併；[四項來源綁定關卡](results/model-index-allocation-main.json)在 `c0dd77c8` 核對通過。原實體 1.25 GiB／21,005 OP 八輪的完整／局部／組合匯出重開、權重／options／pattern、Worker／程序退出及原 RSS 規則通過；HTTP 候選 38 項含 32px、逐 OP／量化／legacy shape 報告及部分 IO。Windows Chrome／Edge 的隔離 OP UI／下載案例亦完成。正式 HTTPS、不可變 Release 與四份實際下載仍待接續，目前公開版本維持 v1.4.0。

原 RSS 失敗與 Windows Chrome 雲端統計／網路注入的歷史觀察保留；不擴大 kernel／dialect 語意、內網環境、任意格式遷移或完整無障礙的完成主張，商品等級目標仍進行中。

## v1.4.1 正式交付

上述候選已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41270750871)完成正式 HTTPS、不可變 Release 與四份實際下載核對，見[最終收據](results/model-index-v1.4.1-published.json)。原始失敗與後續新來源通過保持不同來源，沒有重寫舊 tag、放寬判定或同步 Sites／GH Studio。Windows Chrome 原生關閉、外部網路注入及其餘表列未驗證範圍仍保留；完整商品等級目標繼續進行。

## BATCH_MATMUL 的後續修正（未發布）

接續 OP 驗證發現 [output dtype 與已知 rank 漏擋](batch-matmul-validation.md)：非法的 float→int32 output 甚至可能 CPU 回報成功但輸出浮點位元的整數解讀。已加入格式型別、int8 accumulator 例外及 2～5 維 rank 共享規則，序列化報告不讀權重；125 項相關測試與十種合法實際 CPU 對照通過。Chrome／Edge 的五個原生情境、十二份實際下載及其中四份下載的真正 CPU 已[獨立核對](results/batch-matmul-candidate.json)，32px 與全部 Worker／自有程序正常退出。必要發布關卡仍待完成，正式版本維持 v1.4.1，沒有將舊成功部署重跑。

## v1.4.2 的 BATCH_MATMUL 候選

[BATCH_MATMUL dtype／已知 rank 修正](batch-matmul-validation.md)已合併，解決錯誤 float32→int32 模型連真正 CPU 都可能回報成功的格式缺口；合法 hybrid 與 int8 accumulator 保留，其他混合精度明列未檢查。125 項相關測試、13 項版本選測及十組真正編輯後 CPU 正例通過；兩個 Windows 瀏覽器完成 32px 原生選檔、接線、十二份下載與四份實際下載模型的 CPU 核對。

[四項必要 main 關卡](results/batch-matmul-main.json)原始報告均已核對：不變的 88 檔 core 沿用可信 main 證據，新來源的實體 1.25 GiB／21,005 OP 八輪、79 項契約及 HTTP 候選 38 項操作通過。這批不重跑成功部署，也不放寬原政策。v1.4.2 正式站與固定下載仍待發布；目前公開版維持 v1.4.1，完整商品等級目標及原有未解項目保留。

## v1.4.2 正式交付

上述候選已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41276594514)完成正式 HTTPS、不可變 Release 與四份實際下載核對，見[最終收據](results/batch-matmul-v1.4.2-published.json)。已保留 v1.4.1 tag／assets、原始失敗及各來源的驗收範圍，沒有放寬判定或同步 Sites／GH Studio。BATCH_MATMUL 新格式規則不能代替任意 kernel／量化語意驗證；其餘表列未完成項目與完整商品等級目標繼續保留。

## v1.4.3 必要主分支證據

GATHER 動態型別／rank 檢查與 producer-aware 空常數修正已合併，[四項來源綁定關卡](results/gather-main.json)完成原始報告核對：未變的 88 檔核心沿用可信 main 證據，新來源實體 1.25 GiB／21,005 OP 八輪、79 項契約及 HTTP 候選 38 項操作通過。Windows Chrome／Edge 的實際下載、32px、pattern 與正常退出另有獨立來源；兩份新零輸出下載的 CPU 與相同 bytes 控制的沿用分開記錄。正式 HTTPS 與新不可變 Release 尚待接續，目前公開版仍是 v1.4.2；其餘商品等級未完成項目不改列完成。

## v1.4.3 正式交付

上述候選已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41284224153)完成正式 HTTPS、不可變 Release 與四份實際下載核對，見[最終收據](results/gather-v1.4.3-published.json)。v1.4.2 tag／assets、原始失敗與各來源的驗收範圍均保留，沒有重跑成功部署、放寬判定或同步 Sites／GH Studio。其餘表列未完成項目與完整商品等級目標繼續保留。

## v1.4.4 必要主分支證據

FULLY_CONNECTED dtype／已知 rank 與 optional bias 修正已合併，[四項來源綁定關卡](results/fully-connected-main.json)原始報告已核對：未變核心 88 檔沿用可信 main，新來源實體 1.25 GiB／21,005 OP 八輪、79 項契約及 HTTP 候選 38 項操作通過。Windows Chrome／Edge 的六組原生案例、十六份實際下載、四份下載後 CPU／IO、pattern 正負例與正常退出保留其候選來源。上述主分支驗收完成當時，正式 HTTPS 與新不可變 Release 尚待接續、公開版為 v1.4.3；後續 v1.4.4 交付見下節，其餘商品等級未完成項目不改列完成。

## v1.4.4 正式交付

上述候選已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41290477405)完成正式 HTTPS、不可變 Release 與四份實際下載核對，見[最終收據](results/fully-connected-v1.4.4-published.json)。v1.4.3 tag／assets、原始失敗與各來源的驗收範圍均保留，沒有重跑成功部署、放寬判定或同步 Sites／GH Studio。其餘表列未完成項目與完整商品等級目標繼續保留。

## v1.4.5 必要主分支證據

卷積／pooling 的動態 rank／bias metadata 與逐 OP 報告修正已合併，[四項來源綁定關卡](results/spatial-metadata-main.json)原始報告已核對：未變核心 88 檔沿用可信 main，新來源實體 1.25 GiB／21,005 OP 八輪、79 項契約及 HTTP 候選 38 項操作通過。Windows Chrome／Edge 的六組原生案例、十二份實際下載、四份下載後 CPU／IO、pattern 正負例與正常退出保留其候選來源。上述主分支驗收完成當時，正式 HTTPS 與新不可變 Release 尚待接續、公開版為 v1.4.4；後續交付見下節，其餘商品等級未完成項目不改列完成。

## v1.4.5 正式交付

上述候選已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41295660383)完成正式 HTTPS、不可變 Release 與四份實際下載核對，見[最終收據](results/spatial-metadata-v1.4.5-published.json)。v1.4.4 tag／assets、原始失敗與各來源的驗收範圍均保留，沒有重跑成功部署、修改判定或同步 Sites／GH Studio。其餘表列未完成項目與完整商品等級目標繼續保留。
