# 框選後開啟實際模型編輯器

使用者在 preview.10 回報「編輯實際模型」無反應，觸發方式是框選多個 OP。重播實際 app click handler：兩個已選 OP 且沒有舊 detail 時，編輯器完全不開；有舊 detail 時，反而開啟框選範圍外的舊 OP。先前正式站測試只從單一 Layers 結果開啟，沒有覆蓋此情境。修正不冒充已證明使用者模型的 compiler／runtime 語意。

現在多選會先開啟對話框，列出最多 32 個已選 OP 的名稱、subgraph/block 與原始 OP 編號，再選一個編輯。清單不載入 OP 文字、attributes 或權重。框選範圍優先於舊 detail，跨 block 的同號 OP 保留各自身分；框選清空時不退回舊目標。返回清單的按鈕明示放棄目前欄位，保留框選與圖形視角；匯出仍逐個修改 OP 並產生整份新模型，沒有新增批次刪除或任意重排功能。

「編輯實際模型」與有結果時才出現的「開啟匯出結果」移到模型圖上方，改為 14px、至少 38px 高的明顯按鈕。框選工具列也有「編輯實際模型」入口，使用相同目標判定。關閉模型會清除結果入口；開啟修改結果後，以新模型繼續編輯。

Node 的 `test/model-edit-selection.test.mjs` 重播實際 app 事件邊界，涵蓋多選無 detail、多選舊 detail、跨 block、單選、空選與工具列入口。`test/model-operation-edit.test.mjs` 另檢查清單只回傳有限 metadata、去重及非法位置拒絕；10 項針對性檢查通過。此 seam 不代表原生 dialog 或框選幾何已通過。

瀏覽器驗證已加入真實滑鼠拖曳框選、排除舊 OP、選擇 custom OP、返回清單、關閉後選取及座標保留、框選工具列入口，以及跨 block 分支／迴圈、選定 OP 匯出與重開。另檢查 1366×640 與 390×844 對話框及清單版面。不操作使用者的本機瀏覽器，不上傳公司模型。

## 實際新舊版對照

固定 driver 來源 `49e4112bd2666ca8d955c9501b9316055c17ef1b`：

- [正式 preview.10 負例 40538489292](https://github.com/koviankevin/tflite-explorer/actions/runs/40538489292) 真實框選成功，但無法開啟已選 OP 清單；[原始報告](results/model-edit-multi-old-site-2026-10-28.json) 保留 failed，不用後續成功改寫。
- [隔離修正版 40538497401](https://github.com/koviankevin/tflite-explorer/actions/runs/40538497401) 通過六種切換和 16 項 UI／鍵盤操作；[原始 UI 報告](results/model-edit-multi-fixed-ui-2026-10-28.json) 顯示 21 個模型 Worker 全部關閉、八份修改模型／報告及匯出重開通過。TFLite 真實框選後排除舊 OP #0，清單只列 #1 custom op 與 #2 ADD；返回、關閉與繼續選取保留原選取和節點座標。MLIR 分支 7 OP／4 blocks、迴圈 4 OP／3 blocks 均可從清單選定原始 OP 再修改及匯出。
- [provider 核對](results/model-edit-multi-provider-review-2026-10-28.json) 重新下載 GitHub artifacts，驗證 digest、CRC、來源、attempt 與實際成功／失敗 job 時段。
- 初次 925ff15 的 [40537792312](https://github.com/koviankevin/tflite-explorer/actions/runs/40537792312) 滑鼠起點落在左欄 resize handle，尚未到達編輯器。修正 driver 起點並檢查命中圖面後，才得到上面真正的正反例；不將此初次測試錯誤算成修正通過。

## 正式來源的發布證據選擇

Main 修正來源 `d61090ca0ec4d33af48a4f54e81a312c34ab6aa0`、tree `c50ac00cf347c21dda523d43b40d74034aac9caa` 與通過隔離 UI 的 PR head tree 相同。`release-evidence.json` 只選定下列 run IDs，不是通過憑證；尚在執行的 run 不可視為通過。prepare 仍須驗證 API、artifact digest、原始 policy、相依 fingerprint 和乾淨候選重建，全部通過才可發布。

| 關卡 | 選擇與驗證 |
| --- | --- |
| [core 40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445) | [86 個執行依賴指紋完全相同](results/preview11-core-scope-2026-10-28.json)，沿用成功 main 量測；版本標籤以外的 package／lock 欄位仍比對 |
| [browser 40539126102](https://github.com/koviankevin/tflite-explorer/actions/runs/40539126102) | 本次 main 的實體 1.25 GiB／21,005 OP 八輪完整改模、下載與關閉門檻；必須最終成功，不能用前版報告替代 |
| [contract 40539137044](https://github.com/koviankevin/tflite-explorer/actions/runs/40539137044) | [75 項契約測試](results/preview11-main-contract-2026-10-28.json) 成功，零失敗／略過／取消 |
| [site 40539144317](https://github.com/koviankevin/tflite-explorer/actions/runs/40539144317) | [main 六種隔離切換](results/preview11-main-site-2026-10-28.json) 及同 job 的 16 項原生 UI 成功 |

**preview.11 已部署，正式網站及固定 Release 驗收通過，見下方正式交付。** TFLite 新增仍以既有 OP 為範本，未新增任意 OP catalog、拖曳排序或批次刪除；compiler／runtime 語意仍須內網驗收。

## 正式交付

已更新 [GitHub 正式網站](https://koviankevin.github.io/tflite-explorer/) 與 [preview.11 固定版本](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.11)。重新整理載入新版後，「編輯實際模型」與有結果時才出現的「開啟匯出結果」位於模型圖上方；框選工具列另有「編輯實際模型」。多選後先選清單中的一個 OP，再修改接線或在前／後複製新增，驗證匯出後按「開啟修改結果」繼續編輯；小模型匯出後按圖上方「開啟匯出結果」。目前沒有拖曳重排與批次刪除。

凍結來源 `23913d50b9404889b6ff91ae8980545df06e3278`、tree `79d6be407bf07dbdddf3aad7eb43cd3d0445ed8d`、build `cc9492eba3dff776`。[最終候選的四關卡審閱](results/preview11-selected-scopes-2026-10-28.json) 重新下載 GitHub artifacts、核對 digest 並重判原始 policy，全部通過；各執行依賴 fingerprint 與受測來源一致，僅文件／索引差異不重跑功能。prepare 再次認證並乾淨重建，不以本頁或本機 JSON 代替發布關卡。

[大檔原始量測](results/preview11-physical-lifecycle-2026-10-28.json) 的八輪整份模型改動、下載、直接重開、子模型原生重開和關閉通過。24 個模型 Worker 全部終止；每份完整輸出的七個 ranges 共 1,342,177,328 bytes 串流比對通過，包含 1.25 GiB 非零權重與 opaque custom options。完整輸出 SHA-256 仍為 `6371d2132d4f1816666c04f3132ae0f395de5f54777d6adcab55f0c07ea6665b`。完整修改／候選解析／下載約 13.8～19.9 秒；扣除兩輪 warmup，closed RSS drift 約 14.2 MiB、slope 約 0.29 MiB／輪，main heap drift 約 488 KiB；sampled whole-browser peak 約 876.7 MiB。500ms 取樣、有限八輪與特定 hosted Chromium 不能證明永不洩漏、連續峰值或公司硬體 SLA；未強制 GC、未縮短 60 秒 Blob URL 壽命，全部自然撤銷，原本記憶體／read 門檻沒有放寬。

[準備 40541813119](https://github.com/koviankevin/tflite-explorer/actions/runs/40541813119) 及 [獨立準備審閱](results/preview11-prepared-review-2026-10-28.json) 通過後，使用確切 build／完整 site ID 執行 [發布 40542578996](https://github.com/koviankevin/tflite-explorer/actions/runs/40542578996)。第一次 verify_live 的 HTTP 核對已成功，但安裝 Ubuntu 字型／瀏覽器依賴下載過慢、job 被取消，尚未執行網站操作；[失敗日誌選錄](results/preview11-browser-install-timeout-2026-10-28.txt) 保留。只對 verify_live 發出 job rerun，attempt 2 的原生驗收和相依 Release 成功。GitHub 對準備／部署顯示複用的成功 job metadata；實際 deployment 沒有重做，仍是 attempt 1、job `122325038196`、deployment `7364421446`。不將第一次取消改寫為成功。

- [正式 HTTP 報告](results/preview11-live-http-2026-10-28.json)：1,256 檔逐檔 SHA／MIME 與實際 root 核對通過。
- [正式 UI 報告](results/preview11-live-ui-2026-10-28.json)：16 項操作、21 個模型 Worker 關閉，實際框選、舊 OP 排除、custom OP 選擇、選取／座標保留、分支 7 OP／4 blocks、迴圈 4 OP／3 blocks 及八份修改模型／報告下載重開通過。1366×640 與 390×844 清單／表單版面沒有水平溢出。三份 TFLite ranges 比對成功，五份無權重 ranges 的 MLIR 明列 not-applicable，未宣稱執行 compiler。
- [固定 Release 報告](results/preview11-fixed-release-2026-10-28.json) 及 [最終獨立審閱](results/preview11-publication-review-2026-10-28.json)：依實際成功 job／attempt／時間範圍認證 provider digest、CRC、原始報告，重新下載四份 Release 資產，與原準備 bytes 完全一致；部署權威、無 query 的 root 與 live index 一致。

完整 site ID `8925441b0b077a824f4a24f4a695d73863be75989412d937c0c12027d9f10733`，site manifest SHA-256 `c6fac042aa980fa31f67f000903175d877feccba12336c7995dea7ea31830011`，root SHA-256 `91c2d26ea9a8cc40b2930e14174b731f71c69c0497bc1c958323bb7d5fdc50da`。保留 preview.10／preview.9 namespaces 和永久 preview.7 baseline；舊分頁保持其原版，重新整理才載入新版。

部署 ZIP `model-lens-public-0.2.0-preview.11-cc9492eba3dff776.zip` 為 29,543,782 bytes，SHA-256 `a0b61a099e347d08090b4863db59c18680eea42ff9a3f151017661646a9ebd41`。可原樣部署公開版；帶公司 profile／adapter 時固定 `v0.2.0-preview.11` 後重新建置與內網驗收。固定包內文件反映準備時階段，本頁補上正式完成證據，不替換已發布 bytes。公司模型／compiler／runtime、其他引擎、實體手機、長時間負載與其餘 [商品等級目標](product-readiness.md) 仍未完成。
