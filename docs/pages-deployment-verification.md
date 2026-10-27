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

## 修正後正式交付

[正式發布 40447776209](https://github.com/koviankevin/tflite-explorer/actions/runs/40447776209) 的 prepare、deploy、verify_live、release 四個 jobs 全部成功。正式版為 `0.2.0-preview.7`／build `163f38ab1dc856e4`，固定來源 `a0c0f702e310b53fc6baa3a05a57dbb5ca79b887`。Pages deployment `7350054986` 為 main／同一 SHA／success；[固定版本 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.7) 已建立。

- [部署準備 40447660731](https://github.com/koviankevin/tflite-explorer/actions/runs/40447660731) 重新核對三項必要 CI、逐檔相依 scope 與來源重建；只產出 artifact，其他三個 jobs skipped。下載後以標準 ZIP／tar reader 核對同一 manifest 的 247 個檔案；實際發布與下載 Release 的四份資產再與準備產物逐 byte 比較，全部相同。
- 部署 ZIP 為 29,454,029 bytes，SHA-256 `4a7db3bcf310d7253c1d103cf86292323c32441b7471e84c035917a66b0702f7`。Release 另含 `.sha256`、`release-manifest.json`、`release-gates.json`；tag 指向固定來源，各資產大小及 GitHub digest 符合實際下載內容。沒有覆寫失敗候選的 tag，也沒有修改已存在的版本。
- [正式站原始報告](results/pages-live-2026-10-27.json) 記錄全部 246 個 manifest 檔案的 HTTP 大小／SHA／瀏覽器 MIME。另對不帶 query 的正式入口及 `release.json` 獨立核對，同樣符合此版本，見 [完整交付核對](results/pages-delivery-2026-10-27.json)。
- [正式瀏覽器原始報告](results/pages-production-smoke-2026-10-27.json)：Chromium `141.0.7390.37`，1366×768，刻意延遲圖形初始化時版本視窗仍可開啟；32px 圖、精確 layer 搜尋定位、原生模型與 pattern JSON 選檔、pattern 匯入匯出、TFLite 子模型實際下載重開及原 pattern 均通過，Worker 已關閉、無 page errors。測試只使用公開示範，HTTP 只允許本站 GET。

## 沿用及補測依據

| 關卡 | 成功來源／結果 | 發布時核對 |
| --- | --- | --- |
| 核心效能 | [40438427440](https://github.com/koviankevin/tflite-explorer/actions/runs/40438427440)，`521d1b206bb9345117b340cf625493ca5c490040`，九筆量測 | 相依 fingerprint 未變，沿用既有量測；[原始報告](results/pages-core-2026-10-27.json) |
| 實體瀏覽器生命週期 | [40445983471](https://github.com/koviankevin/tflite-explorer/actions/runs/40445983471)，`35baf490d665ceafcf795a325e1f4036dd096d98`，八輪實測 | 前端啟動修正後補跑；後續只改獨立 production smoke／文件／證據索引，受測 src/vendor/build 與其測試相依未變；[原始報告](results/pages-lifecycle-2026-10-27.json) |
| 發布契約 | [40446643561](https://github.com/koviankevin/tflite-explorer/actions/runs/40446643561)，`6b52f3e81e8a2693d0820984565c58dd07aa118a`，21 passed／零略過 | 後續文件與證據索引不改契約相依 scope；[原始報告](results/pages-contract-2026-10-27.json) |

三份原始報告 SHA 與已發布 [關卡憑證](results/pages-release-gates-2026-10-27.json) 完全一致，該憑證又與 Release 實際下載內容一致。PR #8 的 scope 相同時回報 `not_required`、零測試，Node/build 計畫為 false；這些 PR 結果只供必要合併檢查，不冒充正式發布要求的三項成功 main dispatch。

八輪使用實體寫滿、完整讀回 SHA 的 1,349,965,216 bytes／21,005 OP 合成 TFLite，交替匯出 prefix／custom branch，單份子模型仍超過 1 GiB。權重、custom options、重複匯出 bytes、pattern 正反例及重開皆通過；16 個模型 Worker 真正終止，所有 Blob URL 自然撤銷。暖機後六輪的整個 Chromium 程序樹 RSS 漂移 10,752,000 bytes、斜率 140,668 bytes／輪，主頁 heap 漂移 28,776 bytes；1101 筆取樣的 peak RSS 為 765,812,736 bytes，未超過既定 policy。Worker V8／backing storage 與讀取預算另保留於原始報告。未強制 GC，也未降低門檻。

## 尚待完成

八輪合成檔不能證明數小時負載、其他引擎、固定實體硬體 SLA 或公司模型／dialect／compiler／runtime 均已支援。內網仍需用選定的核心版本與公司擴充重新建置及驗收。此輪僅更新 GitHub，未同步 Sites。

隔離 HTTP 的 ZIP 升級／回退結果仍可參考 [既有演練](release-gates-verification.md)，但不等於正式 Pages 已做回退、瀏覽器資料反向遷移或升級時的舊分頁／CDN 資產隔離。這些與公司實模／compiler／runtime 驗收仍列於 [商品等級工作](product-readiness.md)。
