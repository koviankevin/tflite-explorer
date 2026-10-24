# 2026-10-24 大型瀏覽器驗收整合

## 基準與衝突

- 原 PR #1 head：`7ec6fef905688eb3b3022f43c9f8778fea89ec2e`；原始基準：`6fbe65cd5ecd53f6a358d81cebf76fecdcffb647`。
- 本次整合 main：`ec31522720ed184f29bb6c955bcf5793a31bc587`，比原始基準多 35 個提交（包含任務建立後新增的 resize／mobile index commit）。
- GitHub 回報 `mergeable=false`、`mergeable_state=dirty`。本機三方合併重現兩個實際衝突：`test/browser/README.md` 的 add/add，以及 `test/make-large-fixture.mjs` 的內容衝突。README 主檔雖可自動合併，仍需釐清歷史測試基準與產生器規格。
- 保留 main 的 operator label bounds 操作說明及資料產生器 CLI 單子圖／21,001 operators 預設。瀏覽器驗收明確指定雙子圖／6,002 operators。未改動 main 的 `src/`、`vendor/` 或建置程式；MLIR、pattern 投影、圖形瀏覽、resize 與版本化模組原樣保留。
- 新版建置會加入 `?v=...`，測試改以 `**/src/model-worker.js*` 攔截 Worker，以 URL pathname 找取消中的 Worker，保留原生 File API 及真正的 Worker 終止驗證。

## 本機執行證據

`test/browser/results/2026-10-24-chromium.json` 記錄本機整合快照，**不是 GitHub CI**。報告的 `sourceCommit` 是本機快照 `57d6948e7d4897e854d75310ad2f0cace07e32a1`；受測 tree `987d67b3782da29e7b727fbe843808129d7a8ba0`，遠端 main 基準另記於 `integrationBaseCommit`。之後只新增報告及說明文字，未改變受測程式。

| 項目 | 實際結果 |
| --- | --- |
| 環境 | Ubuntu 24.04.3 x64、Linux 6.18.55、Node.js 24.22.1、Playwright 1.56.1、headless Chromium 141.0.7390.37 |
| 資源 | cgroup 上限 8 GiB、CPU 配額 8 核；開始可用記憶體 4,823,232,512 bytes；暫存磁碟 28,869,959,680 bytes |
| Node.js | `npm test`：234 項，199 通過、0 失敗、35 條件式跳過（未設定 `MLIR_OPT`／`MLIR_EXPORTED_FILE` 的獨立編譯器驗證） |
| 建置 | `npm run build` 成功，release `266e37f178714fa4` |
| 實際 File | 1,343,235,364 bytes，雙子圖／6,002 operators，稀疏零權重 |
| 瀏覽器 | 11 組檢查通過：大檔原生選檔與索引、局部圖、跨子圖 pattern／分頁、lazy tensor metadata、子模型下載、取消與 Worker close、無效大檔、同頁恢復、子模型重開、MLIR 切換煙霧測試、讀取／心跳／錯誤／記憶體 |
| 初次選檔到清單 | 294.36 ms；Worker 解析與索引 130.70 ms |
| 錯誤後重新載入 | 278.63 ms |
| 原生大檔讀取 | 1,189,156 bytes／19 次／最大單次 64 KiB，與 range-reader 統計一致 |
| 記憶體 | Chromium 程序樹 RSS 440,553,472 → 609,476,608 bytes，增量 168,923,136 bytes；主頁 heap 峰值 5,757,972 bytes |
| 頁面心跳 | 50 ms 取樣，最大間隔 109.60 ms；未見 crash、pageerror、Worker error 或上傳 |
| CLI 預設交叉檢查 | 21,001 operators／1,345,874,636 bytes；Node inspect 讀取 3,828,428 bytes／59 次，解析與索引 468.38 ms；7,000 個 reshape-transpose-reshape 匹配 |

瀏覽器安裝曾因主要下載站回傳非 ZIP 而失敗；Playwright 自動改用官方 Microsoft 下載站後成功。首次啟動也因尚未安裝瀏覽器失敗，之後完成安裝並重新執行取得上述結果。沒有將這些環境失敗隱藏成通過。

## GitHub 驗證策略與未驗證部分

- 新增一般 `pull_request` workflow，只跑 `npm ci`、`npm test` 與建置，不建立巨型檔，也不部署。
- 獨立大型 workflow 維持僅 `workflow_dispatch`，沒有 Pages 寫入權限；每次保存成功或失敗 JSON artifact 14 天。先確認 PR 驗證成功，再合併並手動啟動。
- 本段撰寫時 GitHub 的新 PR 驗證及大型手動執行尚未完成；真正的 run／artifact 以後續 PR 記錄為準，不能把本機結果當成 CI 成功。
- 合成零權重不等於真實使用者模型；沒有冷磁碟吞吐量、長時間洩漏率、Firefox／WebKit 大檔驗證。
- 讀取觀察器在單次 >1 MiB／每 realm 累計 >8 MiB 時先拒絕；未放行巨型完整配置。取消透過 metadata 暫停點穩定重現，不代表量測同步解析最長取消延遲。
- RSS 為 100 ms 取樣的程序樹加總，可能重複計算共享頁或漏掉短尖峰。受管主機仍有 Chromium 協定關閉後程序回收超過 5 秒的限制，已保存於 JSON。
- MLIR 僅新增小型格式切換／搜尋／圖形煙霧測試；不宣稱完整 MLIR 瀏覽器驗收或獨立 `mlir-opt` 已通過。

## GitHub 首次執行與環境修正

- PR #1 驗證 run [40081360354](https://github.com/koviankevin/tflite-explorer/actions/runs/40081360354) 已成功：Ubuntu 26.04.1、Node.js 22.23.3；199 通過、0 失敗、35 跳過，建置 release `266e37f178714fa4`。
- PR #1 已合併，main 為 `efec09502f7bd0c5318d7cc29db20f45ba960c17`。
- 手動大檔 run [40081492570](https://github.com/koviankevin/tflite-explorer/actions/runs/40081492570) **失敗於環境安裝**：`npx playwright install --with-deps chromium` 明確回報 `Playwright does not support chromium on ubuntu26.04-x64`。驗收步驟未執行，沒有測試 JSON；artifact 上傳亦因此失敗。
- 失敗訊息已直接定位 OS／固定 Playwright 相容性；不對產品程式碼做猜測性修改，也不需要效能壓測或額外 instrumentation。唯一環境變更為獨立大型工作由 `ubuntu-latest` 固定至已在本機驗證的 `ubuntu-24.04`；PR Node 工作與 Pages 保持原樣。
- 修正後仍須新開手動 run；重跑舊 run 會沿用舊 workflow，不能驗證這項修改。測試結果以新的 run 狀態與 artifact 為準。

## GitHub 最終實測（與本機分開）

- runner 修正 PR [#2](https://github.com/koviankevin/tflite-explorer/pull/2) 的 Node／build 驗證 [40081631217](https://github.com/koviankevin/tflite-explorer/actions/runs/40081631217) 已成功並合併。
- main 新手動 run [40081739220](https://github.com/koviankevin/tflite-explorer/actions/runs/40081739220) **成功**，受測提交 `4c78ce9bb6468cd3f79a2ba77815e613d0737e72`，tree `bdaca2894d9efd45b26597d3aab3bc5ba008567c`；報告 `sourceKind=github-actions`、`sourceDirty=false`。這是獨立 CI 證據，取代上文撰寫時的待驗證狀態。
- 環境：Ubuntu 24.04.5 x64、Linux 6.17.0-1022-azure、Node.js 22.23.3、Playwright 1.56.1、headless Chromium 141.0.7390.37，4 CPU；開始可用記憶體 15,448,567,808 bytes、暫存磁碟 90,842,185,728 bytes。
- **11 組驗收全部通過**，實際原生 File 為 1,343,235,364 bytes；範圍與上文本機驗收一致，含取消／Worker 終止、無效檔恢復、子模型重開及小型 MLIR 搜尋／繪圖。
- 首次選檔至清單 **331.05 ms**、Worker 解析／索引 **121.30 ms**、恢復 **234.02 ms**。每次大檔載入原生讀取 **1,189,156 bytes／19 次／最大 64 KiB**。
- Chromium RSS 100 ms 取樣 **511,660,032 → 672,591,872 bytes**，增加 **160,931,840 bytes**，低於 768 MiB 門檻；無 crash、pageerror、Worker error 或上傳。
- Artifact `large-file-chromium-report` **12555132633** 已上傳，ZIP SHA-256 `83e5e03ff43bd15a9106d0c114cedd85e4917a89214c7fa11b2911038d9e25e7`；14 天保留，預定 2026-11-07 17:23（台北）到期。下載後已核對 SHA-256、JSON status／受測 SHA，並把原始 JSON 保存於 `test/browser/results/2026-10-24-github-chromium.json`，不受 Actions artifact 到期影響。
- GitHub 報告同樣記錄 Chromium 協定關閉後程序回收超過 5 秒；報告沿用舊字串中的 `host process wrapper` 歸因，**CI 上的真正原因尚未獨立確認**，僅視為 driver 清理限制。11 組 UI／讀取檢查已先完成；不以此宣稱清理完全無問題。真實模型、非 Chromium 大檔、完整 MLIR 瀏覽器與獨立編譯器驗證仍未完成。
- 此次最後提交僅保存 CI 原始 JSON 與更新文件；沒有修改已通過驗證的產品／測試程式或部署流程。
