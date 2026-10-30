# preview.33 候選驗收與發布

網站程式檔或圖形初始化失敗時，現在提供明確提示和可用鍵盤操作的重新載入入口。開檔及示範按鈕在初始化完成後才啟用，避免快速點擊早於 handler 安裝；指南會依啟動狀態更新，保留對話框與焦點。失敗頁尾不再誤寫「準備就緒」。模型仍在本機處理，interpreter 仍需手動啟動。此版沒有宣稱已找到歷史那次無法重現的啟動逾時根因。

## 固定候選證據

來源 `e163f27a8b463f991ca7a9c2761fb5a4f7f1e0a2`／tree `27618b7b7edebada52e233c9673297e2cea6a0c8`／build `bbcbc6d186066875`，310 個核心檔。PR #166 最新 head 與 main 完整 tree 相同；完整 Node／建置與合約檢查成功。各獨立 reader 在乾淨固定來源實際 exit 0，核對 provider digest、ZIP CRC、來源／job／attempt 與完整 dependency scopes。

| 關卡 | 結果 |
| --- | --- |
| [核心效能 40885892195](https://github.com/koviankevin/tflite-explorer/actions/runs/40885892195) | 87 檔 dependency fingerprint 完全相同，重新認證後沿用 |
| [實體大檔 41001152546](https://github.com/koviankevin/tflite-explorer/actions/runs/41001152546) | 1,349,965,216 bytes／21,005 OP／非稀疏權重八輪、原生選檔／完整與局部匯出重開、權重／custom options／pattern 與原 RSS／Worker 規則通過 |
| [Contract 41001149808](https://github.com/koviankevin/tflite-explorer/actions/runs/41001149808) | 完整發布合約成功 |
| [Chromium 41001146906](https://github.com/koviankevin/tflite-explorer/actions/runs/41001146906) | 六項版本切換、33 項原生操作、19 個執行情境、五組指南、86 model／44 runtime close；另有五個啟動／開檔／指南情境與六個 Netron Worker close |

五個新情境分別阻擋主程式、阻擋圖形依賴並先開版本對話框、暫停後正常恢復、過早開檔，以及指南保持開啟跨越就緒。要求原生 Enter 重載、按鈕停用／啟用、實際 chooser 取消、指南可用性與焦點、1280×640 提示完整可見；零模型／runtime／下載。原始故障截圖經 SHA 與目視核對，頁尾及按鈕狀態一致。

既有 CPU／IO 八輪／24 次運算、八份完整 ZIP bytes、自然約 60 秒 URL 釋放、真 WHILE 取消／30 秒逾時／恢復、cold 取消及保留 native handle 的 FileList 清理仍通過。兩種 14 吋筆電 viewport／32px、TFLite 權重／custom options 及 MLIR SSA／控制流程匯出重開保留原生驗收。

[完整原始資料與 reader](results/preview33-candidate-evidence.zip)、[逐檔 SHA 與界線](results/preview33-candidate-evidence.json)保留。此前兩個測試驅動錯誤、首次三情境成功的舊頁尾，以及真正早期 chooser 失敗均在 [啟動恢復紀錄](startup-recovery.md)保留，不用後續成功覆寫原結果。

必要瀏覽器範圍依使用者指示只保留 Chrome／Edge；實際自動化為 Hosted Linux Chromium，不宣稱 Windows 兩個廠牌本體均獨立驗收。未新增 Firefox／WebKit、手機、公司或兩小時測試；原安全規則、RSS 與 runtime／URL 計時未放寬。CPU／IO 小模型與 1.25 GiB 大檔是不同負載，不作所有模型或數小時 runtime 的保證。

## 發布狀態

候選關卡已核對，尚待同一來源範圍的正式準備、部署與固定 Release 核對。目前正式站仍為 [preview.32](preview32.md#發布狀態)。
