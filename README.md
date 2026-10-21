# 模鏡｜TFLite 模型探索

**Model Lens** — 看清結構，找到連接。

[開啟模鏡網站](https://koviankevin.github.io/tflite-explorer/)

以 Netron 的 TFLite 解析器、模型圖及詳細資料面板為基礎，加入繁體中文搜尋工作區。模型全程由瀏覽器本機處理，沒有模型上傳端點、遠端模型 URL 載入或使用遙測。

## 使用與開發

需要 Node.js 22 或更新版本；不需安裝 npm 套件。

```powershell
node --test test/model.test.mjs test/hydrate.test.mjs test/subgraph.test.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

開啟伺服器輸出的本機網址。正式部署只需要 `dist/` 的靜態檔案。不能直接以 `file://` 開啟，因為使用 JavaScript modules 和 Web Workers。

## GitHub Pages

原始碼保留在 `main`，網站靜態產物發布至 `gh-pages`。設定 GitHub Pages 的來源為 `gh-pages` 分支根目錄；`.nojekyll` 會保留所有靜態資源。專案網址的子路徑也能使用，程式不依賴網域根路徑。

```powershell
node scripts/build.mjs
node scripts/publish-github-pages.mjs
```

發布腳本使用已設定的 GitHub `origin` 和 Git 認證，不修改來源工作樹，也不使用 force push。需要先將來源推送到自己的 GitHub repo。GitHub Pages 網站通常公開；私人 repo 能否啟用 Pages 取決於 GitHub 方案。模型仍由訪客瀏覽器本機處理。

## 功能

- 常駐 Layers／Tensors 清單；名稱不分大小寫、operator 類型搜尋，`#123` 或純數字精確比對編號。
- TFLite 的 operator 本身可能沒有名稱，因此 Layers 的名稱搜尋也包含相連 tensor 名稱。
- 預設搜尋所有 subgraphs，點選結果自動切換；可縮小搜尋範圍。
- 可編輯、增刪及調整順序的 operator pattern，預填 `Reshape → Transpose → Reshape`。
- Pattern 僅比對 tensor 直接連接的 operator 序列，允許額外分支，不限制 shape／dtype／其他參數，也不把融合 activation 當成另一個實體 operator。
- 一條節點路徑列為一筆匹配；共享節點的路徑可分別出現。同一對節點之間多個相連 tensors 不重複計算路徑。
- 點選 pattern 高亮節點及連線，可用上一筆／下一筆跨頁巡覽。
- 分支／匯合模式支援多路徑、多出口的連通子圖；重複別名必須匹配同一節點，不同別名匹配不同節點。FC／BMM 分別對應 FullyConnected／BatchMatMul。
- Tensor 編號、shape、dtype、量化 scale／zero point／dimension，以及原 Netron 節點詳細資料與可用的權重預覽。
- 量化參數超過 12 項時摘要呈現，完整參數可下載為 JSON。

## 大型模型的處理方式

TFLite 解析與搜尋在專用 worker 執行。自訂同步 range stream 使用 64 KiB 分頁和最多 8 MiB 的 LRU 快取，只讀取解析器需要的檔案片段；沿用 Netron 支援的 external-buffer 路徑表示 inline 權重，避免開檔時完整讀取或複製全部權重。主執行緒只接收模型摘要、每頁最多 100 筆搜尋結果，以及當前繪製的局部圖。

檔案達 1 GiB，或模型超過 500 個 operators 時，預設只建立索引。點選結果才繪製一層鄰接範圍的局部圖（最多 100 個 operators）。Tensor 有大量 consumers 時先以最多 20 個相連 operators 為中心。完整圖可手動開啟；超過 1,500 個 operators 時會先顯示提示。

單組 pattern 最多 32 個 operators，匹配結果最多 50,000 筆；達上限會提示縮小搜尋範圍。原始模型不寫入 localStorage／IndexedDB，不加入版本庫或部署包。

分支模式預設使用選單：選擇 operator 建立節點，再以起點／終點選單連線，節點編號自動產生。LoRA 範本一鍵帶入五個節點與五條連線；刪除 Add 節點時相關連線會一併移除，可建立兩個出口的模式。搜尋成功後編輯區收合，點「編輯結構」可重新展開。

需要手動調整語法時，可切到「進階文字」，例如：

```text
Mul0 -> FC -> Add0
Mul0 -> BMM0 -> BMM1 -> Add0
```

這會要求兩條支線共用同一個 Mul0 和 Add0。Mul0／Add0 都是查詢別名，不是模型中的 layer 名稱或編號；匹配只依 operator 類型與連線。也能用 `m:Mul -> f:FullyConnected -> a:Add` 與 `m -> b0:BMM -> b1:BMM -> a` 明確指定別名及類型。介面顯示別名對應的實際類型，缺少該類型時會提示；不自動將 MatMul、BatchMatMul 和 custom operator 視為等價。拿掉兩條路徑末端的 Add0，就能搜尋具有 FC、BMM1 兩個出口的子圖。

匹配依直接 tensor 連接，不限制輸入／輸出 port 順序，不要求出口是整個模型的 outputs，允許額外連線；不支援循環。最多 16 條路徑、32 個節點、64 條連線。計算超過 2,000,000 次候選展開會回傳目前結果並明確提示不完整。內建 LoRA 示範僅重現指定連線結構，不能據此認定實際模型具有 LoRA 語意或可執行推論。

權重數值僅在使用者選取或展開時讀取；單一 tensor 超過 16 MiB 時不展開數值，但保留 metadata。完整圖仍可能很慢，worker 中的結構與索引也仍需要記憶體；本版沒有宣稱可以無限制開啟任何大小的模型。

## 驗證與限制

自動化測試使用有效的合成 TFLite FlatBuffer，直接經過 Netron 解析器，涵蓋跨 subgraph 搜尋、額外分支、直接連線、孤立 tensor、量化參數、lazy 權重與局部圖大小上限。

1.25 GiB 的合成權重測試使用虛擬 range reader，確認初始讀取量小於 8 MiB、最大單次讀取不超過 1 MiB，不會實際分配整塊合成權重。另以暫存資料夾的實體 1.25 GiB／6,002 operators 合成檔驗證 Node.js range reader，單次觀測讀取總量約 1.13 MiB、解析及建立索引約 264 ms。這些是記憶體／I/O 行為測試，不代表任何真實大型模型的載入時間。`node test/make-large-fixture.mjs` 可產生實體合成檔，供人工選檔測試；`node scripts/inspect.mjs <完整模型路徑>` 可在本機量測結構解析與搜尋。

另以 TensorFlow 官方 MobileNet V1 量化模型（31 operators／89 tensors）對照未修改的 Netron，核對 operator、輸入輸出、shape、dtype、量化參數、屬性與權重 bytes 相同；此公開測試檔保留在暫存資料夾，未加入專案或部署包。

瀏覽器已驗證小模型、6,002 operators 的合成模型、搜尋結果分頁、2,000 組 pattern 的局部圖與高亮、跨 subgraph、tensor 量化資料，以及圖方向切換。實際超過 1 GiB 的使用者模型尚未提供，因此原始慢速案例的改善幅度尚未量測。瀏覽器擴充功能尚未開放本機選檔自動化，故 >1 GiB 的實體選檔仍需人工驗證。

內建示範模型為合成結構，不是訓練完成或可用於推論的模型。本工具不修改模型，也不執行推論。

## 上游來源及授權

本專案採 [MIT 授權](LICENSE)。新增程式碼著作權為 `Copyright (c) 2026 koviankevin`，Netron 的著作權屬 Lutz Roeder；根目錄 LICENSE 同時保留兩者聲明。

Netron: https://github.com/lutzroeder/netron

使用 Netron 9.3.2，固定來源 commit `0994fdd00d6668280b0b98a6f5323a736236208b`。完整 MIT 授權及原作者聲明保留於 `vendor/netron/LICENSE`，建置時另複製為 `dist/LICENSE-Netron.txt`。

`vendor/netron` 保留上游 source；對上游僅新增 `Value`、`Tensor`、`Attachment` exports，供 adapter 使用。`scripts/build.mjs` 另對產出的少數詳細資料標題作繁體中文翻譯。Netron Host 的遙測、地理位置查詢和遠端開檔啟動流程沒有啟用；頁面的 CSP 限制連線到同來源。
