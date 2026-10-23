# 模鏡｜TFLite・MLIR 模型探索

**Model Lens** — 看清結構，找到連接。

[開啟模鏡網站](https://koviankevin.github.io/tflite-explorer/)

以 Netron 的 TFLite／MLIR 解析器、模型圖及詳細資料面板為基礎，加入繁體中文搜尋工作區。支援 `.tflite`／`.lite` 與 generic 文字 `.mlir`。模型全程由瀏覽器本機處理，沒有模型上傳端點、遠端模型 URL 載入或使用遙測。

## MLIR 基礎版

讀取文字 `.mlir`（UTF-8，最多 64 MiB），優先支援 generic operation 格式，包括未知 dialect 的 `"namespace.operation"(...)`、多輸出 `%result#0`／`%result#1`、attributes、自訂 type、動態 shape 與巢狀 region。以 `func.func` 及每個 region／block 分開建立搜尋範圍，保留階層路徑，不會將同名 SSA 值跨範圍接線。SSA Values 分頁可搜尋 `%name`，Layers 可搜尋完整 operator／dialect 名稱；原始型別、attributes、scope 與可用的 location 可在詳細資料查看。

圈選支援建立、儲存、搜尋及 JSON 匯入匯出 pattern。以完整 `dialect.op` 名稱比對，不自動將不同 dialect 的同名 operations 視為相同。圈選後或點選 pattern 匹配結果，可匯出局部 `.mlir`：保留 operations 原始文字、custom op 型別、properties、attributes、多輸出及內部 SSA 連線。範圍外的 SSA 值改為新的 function arguments；被外部使用或沒有使用者的結果成為 function outputs。檔案中的 type／attribute／location aliases 和 resources 原文一併保留，檔案可能包含未使用的 declarations／resources。匯出前會在本機 Worker 檢查來源與子圖的語法／SSA；失敗時顯示行、欄與原因，停止下載。此結構檢查不取代 LLVM 或內部 dialect verifier，完整範圍見 [驗證說明](docs/mlir-verification.md)。下載後可用「開啟模型」檢查。Pattern JSON 仍只儲存結構，不含完整 IR。

MLIR 預設匯出局部選取，也可切換「完整 function」。同一 block 的資料流擷取 1～32 個 operations，選到含 region 的 op 時保留其完整 region。多 block 局部匯出移除未選取的一般資料運算，補足外部 SSA 輸入、輸出、控制路徑與必要的迴圈運算；custom op 原文、型別、properties、attributes 保留。支援 generic `cf.br`、`cf.cond_br`、`cf.switch`，匯出前在本機檢查 SSA、branch arguments、跨 block dominance 與 terminators，並重新解析及驗證生成結果。未知 branch／terminator 可透過 dialect adapter 擴充；無對應規則、獨立 region terminator 或需外部 symbol dependencies 時明確拒絕。匯出不轉換 TFLite、不跑推論；memory effects、完整 dialect verifier 和外部 runtime 仍由公司工具處理。任意 dialect 的 custom assembly、bytecode 和大型 resource payload 不保證可讀；不支援時回報位置，不猜測接線。

局部 CFG 是新的 `@extracted` function：保留原有可達控制路徑並新增 entry block，裁掉未使用的 block arguments；迴圈內會變動的 SSA producer 不能凍結成輸入，會自動保留。條件輸出使用 `(valid: i1, value)`，並要求 caller 傳入同型別備援值；`valid=false` 時該值不代表已執行的輸出。多回傳出口另回傳原始出口編號。檔案註解列出輸入來源與結果位置，介面列出補入的運算。新版局部 MLIR 保留原始 pattern 結構對照，既有 pattern 可沿用，新增的 entry、輸出傳值與備援介面不參與原始結構比對；結果仍定位到實際存在的 layers。較早的局部檔案需從原模型重新匯出一次，原有 pattern JSON 不需修改。需要原始函式介面時使用完整 function。局部模式目前支援同一 function 直接 body 的選取、最多 4096 blocks／128 資料輸出，不推斷未註冊 op 的 memory effects。

### 跨 block pattern

搜尋後按「收合所有匹配」可在全模型圖中，將本次搜尋的每個不重疊匹配各自收為節點，包含所有搜尋分頁、functions／subgraphs；未匹配的 OP 保留。點任一節點或按 Enter 可單獨展開，其他匹配保持收合；總覽清單可定位、重新收合某一組或全部展開／收合。不同搜尋結果共用 OP 時，依搜尋順序保留第一個不衝突匹配，後續衝突結果明確標示「重疊，未另建節點」，仍可定位，避免複製 OP 或改變接線。SSA／tensor、分支出口及跨越收合節點的迴圈沿原值接回，functions／subgraphs 不交叉接線。總覽僅改變顯示，匯出仍使用目前匹配的原始選取；需圈選時返回匹配圖。總覽先在 Worker 建立連線投影並規劃收合，再以最終可見節點數（包含 MLIR block／控制流程標記）檢查 1,500 個上限，不再以原始 20,000 OP 或 1,500 筆匹配阻擋。只有通過檢查的可見 OP 才序列化詳細資料；被收合的權重與屬性不會先整份複製。畫面顯示原始 OP 與可見節點數，超限時保留先前圖形並提示實際數量。結果超過 1,500 筆時，總覽下拉選單只列獨立匹配及目前選取的重疊結果，所有結果仍能從原有分頁清單定位。搜尋本身的 50,000 筆與工作量保護仍適用；檔案大小不等同於繪圖負擔，實際容量仍受瀏覽器記憶體及模型結構影響。

點選搜尋結果後，可用圖上方「收合 pattern」將目前匹配收成一個節點；點節點或按 Enter／Space 重新展開。支援 TFLite 與 MLIR。收合僅改變顯示，搜尋結果、圈選來源及匯出仍使用原始 OP；需先展開才能圈選。MLIR 一併收起相關 block 標頭、內部 arguments、控制標記與必要 terminators，保留各個對外 SSA、分支出口及傳值。跨越 pattern 邊界的迴圈仍顯示去向與回跳；完全位於內部的迴圈在展開後查看。圖上以「外部 block」標示未展開的相鄰控制範圍，不會將省略的 OP 當成匹配內容。

在 MLIR 按「選取 pattern」，勾選「跨 block 保留選取」，再切換 blocks 點選 layers，或按「加入目前 block 全部 layers」。選取清單可跳回各 block 或移除；總計最多 32 個 operators。儲存後可搜尋分支、匯合及迴圈，包括 self-loop 和透過 block arguments 傳遞的 loop-carried SSA。

點跨 block 結果會將相關 blocks 畫在同一張圖，以區塊框線區分範圍。藍色虛線顯示實際控制出口與迴圈回跳，實線顯示 SSA 和 block argument 傳值；出口與 argument 顯示節點是檢視用標記，不會寫入原始 IR 或匯出檔。點 block 按鈕直接在同圖定位並保留排版與縮放；「全部 blocks」重新縮放以檢視總覽。預設局部圖只含匹配 operators、必要 terminators、block arguments 與相關 blocks 之間的 successor；省略的資料來源標成邊界輸入，不會跨越省略 blocks 畫假連線。完整圖展開相關 blocks 的所有 operators，最多 1,500 operators、512 個控制出口。

在總覽按「選取 pattern」即可直接點選不同 blocks 的原始 layers，不切換圖形；綠色表示本次選取，Enter／Space 也可加入或取消。block 標題、出口、argument 標記不能選入，儲存時自動擷取 block arguments、SSA 與控制流程。選取以原始 block／layer 編號記錄，不會混淆不同 blocks 的相同 layer 編號。可一次加入目前 block 可見 layers 或整張圖可見 layers，超過 32 個 operators 時整次加入不生效；選取清單支援同圖定位、移除單一 block 與全部清除。切換字級、圖方向與完整／局部圖會保留選取。儲存後仍可匯出／匯入 version 2 pattern JSON；MLIR 匯出範圍可選局部選取或完整 function。

選取模式支援滑鼠左鍵拖曳框選，可從空白或 layer 上開始，往任一方向跨越多個 blocks；與選框有面積重疊的原始 layers 會加入現有選取，重複框選不會取消或重複加入。拖曳期間預覽命中節點及數量，放開後套用；超過 32 個 layers 時整次框選不生效。點選 layer 仍可單獨加入／取消，Alt＋左鍵拖曳保留平移；未啟用選取時沿用一般拖曳平移。Esc 可取消正在拖曳的選框；捲動、縮放、重畫或切換頁面時取消未完成的框選。手機觸控仍沿用原有點選及手勢。

跨 block 模式在同一 region 內比對 operator 類型、相對順序、block membership、SSA operand／result ports、branch argument routing 與 successor 順序；不跨 function 或巢狀 region，也不比對模型名稱、block labels、SSA 名稱、型別 shape 或 attributes。「目前 subgraph」在此模式指其所在完整 region。未選取內容仍是外部邊界；若要限制一個 block 的完整內容，請選入需要的全部 operators。

搜尋與 source SSA／dominance 檢查全在 Worker 執行；未知 branch 需 dialect adapter，無效 CFG 不會猜測接線。搜尋可取消，最多 50,000 筆、2,000,000 次候選／完整比對檢查，達限時顯示結果可能不完整。跨 block JSON 使用 version 2，保留結構節點與有類型的連線；version 1 的單 block patterns 仍可匯入。檔案不含模型／SSA 名稱、權重或原始 IR。

可在公司工具中用 `--mlir-print-op-generic` 輸出通用形式。內部 dialect 的 region kind、isolation、successor operands、terminator 與自訂 verifier 可從 `src/mlir-dialect-registry.js` 接入，來源與匯出重驗共用同一 registry，無需修改搜尋器。顯示擴充、parser 替換位置、介面範例與測試方式見 [MLIR 擴充說明](docs/mlir-adapters.md)。TFLite 開檔不會載入 MLIR parser；TFLite 的 range stream 與子模型匯出保留原有方式。

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
- 預設搜尋目前顯示的 subgraph，切換模型圖的 subgraph 時自動更新搜尋結果；也可明確指定子圖或選「所有 subgraphs」。每筆結果標示子圖編號，因為不同 subgraphs 的 layer／tensor 編號各自從頭計算。點選結果沿用目前的完整圖／局部圖模式，跨 subgraph 才切換圖形。同一張完整圖只更新節點與連線高亮，保留排版及縮放；結果在視野外時才平移定位。
- 可編輯、增刪及調整順序的 operator pattern，預填 `Reshape → Transpose → Reshape`。
- Pattern 僅比對 tensor 直接連接的 operator 序列，允許額外分支，不限制 shape／dtype／其他參數，也不把融合 activation 當成另一個實體 operator。
- 同一 subgraph 內，相同實際 layers 與匹配連線只列一次，對稱分支交換查詢別名不會重複列出。共享節點但匹配連線不同的結構仍分別保留；不同 subgraphs 的結果也各自保留。同一對節點之間多個相連 tensors 不重複計算。
- 點選 pattern 高亮節點及連線，可用上一筆／下一筆跨頁巡覽。
- 使用同一套連接結構編輯器，支援直線、分支、匯合與多出口，不需切換模式；重複別名必須匹配同一節點，不同別名匹配不同節點。FC／BMM 分別對應 FullyConnected／BatchMatMul。既有 pattern JSON 格式不變。
- 圖上按「選取 pattern」，逐一點選 layers（再次點選取消，也可用 Tab／Enter／Space），輸入名稱後「儲存並搜尋」。自動擷取選取節點之間的全部直接連線，支援分支、匯合及多出口；至少兩個節點，且必須形成連通子圖。切換 subgraph 會清除該次選取，搜尋只作用於同一個 subgraph 內的節點。
- Pattern 清單保存在目前瀏覽器、目前網站來源的 localStorage，最多 50 組；相同名稱會更新。可重新開啟網站後從 Pattern 分頁的「已儲存的 patterns」套用，也可用於其他模型。只儲存命名、operator 類型和連線，不儲存模型或 tensor 資料；GitHub Pages 與 Sites 的清單各自獨立。
- Pattern 分頁可「匯出所選」或「匯出全部」為 JSON，換電腦／瀏覽器後用「匯入 JSON」選檔並預覽、確認。支援貼上匯出的 JSON；全程本機處理。匯入保留既有資料，相同名稱且相同內容的略過，衝突自動加上「（2）」等後綴。檔案上限 1 MiB、50 組；無效格式、未知版本、斷開的子圖或超過容量時不寫入既有清單。
- 圖上擷取的 pattern 預設要求內部連線完全相同（可取消勾選），外部連線允許不同。名稱、編號、shape、dtype、權重與 operator 屬性不參與匹配；這是結構匹配，不代表運算語意相同。
- Tensor 編號、shape、dtype、量化 scale／zero point／dimension，以及原 Netron 節點詳細資料與可用的權重預覽。
- 介面內文 15px，清單、詳細資料與操作說明 14px，主要標題 16px。模型圖文字預設 14px，工具列「圖字」可獨立選擇 14–32px，偏好只存在目前瀏覽器。調整圖字會重新排版以容納文字，保留目前縮放、完整／局部圖模式、搜尋選取與手動擷取選取；文字仍隨模型縮放，可在縮小時提高圖字大小。
- 搜尋選取使用亮黃色填滿與 4px 外框，匹配連線加粗為 3px；手動擷取選取使用綠色填滿與虛線外框。外框與連線採 non-scaling stroke，縮小模型時不隨之變細。詳細資料面板的底色與文字成對設定，系統使用深色主題時也維持一致的淺底深字。
- 量化參數超過 12 項時摘要呈現，完整參數可下載為 JSON。

## 大型模型的處理方式

TFLite 解析與搜尋在專用 worker 執行。自訂同步 range stream 使用 64 KiB 分頁和最多 8 MiB 的 LRU 快取，只讀取解析器需要的檔案片段；沿用 Netron 支援的 external-buffer 路徑表示 inline 權重，避免開檔時完整讀取或複製全部權重。主執行緒只接收模型摘要、每頁最多 100 筆搜尋結果，以及當前繪製的局部圖。

檔案達 1 GiB，或模型超過 500 個 operators 時，預設只建立索引。點選結果才繪製一層鄰接範圍的局部圖（最多 100 個 operators）。Tensor 有大量 consumers 時先以最多 20 個相連 operators 為中心。完整圖可手動開啟；超過 1,500 個 operators 時會先顯示提示。

單組 pattern 最多 32 個 operators，匹配結果最多 50,000 筆；達上限會提示縮小搜尋範圍。原始模型不寫入 localStorage／IndexedDB，不加入版本庫或部署包。

連接結構預設使用選單，以三節點的 `Reshape → Transpose → Reshape` 開始：選擇 operator 建立節點，再以起點／終點選單連線，節點編號自動產生。LoRA 範本一鍵帶入五個節點與五條連線；刪除 Add 節點時相關連線會一併移除，可建立兩個出口的模式。搜尋成功後編輯區收合，點「編輯結構」可重新展開。

編輯區超過側欄可用高度時在搜尋區內捲動，結果清單與底部授權列保留在視窗內，不隨展開內容被擠出。

900px 以下改用上下排列：搜尋區、圖形工具列、選取操作區、模型圖與詳細資料各自佔滿可用寬度。頁面可垂直捲動，工具列按鈕自動換行；模型圖內保留拖曳與縮放操作。已以瀏覽器 320×568、390×844 和橫向 844×390 驗證無水平溢位，包含展開 pattern 編輯器、匯入視窗、選取操作區及詳細資料；1280×720 保留桌面左右排列。

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

搜尋定位另驗證完整圖保留節點數與縮放、完整／局部切換、tensor 詳細資料及既有 version 1 pattern JSON 匯入。對稱分支測試確認交換別名只列一筆，但不同 subgraph 或不同匹配連線仍保留；瀏覽器也以四節點對稱分支的實際 TFLite 選檔驗證只出現一筆結果。390×844 展開結構編輯器時結果區保留 90px，沒有水平溢位或工具列重疊。

內建一般範例含兩個結構相同的 subgraphs。以 `Reshape → Transpose` 驗證：目前子圖各有 4 筆，搜尋所有子圖則有 8 筆；切換目前子圖後清單會同步更新，所有子圖的結果可由子圖編號區分，不跨子圖合併真正不同的匹配。

深色系統設定下另驗證 layer 詳細資料與展開的 tensor 資料可讀；約 50% 縮放時選取外框維持 4px、匹配連線維持 3px，手動選取 layer 的綠色填滿與固定粗細外框也正常。

字級調整另以瀏覽器驗證 320×568、390×844、1024×600 與 1536×864 的展開編輯器；沒有水平溢位，工具列與結果區未重疊。模型約 59% 縮放時切換圖字仍保留縮放，32px 的五節點示範文字未超出節點框，重新整理後也能恢復字級偏好。

`node scripts/benchmark.mjs 1000` 可重現結構搜尋效能檢查。2026-10-22 本機單次觀測：3,001 layers、五節點結構、999 組匹配，修正前約 2,246 ms，修正後約 43 ms；6,001 layers、1,999 組匹配約 86 ms。後者文字搜尋平均約 1.7 ms，局部圖 DTO 約 1.2 ms。這些是 Node.js 的合成圖量測，不含瀏覽器 SVG 排版時間，也不代表真實模型的載入效能。回歸測試另以候選檢查次數驗證不再重複掃描無關節點，並驗證大量候選可以取消、密集圖會回報計算上限。

1.25 GiB 的合成權重測試使用虛擬 range reader，確認初始讀取量小於 8 MiB、最大單次讀取不超過 1 MiB，不會實際分配整塊合成權重。另以暫存資料夾的實體 1.25 GiB／6,002 operators 合成檔驗證 Node.js range reader，單次觀測讀取總量約 1.13 MiB、解析及建立索引約 264 ms。這些是記憶體／I/O 行為測試，不代表任何真實大型模型的載入時間。`node test/make-large-fixture.mjs` 可產生實體合成檔，供人工選檔測試；`node scripts/inspect.mjs <完整模型路徑>` 可在本機量測結構解析與搜尋。

另以 TensorFlow 官方 MobileNet V1 量化模型（31 operators／89 tensors）對照未修改的 Netron，核對 operator、輸入輸出、shape、dtype、量化參數、屬性與權重 bytes 相同；此公開測試檔保留在暫存資料夾，未加入專案或部署包。

瀏覽器已驗證小模型、6,002 operators 的合成模型、搜尋結果分頁、2,000 組 pattern 的局部圖與高亮、跨 subgraph、tensor 量化資料，以及圖方向切換。2026-10-22 另以實際檔案選擇器驗證 TFLite 與 JSON 匯入；JSON 單筆／全部實際下載、重複略過、無效檔案拒絕及重新整理後保存皆通過。1280×720、1024×600 展開五節點編輯器時，結果區分別保留 98／90 px、底部列沒有被擠出、頁面沒有水平溢位。實際超過 1 GiB 的使用者模型尚未提供，因此原始慢速案例的改善幅度尚未量測；>1 GiB 的實體選檔尚未完成瀏覽器驗證。

TFLite 子模型測試核對 options、量化、必要權重 bytes、兩個出口、邊界輸入與未知 schema 拒絕。另以 Google LiteRT 2.3.0 CPU Interpreter 實際執行含常數權重的原模型、兩層子模型、由中間 tensor 輸入的單層子模型及完整重新匯出模型，結果符合預期；從瀏覽器實際下載的兩層子模型也執行得到 `[5, 8]`。這是匯出檔的開發驗證，網站本身仍不執行推論。下載使用延後釋放的 Blob URL，避免瀏覽器尚未開始讀取即被撤銷。

Custom 切圖另涵蓋 inline／external options 逐 byte 相同、64 KiB 以上 inline options 延後讀取、3 GiB 虛擬檔案位置的 64-bit 搬移、兩種 options 同時存在時的優先順序、optional input `-1`、intermediates、原 tensor／buffer 編號、隱含 buffer 依賴與兩個出口。瀏覽器實際選檔、單獨選取 custom op、下載及重新開啟皆已驗證，下載檔再以 LiteRT 官方 Python schema 與 Interpreter 讀取核對。合成 custom kernel 未註冊，執行時預期回報 unresolved custom op；尚未驗證任何內部 custom runtime 的運算結果。

內建示範模型為合成結構，不是訓練完成或可用於推論的模型。本工具不修改來源模型，也不執行推論；子模型匯出會建立新的檔案。

## 上游來源及授權

本專案採 [MIT 授權](LICENSE)。新增程式碼著作權為 `Copyright (c) 2026 koviankevin`，Netron 的著作權屬 Lutz Roeder；根目錄 LICENSE 同時保留兩者聲明。

Netron: https://github.com/lutzroeder/netron

使用 Netron 9.3.2，固定來源 commit `0994fdd00d6668280b0b98a6f5323a736236208b`。完整 MIT 授權及原作者聲明保留於 `vendor/netron/LICENSE`，建置時另複製為 `dist/LICENSE-Netron.txt`。

`vendor/netron` 保留上游 source，新增 `Value`、`Tensor`、`Attachment` exports 供 adapter 使用，並在 `dagre.js` 的連線排序條件補上邊界／終端節點檢查，避免局部迴圈有外部 SSA 輸入時讀取不存在的 incoming／outgoing edge。`scripts/build.mjs` 另對產出的少數詳細資料標題作繁體中文翻譯。Netron Host 的遙測、地理位置查詢和遠端開檔啟動流程沒有啟用；頁面的 CSP 限制連線到同來源。
