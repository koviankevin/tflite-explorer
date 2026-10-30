# 網站啟動失敗與恢復（preview.33 候選）

目前正式站仍為 [preview.32](preview32.md#發布狀態)。本候選改善啟動失敗時的操作，不宣稱已查明 preview.22 那次無法穩定重現的啟動逾時。

獨立 bootstrap 先顯示載入狀態，再載入應用；程式檔載入或頂層初始化失敗時，顯示明確訊息和「重新載入網站」。不自動重整、重試、開啟模型或執行 interpreter，也不將原始錯誤字串／路徑放進提示。載入較慢時仍可使用獨立版本對話框；成功後提示消失，若鍵盤焦點原本在提示上則返回「開啟模型」。

Netron 的 `View.start()` 可能呼叫 `view.error` 後仍 resolve；新的啟動檢查在這種情況拒絕就緒，並在成功或失敗後恢復原本的 runtime 錯誤處理器。初始化失敗時關閉已開啟的版本對話框、停用半初始化的介面，保留瀏覽器重新整理及原生 Enter 操作重新載入按鈕。

相關 Node 啟動／錯誤隱私／封裝與來源檢查共 14 項通過；測試加強後四項啟動案例另通過。這是 Node 證據，尚不代表真實瀏覽器已驗收。

Hosted Chromium 將用三個獨立 context 阻擋一次入口檔、阻擋一次圖形初始化依賴（先開版本對話框），以及暫停入口後放行。要求原生鍵盤重新載入／正常恢復、1280×640 提示完整可見、零模型／runtime／下載、所有原生 Worker close；失敗畫面的公開截圖會保存在原始報告，供獨立 SHA 核對及目視驗收。原 RSS、runtime 30 秒與下載 URL 60 秒規則不改，不新增 Firefox／WebKit、手機或公司測試。

## 首輪 Hosted 結果與修正

[40994498640](https://github.com/koviankevin/tflite-explorer/actions/runs/40994498640) 的既有 33 項操作、真實 CPU／IO、cold 及 retained input 清理均完成，新恢復情境則在第一個 request 觀察失敗。實際檔案請求包含 `?v=buildId`，注入器原先比對未帶版本 query 的 URL，因此零次故障注入、零個恢復案例，不能宣稱功能已通過。獨立 reader 核對 provider digest／CRC、來源、完成階段及實際 URL 後 exit 0，保留[原始 ZIP／報告](results/startup-recovery33-first-failure.zip)與[雜湊／失敗界線](results/startup-recovery33-first-failure.json)。

修正只讓注入器比對實際版本 URL，應用未再改動。必要網站關卡仍按既有流程完整執行，新的三個故障恢復案例尚待通過；沒有放寬計時、改寫失敗或啟動大模型關卡。
