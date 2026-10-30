# preview.34 草稿保存修正

依使用者「挑重要的做，先完成一版」的最新範圍，本版只補探索草稿保存失敗與安全重試，其他商品化品質項目列為後續。

原先寫入 catch 只標記跨分頁衝突，未記錄一般儲存失敗；回歸測試在舊程式實際失敗。現在失敗狀態持續可見、保留目前操作與 Undo／Redo，暫停自動重試並提供「重試儲存草稿」。首次讀取失敗會先重讀，發現舊草稿時要求恢復／另開副本，revision 衝突與跨模型隔離保持有效。資料庫格式、上限及原記錄不變。

## 固定候選證據

來源 `ce8ce8c94e41626556d4d7658cbd1f8e66641035`／tree `6d897e8f7abe6247d947cdaf5af9d1bf3182939e`／build `2178e0f993592319`，310 個核心檔。PR #169 與 main 完整 tree 相同，37 項保存相關選測及必要 PR Node／建置／合約檢查成功。

| 關卡 | 結果 |
| --- | --- |
| [核心 40885892195](https://github.com/koviankevin/tflite-explorer/actions/runs/40885892195) | 相同 dependency scope 經 provider 認證後沿用 |
| [實體大檔 41006831431](https://github.com/koviankevin/tflite-explorer/actions/runs/41006831431) | 1.25 GiB／21,005 OP 八輪，原權重／options／pattern／匯出重開與 RSS／Worker 門檻通過 |
| [Contract 41006828761](https://github.com/koviankevin/tflite-explorer/actions/runs/41006828761) | 發布合約通過 |
| [Chromium 41006826224](https://github.com/koviankevin/tflite-explorer/actions/runs/41006826224) | 原六項切換及 33 項操作／19 種運算／五組指南／86 model、44 runtime close 通過；五個啟動情境保留 |

新增隔離原生流程建立 20 份真實草稿，第 21 份拒絕後保留搜尋、32px 及圈選；下載 JSON、明確移除一份備份草稿，Enter 重試成功，重新載入及選原模型後能恢復。兩個流程情境、22 次原生 chooser、22 model Worker close 均核對。截圖從原始報告核對 SHA 並目視驗收。未直接改 IndexedDB、quota 或 DOM。

既有 CPU／IO 八輪、自然 URL 期限、真 WHILE 取消／30 秒逾時、冷啟動及 retained FileList 清理保持原門檻。這是 Hosted Linux Chromium 證據，不宣稱 Windows 兩個廠牌本體均獨立測試。容量上限不冒充 OS 磁碟已滿或斷電；未增加手機、公司、Firefox／WebKit 或兩小時負載。

[原始資料與 reader](results/storage34-candidate-evidence.zip)、[逐檔 SHA／實際 reader 退出](results/storage34-candidate-evidence.json)。

## 發布狀態

候選關卡已核對，尚待固定來源準備、正式站與四份 Release 下載驗證。正式站仍為 [preview.33](preview33.md#發布狀態)。
