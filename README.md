# 模鏡｜TFLite 模型探索

**Model Lens** — 看清結構，找到連接。

[開啟模鏡網站](https://koviankevin.github.io/tflite-explorer/)

以 Netron 的 TFLite／MLIR 解析器、模型圖及詳細資料面板為基礎，加入繁體中文搜尋工作區。模型全程由瀏覽器本機處理，沒有模型上傳端點、遠端模型 URL 載入或使用遙測。

## MLIR 輸入

可直接選擇文字 `.mlir`，沿用 Layers／Tensors 搜尋、局部圖、圖上選取及 pattern JSON 匯入／匯出。以 function／巢狀 region 分開索引，連線依 SSA values 建立，保留 operation 名稱、屬性及可解析的 shape／dtype。MLIR 沒有 TFLite 的 tensor 數字編號，清單使用 SSA 名稱；多結果名稱沿用 Netron 顯示方式，例如 `%0.1`。Operator 類型保留 dialect 前綴，不自動視為 TFLite operator 的等價運算。

第一版支援 Netron 實驗性 parser 能解析的標準文字語法，以及自訂 dialect 的通用 operation 語法，例如 `"demo.split"(%arg0) : (tensor<1x4xf32>) -> (tensor<1x2xf32>, tensor<1x2xf32>)`。內部工具可先用 `--mlir-print-op-generic` 匯出文字；專用簡寫、特殊 type／attribute 或 dialect resource encoding 仍需在內部環境接入及驗證，尚未宣稱支援任何內部 dialect。

文字 MLIR 上限 64 MiB，在 worker 內完整讀取和解析；大型 inline constants 目前沒有 TFLite 的 lazy range 處理。暫不接受 MLIR bytecode，也不從 MLIR 編譯 TFLite；後者需要對應 dialect 的 compiler lowering。

## 匯出 TFLite 子模型

在 TFLite 模型圖上按「選取 pattern」，選取 layers 後按「匯出 TFLite 子模型」；單一 layer 也能匯出。也可在 pattern 搜尋後點選一筆匹配，再按「匯出此匹配為 TFLite 子模型」。只輸出選取的 operators，保留原 options、所需權重、tensor shape／dtype、量化及 sparsity 資料；不修改來源檔。只有 builtin op 的子模型會精簡 tensors／buffers 並重新編號；含 custom op 時採用下述保留編號模式。

選取區域外產生的中間 tensor 成為子模型輸入，常數權重仍放在模型中；對外有 consumer、原本是 graph output 或未被區域內消耗的輸出成為子模型 outputs，因此可保留多個出口。執行時須提供邊界輸入的實際值。JSON pattern 僅保存結構，沒有權重及 options，不能單靠 JSON 匯出可執行模型；需在開啟的 TFLite 中選取實際匹配。

支援無狀態、無子圖呼叫的 builtin 與 custom operators，兩者可混合選取。Custom 的名稱、版本、`custom_options_format` 與 options bytes 原樣保留，不要求瀏覽器理解其私有內容。含 custom op 時保留該 subgraph 全部 tensor metadata、全模型 buffer 編號及全部 buffer 資料，避免 opaque options 內的 tensor／buffer 索引因精簡而失效；因此即使只切少量 layers，輸出檔仍可能接近原模型大小。內部 runtime metadata 也保留；描述原輸入輸出邊界的 `TFLITE_METADATA` 和原 signatures／debug index 不沿用。

一般 inline custom options 保持原表示；超過 64 KiB 時只讀取位置與大小，顯示範圍摘要，匯出時改用 TFLite 的 external options 表示。原本的 `large_custom_options_offset／size` 也會重新定位；資料以 16-byte alignment 存在同一個輸出檔，從來源 File.slice／Blob 搬移。若原始檔同時有 inline 與 external options，保留 inline 優先的 runtime 行為。權重同樣使用 TFLite buffer offset／size，避免在 JavaScript 完整複製大型資料；執行環境須支援這些 TFLite buffer 格式。

執行 custom 子模型仍需你們的 custom kernel／delegate。Opaque options 不進行語意改寫；若私有格式另含絕對檔案位置、operator／subgraph 編號、外部檔案或其他初始化依賴，仍需內部 adapter 驗證。控制流程、會修改 variable 的 operators、被選取的 variable／resource／variant tensor、需要外部資料檔的 tensor 和未知 schema 欄位／union 暫不匯出。是否能在特定裝置執行取決於原 runtime 與輸入／初始化條件。

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
- 圖上按「選取 pattern」，逐一點選 layers（再次點選取消，也可用 Tab／Enter／Space），輸入名稱後「儲存並搜尋」。自動擷取選取節點之間的全部直接連線，支援分支、匯合及多出口；至少兩個節點，且必須形成連通子圖。切換 subgraph 會清除該次選取，搜尋只作用於同一個 subgraph 內的節點。
- Pattern 清單保存在目前瀏覽器、目前網站來源的 localStorage，最多 50 組；相同名稱會更新。可重新開啟網站後從 Pattern 分頁的「已儲存的 patterns」套用，也可用於其他模型。只儲存命名、operator 類型和連線，不儲存模型或 tensor 資料；GitHub Pages 與 Sites 的清單各自獨立。
- Pattern 分頁可「匯出所選」或「匯出全部」為 JSON，換電腦／瀏覽器後用「匯入 JSON」選檔並預覽、確認。支援貼上匯出的 JSON；全程本機處理。匯入保留既有資料，相同名稱且相同內容的略過，衝突自動加上「（2）」等後綴。檔案上限 1 MiB、50 組；無效格式、未知版本、斷開的子圖或超過容量時不寫入既有清單。
- 圖上擷取的 pattern 預設要求內部連線完全相同（可取消勾選），外部連線允許不同。名稱、編號、shape、dtype、權重與 operator 屬性不參與匹配；這是結構匹配，不代表運算語意相同。
- Tensor 編號、shape、dtype、量化 scale／zero point／dimension，以及原 Netron 節點詳細資料與可用的權重預覽。
- 量化參數超過 12 項時摘要呈現，完整參數可下載為 JSON。

## 大型模型的處理方式

TFLite 解析與搜尋在專用 worker 執行。自訂同步 range stream 使用 64 KiB 分頁和最多 8 MiB 的 LRU 快取，只讀取解析器需要的檔案片段；沿用 Netron 支援的 external-buffer 路徑表示 inline 權重，避免開檔時完整讀取或複製全部權重。主執行緒只接收模型摘要、每頁最多 100 筆搜尋結果，以及當前繪製的局部圖。

檔案達 1 GiB，或模型超過 500 個 operators 時，預設只建立索引。點選結果才繪製一層鄰接範圍的局部圖（最多 100 個 operators）。Tensor 有大量 consumers 時先以最多 20 個相連 operators 為中心。完整圖可手動開啟；超過 1,500 個 operators 時會先顯示提示。

單組 pattern 最多 32 個 operators，匹配結果最多 50,000 筆；達上限會提示縮小搜尋範圍。原始模型不寫入 localStorage／IndexedDB，不加入版本庫或部署包。

分支模式預設使用選單：選擇 operator 建立節點，再以起點／終點選單連線，節點編號自動產生。LoRA 範本一鍵帶入五個節點與五條連線；刪除 Add 節點時相關連線會一併移除，可建立兩個出口的模式。搜尋成功後編輯區收合，點「編輯結構」可重新展開。

編輯區超過側欄可用高度時在搜尋區內捲動，結果清單與底部授權列保留在視窗內，不隨展開內容被擠出。

需要手動調整語法時，可切到「進階文字」，例如：

```text
Mul0 -> FC -> Add0
Mul0 -> BMM0 -> BMM1 -> Add0
```

這會要求兩條支線共用同一個 Mul0 和 Add0。Mul0／Add0 都是查詢別名，不是模型中的 layer 名稱或編號；匹配只依 operator 類型與連線。也能用 `m:Mul -> f:FullyConnected -> a:Add` 與 `m -> b0:BMM -> b1:BMM -> a` 明確指定別名及類型。介面顯示別名對應的實際類型，缺少該類型時會提示；不自動將 MatMul、BatchMatMul 和 custom operator 視為等價。拿掉兩條路徑末端的 Add0，就能搜尋具有 FC、BMM1 兩個出口的子圖。

匹配依直接 tensor 連接，不限制輸入／輸出 port 順序，不要求出口是整個模型的 outputs，允許額外連線；不支援循環。最多 16 條路徑、32 個節點、64 條連線。計算超過 2,000,000 次候選展開會回傳目前結果並明確提示不完整。內建 LoRA 示範僅重現指定連線結構，不能據此認定實際模型具有 LoRA 語意或可執行推論。

搜尋索引會快取 operator 類型和正規化結果。連通子圖搜尋從已匹配節點的相鄰候選擴展，避免每一層重新掃描未相連的整張圖。候選篩選及線性路徑搜尋也設有 2,000,000 次工作量上限；定期讓出 worker 以處理新查詢，達上限會標示結果不完整。

權重數值僅在使用者選取或展開時讀取；單一 tensor 超過 16 MiB 時不展開數值，但保留 metadata。完整圖仍可能很慢，worker 中的結構與索引也仍需要記憶體；本版沒有宣稱可以無限制開啟任何大小的模型。

## 驗證與限制

自動化測試使用有效的合成 TFLite FlatBuffer，直接經過 Netron 解析器，涵蓋跨 subgraph 搜尋、額外分支、直接連線、孤立 tensor、量化參數、lazy 權重與局部圖大小上限。

`node scripts/benchmark.mjs 1000` 可重現結構搜尋效能檢查。2026-10-22 本機單次觀測：3,001 layers、五節點結構、999 組匹配，修正前約 2,246 ms，修正後約 43 ms；6,001 layers、1,999 組匹配約 86 ms。後者文字搜尋平均約 1.7 ms，局部圖 DTO 約 1.2 ms。這些是 Node.js 的合成圖量測，不含瀏覽器 SVG 排版時間，也不代表真實模型的載入效能。回歸測試另以候選檢查次數驗證不再重複掃描無關節點，並驗證大量候選可以取消、密集圖會回報計算上限。

1.25 GiB 的合成權重測試使用虛擬 range reader，確認初始讀取量小於 8 MiB、最大單次讀取不超過 1 MiB，不會實際分配整塊合成權重。另以暫存資料夾的實體 1.25 GiB／6,002 operators 合成檔驗證 Node.js range reader，單次觀測讀取總量約 1.13 MiB、解析及建立索引約 264 ms。這些是記憶體／I/O 行為測試，不代表任何真實大型模型的載入時間。`node test/make-large-fixture.mjs` 可產生實體合成檔，供人工選檔測試；`node scripts/inspect.mjs <完整模型路徑>` 可在本機量測結構解析與搜尋。

另以 TensorFlow 官方 MobileNet V1 量化模型（31 operators／89 tensors）對照未修改的 Netron，核對 operator、輸入輸出、shape、dtype、量化參數、屬性與權重 bytes 相同；此公開測試檔保留在暫存資料夾，未加入專案或部署包。

瀏覽器已驗證小模型、6,002 operators 的合成模型、搜尋結果分頁、2,000 組 pattern 的局部圖與高亮、跨 subgraph、tensor 量化資料，以及圖方向切換。2026-10-22 另以實際檔案選擇器驗證 TFLite、文字 MLIR 與 JSON 匯入；JSON 單筆／全部實際下載、重複略過、無效檔案拒絕及重新整理後保存皆通過。1280×720、1024×600 展開五節點編輯器時，結果區分別保留 98／90 px、底部列沒有被擠出、頁面沒有水平溢位。實際超過 1 GiB 的使用者模型尚未提供，因此原始慢速案例的改善幅度尚未量測；>1 GiB 的實體選檔尚未完成瀏覽器驗證。

MLIR 測試涵蓋標準 arith、多 function、不註冊的通用 dialect、雙結果 SSA 及匯合、搜尋／擷取／局部圖和錯誤提示。TFLite 子模型測試核對 options、量化、必要權重 bytes、兩個出口、邊界輸入與未知 schema 拒絕。另以 Google LiteRT 2.3.0 CPU Interpreter 實際執行含常數權重的原模型、兩層子模型、由中間 tensor 輸入的單層子模型及完整重新匯出模型，結果符合預期；從瀏覽器實際下載的兩層子模型也執行得到 `[5, 8]`。這是匯出檔的開發驗證，網站本身仍不執行推論。下載使用延後釋放的 Blob URL，避免瀏覽器尚未開始讀取即被撤銷。

Custom 切圖另涵蓋 inline／external options 逐 byte 相同、64 KiB 以上 inline options 延後讀取、3 GiB 虛擬檔案位置的 64-bit 搬移、兩種 options 同時存在時的優先順序、optional input `-1`、intermediates、原 tensor／buffer 編號、隱含 buffer 依賴與兩個出口。瀏覽器實際選檔、單獨選取 custom op、下載及重新開啟皆已驗證，下載檔再以 LiteRT 官方 Python schema 與 Interpreter 讀取核對。合成 custom kernel 未註冊，執行時預期回報 unresolved custom op；尚未驗證任何內部 custom runtime 的運算結果。

內建示範模型為合成結構，不是訓練完成或可用於推論的模型。本工具不修改來源模型，也不執行推論；子模型匯出會建立新的檔案。

## 上游來源及授權

本專案採 [MIT 授權](LICENSE)。新增程式碼著作權為 `Copyright (c) 2026 koviankevin`，Netron 的著作權屬 Lutz Roeder；根目錄 LICENSE 同時保留兩者聲明。

Netron: https://github.com/lutzroeder/netron

使用 Netron 9.3.2，固定來源 commit `0994fdd00d6668280b0b98a6f5323a736236208b`。完整 MIT 授權及原作者聲明保留於 `vendor/netron/LICENSE`，建置時另複製為 `dist/LICENSE-Netron.txt`。

`vendor/netron` 保留上游 source；對上游僅新增 `Value`、`Tensor`、`Attachment` exports，供 adapter 使用。`scripts/build.mjs` 另對產出的少數詳細資料標題作繁體中文翻譯。Netron Host 的遙測、地理位置查詢和遠端開檔啟動流程沒有啟用；頁面的 CSP 限制連線到同來源。
