# 模鏡｜TFLite・MLIR 模型探索

**Model Lens** — 看清結構，找到連接。

公開核心與公司 dialect 現可分開建置。使用 `node scripts/build.mjs` 建公開版，或以 `--profile` 及獨立輸出接入內部擴充；可產生固定版本 ZIP、校驗逐檔雜湊，並在網站右上查看版本。見 [內網更新與回退](docs/intranet-release.md)。商品等級的完整驗收及尚未完成項目另列於 [工作清單](docs/product-readiness.md)。

[開啟模鏡網站](https://koviankevin.github.io/tflite-explorer/)

[固定版本部署包](https://github.com/koviankevin/tflite-explorer/releases) 提供已建置 ZIP、SHA-256、逐檔 manifest 與發布憑證。公開版原樣部署可使用該 ZIP；帶公司 dialect 時保留內部 profile／adapter，固定核心版本後重新建置，依 [內網更新流程](docs/intranet-release.md) 驗收並切換完整版本目錄。正式站目前為 preview.13，1,277 檔與 21 項原生操作、固定資產實際下載比對均通過，含可攜編輯草稿、OP 複製／builtin 選單、固定 seed 權重、滑鼠平移與滾輪縮放，見 [最新交付驗收](docs/model-edit-workspace.md)；前次實際回退／恢復紀錄另見 [切換驗收與限制](docs/production-transition-verification.md)。

匯出後可從「最近匯出報告」下載來源 OP、輸入／輸出和原始資料位置對照；以本機 CLI 串流比對實際下載檔的權重／custom options，並可指定公司 MLIR compiler。報告清楚區分結構檢查、bytes 比對和未驗證的 runtime 語意，見 [匯出報告與本機驗證](docs/export-reports.md)。

以 Netron 的 TFLite／MLIR 解析器、模型圖及詳細資料面板為基礎，加入繁體中文搜尋工作區。支援 `.tflite`／`.lite` 與 generic 文字 `.mlir`。模型全程由瀏覽器本機處理，沒有模型上傳端點、遠端模型 URL 載入或使用遙測。

## 圈選與修改模型

選 pattern 時按住 **Alt＋拖曳**可平移模型，滾輪縮放；已有選取會保留。「編輯選取 pattern」把圈選轉成未儲存的 pattern 草稿，可增刪節點與連線；這項操作修改搜尋條件。匯出子模型後可按「開啟匯出結果」，直接在目前網站重新開啟。

實際模型編輯**僅支援 TFLite**。開啟 TFLite 後，右上可切換「探索模型／編輯模型」，圖上與框選工具列也有入口；支援點選／拖曳接線、自動建立 output tensor、OP 複製／builtin 選單、固定 seed 權重、多步變更預覽與復原／重做。拖曳空白處平移，Alt＋拖曳可從 OP 上平移，滾輪以游標為中心縮放。編輯草稿可下載 JSON，重新選原模型並核對完整檔案指紋後恢復接線、歷史及視角。匯出後可直接重開修改結果，詳見 [TFLite 模型編輯工作區](docs/model-edit-workspace.md)。MLIR 保留探索、搜尋、pattern、局部匯出，不提供實際 OP 編輯，也不接受舊 MLIR 模型編輯草稿。

## Pattern 條件與工作階段

可指定 pattern 中各 OP 的 shape、dtype 與 attributes 條件，條件隨 version 3 pattern JSON 保存，仍可匯入舊版。搜尋欄可下載工作階段 JSON，或恢復此瀏覽器上次儲存；重新選取本機模型並核對結構後，還原搜尋、選取、收合、字級與 SVG／Canvas 縮放位置。新版另有本機自動草稿、Undo／Redo、未完成編輯保存及多分頁衝突保護；模型與權重不存入草稿。操作方式與限制見 [保存及復原說明](docs/workspace-recovery.md) 和 [條件與工作階段說明](docs/conditions-workspace.md)。

## 搜尋工作區寬度

自 preview.9 起，搜尋分頁支援左右方向鍵、Home／End 移焦點，Enter／Space 切換並搜尋；圖形重畫保留目前操作控制項的焦點，對話框快捷鍵不影響後方選取。已驗證 TFLite 原生鍵盤工作流程，實際涵蓋範圍及限制見 [操作說明](docs/keyboard-acceptance.md)。

桌面版可拖曳左側搜尋欄的右邊界調整寬度，並記住此瀏覽器的設定。分隔線支援方向鍵微調、Shift 加速、Home／End 調至最窄／最寬，Enter 或雙擊恢復預設。寬度會依視窗限制，保留模型圖空間；拖曳保留目前圖形、縮放與已選 layers，工具列依可用寬度換行。手機維持上下排列，不顯示拖曳線；大型模型只完成索引時也能直接使用搜尋欄。

14 吋筆電常見的可用畫面另有調整：901～1600px 寬時，「尋找模式」固定在結果列，不隨結構／條件編輯器捲走；左欄暫時限制在畫面的 35% 內。開啟右側詳情會再調整左欄，於至少 1280px 的畫面保留 600px 模型圖；關閉詳情或回到大視窗時恢復可用範圍內的偏好寬度。字級維持 14px，模型圖可選至 32px。已驗證包含瀏覽器工具列占用的 1280×600、1366×640，以及 1280×720、1366×768、1536×864；詳細紀錄見 [筆電版面驗證](docs/laptop-layout-verification.md)。

## MLIR 基礎版

讀取 UTF-8 文字 `.mlir`，優先支援 generic operation 格式，包括未知 dialect 的 `"namespace.operation"(...)`、多輸出 `%result#0`／`%result#1`、attributes、自訂 type、動態 shape 與巢狀 region。以 `func.func` 及每個 region／block 分開建立搜尋範圍，保留階層路徑，不會將同名 SSA 值跨範圍接線。SSA Values 分頁可搜尋 `%name`，Layers 可搜尋完整 operator／dialect 名稱；原始型別、attributes、scope 與可用的 location 可在詳細資料查看。

已移除整檔 64 MiB 上限。大型 MLIR 以 1 MiB 區塊在本機 Worker 掃描，超過 4 KiB 的 `dense<…>` literal 與檔案內 resource hex blob 留在原始 File；搜尋只建立結構索引，匯出以 File slices 接回完整原文，避免整檔字串、完整權重陣列或巨大 TextEncoder 複本。另限制**扣除這些 payload 後的結構文字最多 256 MiB**，不將權重大小算進此上限。大型屬性顯示延後讀取提示，不以預覽值匹配 attribute 條件。仍須完整掃描檔案，速度依磁碟及裝置而異；不保證任意大小、非標準大型屬性或外部權重檔可用。見 [大型 MLIR 與驗證](docs/mlir-large-files.md)。

圈選支援建立、儲存、搜尋及 JSON 匯入匯出 pattern。以完整 `dialect.op` 名稱比對，不自動將不同 dialect 的同名 operations 視為相同。圈選後或點選 pattern 匹配結果，可匯出局部 `.mlir`：保留 operations 原始文字、custom op 型別、properties、attributes、多輸出及內部 SSA 連線。範圍外的 SSA 值改為新的 function arguments；被外部使用或沒有使用者的結果成為 function outputs。檔案中的 type／attribute／location aliases 和 resources 原文一併保留，檔案可能包含未使用的 declarations／resources。匯出前會在本機 Worker 檢查來源與子圖的語法／SSA；失敗時顯示行、欄與原因，停止下載。此結構檢查不取代 LLVM 或內部 dialect verifier，完整範圍見 [驗證說明](docs/mlir-verification.md)。下載後可用「開啟模型」檢查。Pattern JSON 仍只儲存結構，不含完整 IR。

MLIR 預設匯出局部選取，也可切換「完整 function」。同一 block 的資料流擷取 1～32 個 operations，選到含 region 的 op 時保留其完整 region。多 block 局部匯出移除未選取的一般資料運算，補足外部 SSA 輸入、輸出、控制路徑與必要的迴圈運算；custom op 原文、型別、properties、attributes 保留。支援 generic `cf.br`、`cf.cond_br`、`cf.switch`，匯出前在本機檢查 SSA、branch arguments、跨 block dominance 與 terminators，並重新解析及驗證生成結果。未知 branch／terminator 可透過 dialect adapter 擴充；無對應規則、獨立 region terminator 或需外部 symbol dependencies 時明確拒絕。匯出不轉換 TFLite、不跑推論；memory effects、完整 dialect verifier 和外部 runtime 仍由公司工具處理。任意 dialect 的 custom assembly 與 bytecode 不保證可讀；不支援時回報位置，不猜測接線。延後讀取的權重保留原文，結構語法／SSA／dominance 檢查不包含其逐值語法、元素數量與 dialect 語意，介面會明示這個範圍。

局部 CFG 是新的 `@extracted` function：保留原有可達控制路徑並新增 entry block，裁掉未使用的 block arguments；迴圈內會變動的 SSA producer 不能凍結成輸入，會自動保留。條件輸出使用 `(valid: i1, value)`，並要求 caller 傳入同型別備援值；`valid=false` 時該值不代表已執行的輸出。多回傳出口另回傳原始出口編號。檔案註解列出輸入來源與結果位置，介面列出補入的運算。新版局部 MLIR 保留原始 pattern 結構對照，既有 pattern 可沿用，新增的 entry、輸出傳值與備援介面不參與原始結構比對；結果仍定位到實際存在的 layers。較早的局部檔案需從原模型重新匯出一次，原有 pattern JSON 不需修改。需要原始函式介面時使用完整 function。局部模式目前支援同一 function 直接 body 的選取、最多 4096 blocks／128 資料輸出，不推斷未註冊 op 的 memory effects。

### 跨 block pattern

搜尋後按「收合所有匹配」可在全模型圖中，將本次搜尋的每個不重疊匹配各自收為節點，包含所有搜尋分頁、functions／subgraphs；未匹配的 OP 保留。點任一節點或按 Enter 可單獨展開，其他匹配保持收合；總覽清單可定位、重新收合某一組或全部展開／收合。不同搜尋結果共用 OP 時，依搜尋順序保留第一個不衝突匹配，後續衝突結果明確標示「重疊，未另建節點」，仍可定位，避免複製 OP 或改變接線。SSA／tensor、分支出口及跨越收合節點的迴圈沿原值接回，functions／subgraphs 不交叉接線。總覽僅改變顯示，匯出仍使用目前匹配的原始選取；Canvas 總覽可直接圈選已展開的原始 OP。總覽先在 Worker 建立連線投影並規劃收合，不以原始 OP 數或匹配筆數阻擋。收合／展開後在 1,500 個節點以內沿用 Netron SVG；超過時自動切換 Canvas 虛擬總覽，背景建立全圖座標，依視窗查詢節點及連線，拖曳／縮放時只重畫可見範圍及少量預載邊界。兩端在畫面外但穿過視窗的連線也會保留；全圖縮小時省略文字，放大再顯示名稱，並以固定畫面線寬標出目前匹配。大型總覽使用分層概略排版，迴圈以強連通元件安排；不同 functions／subgraphs 分區。Canvas 只傳送名稱、型別、原始位置與連線，點 OP 才取得原始詳細資料，權重仍按需在本機讀取。

虛擬總覽可拖曳平移、滾輪／＋− 縮放，按「全圖」或 Home 還原全圖；方向鍵平移，Enter 開啟選取節點。搜尋可直接定位畫面外的匹配，單組展開／全部展開後仍使用同樣視窗機制；字級及圖方向變更會重算座標。總覽下拉選單在結果超過 1,500 筆時列前 1,000 組獨立匹配及目前選取，其餘仍可透過分頁搜尋清單定位。詳情、pattern 儲存與模型匯出使用原始 OP。Canvas 總覽按「選取 pattern」可直接跨 blocks 框選，滑鼠拖曳加入相交的原始 OP、點選切換、Alt＋拖曳平移；縮放與平移後以反向座標轉換查詢空間索引。框選範圍限於實際畫布，不會加入視窗外預載節點、收合節點或控制標記；收合節點可在選取模式中點開再選。未完成的框選在 Escape、滾輪、重畫、捲動、失焦、縮放或 resize 時取消。選取跨 block 保留，最多 32 個原始 OP，須在同一 function／region 或 TFLite subgraph，超限／跨範圍時保留原選取並提示。可加入視窗內的 layers、從選取的 block 清單定位，或匯出所選子模型。儲存並搜尋後留在全模型總覽，字級和方向重畫仍保留原始選取；SVG 收合總覽請返回匹配圖再圈選。搜尋本身的 50,000 筆與工作量保護仍適用。虛擬繪圖降低畫面繪製負擔，但全圖索引與座標仍需要與節點／連線數成比例的記憶體，實際容量取決於瀏覽器和模型結構。

點選搜尋結果後，可用圖上方「收合 pattern」將目前匹配收成一個節點；點節點或按 Enter／Space 重新展開。支援 TFLite 與 MLIR。收合僅改變顯示，搜尋結果、圈選來源及匯出仍使用原始 OP；需先展開才能圈選。MLIR 一併收起相關 block 標頭、內部 arguments、控制標記與必要 terminators，保留各個對外 SSA、分支出口及傳值。跨越 pattern 邊界的迴圈仍顯示去向與回跳；完全位於內部的迴圈在展開後查看。圖上以「外部 block」標示未展開的相鄰控制範圍，不會將省略的 OP 當成匹配內容。

在 MLIR 按「選取 pattern」，勾選「跨 block 保留選取」，再切換 blocks 點選 layers，或按「加入目前 block 全部 layers」。選取清單可跳回各 block 或移除；總計最多 32 個 operators。儲存後可搜尋分支、匯合及迴圈，包括 self-loop 和透過 block arguments 傳遞的 loop-carried SSA。

點跨 block 結果會將相關 blocks 畫在同一張圖，以區塊框線區分範圍。藍色虛線顯示實際控制出口與迴圈回跳，實線顯示 SSA 和 block argument 傳值；出口與 argument 顯示節點是檢視用標記，不會寫入原始 IR 或匯出檔。點 block 按鈕直接在同圖定位並保留排版與縮放；「全部 blocks」重新縮放以檢視總覽。預設局部圖只含匹配 operators、必要 terminators、block arguments 與相關 blocks 之間的 successor；省略的資料來源標成邊界輸入，不會跨越省略 blocks 畫假連線。完整圖展開相關 blocks 的所有 operators，最多 1,500 operators、512 個控制出口。

在總覽按「選取 pattern」即可直接點選不同 blocks 的原始 layers，不切換圖形；綠色表示本次選取，Enter／Space 也可加入或取消。block 標題、出口、argument 標記不能選入，儲存時自動擷取 block arguments、SSA 與控制流程。選取以原始 block／layer 編號記錄，不會混淆不同 blocks 的相同 layer 編號。可一次加入目前 block 可見 layers 或整張圖可見 layers，超過 32 個 operators 時整次加入不生效；選取清單支援同圖定位、移除單一 block 與全部清除。切換字級、圖方向與完整／局部圖會保留選取。儲存後仍可匯出／匯入 version 2 pattern JSON；MLIR 匯出範圍可選局部選取或完整 function。

選取模式支援滑鼠左鍵拖曳框選，可從空白或 layer 上開始，往任一方向跨越多個 blocks；與選框有面積重疊的原始 layers 會加入現有選取，重複框選不會取消或重複加入。拖曳期間預覽命中節點及數量，放開後套用；超過 32 個 layers 時整次框選不生效。點選 layer 仍可單獨加入／取消，Alt＋左鍵拖曳保留平移；未啟用選取時沿用一般拖曳平移。Esc 可取消正在拖曳的選框；捲動、縮放、重畫或切換頁面時取消未完成的框選。手機觸控仍沿用原有點選及手勢。

跨 block 模式在同一 region 內比對 operator 類型、相對順序、block membership、SSA operand／result ports、branch argument routing 與 successor 順序；不跨 function 或巢狀 region，也不比對模型名稱、block labels、SSA 名稱；未加條件時不比對型別 shape 或 attributes。「目前 subgraph」在此模式指其所在完整 region。未選取內容仍是外部邊界；若要限制一個 block 的完整內容，請選入需要的全部 operators。

搜尋與 source SSA／dominance 檢查全在 Worker 執行；未知 branch 需 dialect adapter，無效 CFG 不會猜測接線。搜尋可取消，最多 50,000 筆、2,000,000 次候選／完整比對檢查，達限時顯示結果可能不完整。跨 block JSON 使用 version 2，保留結構節點與有類型的連線；version 1 的單 block patterns 仍可匯入。檔案不含模型／SSA 名稱、權重或原始 IR。

可在公司工具中用 `--mlir-print-op-generic` 輸出通用形式。內部 dialect 的 region kind、isolation、successor operands、terminator 與自訂 verifier，請透過獨立的 [profile／dialect adapter](docs/intranet-release.md) 接入，保留私有來源，不直接修改公開 registry。來源與匯出重驗共用同一 registry，無需修改搜尋器。顯示擴充、parser 替換位置、介面範例與測試方式見 [MLIR 擴充說明](docs/mlir-adapters.md)。TFLite 開檔不會載入 MLIR parser；TFLite 的 range stream 與子模型匯出保留原有方式。

## 匯出 TFLite 子模型

在 TFLite 模型圖上按「選取 pattern」，選取 layers 後按「匯出 TFLite 子模型」；單一 layer 也能匯出。也可在 pattern 搜尋後點選一筆匹配，再按「匯出此匹配為 TFLite 子模型」。只輸出選取的 operators，保留原 options、所需權重、tensor shape／dtype、量化及 sparsity 資料；不修改來源檔。只有 builtin op 的子模型會精簡 tensors／buffers 並重新編號；含 custom op 時採用下述保留編號模式。

選取區域外產生的中間 tensor 成為子模型輸入，常數權重仍放在模型中；對外有 consumer、原本是 graph output 或未被區域內消耗的輸出成為子模型 outputs，因此可保留多個出口。執行時須提供邊界輸入的實際值。JSON pattern 僅保存結構，沒有權重及 options，不能單靠 JSON 匯出可執行模型；需在開啟的 TFLite 中選取實際匹配。

支援無狀態、無子圖呼叫的 builtin 與 custom operators，兩者可混合選取。Custom 的名稱、版本、`custom_options_format` 與 options bytes 原樣保留，不要求瀏覽器理解其私有內容。含 custom op 時保留該 subgraph 全部 tensor metadata、全模型 buffer 編號及全部 buffer 資料，避免 opaque options 內的 tensor／buffer 索引因精簡而失效；因此即使只切少量 layers，輸出檔仍可能接近原模型大小。內部 runtime metadata 也保留；描述原輸入輸出邊界的 `TFLITE_METADATA` 和原 signatures／debug index 不沿用。

一般 inline custom options 保持原表示；超過 64 KiB 時只讀取位置與大小，顯示範圍摘要，匯出時改用 TFLite 的 external options 表示。原本的 `large_custom_options_offset／size` 也會重新定位；資料以 16-byte alignment 存在同一個輸出檔，從來源 File.slice／Blob 搬移。若原始檔同時有 inline 與 external options，保留 inline 優先的 runtime 行為。權重同樣使用 TFLite buffer offset／size，避免在 JavaScript 完整複製大型資料；執行環境須支援這些 TFLite buffer 格式。

執行 custom 子模型仍需你們的 custom kernel／delegate。Opaque options 不進行語意改寫；若私有格式另含絕對檔案位置、operator／subgraph 編號、外部檔案或其他初始化依賴，仍需內部 adapter 驗證。控制流程、會修改 variable 的 operators、被選取的 variable／resource／variant tensor、需要外部資料檔的 tensor 和未知 schema 欄位／union 暫不匯出。是否能在特定裝置執行取決於原 runtime 與輸入／初始化條件。

## 使用與開發

需要 Node.js 22 或更新版本及 Git checkout；建置本身不需安裝 npm 套件。部署封裝測試另外使用 Python 3 的標準 ZIP 讀取器。可選的 Chromium 大檔驗收另需 Playwright，操作見下方。

```powershell
node --test test/model.test.mjs test/hydrate.test.mjs test/subgraph.test.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

開啟伺服器輸出的本機網址。正式部署只需要 `dist/` 的靜態檔案。不能直接以 `file://` 開啟，因為使用 JavaScript modules 和 Web Workers。

## GitHub Pages

原始碼保留在 `main`，正式發布入口為 `Verified Pages release`。啟用時將 GitHub Pages 來源設定為 GitHub Actions，github-pages environment 僅允許 main。`gh-pages` 保留舊靜態產物供追查；切換完成後，直接推送該分支不再觸發網站更新。專案網址的子路徑也能使用，程式不依賴網域根路徑。

局部 MLIR 重新開啟時預設為精簡圖，只顯示匯出時圈選的原始 OP。匯出器補上的輸入、輸出有效旗標、block arguments 與控制路由保留在 MLIR 內，圖面將其收起並直接連接原始 OP；分支、匯合與迴圈回跳仍可查看。點精簡圖的連線可只展開該段隱藏的 SSA、block arguments 與控制路由，其餘支線保持收起；再點展開的連線可收起，也可從側欄逐段收起或「收起全部路徑」。共享的輔助節點只顯示一次，仍被其他展開路徑使用時會保留。展開／收起會保留目前縮放，並以該段仍存在的節點維持畫面位置；若端點原本在畫面外，會定位到畫面邊緣附近。選取 pattern 模式中也可點連線展開／收起，或用側欄收起路徑；已選的原始 layers 會保留，可繼續跨 block 框選，再儲存 pattern 或匯出 MLIR。展開的輔助節點不參與圈選 pattern。點「展開輔助節點」可檢視完整 SSA 與控制流程，再點「收起輔助節點」返回。此顯示切換不改動模型、匯出或 pattern 比對。較舊的局部檔案沒有圈選標記，預設顯示可驗證的原始 OP；套用原先儲存的 pattern 後會只顯示該匹配的 OP，或可重新匯出以記錄精確圈選。

反覆匯出相同選取時，會依有效的結構對照合併舊的自動入口路由，再建立一次匯出介面；原始 blocks 與明確圈選的輔助 OP 不會被合併。多出口 `func.return` 另保留原始資料輸出的 operand 對照，避免把出口編號、valid 旗標再包成資料輸出。對照失效的檔案不會套用入口整理；舊檔若無法可靠還原 return 的資料輸出，會提示從原模型重新匯出或改用完整 function。

```powershell
node scripts/build.mjs
node scripts/publish-github-pages.mjs --site-id SITE_ID_FROM_PREPARE
```

發布腳本以已登入的 GitHub CLI dispatch 受控工作流程，要求本機建置與目前 main 完全相同；不推送靜態分支。先用工作流程的準備模式核對 build ID，再以該 ID 發布。正式站逐檔 SHA、瀏覽器選檔／搜尋／匯出重開都成功後，才建立不可覆寫的固定版本 Release。GitHub Pages 通常公開，模型仍由訪客瀏覽器本機處理。完整步驟見 [Pages 發布](docs/pages-deployment.md)。

發布前另需已登入的 GitHub CLI（PATH 的 `gh` 或 `GH_BIN`），以及 `release-evidence.json` 指定的四項成功 CI。將 `SITE_ID_FROM_PREPARE` 換成成功 prepare 並審閱後的 64 位整站 ID。腳本會線上核對來源／artifact、重新建置逐檔比較，再發布完整隔離快照；缺少必要工作、來源或站台 ID 改變會拒絕。四關卡、完整版本隔離和固定 Release 提升已在 main，正式交付狀態見 [版本隔離](docs/versioned-site.md) 與 [正式切換驗收](docs/production-transition-verification.md)。詳見 [發布關卡與回退](docs/release-gates.md) 及 [實際驗收](docs/release-gates-verification.md)。內網建置與封裝仍可不連外。

Pattern 清單支援多分頁交易合併、同名衝突副本及舊版資料保留，見 [保存說明](docs/pattern-library-recovery.md) 與 [驗收紀錄](docs/pattern-library-verification.md)。

右上角「版本 → 本機診斷報告」可預覽及下載不含模型名稱／內容的操作紀錄，見 [診斷說明](docs/diagnostics.md) 與 [驗收紀錄](docs/diagnostics-verification.md)。

大型模型另有 [實體瀏覽器生命週期關卡](docs/browser-lifecycle-gate.md) 與 [八輪驗收紀錄](docs/browser-lifecycle-verification.md)，涵蓋 >1 GiB／21,005 OP 的選檔、下載重開、custom options、pattern 正反例及記憶體釋放。

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

局部連線展開使用本機路徑快取，每段預設最多 96 個實際輔助節點；長路徑可在側欄用「上一段／下一段」逐段查看。不同段落重疊一個節點以保持銜接，未顯示的部分以「已收起 N 個節點」保留邊界連線。多條路徑同時開啟時會分配額度，畫面最多 512 個輔助節點（含收合標記）、最多同時 16 段路徑。切段沿用原始 layers 選取與縮放，並以仍存在的鄰近節點維持定位。輔助節點與收合標記不會混入 pattern 或 MLIR 匯出。

路徑分析每次最多執行 50,000 個遍歷工作單位；尚未完成時保持精簡連線並顯示「繼續分析」，點選後接續，不會將不完整路徑當成完成結果。每個 region 快取最多 16 個路徑計畫，模型最多快取 4 個連線索引；另以拓樸及邊數控制閒置快取，使用中的大型索引／路徑可超過該回收目標，關閉模型後釋放。此上限限制額外畫圖資料，仍需保留原始模型及解析索引。

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

1.25 GiB 的合成權重測試使用虛擬 range reader，確認初始讀取量小於 8 MiB、最大單次讀取不超過 1 MiB，不會實際分配整塊合成權重。另以暫存資料夾的實體 1.25 GiB／6,002 operators 合成檔驗證 Node.js range reader，單次觀測讀取總量約 1.13 MiB、解析及建立索引約 264 ms。這些是記憶體／I/O 行為測試，不代表任何真實大型模型的載入時間。`node test/make-large-fixture.mjs` 目前預設產生單子圖／21,001 operators 的實體合成檔，供人工選檔測試；`node scripts/inspect.mjs <完整模型路徑>` 可在本機量測結構解析與搜尋。

另以 TensorFlow 官方 MobileNet V1 量化模型（31 operators／89 tensors）對照未修改的 Netron，核對 operator、輸入輸出、shape、dtype、量化參數、屬性與權重 bytes 相同；此公開測試檔保留在暫存資料夾，未加入專案或部署包。

瀏覽器已驗證小模型、6,002 operators 的合成模型、搜尋結果分頁、2,000 組 pattern 的局部圖與高亮、跨 subgraph、tensor 量化資料，以及圖方向切換。2026-10-22 另以實際檔案選擇器驗證 TFLite 與 JSON 匯入；JSON 單筆／全部實際下載、重複略過、無效檔案拒絕及重新整理後保存皆通過。1280×720、1024×600 展開五節點編輯器時，結果區分別保留 98／90 px、底部列沒有被擠出、頁面沒有水平溢位。2026-10-24 已用實體、非 sparse 的 1.25 GiB 權重／21,005 OP 合成 TFLite 在 Edge 實際選檔，完成六輪子模型下載、關閉及重開；權重完整雜湊、custom options 與 pattern 核對通過。每輪關閉並待下載 URL 撤銷後，model worker 為零，頁面記憶體約 9–10 MiB，未觀察到下載負載持續累積。這是有限次數的合成模型驗證；實際使用者模型的改善幅度仍待量測。

獨立 Chromium 合成大檔與 GitHub CI 的驗收另見下節，與上述 Edge 非 sparse 權重測試分開記錄。

### 核心效能 CI

相關核心變更的 PR 會執行固定 Node.js 22.23.3／Ubuntu 24.04 的三種規模、各三筆全新程序量測，檢查解析、搜尋、取消、RSS、跨 block 分段快取及匯出重開。亦可手動執行 `Core performance gate`，或本機執行 `node scripts/accept-performance.mjs --out test-results/new-performance-run.json`。CI 九筆已通過，來源與原始報告見 [驗收紀錄](docs/performance-gate-verification.md)，預算與限制見 [門檻說明](docs/performance-gate.md)。這一層量測 Node 核心，不代表下方原生瀏覽器或公司模型驗收。

### 可選的 >1 GiB Chromium 選檔驗收

`npm ci`、`npx playwright install --with-deps chromium` 後執行 `npm run test:large-browser`。以參數指定現有產生器的雙子圖案例，自動建立 1.25 GiB／6,002 operators 的稀疏合成實體檔，經 Chromium 原生 File API 與 Worker 驗證索引、局部圖、搜尋／分頁、取消、無效大檔恢復及子模型下載後重新開啟。另涵蓋 metadata 條件切換重搜、v3 pattern JSON、工作階段 JSON 與 SVG 選取／縮放恢復、重新整理後恢復，以及相同大小但 dtype 不同的模型拒絕。獨立的 GitHub Actions workflow 僅能手動啟動，不增加一般 CI 或 Pages 發布的巨型檔案負擔。

2026-10-25（台北時間），以最新 main `36211521c418948d612d576fd2515af04512f469` 為基準擴充測試，實際受測提交 `754f7cad8accf7a104673606f710c1de0995ea94`、乾淨來源樹 `8e7a1e4ba2462e96c07f6902f784d697e1f5d219`，本機 Chromium **18 項通過**。首次選檔 **375 ms**；6 次大型模型開啟各原生讀取 **1,189,156 bytes**；條件搜尋與工作階段指紋／保存額外讀檔 **0 bytes**；RSS 增量 **227.94 MiB**，頁面最大心跳間隔 **124.9 ms**。這是本次新來源的本機實測，未宣稱已有對應 GitHub 大檔 run。詳見 [條件／工作階段大檔驗證](docs/large-browser-conditions-workspace-2026-10-25.md) 與 [完整 JSON](test/browser/results/conditions-workspace-2026-10-25.json)。以下舊提交證據維持各自適用範圍。

2026-10-24 已整合至 main `ec31522`（保留新版 MLIR、圖形瀏覽與 resize 功能），本機 Chromium **11 組檢查通過**，含 TFLite 大檔流程及小型 MLIR 格式切換／搜尋／繪圖。初次選檔約 **294 ms**，原生讀取量仍為 **1,189,156 bytes**；Node.js **199 通過、0 失敗、35 條件式跳過**。上述為本機整合快照結果；另有獨立的 GitHub Actions 證據如下。環境、衝突處理、受測樹與限制見 [整合驗證紀錄](docs/large-browser-integration-2026-10-24.md)、[本機 JSON](test/browser/results/2026-10-24-chromium.json)。

合併後 GitHub 手動 run [40081739220](https://github.com/koviankevin/tflite-explorer/actions/runs/40081739220) 已於 2026-10-24 成功：Ubuntu 24.04.5、Node.js 22.23.3、Playwright 1.56.1、Chromium 141.0.7390.37，11 組驗收通過，首次選檔約 **331 ms**、原生讀取 **1,189,156 bytes**，JSON artifact 上傳成功。完整報告另存 [GitHub CI JSON](test/browser/results/2026-10-24-github-chromium.json)，受測提交 `4c78ce9`；與本機報告分開。PR Node／build 驗證亦已成功。首次使用 `ubuntu-latest` 的手動 run 因 Ubuntu 26.04 不支援固定 Playwright 而停在安裝階段，已由 PR #2 固定至 `ubuntu-24.04`；第一次失敗仍保留紀錄。大型驗收仍僅手動啟動，不變更 Pages 部署。

以下為 **舊基準 `6fbe65c`** 的歷史證據，不能代替最新 main 的驗證。2026-10-23 單次實測：Ubuntu 24.04.3 x64、Node.js 24.19.0、Playwright 1.56.1、headless Chromium 141.0.7390.37；cgroup 上限 8 GiB、CPU 配額 8 核，開始時可用記憶體約 4.4 GiB、暫存磁碟約 27 GiB。從自動選檔到索引與初始清單就緒約 **284 ms**，Worker 解析與索引約 **133 ms**；錯誤後重新載入約 **246 ms**。原生 FileReaderSync 共讀 **1,189,156 bytes（約 1.13 MiB）**，19 次、最大單次 **64 KiB**，與 worker range 統計相符。未發生大檔完整讀取、瀏覽器當機、頁面／Worker 未處理錯誤或模型上傳請求。

100 ms 取樣的 Chromium 程序樹 RSS 約 **409 → 峰值 536 MiB**（增加約 127 MiB），主頁 JS heap 峰值約 5.3 MiB；頁面 50 ms 心跳最大間隔約 99 ms。RSS 含共享頁重複計算且可能漏掉短暫尖峰，並非精確的全瀏覽器 JS heap。讀取觀察器會在單次 >1 MiB 或累計 >8 MiB 時先拒絕，避免完整載入回歸造成記憶體耗盡；取消案例使用測試專用的 metadata 回應暫停點。受管主機另有 Chromium 關閉後程序回收逾時的限制，已記入報告。詳細重現方式、通過條件與量測邊界見 [大檔驗收說明](test/browser/README.md)，[實測 JSON](test/browser/results/2026-10-23-chromium.json) 保留樣本與讀取證據。

同環境另跑 Node.js `scripts/inspect.mjs` 的合成實體檔讀取，解析與索引約 **150 ms**、讀取量同為 1.13 MiB。這是獨立的 Node.js 路徑，不包含 Chromium File API、Worker 啟動或畫面操作；既有 264 ms 也是另一次 Node.js 觀測，不能用兩次單次數據宣稱速度提升。以上皆為合成測試，仍缺少原始真實模型的改善幅度。

### 其他既有驗證


TFLite 子模型測試核對 options、量化、必要權重 bytes、兩個出口、邊界輸入與未知 schema 拒絕。另以 Google LiteRT 2.3.0 CPU Interpreter 實際執行含常數權重的原模型、兩層子模型、由中間 tensor 輸入的單層子模型及完整重新匯出模型，結果符合預期；從瀏覽器實際下載的兩層子模型也執行得到 `[5, 8]`。這是匯出檔的開發驗證，網站本身仍不執行推論。下載使用延後釋放的 Blob URL，避免瀏覽器尚未開始讀取即被撤銷。

Custom 切圖另涵蓋 inline／external options 逐 byte 相同、64 KiB 以上 inline options 延後讀取、3 GiB 虛擬檔案位置的 64-bit 搬移、兩種 options 同時存在時的優先順序、optional input `-1`、intermediates、原 tensor／buffer 編號、隱含 buffer 依賴與兩個出口。瀏覽器實際選檔、單獨選取 custom op、下載及重新開啟皆已驗證，下載檔再以 LiteRT 官方 Python schema 與 Interpreter 讀取核對。合成 custom kernel 未註冊，執行時預期回報 unresolved custom op；尚未驗證任何內部 custom runtime 的運算結果。

內建示範模型為合成結構，不是訓練完成或可用於推論的模型。本工具不修改來源模型，也不執行推論；子模型匯出會建立新的檔案。

## 上游來源及授權

本專案採 [MIT 授權](LICENSE)。新增程式碼著作權為 `Copyright (c) 2026 koviankevin`，Netron 的著作權屬 Lutz Roeder；根目錄 LICENSE 同時保留兩者聲明。

Netron: https://github.com/lutzroeder/netron

使用 Netron 9.3.2，固定來源 commit `0994fdd00d6668280b0b98a6f5323a736236208b`。完整 MIT 授權及原作者聲明保留於 `vendor/netron/LICENSE`，建置時另複製為 `dist/LICENSE-Netron.txt`。

`vendor/netron` 保留上游 source，新增 `Value`、`Tensor`、`Attachment` exports 供 adapter 使用，並在 `dagre.js` 的連線排序條件補上邊界／終端節點檢查，避免局部迴圈有外部 SSA 輸入時讀取不存在的 incoming／outgoing edge。`view.js` 的圖形 register 另保留圖外控制項的鍵盤焦點，避免重畫搶走字級選單或 modal 焦點。`scripts/build.mjs` 對產出的少數詳細資料標題作繁體中文翻譯。Netron Host 的遙測、地理位置查詢和遠端開檔啟動流程沒有啟用；頁面的 CSP 限制連線到同來源。
