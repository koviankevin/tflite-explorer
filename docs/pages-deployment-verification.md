# Pages 伺服器發布保護驗收（2026-10-27）

GitHub Pages 已由 `legacy`／gh-pages 改成 `workflow`，github-pages environment 的唯一允許分支改為 main。main 已要求來自 GitHub Actions App `15368` 的 `release-contract`、`node-and-build`，包含管理者、要求與 main 同步，禁止 force push／刪除；沒有新增人工 approving review。此處記錄已完成的設定與負例，完整新版本發布另以實際工作流程結果為準。

## 實際負例

[設定與負例報告](results/pages-guards-2026-10-27.json) 保留 API 觀察、來源、probe commits、退出碼及原始本機紀錄 SHA；沒有公司模型、dialect 或認證資料。

- [版本不符 run 40445115478](https://github.com/koviankevin/tflite-explorer/actions/runs/40445115478)：指定全零 build ID，prepare 明確拒絕。deploy、verify_live、release 全部 skipped，artifact 數量為零，沒有新部署。
- 未受測 main probe `f404892e590e350641f1ccbfadb7cab9f5bbe588` 與原 main 的 Git tree 完全相同；普通推送仍被 `GH006` 拒絕，訊息為兩項必要檢查未完成。main 前後保持 `95a6371c7d3827fef67964aa037d42bcf2d92d27`，沒有強推或放寬保護。
- 舊 gh-pages probe `ad737327acb3a54dcbbc6b6b2db380fa83bc123c` 保持原靜態網站 Git tree 不變。實際推送後觀察 95 秒，該 SHA 對應工作流程零筆，最新 deployment ID 仍為 `7349696141`。不再從 gh-pages 推送觸發正式部署。

main 保護啟用後，[修正 PR #6](https://github.com/koviankevin/tflite-explorer/pull/6) 經兩項必要檢查成功後正常合併；不是以繞過規則交付。PR 測試 merge tree 與合併後 tree 同為 `714b34c2f5b9c2f5e96970527b1c7f6a1bac69f6`。Node 檢查 287 passed、35 skipped、零失敗；發布契約 21 passed、零略過。必要契約的成功與一般套件中原本略過的環境案例分開紀錄。

## 正式瀏覽器發現的啟動問題

[第一次正式發布 40445193799](https://github.com/koviankevin/tflite-explorer/actions/runs/40445193799) 的 prepare／deploy 成功，246 個正式檔案 SHA／大小／瀏覽器 MIME 也全部通過。但瀏覽器在圖形引擎初始化前點版本按鈕，沒有開啟視窗。verify_live 因此失敗，release job 未執行；這筆失敗不是完成交付。

[延遲初始化負例 40445703836](https://github.com/koviankevin/tflite-explorer/actions/runs/40445703836) 刻意保留真正 zip module 請求未完成，在約兩秒內確認版本按鈕尚未綁定。PR #6 將獨立版本資訊的事件綁定移到 `view.start()` 前。正式 smoke 保留延遲初始化案例，等實際請求抵達後才斷言，並在版本視窗成功後解除延遲，再完成原本的模型選檔、32px 搜尋、pattern JSON 與子模型下載重開。

## 尚待完成

新來源仍須通過實體大型模型生命週期驗收、固定來源準備及正式站完整操作，才能建立固定版本 Release。此文件不將前一次已部署但未通過瀏覽器驗證的候選當成成功交付。

隔離 HTTP 的 ZIP 升級／回退結果仍可參考 [既有演練](release-gates-verification.md)，但不等於正式 Pages 已做回退、瀏覽器資料反向遷移或升級時的舊分頁／CDN 資產隔離。這些與公司實模／compiler／runtime 驗收仍列於 [商品等級工作](product-readiness.md)。
