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

[preview.34 固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.34)與[正式站](https://koviankevin.github.io/tflite-explorer/)均已完成獨立核對。固定來源 `20ec63305ca0dfb23ea06cb185d964896d5ad287`／tree `f7cb6405f80e3484e5855bd6f583c1c790056d8a`／build `b4e7d23b66e9d9c5`。候選與最終來源只差明列的非執行文件／收據選擇，四個執行 dependency scopes 相同；正式準備仍重新核對 provider、來源、scope 及乾淨建置。

[準備 41008715430](https://github.com/koviankevin/tflite-explorer/actions/runs/41008715430)的 provider ZIP／Pages tar、310 核心檔、全站 1,424 檔及乾淨重建 manifest 通過。[發布 41008988653](https://github.com/koviankevin/tflite-explorer/actions/runs/41008988653)四工作 attempt 1 成功，成功部署未重跑。

最終 reader 實際 exit 0，核對全站 SHA／MIME、root、權威 deployment 和四份實際固定下載，均與原準備包相同。原 33 項操作、19 種運算／分佈、86 model／44 runtime close、CPU／IO 八輪、自然 URL 期限、cold／retained 清理、五個啟動情境，以及新草稿容量／備份／移除／重試／重載恢復全部通過；新增 22 個模型 Worker 均原生關閉。草稿失敗截圖已再次驗 SHA 並目視核對。

site ID `4b520a6d3e647e3c00ae92a5a32554f9c0c140f7dbba81cd0f623168af4077b8`。[正式獨立收據](results/preview34-published-final.json)、[原始 provider／manifest／截圖／reader](results/preview34-published-originals.zip)及[逐檔 SHA／實際退出紀錄](results/preview34-published-originals.json)保留；大型成品保留於不可變 Release。preview.33／32 與 legacy preview.7 保留，未同步 Sites、覆寫舊版或改安全／RSS／runtime 規則。

依使用者「先完成一版再慢慢修」，本輪重要保存修正及交付完成，其餘品質項目列為後續；不宣稱 OS 磁碟已滿／斷電、Windows 兩廠牌實機、完整無障礙、數小時 interpreter 或歷史偶發啟動根因已全部解決。
