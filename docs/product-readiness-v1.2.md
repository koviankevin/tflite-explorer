# 模鏡 v1.2.0 正式交付

[正式網站](https://koviankevin.github.io/tflite-explorer/)與[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.2.0)已於 2026-10-31 完成部署及獨立核對。這是公開核心的增量交付；[商品等級後續工作](product-readiness-next.md)仍進行中，Windows 大模型的完整正常關閉尚未通過。

## 本版修正

- 保留原始 TFLite `Buffer.data` 欄位的存在性，避免把 activation 的 absent data 重建成明確空 vector；整份、局部與組合匯出共用修正。
- 補上常用卷積／pooling 的靜態 shape、dtype 與參數規則；真正 allocation 失敗可列出有界的 OP／tensor 候選與定位，保留原始診斷。
- 新增可信 custom 引用契約與獨立建置接點；符合契約才精簡資料，未知 options 仍保守保留原編號及 payload。
- 修正 resource-only MLIR 漏列未驗證權重段，匯出重開保留原文；packing 與 dialect 語意仍明列未驗證。
- 修正非同步排版途中切到 32px 的文字超框；OP 與圖輸入／輸出均重新量測。一般連接範本改稱分支／匯合，保留內部資產與 pattern 相容性。

一般編輯／匯出只做結構與資料檢查，不自動執行 interpreter。手動執行以目前開啟的完整 TFLite 為目標，局部模型需先匯出並重開；既有 128 MiB 模型、16 MiB IO 與 30 秒執行界線不變。模型、權重、測試輸入及診斷維持在本機。

## 已核對的證據與界線

| 項目 | 結果與範圍 |
| --- | --- |
| 正式發布 | [工作流程 41178000511](https://github.com/koviankevin/tflite-explorer/actions/runs/41178000511)的 prepare／deploy／verify_live／release 四工作 attempt 1 全成功；沒有重跑成功部署 |
| 完整性 | 322 核心檔、全站 1,445 檔的原始 HTTPS SHA／MIME、獨立根網址、namespace 與權威 deployment 一致 |
| 真實操作 | 正式站 34 項操作、五組指南、19 種手動執行／分佈情境；包含原生選檔、pattern 匯入匯出、TFLite／MLIR 匯出重開與跨 block 分支／迴圈、編輯／草稿／選取／縮放及 32px 筆電版面 |
| 字級競態 | 正式站真實 layout 途中切字級，13 個 OP 加兩個圖輸入／輸出、共 15 組實際文字框符合 32px；另保留 Windows Chrome／Edge 各七組文字框的本機原生前後測及截圖 |
| 手動 CPU／IO | 正式站八輪／24 次 CPU、完整 IO bytes 與自然 URL 釋放通過原 RSS／heap 規則；沒有 forced GC、扣除 RSS 或縮短 timer |
| 實體大模型 | 相同應用來源的 Linux 1.25 GiB／21,005 OP 八輪、完整／局部／組合輸出、權重／custom options／pattern 與正常程序退出通過。這不取代 Windows 完整驗收 |
| 固定下載 | 四份實際公開下載均與準備包 bytes／SHA 相同；tag、Latest、Release 作者／來源與部署 job／site ID 一致 |

[最終交付收據](results/product-readiness-v1.2-published.json)與[原始報告、截圖、metadata 及驗證器](results/product-readiness-v1.2-evidence.zip)保留完整校驗。較早的[四關卡封存](results/product-readiness-main-verification.json)、[公開模型與空 buffer 回歸](results/product-readiness-stage1.json)、[custom 契約](results/product-readiness-stage2.json)及[Windows 混合結果](results/product-readiness-stage3-update.json)保持各自來源與原判定。

## 固定來源與部署包

- 來源：`f592e3d9df7ed48fae2ca19e353c7215638959a3`；tree：`c0ac061dd6e864b2a2366fca3fb0f880e4012640`。
- Build：`d69754e5b6791ecd`；site ID：`65f3aa00f191c852bff62c28ab9ccccc4294a031ac200ba7b2177a8299629b22`。
- [固定 ZIP](https://github.com/koviankevin/tflite-explorer/releases/download/v1.2.0/model-lens-public-1.2.0-d69754e5b6791ecd.zip)：41,262,165 bytes，SHA-256 `d2635dcef7f433da2524bb0213c47532439651e890d7cefb07afb354031e6eb5`。
- 保留 v1.1.0、v1.0.1 與永久 preview.7 root 基準，舊版本來源／資產不改寫。後續文件提交不重發 v1.2.0，也不移動已發布 tag。

## 尚未解決

Windows Chrome 的原實體八輪內容與記憶體子檢查通過，但最後正常 browser close 逾時，整輪仍失敗；歷史 RSS 失敗也保留。未知 custom 引用不能任意刪除，公開 runtime 不含公司 custom kernels。外部 MLIR resource 選檔尚未支援，未知 packing／各 dialect verifier、任意 kernel 語意、歷史啟動逾時根因、OS 斷電與任意格式遷移仍未證實。

必要範圍為 Chrome／Edge、14 吋桌面及 32px；本次不測手機、Firefox／WebKit、公司私有環境或新增兩小時負載。內網由使用者接入 private profile／adapter；沒有同步 Sites／GH Studio。
