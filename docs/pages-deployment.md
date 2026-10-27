# GitHub Pages 受控發布

此入口由 `.github/workflows/verified-pages.yml` 定義，僅接受 main 上的手動 dispatch。工作流程使用有效 YAML 的 JSON 語法，供結構契約與完整 YAML inventory 共同核對。所有其他 workflows 必須維持唯讀權限；正式寫入權限只分配給受控的部署及 Release jobs。

```text
prepare：固定來源 → 四項成功 CI → 來源重建／逐檔比對 → 固定 core ZIP／完整站台 Pages tar
  deploy：只提升該 tar
    verify_live：固定來源與 ZIP → 正式站全部檔案 SHA／MIME → 實際瀏覽器選檔、搜尋、pattern、子模型重開
      release：建立或核對不可覆寫的固定版本與四個下載資產
```

## 先準備，再發布

```sh
gh workflow run verified-pages.yml --ref main -f publish=false
# 檢查成功 prepare 的 build ID、site ID、來源及兩份 artifact。
gh workflow run verified-pages.yml --ref main -f publish=true -f expected_build_id=0123456789abcdef -f expected_site_id=<準備階段的64位site-ID>
```

第二個命令必須換成第一次成功準備的實際 build ID 與 64 位 site ID；範例值不能用於正式發布。若期間 main 移動，或保留版本／完整站台與審閱結果不同，就停止，不會悄悄發佈另一版。預設 `publish=false`，只會建置及保存 artifacts，deploy、verify_live、release 都不執行。此整站流程目前在草稿分支，正式站仍使用上次已交付版本；實際完成狀態見 [版本隔離](versioned-site.md)。

本機 `node scripts/publish-github-pages.mjs --site-id <準備階段的64位site-ID>` 先核對 dist 與目前 main、四項驗收及伺服器設定，再 dispatch 同一工作流程；不再建立或推送 gh-pages commit。它回報的是 dispatch，成功上線仍須看 deploy、verify_live 及 release 的實際結果。

## 啟用入口所需設定

- Pages `build_type` 為 `workflow`，不再由推送分支觸發部署。
- github-pages environment 僅允許 main branch；gh-pages 與 wildcard 不在部署允許清單。
- main 的必要檢查為 GitHub Actions 提供的 `release-contract` 及 `node-and-build`，來源 App ID `15368`，包含管理者，且合併前必須與 main 保持同步。無需新增人工 approving review。

`release-contract` 每個 PR 都有明確結果；依賴 scope 相同時報告 `not_required`、零個執行測試及實際相同 fingerprints。`node-and-build` 的計畫也會說明是否需要原本的 Node/build 檢查。文件／證據選擇與受 release-contract 涵蓋的發布工具不重跑未改動的模型測試；runtime、建置輸入、依賴或未知檔案仍保留完整 Node/build。公開發布只接受 main 的真正成功 dispatch 報告，不接受 PR 的 `not_required` 作為測試憑證。

上述是此入口必須具備的設定，不代表僅新增工作流程就已完成切換。切換及負例結果需另以實際 API／deployment 狀態和正式站雜湊驗收。管理者仍有權明確修改 repository 規則；這些規則用於防止日常發布繞過驗收，不宣稱能阻止管理者刻意改寫規則本身。

## 固定版本與交付物

正式站逐檔與瀏覽器操作成功後才建立 GitHub Release，包含部署 ZIP、checksum、release-manifest.json 及 release-gates.json。瀏覽器使用全新 CI context 與公開示範，確認正式子路徑的 module／版本資訊、32px 圖、精確搜尋定位、原生選檔、pattern JSON 匯入匯出、TFLite 子模型下載重開與原 pattern；HTTP 只允許本站 GET，沒有上傳模型。寫入 Release 的權限與 Pages 部署權限分開。ZIP 內只放網站、公開示範與授權；使用者模型與公司私有擴充不進 CI 或公開 artifact。

Release 證據集合移除每次查核時間及本機快照目錄，保留固定來源、run、artifact digest 與 scope，使同一來源重試時四份資產位元組一致；實際查核時間保留在工作流程 log。既有 tag 若指向不同 source，或任何下載資產的大小／SHA 不符，都會拒絕，沒有覆寫舊版本的 fallback。

工作流程的 Pages artifact 保留七天、交付／驗收 artifact 保留三十天；成功的 GitHub Release 下載檔另行保留。過期或未完成的 CI 證據不能用本機 passed JSON 替代。若正式站逐檔核對失敗，Release 不會建立；目前尚無自動回退，應依實際原因修復或使用已驗收版本處理。此入口也不代表瀏覽器資料可反向遷移。

公司內網仍依 [內網升級流程](intranet-release.md) 保留私有 dialect 設定後重新建置；一般建置／封裝不需連到 GitHub。此流程只管理公開 GitHub 正式站，不同步 Sites。

實際伺服器切換、發布負例與正式瀏覽器發現的問題，記錄於 [驗收說明](pages-deployment-verification.md)；以該次實際狀態區分已驗證與尚待完成。
