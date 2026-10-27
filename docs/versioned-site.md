# 固定版本靜態站台（開發中）

此功能尚未接入 GitHub 正式發布工作流程。正式站目前仍是已驗收的 preview.7／build `163f38ab1dc856e4`；下述工具用於建立新的獨立候選目錄，不代表正式站已取得版本隔離或已完成回退驗收。

## 已確認的問題

用已發布 preview.6 ZIP 的 SHA-256 核對來源，再請求正式站帶 preview.6 `?v=` 的 app、MLIR engine、TFLite parser 三個檔案，三者全部回傳 preview.7 的 bytes。Query 標記可以分開快取鍵，但沒有讓靜態 server 保存舊檔案。[原始負例](results/site-legacy-query-negative-2026-10-27.json) 保留觀察時間、兩份 release metadata 及三組來源／回應 SHA。

## 共同介面與目錄

`scripts/lib/versioned-site.mjs` 提供 `composeSite()` 和 `verifySite()`。輸入是現有的單一版本部署目錄，保留原本 build／ZIP／manifest 格式。輸出為完整的新站台快照：

```text
index.html                       現行版本的 HTML，加上固定版本的 base
site-manifest.json               真正的現行版本、保留版本與全站檔案 SHA
src/, vendor/, release.json, ... 原有根路徑的固定 baseline，供已開啟舊頁面使用
versions/<build-id>/             每個完整版本各自的原始檔案與 release-manifest.json
```

根入口的 `<base href="./versions/<build-id>/">` 讓 scripts、styles、示範檔與相對 URL 使用相同版本。Parser／Worker 以 `import.meta.url` 載入的相依檔也留在該版本目錄。原本 root baseline 不隨現行版本切換；它的版本資訊與原有 modules 仍一致。**組裝後的根 `release.json`／`release-manifest.json` 描述 baseline，讀取現行版本必須使用 `site-manifest.json.current`，不能把 baseline 當成現行版。**

原有 HTML 已使用 `base-uri 'self'`。內網 server 若另送 CSP header，也需允許同來源的 base；部署前的真實瀏覽器驗收必須確認 `document.baseURI` 和實際 module／Worker URL，不能只憑靜態檔案雜湊判定成功。

預設最多三個近期版本（現行版加兩個 retained），另永久保留一份 root baseline。Baseline 不在近期清單時仍保留其 namespace 與根路徑副本。總計最多四個 namespaces 加根路徑副本，整站 512 MiB、4096 個檔案；組裝前先按 manifest 預算檢查，超量即拒絕，不偷偷丟棄版本。需要更舊的 namespace 時須先明確保留；未保留版本的 URL 不會改指到另一版。

這能保護採用新目錄的版本，以及遷移時明確指定的既有 baseline。不能復原在修正前就已被覆蓋的更舊 query URL；首次切換必須以當時實際正式版本作 baseline。

## 本機與內網操作

先取得並核對固定版本 ZIP 和 SHA-256，分別解壓到獨立目錄。公開範例：

```powershell
node scripts/compose-site.mjs --current build/releases-extracted/new --legacy build/releases-extracted/original-root --retain build/releases-extracted/previous --out build/new-site
node scripts/compose-site.mjs --verify build/new-site
```

第一次建立站台沒有舊版時可省略 `--legacy`／`--retain`，以 current 建立 baseline；日後升級須沿用同一份 baseline。只要使用 `--retain`，CLI 就要求明確 `--legacy`，避免不小心替換原有根路徑。`--out` 只接受專案 dist、build 或 test-results 範圍的全新目錄；不覆寫既有站台或來源。

公司建置使用相同介面，加上 `--internal`。所有輸入必須屬於同一發行類型；公開模式一律拒絕 internal／private dialect，內網資料留在內網，不上傳 GitHub。CLI 只讀寫本機靜態檔案，不載入模型或執行輸入中的 JavaScript。

切換前需獨立核對快照，再由部署系統整份啟用。回退也應以舊核心作 current、仍保留新版 namespace，不能只把根入口指回舊版卻刪掉新版資產。此工具不改 IndexedDB、工作階段或 pattern 格式；靜態檔案一致性不能代替瀏覽器資料遷移驗收。

## 驗證與尚待接入

八項本機測試覆蓋實際靜態 HTTP 升級／回退、根路徑與 namespaced lazy assets、原有版本資訊、竄改檔案、重算外層 manifest 仍無法替換內層版本、私有擴充、混用發行類型、build ID 衝突、容量預算、既有輸出／來源保護、符號連結與實際 CLI。測試加入必要 release-contract；不把它列為模型功能變更重跑整套 runtime。

另以實際 preview.7 部署 ZIP（SHA `4a7db3bcf310d7253c1d103cf86292323c32441b7471e84c035917a66b0702f7`）及 clean source `92a08519264022fc4fc6ce3e50abd2dc458a3c9a` 的開發候選，完成 [真實部署包本機演練](results/site-real-artifacts-local-2026-10-27.json)。升級與回退各組成一份含 741 個受管理檔案的快照；所有檔案經 `verifySite` 核對，七次實際 HTTP parser 請求維持 root baseline 與兩個 namespace 各自的原始 bytes。候選只是本機驗收建置，沒有建立或覆寫另一個 preview.7 Release。

## 真實瀏覽器情境與發布關卡

[隔離 CI 40451936799](https://github.com/koviankevin/tflite-explorer/actions/runs/40451936799) 已在乾淨分支 `d51f644aba83d26032a7df0b84badf40af3de69f` 通過六項情境，見 [原始瀏覽器報告](results/site-browser-2026-10-27.json)。它使用真正的 preview.7 ZIP 和新建置，在同一 origin／repository 子路徑下保留原有 root tab、namespaced 舊 tab 與 candidate tab：

- 原有 root tab 先開 TFLite、以原生選檔匯入 pattern，並寫入真實 IndexedDB。
- 切換到新快照後，兩種舊 tab 才首次開 MLIR；五個 OP 與 custom `acme.split` 搜尋成功，版本視窗仍是舊版本。
- 新 tab 的 `document.baseURI`、module 與 Worker 路徑指向 candidate，並可讀到原本儲存的 pattern。
- 回退後，仍開著的 candidate tab 才首次開 TFLite；仍使用自己的 namespace，32px pattern 搜尋為四筆，實際下載子模型、原生重開為三個 OP／一筆匹配，pattern JSON 匯出仍等同原內容。
- 回退後新開 tab 使用舊版本，原 pattern 仍為四筆匹配。

原始報告包含三份真實快照、508 筆唯讀同來源請求與七個已終止的模型 Worker。另新增獨立 policy 重新判定版本／相位／lazy parser 請求與完整關閉，不接受只有 passed 標籤、缺少情境或錯誤 namespace。新增正反例後，本機完整發布契約為 32 項、零失敗／略過。

同一既有 `production-smoke.yml` 提供 `scenario=versioned` 的唯讀隔離測試入口。新增的第四項 `site` 發布關卡只接受 main 的成功 workflow_dispatch、正確 site-upgrade job、當次 artifact digest、原始 policy 判定及相依 scope；上列分支成功報告可驗證行為，但不能充當正式 main 發布憑證。舊版已交付的三關卡 receipt 保持原樣，新候選缺少第四項時會拒絕準備／提升。

下一步仍須完成：GitHub 工作流程的可信舊版資產取得、整站 manifest／site ID 綁定、完整正式發布整合、main 的新版憑證，以及正式站實測。完成前不宣稱已解決正式站舊分頁／CDN 相容性，完整商品等級工作仍維持未完成。

技術依據：[module 的相對 URL](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta)、[HTTP 快取](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)、[GitHub Pages 站台容量限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。512 MiB 是這個工具採用的本機預算，並非 GitHub 的容量上限。
