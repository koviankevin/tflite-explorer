# 固定版本靜態站台（開發中）

完整快照的 prepare／HTTP 與瀏覽器驗證已合併 main，尚未部署。正式站目前仍是已驗收的 preview.7／build `163f38ab1dc856e4`；下述工具用於建立新的獨立候選目錄，不代表正式站已取得版本隔離或已完成回退驗收。

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

加入 policy 的 [重驗 40453158488](https://github.com/koviankevin/tflite-explorer/actions/runs/40453158488) 也已成功，來源 `99498c145c98465dd7f402d21b007f0e59876147`，見 [原始 policy 報告](results/site-browser-policy-2026-10-27.json)。六項情境、七個模型 Worker、508 筆請求與三份快照均通過重新判定。

## 舊核心資產的取得

`scripts/lib/release-history.mjs` 的 `fetchReleasedCore()` 只讀取固定公開 repository 的 GitHub Release。參考資料必須提供版本、build ID、source commit 和完整 core manifest SHA，也可加上已知 ZIP SHA／大小。它要求 bot 發行／上傳、正式 tag 指向同一 commit、Git tree 相符、唯一已上傳 ZIP 與服務端 digest；先用特定 asset ID 串流下載到全新目錄，再獨立核對檔案大小／SHA，才會檢查 CRC／路徑／容量並解壓。輸入中的 JavaScript 不執行，internal／private core 不接受。此 module 供公開站發布控制使用；公司內網仍使用本機 core／profile，不經此 GitHub 下載流程。

[實際下載核對](results/site-history-fetch-2026-10-27.json) 來自 clean source `a28b7dddb01d22665e235a66b68ee483eb251f56`：讀取 preview.7 的 Release `425024166`／asset `680389934`，29,454,029 bytes 的 ZIP SHA 為 `4a7db3bcf310d7253c1d103cf86292323c32441b7471e84c035917a66b0702f7`，manifest SHA 為 `856da197840ba33d498317d07e22b223c20bac0d84984b226a82cece189b4a54`，所有 246 個 core 檔案完整性通過。另有五項取得流程測試涵蓋 metadata 下載前拒絕、傳輸不符、ZIP traversal、私有發行、不同 manifest 與 Git tree。加上原有契約，本機共 37 項、零失敗／略過。

沒有已發行 tag／Release，或同一 bot／tag 的 Release 仍是 draft／缺少 ZIP 時，core 會回報 `UNRELEASED_CORE`。新增的 `fetchRetainedCore()` 只在此情況使用 `recoverPreparedCore()`：限定同一公開 repository、main 的手動 `verified-pages.yml`、同一 source commit、當次成功 prepare job 與唯一未過期 `release-delivery`。Artifact 的時間必須在該 attempt 的 prepare 期間；服務端 digest、下載 SHA／大小、四份資產、原有四關卡 receipt、live core manifest SHA、Git tree 與所有 ZIP payload 均重新核對。整個 workflow 即使在後續發布階段失敗，也只能供保留已上線 namespace，不能取代新版的四項成功發布關卡。Release／tag 來源驗證失敗或已上傳資產 digest 不符時不會改走恢復來源；draft／部分發行本身的資產也不被信任。Artifact 過期或備份缺失即拒絕新快照，保留原站台待處理，不猜測另一個版本。

`scripts/lib/site-history.mjs` 的 `preparePublicSnapshot()` 已串接唯讀正式站歷史讀取、獨立取得 core 和 composer。只有 `site-manifest.json` 的實際 HTTP 404 才允許首次遷移；此時根版本必須仍是已知 preview.7 baseline。其他 HTTP 錯誤、無效 metadata 或改過 baseline 均拒絕。之後以真正現行版本及最近的 retained 順序保留兩個先前版本，baseline 永久保留；composer 不再依 build ID 字母排序打亂近期順序。已上線版本恰好是同一個重建候選時，直接使用已驗證候選，不必等待它的 Release 完成。

本機 50 項發布契約已通過，之後另補一項 bot draft／部分發行的恢復正例，11 項 history 測試均通過。[CI 40456879636](https://github.com/koviankevin/tflite-explorer/actions/runs/40456879636) 的完整契約為 51 項、51 通過、零失敗／略過／取消，受測 PR merge source `3b1699bbf0d0ac49b3b1cef2c87d7f296ae0500d` 與 tree 均固定、全程 clean 且未改變，見 [原始報告](results/site-history-contract-2026-10-27.json)。涵蓋中斷發布恢復、錯誤來源／attempt／過期／竄改資產、歷史順序、重複準備／回退及 metadata 容量與路徑。這些是工具與契約驗收，尚不代表正式 Pages 工作流程已切換；PR CI 也不能替代正式 main dispatch 的發布憑證。

[真實歷史規劃演練](results/site-history-plan-2026-10-27.json) 來源為 clean `a79d5f3573fcde820e3c097a8c74a5b7dd9a28a7`：正式站 index 實際回應 404、根 release metadata 符合 preview.7，獨立下載的固定 ZIP／manifest／246 個檔案均核對後，組成含 741 個受管理檔案的本機快照。以該真實快照作下一輪現行 index 重複準備，site ID 維持 `3d8a1c0ce497a79eddfa9086c65973b45235644b984138da35e8cfaab6458184`；未取得候選尚不存在的 Release。開發候選 build `544a3fe021bad19a` 只供本機演練，沒有發布或覆寫 preview.7；正式站和內網均未更動。

## 發布流程接入（草稿已測，待正式交付）

草稿的 `prepare-pages-release.mjs` 在四關卡、來源重建與原有四份 core 資產核對後，取得歷史並組裝完整快照。Pages tar 改放完整站台；`release-delivery` 與 GitHub Release 仍只放原有 core ZIP、checksum、core manifest 及 gate receipt。`publish=true` 同時要求準備階段的 core build ID 和整站 site ID；build 相同而 retained／任一檔案不同時，也無法通過。`site_id` 與完整 `site_manifest_sha` 綁在 prepare 的可信輸出，HTTP／瀏覽器驗證不能用使用者輸入取代它們。

`scripts/lib/live-site.mjs` 以可信 SHA／site ID／core manifest 核對實際 `site-manifest.json`，讀取不帶 query 的真實根入口和全站清單，檢查大小、SHA 與 MIME。現行版本使用 namespace；根 release metadata 仍是 baseline。瀏覽器 smoke 也改讀現行 namespace 的示範檔、核對實際 `document.baseURI` 與三個模型 Worker 的版本／關閉。只有獨立手動 smoke 可以檢查尚未遷移的原站；正式發布有 expected site ID，缺少 index 時必須失敗。

隔離 `scenario=versioned` 另以同一新版 HTTP／瀏覽器驗證器檢查已組裝快照：先核對所有站台檔案，再做版本視窗、32px、搜尋定位、原生選檔、pattern JSON 匯入匯出及 TFLite 子模型下載重開。它只接受受控 Linux CI 和 `test-results` 下的公開完整快照，報告標示 `isolated-versioned-snapshot`；正式 deploy job 的 smoke 禁止這個本機目標。此流程不操作個人瀏覽器，不接觸公司模型。

整合來源 `520dc04d1ddab38908de25ad00de5e5efdbc7c4e` 的 [CI 40458488426](https://github.com/koviankevin/tflite-explorer/actions/runs/40458488426) 已通過六項跨版本情境，以及新版完整 HTTP／原生選檔 smoke。後者逐檔核對 741 個檔案，四項 UI 情境全通過，三個模型 Worker 均關閉；見 [切換原始報告](results/site-integration-browser-2026-10-27.json) 與 [完整 HTTP／smoke 原始報告](results/site-integration-http-smoke-2026-10-27.json)。同來源的 [正式站唯讀驗收 40458772476](https://github.com/koviankevin/tflite-explorer/actions/runs/40458772476) 也通過四項操作，仍顯示實際 preview.7／build `163f38ab1dc856e4`；[報告](results/site-integration-public-smoke-2026-10-27.json) 明確標示 `public-production`，不把隔離結果冒充正式站升級成功。

[契約 CI 40458476528](https://github.com/koviankevin/tflite-explorer/actions/runs/40458476528) 為 58 項、58 通過、零失敗／略過／取消；[原始報告](results/site-integration-contract-2026-10-27.json) 的 PR merge tree 與上述來源相同。後續另補固定版本提升／回退，最新本機十份契約為 64 項、64 通過、零失敗／略過／取消。新增負例包括 core 相同但 site ID 不同、可信輸出被替換、錯版根入口、現行 namespace payload／MIME 錯誤，以及正式驗證降級到 fixture 或原始 root。新的提升流程仍需新來源的 CI 與完整正式交付。

## 固定 Release 提升／回退

`fetchPublishedDelivery()` 只接受完整、已發行、由 bot 產生／上傳且 tag 固定來源的四份資產；逐份核對 provider digest，另核對 core manifest、來源 Git tree、ZIP CRC／所有 payload 與原始 gate receipt。輸出保留原始四份 bytes，不重新封裝或重寫歷史憑證。缺少、draft、部分發行或已失效的資產不能拿來提升；此路徑不使用供保留 namespace 的 CI recovery。

手動工作流程可用 `promote_version` 選擇固定已發布版本。控制程式本身仍須先通過目前四項來源綁定關卡，再取得舊 core 組裝新完整快照；prepare 輸出分開記錄 controller／core source 及 promotion mode。提升也要求乾跑的 build ID 和完整 site ID，套用相同 HTTP／瀏覽器正式驗收，但不執行會建立 Release 的 job。回退保留較新版 namespace；恢復新版也使用其原始 Release，不在已存在的版本號下重新建置另一份 core。

唯一舊三關卡例外限於 `release-baseline.mjs` 固定的 preview.7：只有明確的歷史提升模式，且來源、build、core manifest SHA、ZIP SHA 和原 receipt SHA 五項全部完全一致，才接受原有三關卡憑證。任一不同仍要求四關卡，新候選的預設驗證完全不放寬。例外不豁免目前控制程式的四關卡，也不代表已完成正式站回退或資料格式遷移。

## 防止 CDN 舊歷史遺漏保留版本

只驗 HTTP index 的自有 hash 仍不夠：CDN 可能回傳較早、但本身完整有效的 index，甚至現行 core 相同卻缺少後來保留的版本。新增 `deployment-history.mjs`，先向 GitHub 唯讀核對最新 github-pages deployment、成功 status 的固定 workflow job link、來源與確切 attempt，再從 `Publish site <完整 site ID>` job metadata 取得已部署 ID。HTTP index 必須完全符合，否則在取得歷史 core／組裝快照前停止，不會用舊歷史刪掉 namespace。

首次遷移只允許已獨立驗收的 deployment `7350054986`／run `40447776209`／job `122003141213`／preview.7 source；未綁定 ID 的其他 deploy 不作自動猜測。後續 Release 失敗仍可保留已成功部署的 ID；最新部署若待處理／失敗、run/job 被刪除或 metadata 不符，則需先釐清，不能把 HTTP 回應當作唯一依據。此檢查不需下載已過期的 Pages artifact；prepare 僅增加 `deployments: read`，沒有擴大正式寫入權限。

新增六項權威來源／stale CDN 測試，最新契約共 70 項。[CI 40461287910](https://github.com/koviankevin/tflite-explorer/actions/runs/40461287910) 全部通過，零失敗／略過／取消，受測 PR merge source `67a8ae38b9869b91f7b548f1da412625631c7508` 的 tree 與功能來源 `209a53d787832a87b4d4e7230ed271b0f7ed1806` 完全一致，見 [原始契約報告](results/site-authority-contract-2026-10-27.json)。

同來源的 [實際權威資料核對](results/site-deployment-authority-2026-10-27.json) 已從 GitHub 取得固定 deployment／成功 job／確切 attempt，並與正式站 index 404 及 preview.7 根 metadata 核對一致。另見 [實際固定 Release 提升來源演練](results/site-published-promotion-2026-10-27.json)：從 clean `78b0e3895031ef76723e35b5f435f80fd5779de9` 下載原始四份 assets、重驗 246 個 core 檔案與原三關卡 receipt；預設新候選模式拒絕此舊 receipt，只有五項固定 pins 全符且明確歷史模式才通過。兩個既有 main core／大檔瀏覽器關卡的 source scopes 仍完全相同，正式發布時仍須重新向 GitHub 驗證其原始憑證，不能只拿這份來源比較當作發布授權。

固定 Release helper 的 [隔離 CI 40459962581](https://github.com/koviankevin/tflite-explorer/actions/runs/40459962581) 也完成 [六項切換情境](results/site-promotion-browser-2026-10-27.json) 與 [741 檔 HTTP／四項原生 UI 驗收](results/site-promotion-http-smoke-2026-10-27.json)。此後的 authority 改動由 70 項契約及上述實際 API 核對驗收；正式發布仍需新 main 的 site／contract 憑證。所有演練均未切換正式站或公司內網。

## Main 關卡與正式切換觀察器

合併來源 `5eb92764d4512313c9fe995d0ed518328d803f1d` 的 [main 契約 40462048941](https://github.com/koviankevin/tflite-explorer/actions/runs/40462048941) 已通過 70 項、零失敗／略過／取消；[原始報告](results/site-main-contract-2026-10-27.json) 記錄精確來源與 tree。[main site 關卡 40462052121](https://github.com/koviankevin/tflite-explorer/actions/runs/40462052121) 也已通過 [六項切換情境](results/site-main-browser-2026-10-27.json) 及 [741 檔 HTTP／四項原生 UI 驗收](results/site-main-http-smoke-2026-10-27.json)。這是可驗來源的 main 證據，尚未切換正式站。

新增唯讀 `production-transition.yml` 與隔離 Linux CI observer，預計在真實 Pages 更新期間保留同一個 browser context：原有 root tab 就緒後才允許升級；候選 namespace tab 就緒後才允許回退；驗證舊 tab 在回退後的 lazy TFLite／32px／pattern／子模型重開後，才允許恢復新版。最後重新開啟新版，核對同一整站 ID 與既有 IndexedDB pattern，關閉六個模型 Worker 及 browser。Observer 不執行 deploy API，只請求本站 GET，模型只用固定公開範例。

`transition-control.mjs` 在同一 CI job 的 steps 間保留 Node/browser，使用來源／run／attempt 與 Linux process start time 核對存活；checkpoint 以原子 JSON 寫入，由官方 upload-artifact 提供可觀察階段。PID 消失或狀態 failed 會停止，不重啟或把舊檔當成活程序。Always cleanup 僅處理同一來源與 start time 的 CI process。它和 browser driver 都拒絕在一般本機環境執行，不操作個人瀏覽器；artifact 不含選入／匯出的模型檔。

此 observer 尚待實際正式切換執行；新增一項語法／CI 隔離拒絕契約後總數為 71。新的 workflow／driver 會使 contract scope 改變，因此合併後需新 main 契約；既有 site／core／大檔 browser 只在相依 scope 仍相同且 GitHub 原始憑證有效時重用。

下一步仍須完成：71 項 main 契約、憑證索引、準備產物與錯誤 site ID 負例，以及正式站升級／回退／恢復實測。完成前不宣稱已解決正式站舊分頁／CDN 相容性或正式發布恢復，完整商品等級工作仍維持未完成。

技術依據：[module 的相對 URL](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta)、[HTTP 快取](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)、[GitHub Release asset 的唯讀取得](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)、[GitHub Pages 站台容量限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。512 MiB 是這個工具採用的本機預算，並非 GitHub 的容量上限。
