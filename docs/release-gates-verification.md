# 發布關卡與隔離回退驗收（2026-10-27）

本輪修改發布工具與測試，沒有更動網站 src/vendor 或重新部署正式站。現有正式版仍是 `0.2.0-preview.6`／build `0f8361cc44fcd547`。下述新來源 build 只是公開產物候選，用於驗證關卡，不是另一份覆蓋同 tag 的 GitHub Release。

## 關卡證據

完整正例以 clean commit `dfbb2e1667fba6d20c7a91fc101d5657107a9ff8`、tree `c3b9f7405a91f11dbc256850b9a7ab3e6940af89` 建置候選 `7d95754588e0d7a0`。從 GitHub 即時取得 workflow、job、artifact metadata 與 archive；所有 archive 均完整下載並符合服務端 SHA-256 digest，JSON 重新判定，而非直接信任報告的 passed 標籤。

| 必要關卡 | 實際成功 run／受測來源 | 沿用依據 |
| --- | --- | --- |
| 核心效能 | [40433340886](https://github.com/koviankevin/tflite-explorer/actions/runs/40433340886)，`0a66a6343e6dea76a0638838a8d9404f527875fc` | 九筆固定量測重新成功；85 個受測入口、import dependencies、metadata、policy、workflow、package/lock fingerprint 與候選相同 |
| 實體瀏覽器 | [40429421681](https://github.com/koviankevin/tflite-explorer/actions/runs/40429421681)，`eb0a330865fd5d6cbf01cff9109ee5ff9f94ae61` | 沿用前輪八輪實體檔驗收；255 個相關來源 fingerprint 相同，重新核對資源終止、讀取預算與實體檔案證據；沒有再跑九分鐘 |
| 發布契約 | [40433890908](https://github.com/koviankevin/tflite-explorer/actions/runs/40433890908)，`dfbb2e1667fba6d20c7a91fc101d5657107a9ff8` | 最新來源 12 項實際執行、12 passed、零略過／取消／失敗，期間來源不變；329 個契約相關檔案 fingerprint |

較早核心 run `40426428095` 因 package script 已改動，scope 比對拒絕沿用，故本輪只補跑核心。發布契約在新增原始 read audit／實體配置缺值拒絕案例後分別補測，最終憑證以上表最新 run 為準；較早 run `40433337208`、`40433627041` 不冒充最新程式結果。

- [完整關卡收據](results/release-gates-2026-10-27.json) 含三組逐檔 scope、run、artifact ID/digest 與 report SHA，候選 manifest 可重建 fingerprint 為 `155e5fccd740f966559e832754ec4e44e5ad2dbf19cdf4aac6181c0ebc6fdc17`。
- [核心原始報告](results/release-core-2026-10-27.json) SHA `f1848a104ae5afd170309aff1d8ceaedf6201b7814c5343310f7acbd21bce3b7`；[發布契約原始報告](results/release-contract-2026-10-27.json) SHA `1fbc149bd55e41e2dc66f1dd18c4897282cc0c608cbe688e9aa7be3236389408`。兩者與關卡實際下載的 report SHA 相同。
- 本機六項關卡測試覆蓋未完成／失敗／PR／外部 repo／不同 attempt、略過及重複 job、缺少／過期／超量 artifact、錯誤 archive digest、路徑／多檔 archive、僅有 passed、缺少記憶體／實體 read 證據、受測 import 改動與 contract 零執行／略過等拒絕案例。CI 再執行六項封裝相關測試，共 12 項。
- [實際產物負例](results/release-tamper-negative-2026-10-27.json)：修改候選 app.js 並重算 manifest，讓原本的逐檔 verifyArtifact 能成功；新的關卡仍因與 fresh build 不符，在任何 GitHub 網路請求前拒絕。沒有降低 integrity 規則或跳過來源重建。

證據索引提交後，另在 clean `b60185a0481b3e609b83c489267c5ca6ee941b98` 執行真正的 `verify-release-gates.mjs` CLI，使用預設 `release-evidence.json`，候選 build `115d8e5ae29de6f3`，三項關卡均依相同 scope 成功沿用；見 [CLI 收據](results/release-gates-cli-2026-10-27.json)。此後收尾只記錄該收據與說明，scripts/test/src/vendor/workflow 未改，沿用此結果。最後唯讀核對 Pages 仍為 legacy／gh-pages，部署環境也只允許 gh-pages，伺服器端入口尚待下一階段遷移。

## 回退演練

使用已交付的 preview.5 ZIP（29,453,921 bytes、SHA `1b6981ebd40ddd9f0c5c486b729309142bce57582dc7874ea0b11ac76ca33ef0`）及 preview.6 ZIP（29,453,947 bytes、SHA `82b358f03a6a18dea8d9e72fb445371d92f913c9ec67b4d2727baeb84f259193`）。演練工具實際受測來源為 `0a66a6343e6dea76a0638838a8d9404f527875fc`；後續僅改 gate validator、拒絕案例及證據選擇，該工具、HTTP server 與 artifact verifier 未改動，沿用成功演練。

本機隔離 HTTP 站完成：

1. 解壓前檢查 ZIP entry 路徑／數量／總大小／CRC／symlink，解壓後重新驗 public manifest。
2. preview.5 → preview.6 → preview.5，各 246 個 HTTP 檔案大小／SHA 全數符合原版清單。
3. 修改 preview.6 app.js 時拒絕啟用，原 preview.5 指標保持不變。
4. 升級後 preview.5 的版本 URL 仍取得原 app.js，避免仍開啟舊頁面的 lazy import 被新檔覆蓋。

[成功演練報告](results/release-rollback-2026-10-27.json) 已保留；首次受限執行環境的 localhost fetch 失敗也保留在 [失敗報告](results/release-rollback-restricted-2026-10-27.json)。改用可連線該自有 localhost 的執行環境後，同一程式、同一兩份 ZIP 通過，沒有換小案例。公開報告只移除本機暫存目錄，並記錄未遮罩本機原檔 SHA；原始檔及臨時版本目錄留於本機 build/qa 供追查。

## 邊界與後續

這一輪證明現有發布腳本會要求三個成功關卡，並驗證隔離交付／回退。GitHub Pages 的伺服器設定仍是 gh-pages 分支直接發布，管理者或其他工具仍可繞過腳本。後續必須將部署改為依賴關卡的受控 workflow，核對環境／分支規則，並完成正式站回退與瀏覽器資料遷移演練；尚未宣稱伺服器端強制門檻完成。模型與公司 dialect/runtime 驗收仍留在內網，商品等級目標維持未完成。
