# 公開核心更新與內網部署

公開核心與公司 dialect 分開管理。公司資料不放進公開 repository；不再修改 `src/mlir-dialect-registry.js` 接入私有程式。這是受信任的本機建置擴充，不接受模型內 JavaScript 或遠端 adapter URL。

已部署的內網版可以持續跟進公開核心的改善，不需要搬回外網。內網不會自動下載或套用正式網站的新程式；每次由公司選定固定版本，完成內部驗收後才切換。

目前固定公開版為 [preview.29](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.29)／build `ad6db9bb06620139`，來源 `42e0771e49891becfd68ace7cea2d444ca989c51`；[正式交付](model-runtime-workspace.md#preview29-正式交付)核對正式站與四份下載。公司擴充固定 `v0.2.0-preview.29` 後使用公司 profile 建置；公開 ZIP 不直接覆蓋公司修改，內網驗收依使用者指示自行處理。

- 原樣部署公開版：取新的固定版本 ZIP 與 checksum，照下方升級流程部署。
- 有獨立 profile／dialect adapter：更新公開核心 checkout，沿用內部 repository 的 profile 重新建置，保留私有擴充版本與指紋紀錄。
- 已直接修改核心：先保留目前內網來源 commit 和差異，將公開版本合併到公司分支、處理衝突；不能拿公開 ZIP 直接蓋過私有修改。可逐步把適合的 dialect 邏輯移到 adapter，以減少後續合併成本。

Adapter 介面版本檢查可以阻止已知不相容的建置，但不能保證公司 dialect 的所有語意仍正確。公開功能修正、搜尋／繪圖效能與匯出改善仍須用內部實際模型和 compiler／runtime 驗收；這些資料和執行結果不需上傳公開 GitHub。

## 公開版部署包

建置本身使用 Node.js 22 以上及 Git checkout，不依賴 npm 套件或網際網路。原始碼 ZIP 沒有 Git metadata，應改用 Git checkout，或直接取已建好的部署 ZIP。測試另外需要專案 dev dependencies；ZIP 驗收使用 Python 3 的標準 `zipfile`。

```powershell
node scripts/build.mjs
node scripts/verify-release.mjs dist
node scripts/package-release.mjs dist
```

`build/releases/` 產生帶版本及 build ID 的 `.zip` 和 `.sha256`。它包含完整靜態網站、公開示範、授權、`release.json` 與逐檔 SHA-256 的 `release-manifest.json`。ZIP 不需 Node.js 即可部署到靜態 HTTP／HTTPS server；不能直接用 `file://` 開啟 module Worker。內網 server 必須正確提供 JavaScript／JSON MIME types。

固定核心 ZIP 與 Pages 完整版本隔離快照是不同產物。內網原樣部署請取 Release ZIP；有私有擴充則使用自己的建置包。公開 Pages 根目錄刻意保留舊版 lazy-load 檔案及其 `release.json`，現行版本以版本視窗及 `site-manifest.json.current` 為準，不能只拿根 metadata 判斷或混貼新舊檔案。Pattern／草稿也不會跨公開站與內網 origin 自動同步，換環境先匯出 JSON。

SHA-256 用於傳輸與檔案完整性核對，不等於數位簽章或公司 runtime 語意驗證。來源狀態若有未提交修改，版本視窗會明示；公開發布要求已提交來源並重新建置。

## 公司 dialect 設定

在另一個內部 repository 保存 `profile.json`，以及 `dialects/index.js`、`dialects/company.js`。

```json
{
  "schemaVersion": 1,
  "distribution": "internal",
  "name": "公司內網",
  "extensionVersion": "1.0.0",
  "adapterInterfaceVersion": 1,
  "dialectDirectory": "./dialects"
}
```

`dialects/index.js`：

```js
import {company} from './company.js';
export const mlirDialects = [company];
```

`company.js` 使用 [dialect 介面](mlir-adapters.md) 的 `describeOperation`／`operationSemantics`，可加 `interfaceVersion: 1`。相對 `.js` imports 隨 build ID 更新。Adapter 必須適用於瀏覽器 Worker；Node.js／npm bare imports 不會由此工具打包。模型、權重、認證資料不得放在 dialect 目錄；只接受 JS、JSON、說明及授權檔，單檔 16 MiB、總計 32 MiB，拒絕 symlinks。

```powershell
node scripts/build.mjs --profile C:\company-model-lens\profile.json --out build/internal
node scripts/verify-release.mjs build/internal
node scripts/package-release.mjs build/internal
```

內網產物帶有 `internal` 類型、擴充版本、介面版本和擴充來源指紋。公開發布工具一律拒絕內網產物，無論資料夾名稱如何。私有 profile 與來源路徑不寫入版本資訊；擴充程式本身會包含在內網 ZIP，應只在公司內傳遞。

## 後續升級與回退

1. 固定一個新的公開核心 commit，在測試 checkout 更新核心。保留公司獨立 repository 和同一份 profile，不覆蓋私有檔案。
2. 建置新的 `build/internal`，確認擴充版本／指紋符合預期。每次建置使用全新內容，舊輸出保留於 `build/previous/`，不把新舊靜態檔混在一起。
3. 在公司用實際模型執行開檔、搜尋、選取、匯出／重開及 compiler／runtime 驗收。通過公開測試不代表公司 dialect 已驗收。
4. 核對 ZIP 的 SHA-256，解壓到新的站台版本目錄；在有 Node／Git 工具的驗收 checkout 可再用 `verify-release.mjs` 核對解壓內容。確認後切換內網站台，重新整理頁面。
5. 保留上一個已驗收 ZIP、checksum 與測試紀錄；需要回退時切回上一個完整目錄。更新前先匯出工作階段與 pattern JSON，程式回退不等於資料格式能自動回退。

瀏覽器右上「版本」顯示安裝版本與來源 commit，可下載不含模型、權重和搜尋內容的版本 JSON。版本視窗只顯示部署資料；完整性檢查由 CLI 執行，不把它顯示成 runtime／模型驗證結果。

建置中繼資料與來源狀態記錄於 `build/events.jsonl`；失敗建置保留 staging，封裝失敗保留 `.partial`，不把它們當成可部署版本。確認成功產物與重現來源都在後，才清理指定的 staging／previous 項目；建置不自動刪除舊版。
