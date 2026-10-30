# 網站啟動失敗與恢復（preview.33 已交付）

目前正式站為 [preview.33](preview33.md#發布狀態)。本版改善啟動失敗時的操作，不宣稱已查明 preview.22 那次無法穩定重現的啟動逾時。

獨立 bootstrap 先顯示載入狀態，再載入應用；程式檔載入或頂層初始化失敗時，顯示明確訊息和「重新載入網站」。不自動重整、重試、開啟模型或執行 interpreter，也不將原始錯誤字串／路徑放進提示。載入較慢時仍可使用獨立版本對話框；成功後提示消失，若鍵盤焦點原本在提示上則返回「開啟模型」。

Netron 的 `View.start()` 可能呼叫 `view.error` 後仍 resolve；新的啟動檢查在這種情況拒絕就緒，並在成功或失敗後恢復原本的 runtime 錯誤處理器。初始化失敗時關閉已開啟的版本對話框、停用半初始化的介面，保留瀏覽器重新整理及原生 Enter 操作重新載入按鈕。

相關 Node 啟動／錯誤隱私／封裝與來源檢查共 14 項通過；測試加強後四項啟動案例另通過。這是 Node 證據，尚不代表真實瀏覽器已驗收。

Hosted Chromium 將用三個獨立 context 阻擋一次入口檔、阻擋一次圖形初始化依賴（先開版本對話框），以及暫停入口後放行。要求原生鍵盤重新載入／正常恢復、1280×640 提示完整可見、零模型／runtime／下載、所有原生 Worker close；失敗畫面的公開截圖會保存在原始報告，供獨立 SHA 核對及目視驗收。原 RSS、runtime 30 秒與下載 URL 60 秒規則不改，不新增 Firefox／WebKit、手機或公司測試。

## 首輪 Hosted 結果與修正

[40994498640](https://github.com/koviankevin/tflite-explorer/actions/runs/40994498640) 的既有 33 項操作、真實 CPU／IO、cold 及 retained input 清理均完成，新恢復情境則在第一個 request 觀察失敗。實際檔案請求包含 `?v=buildId`，注入器原先比對未帶版本 query 的 URL，因此零次故障注入、零個恢復案例，不能宣稱功能已通過。獨立 reader 核對 provider digest／CRC、來源、完成階段及實際 URL 後 exit 0，保留[原始 ZIP／報告](results/startup-recovery33-first-failure.zip)與[雜湊／失敗界線](results/startup-recovery33-first-failure.json)。

修正只讓注入器比對實際版本 URL，應用未再改動。必要網站關卡仍按既有流程完整執行，新的三個故障恢復案例尚待通過；沒有放寬計時、改寫失敗或啟動大模型關卡。

## 第二輪：觀察順序錯誤

[40995960246](https://github.com/koviankevin/tflite-explorer/actions/runs/40995960246) 已實際命中版本 URL，第一個情境走到原生鍵盤重載與正常初始化檢查，卻在關閉 context 後繼續讀取 viewport 而失敗。這是新增測試的順序錯誤；當輪仍是零個完整案例收據，不能當成三種恢復情境已通過。獨立 reader 核對原始 provider／CRC／來源、context close 與程式順序後 exit 0，[原始 ZIP](results/startup-recovery33-observation-failure.zip)及[失敗收據](results/startup-recovery33-observation-failure.json)保留。修正僅將版面讀取移至 context 關閉前，保留所有 assertion 及真正 Worker close 要求，應用未更動。

## 首次三情境成功與目視修正

[40997283556](https://github.com/koviankevin/tflite-explorer/actions/runs/40997283556) 的三個恢復情境全部通過；四個 Netron Worker 都收到 close，無模型、runtime 或下載。33 項原操作、19 runtime、CPU／IO、cold 與 retained input 也通過。獨立 reader 真正 exit 0，核對 provider digest／CRC、來源、截圖 SHA 與 1280×640 邊界；[原始資料](results/startup-recovery33-first-success.zip)與[收據](results/startup-recovery33-first-success.json)保留。

目視截圖發現失敗時頁尾仍是舊的「準備就緒」。候選另將載入中與失敗頁尾同步，並在三情境加入狀態文字檢查；這個小修正仍需新的原生核對，未拿舊成功直接當新來源發布資格。

## 快速開檔的就緒競態

頁尾修正版 [40998526593](https://github.com/koviankevin/tflite-explorer/actions/runs/40998526593) 的三情境與原 33 操作再次通過；獨立實體關卡 [40998532591](https://github.com/koviankevin/tflite-explorer/actions/runs/40998532591) 卻在第一個 chooser 逾時，零輪完成，六個已觀察程序正常退出。動態 bootstrap 讓靜態按鈕先出現，使用者可能在 handler 安裝前點擊；本候選將所有模型開啟／示範入口預設停用，完整初始化後才啟用。版本控制於圖形初始化等待期間仍可操作。

另增加第四個早期開檔情境：真正暫停主程式載入，確認按鈕停用；放行後由原生操作開啟 chooser，取消檔案選取，確認零模型／runtime／下載與真正 Worker close。原始[大檔失敗與網站成功資料](results/startup-recovery33-early-chooser.zip)和[認證界線](results/startup-recovery33-early-chooser.json)保留；不能拿三情境成功覆蓋這次開檔失敗。

指南的模型操作同樣在啟動期間維持忙碌，並監看啟動提示隱藏以即時恢復可用；另加第五個保留指南對話框的情境，要求啟動前停用、就緒後啟用且焦點不被搶走。這避免只新增忙碌判定卻忘記重新整理可用狀態。

## 最新五情境與八輪結果

[preview.33 固定候選](preview33.md)已完成五個原生情境、原 33 操作及未修改 chooser 邏輯的 1.25 GiB／21,005 OP 八輪。按鈕就緒競態的修正已由早期點擊與原大型流程核對；來源、原始資料、失敗界線與發布狀態以該頁為準。

## 正式交付

[preview.33](preview33.md#發布狀態)已完成正式站、四份固定下載與權威 deployment 的獨立驗證。五個原生情境在正式站再次通過，故障截圖已目視核對；歷史失敗保留原始結果。
