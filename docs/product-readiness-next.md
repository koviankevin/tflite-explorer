# 商品等級後續工作（進行中）

使用者於 2026-10-31 將目標接續為「商品等級」。目前正式版為 [v1.2.0](product-readiness-v1.2.md)／build `d69754e5b6791ecd`，正式站與固定 Release 已獨立核對；完整商品化目標仍進行中。目標是公開核心可供工程師可靠日常使用，保留全部尚未完成項目；不以單個合成模型或綠燈宣告完成。

沿用使用者範圍：模型、權重、測試輸入及診斷全程本機；Chrome／Edge、14 吋桌面與 32px；不測手機、Firefox／WebKit，不自行啟動兩小時負載；內網模型、私有 dialect／compiler／custom runtime 由使用者處理。一般編輯／匯出不自動執行 interpreter。既有安全、RSS 與 runtime／URL timer 不放寬。

## 目前交付狀態

階段一的序列化／常用 OP 修正、階段二的 custom 引用契約、resource-only MLIR 未檢查計數及字級排版修正，已在 v1.2.0 正式交付。[最終收據](results/product-readiness-v1.2-published.json)核對完整來源、部署、34 項正式操作與四份實際固定下載。下表保留各階段的工作界線；早期收據的「待執行／未發布」維持其當時狀態，不覆蓋目前交付結果。

精確 v1.2.0 固定產物的最新 [Windows 實體八輪](windows-large-model.md#v120-固定產物的完整-windows-驗收)在 Chrome／Edge 均通過原判定及正常退出；Edge slope 接近原上限，不宣稱有寬裕餘量。[階段三證據](results/product-readiness-stage3.json)及[後續原始證據](results/product-readiness-stage3-update.json)中的歷史失敗仍保留，根因尚未證實。後續小型 TRANSPOSE 候選又重現 Chrome 正常關閉逾時，不能把功能或稍後 PID 消失寫成整輪通過；新證據見下段。

下一個 v1.2.1 候選已修正 [TRANSPOSE permutation](transpose-permutation.md) 合法負軸被擋與 int64 錯誤放行，56 項相關測試通過。打包來源 `4b0822e` 的兩瀏覽器實際編輯／匯出／重開／搜尋／raw BIN CPU 內容均核對；Edge 整輪通過，Chrome 最後正常關閉逾時仍判失敗。[原始收據](results/transpose-permutation.json)保留此差別。PR #187 已合併，`8bf6c9b` 的新主分支大檔八輪、78 項發布契約及 34 項網站操作均已核對；核心 88 檔範圍未變而沿用既有量測，[四關卡收據](results/transpose-main-verification.json)與原始 ZIP 保留。仍待精確產物準備／正式發布，正式站尚未取得候選修正。

另在實際截圖中發現 32px 字級與框線不同步，原先「沒有頁面溢位」的數值檢查不足。已在未修改候選穩定重現[字級排版回歸](font-reflow.md)，修正非同步 layout 期間 target 暫空的提前返回；來源 `7068a7e` 的 Chrome／Edge 完整七組文字邊界與實際截圖已核對，v1.2.0 正式站另核對 15 組實際文字框。舊來源成功不抵銷曾有的視覺缺口。

字級修正已經 [PR #184](https://github.com/koviankevin/tflite-explorer/pull/184) 合併至 `bb3bd37`，完整 tree 與實際 PR checkout 相同。[新 main 網站關卡](https://github.com/koviankevin/tflite-explorer/actions/runs/41174045604)的六種版本切換、正常 HTTP 候選與 34 項實際操作已完成 digest／CRC／來源／原判定核對；新增字級情境的 13 個 OP、兩個輸入／輸出文字框皆符合 32px。19 種手動 runtime 情境及八輪／24 次 CPU、IO 與原記憶體規則通過；[發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/41174041946) 78 項亦核對通過。[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41174035077)亦已取得原始報告並核對通過；四項關卡的[收據](results/product-readiness-main-verification.json)與[原始證據](results/product-readiness-main-evidence.zip)保留。後續以精確來源 `f592e3d9df7ed48fae2ca19e353c7215638959a3` 完成 v1.2.0 準備、部署及固定下載核對；這些 Linux 結果不取代 Windows 的原始關閉失敗。

目前外部使用者以 v1.2.0 為準，包含一般分支／匯合名稱與文件整理；[發布工作流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41178000511)四個工作 attempt 1 全成功。發布後文件更新不移動 tag、不改寫固定資產，也不重跑成功部署。

## 各階段原始計畫與範圍

| 工作 | 要證明的行為 | 狀態 |
| --- | --- | --- |
| 編輯合法性與錯誤定位 | 常用 OP 的 shape、dtype、常數／量化正負例；實際序列化、原始權重／options 保留與 CPU 結果；runtime 錯誤可對照 OP／tensor，無法唯一對應時明列候選 | 卷積／pooling 共用靜態規則、真正 allocation 負例及 Windows 小型 UI 已通過，四項 main 關卡與 v1.2.0 正式交付已核對。其他 OP／任意 kernel 語意仍未驗證，不把結構通過寫成可執行保證 |
| Custom 子模型資料保留 | 未知引用保守保留；有可信引用契約才能安全縮減；預覽與實際匯出一致、契約負例拒絕、擴充不污染公開包 | [引用契約](custom-reference-contracts.md)本機證據已核對：建置隔離與十二份 Windows 下載的原始 bytes／編號／pattern；公開程序 exit 0，合成內網報告通過但退出碼遺失。公開支援已在 v1.2.0 正式交付；未知格式仍完整保留，不宣稱任意 custom kernel 已可執行 |
| Windows 大模型可靠性 | 在明確環境的有限輪數操作中觀察整個瀏覽器／Worker、原生關閉及匯出後釋放；權重、options、pattern、草稿／視角保留 | 精確 v1.2.0 的[實體 1.25 GiB 八輪](windows-large-model.md#v120-固定產物的完整-windows-驗收)兩端均通過；歷史失敗保留，後續小型候選 Chrome 關閉再次逾時，正常關閉根因仍未完成。不以小型 UI／Linux 大檔代替 Windows 大檔，亦不把 f592 結果換標成未來來源 |
| Generic MLIR 支援邊界 | 支援型別的 dense／hex 計數、SSA／dominance；外部 resource／packing 有明確契約或明列未驗證；公司 dialect 接點可獨立建置 | Resource-only 漏列未檢查段已修正；44 項選測及 Windows Chrome／Edge 打包後原生開檔、32px、pattern 各一筆、匯出重開通過，12,012 bytes resource 原文比對一致、每個瀏覽器三個 Worker 關閉。修正已在 v1.2.0 正式交付；packing／公司 verifier 未驗證，外部 resource 選檔尚未支援 |
| 啟動與診斷 | 公開請求／啟動問題可收集不含模型的白名單診斷；中斷後可恢復；歷史失敗保留，根因須由可重現證據確認 | 歷史 preview.22 的一次啟動逾時仍未重現，不反覆重跑成功部署冒充修好 |
| 保存、操作及發布 | 草稿／pattern 異常與遷移可恢復；主要新手流程與鍵盤可操作；固定產物、相依 scope、必要關卡、正式站與 Release 一致，回退不破壞使用者資料 | 既有功能與交付證據沿用；新功能仍須補受影響驗收；OS 斷電、完整螢幕閱讀器與任意格式遷移仍未證實 |

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
