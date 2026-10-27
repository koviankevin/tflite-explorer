# 正式站版本切換、回退與恢復驗收

2026-10-27，GitHub 正式站目前為 `0.2.0-preview.8`／build `017eed149449e951`。核心來源固定為 `98f4aaa3dce7f6ceeedccdfd2d9449a3927f7385`，發布控制程式來源為 `eca6e88f740b13f7ae862dce3523b92a59726f37`；兩者分開核對，不以新版控制程式重寫舊 Release。

## 完成的正式站演練

| 動作 | 實際結果與來源 |
| --- | --- |
| 正確 build 搭配錯誤 site ID | [40466627559](https://github.com/koviankevin/tflite-explorer/actions/runs/40466627559) 如預期拒絕，零 artifact，deploy／verify／release 全部略過；[負例紀錄](results/production-wrong-site-negative-2026-10-27.json) 確認原 deployment 不變 |
| 首次發布 preview.8 | [40466906051](https://github.com/koviankevin/tflite-explorer/actions/runs/40466906051) 第三次 attempt 成功，正式站逐檔及原生 UI 通過後才建立四份固定 Release assets；前兩次的暫時 503 仍記為失敗 |
| 使用新控制程式回退 preview.7 | 先審閱 [準備 40472995964](https://github.com/koviankevin/tflite-explorer/actions/runs/40472995964)，再執行 [40473313236](https://github.com/koviankevin/tflite-explorer/actions/runs/40473313236)，全部成功；[741 檔 HTTP](results/production-rollback-http-2026-10-27.json) 與 [四項原生操作](results/production-rollback-smoke-2026-10-27.json) 通過，保留 preview.8 namespace |
| 恢復原本 preview.8 | 審閱 [準備 40473476999](https://github.com/koviankevin/tflite-explorer/actions/runs/40473476999)，再執行 [40473793963](https://github.com/koviankevin/tflite-explorer/actions/runs/40473793963)，第二次 attempt 全部成功；[741 檔 HTTP](results/production-restore-http-2026-10-27.json) 與 [四項原生操作](results/production-restore-smoke-2026-10-27.json) 通過，保留 preview.7 namespace |
| 同一 browser context 經過真實回退與恢復 | [40472992187](https://github.com/koviankevin/tflite-explorer/actions/runs/40472992187) 六項全部通過；[原始瀏覽器報告](results/production-transition-browser-2026-10-27.json) 記錄三次實際 site 觀察、原生操作、六個 model workers 和三個 layout workers 全數關閉、browser 關閉及受測來源未變 |

[最終獨立核對](results/production-transition-review-2026-10-27.json) 重新讀取 GitHub run／attempt／jobs，選取實際成功 job 時段內的 artifact ID，核對 provider ZIP 大小／digest、CRC 和每份原始報告 SHA，不依賴可能重複的 artifact 名稱。最新成功 deployment `7353771640` 的 job `122087247196` 屬於原部署 attempt 1，與 live index 的完整 site ID 相同；後續只重試 verify，沒有再次部署。

恢復後的完整 site ID 為 `13a9185171eb3ffb32c8b2df63b12512d2a22e65f6b9c7db64f0f7570dac17a5`，site manifest SHA-256 為 `f698f6d4d6ac6bb8f24c992f590d68cc4f7d393e1ca6eae70d1fff13cf64f639`，均與最初成功準備的 preview.8 完全相同。[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.8) 的來源 tag、ZIP、checksum、core manifest 與四關卡 receipt 均保持原始內容；ZIP SHA-256 為 `afdb7d2728bbf3940d3dcc13356b52d33d55c1aeb697fe9ab4a7a9aa510f6614`。

## 瀏覽器涵蓋的行為

Hosted Linux Chromium 141.0.7390.37，1366×768，僅使用固定公開 TFLite／custom MLIR 範例。在同一 context 由 baseline 分頁保存 IndexedDB pattern，新版分頁可讀取；真實回退後，已開啟的新版才首次 lazy-load TFLite parser，32px 下仍找到四筆原匹配。原生下載子模型後重新選檔，仍匹配一次；pattern JSON 與原始內容完全相同。真正恢復 preview.8 後，新開 root 分頁仍能讀到原清單並找到四筆。

這輪以 `initialMode=existing-versioned-default` 開始，baseline 分頁使用保留的 preview.7 namespace；`observedInitialUpgrade=false`，不冒充首次 root 遷移。首次 root 的 [40466402819](https://github.com/koviankevin/tflite-explorer/actions/runs/40466402819) 原先通過前五項，包括真實升級後原 root lazy custom MLIR 及回退後舊分頁操作，但等待最後恢復時超過 25 分鐘；[原始部分報告](results/production-original-root-partial-2026-10-27.json) 仍明確為 failed，不與後一輪拼成單次全程通過。

## 失敗與修正沒有隱藏

早期 [恢復 40469787584](https://github.com/koviankevin/tflite-explorer/actions/runs/40469787584) 的 deploy 成功，逐檔 HTTP 卻遇到 503，因此整體失敗。後續靜態讀取僅對 502／503／504 最多四次、1／2／4 秒間隔重試，保留每檔 attempts；SHA、MIME、大小和永久 HTTP 仍立即拒絕。[main 74 項契約](results/bounded-main-contract-2026-10-27.json) 包含完整 HTTP 鏈回歸及恢復後錯誤內容拒絕案例。此次回退和恢復的逐檔報告皆為零重試，不宣稱觀察到實際 CDN 503 恢復。

最後恢復 run 的 attempt 1 在通過所有 741 檔後，從 `azure.archive.ubuntu.com` 下載 Playwright 所需系統套件過慢，超過八分鐘上限而取消；原生 UI 尚未執行。僅以 failed-only 重試 verify，attempt 2 成功；未改安全規則、延長上限、重跑 prepare 或 deploy，原始取消 job 與後續成功 artifact 分開記錄。

## 仍需驗收

此輪證明這兩份固定版本、同格式 IndexedDB pattern、所列公開操作與正式站切換相容性。沒有執行公司模型、私有 dialect verifier、公司 runtime 或數值等價性，也不代表所有資料格式能向下遷移。兩個既有 core／1.25 GiB browser 關卡只因相依 fingerprint 完全相同才沿用，未重跑；正式 prepare 仍驗證其原始 GitHub 憑證。固定實體硬體 SLA、其他瀏覽器、數小時負載、硬崩潰／儲存回收、新手／鍵盤流程等仍列 [商品等級工作](product-readiness.md)。

內網可持續選用後續公開核心，依 [內網更新與回退](intranet-release.md) 保留私有 profile／adapter、重新建置和公司驗收。公司來源及模型不必離開內網；這輪僅更新 GitHub。
