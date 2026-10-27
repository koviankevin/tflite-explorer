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

**正式網站目前仍為 preview.10；本頁記錄修正及選證，尚非 preview.11 的部署完成聲明。** TFLite 新增仍以既有 OP 為範本，未新增任意 OP catalog、拖曳排序或批次刪除；compiler／runtime 語意仍須內網驗收。
