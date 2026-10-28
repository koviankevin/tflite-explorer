# 發布驗收與回退基礎

現有 `scripts/publish-github-pages.mjs` 先執行線上關卡、固定來源與伺服器設定檢查，再 dispatch 受控 Pages 工作流程；不再直接推送 gh-pages。不接受自行提供的 passed JSON。一般建置與公司內網封裝仍不需連外；這個關卡只適用於公開 GitHub 發布。

```powershell
$env:GH_BIN = 'C:\tools\gh.exe' # 已登入的 GitHub CLI；在 PATH 時不用設定
node scripts/build.mjs
node scripts/verify-release-gates.mjs dist build/qa/new-gate-receipt.json
node scripts/publish-github-pages.mjs --site-id <成功準備並審閱的64位site-ID>
```

`release-evidence.json` 只選擇四個 GitHub run ID，不是通過憑證。必須是同一 repository、main、workflow_dispatch、指定工作流程與必要 job 全部成功，且 artifact 未過期、名稱對應本次 attempt、GitHub SHA-256 digest 相符。ZIP 只允許一個有限大小的 JSON，不解壓或執行其中程式。網路、Git 歷史、API 權限或 artifact 缺少時停止，不退回信任本機報告。讀取 GitHub 僅需 repository/Actions read；不額外擴大登入憑證權限。四項關卡與整站發布均已在 main 的受控流程；驗證過的版本隔離範圍見 [版本隔離](versioned-site.md)，現行正式版本以 [README](../README.md) 為準。

四項必要證據：

1. `performance.yml`：重新判定九筆核心效能、固定 policy 與 clean source。
2. `browser-lifecycle.yml`：重新判定八輪生命週期、真實 Worker 終止、Blob URL、read audit 與 clean source。
3. `release-contract.yml`：建置／public/internal 封裝、來源與完整性，以及關卡拒絕案例。測試必須實際執行、零失敗／略過／取消，來源期間不變。
4. `production-smoke.yml` 的 `site-upgrade`：隔離站台的版本切換、舊分頁延遲載入、已存 pattern、子模型重開與完整 Worker 關閉；原始報告由 policy 重新判定，且同一 job 要通過完整快照的 HTTP 與瀏覽器 smoke。

每個關卡比較候選 commit 與受測 commit 的相關 Git blobs。核心效能使用 runner/測試入口及相對 module imports、metadata、policy、workflow、package/lock；瀏覽器另外涵蓋完整 src/vendor 與建置入口；封裝契約保守涵蓋 scripts/test/src/vendor。Package 與 lock 的版本標籤不影響未變動的執行程式，其餘欄位（含 scripts 與依賴）仍需一致。改動相依檔案就需要對應關卡的新 run，不能用較早綠燈替代。這是針對既有 ESM 與版本控管依賴的明確範圍；日後新增 computed imports、外部測試資料或新的載入方式，須一起擴充 scope 和拒絕案例，不能假設能自動推導所有 JavaScript 行為。

候選需來自目前已提交的 clean checkout，逐檔完整性、公用類型及來源需符合；還會在新的隔離目錄重新建置，對照全部 manifest，防止只改產物與自製 manifest 就冒充受測來源。Git 歷史不足時先取得受測 commit；不得把 source 檢查改成只比版本號。收據保存在指定的新檔案，包含 run、artifact digest、report SHA 與逐檔 scope；再次發布仍會重新詢問 GitHub，不使用舊收據略過檢查。

## 回退演練

```powershell
node scripts/drill-release-rollback.mjs previous.zip candidate.zip build/qa/new-rollback-report.json
```

工具只在本機 `build/qa/rollback-*` 建立隔離站台，保留演練輸出與原始 ZIP，不修改正式站。檢查 ZIP 路徑、CRC、大小／檔案數、symlink、public 類型與 manifest；每個版本維持獨立不可混用的檔案目錄。HTTP 入口指向版本 URL，切換使用寫入／rename 的指標。驗證舊版 → 新版 → 舊版的全部 HTTP 逐檔 SHA，另驗證修改候選會被拒絕、舊版指標保留，以及升級後舊版 lazy import URL 仍能取得原檔。

這是靜態交付／版本路由的回退演練，不代表 GitHub 正式站已切換回舊版，也不證明 IndexedDB 或工作階段格式可反向遷移。公司內網仍須按自己的 server 設定部署版本目錄與路由，並在更新前匯出使用者資料。

## 伺服器強制邊界與後續

GitHub Pages 已切換為 workflow，github-pages environment 只允許 main；main 的必要檢查限定 GitHub Actions App 並包含管理者。實際負例已確認未受測的 main 推送遭拒、舊 gh-pages 分支更新不再部署、版本不符時 deploy 與 release 不執行。流程見 [受控發布](pages-deployment.md)，實際狀態及尚待完成的正式交付見 [伺服器驗收](pages-deployment-verification.md)。管理者仍可明確修改 repository 規則，不能宣稱完全無法繞過管理權限。已完成的正式站回退、升級時舊分頁與版本資產隔離範圍見 [正式切換驗收](production-transition-verification.md)；任意使用者資料格式升降級及公司內網實際切換仍需驗收，商品等級目標尚未完成。
