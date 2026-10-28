# Firefox／WebKit 實體大檔生命週期

這是新增的唯讀、手動 hosted CI，首次真實執行失敗，原因與原始報告列於下文；八輪仍未通過。`.github/workflows/desktop-physical.yml` 在此 repository 的 main／Ubuntu 24.04 執行 Firefox 與 Linux WebKit；`engine` 可只補測失敗的引擎。沒有部署權限、外部模型 URL、公司模型或縮小案例的輸入。正式站維持 preview.18。

沿用 Chromium 實際寫滿非零權重、fsync／完整 SHA 讀回的 1.25 GiB／21,005 OP TFLite，同一瀏覽器八輪。每輪原生選檔、prefix／分支匯合 pattern、原始 OP 複製與整份模型匯出、>1 GiB 子模型下載／重開，完整串流比較權重、custom options、介面與 pattern 正反例；同種輸出 SHA 必須一致。獨立 Node 指紋對照每輪完整的瀏覽器指紋 Worker。探索及編輯固定 32px，viewport 1280×640，不測手機。

## 量測與歸屬

每次 launch 只對該瀏覽器傳入隨機環境標記；只檢查目前測試 Node 程序的直接子程序，取得唯一符合標記的根 PID。讀取 [`/proc` 的 PPid、start_time、VmRSS](https://www.kernel.org/doc/html/latest/filesystems/proc.html)，依 PID 加 start ticks 記錄歸屬；已觀察到的 orphan 持續計入，PID 重用不計入舊程序。從未讀取或輸出其他使用者的環境內容。正常關閉後，每個已知瀏覽器程序都必須消失，不能只看 root 不見。

每 500ms 加總所屬程序 RSS，涵蓋 browser、renderer 與 Worker 共用的程序；原始時間、相位、RSS 和程序數保存。沿用原有 768 MiB 峰值成長、128 MiB 關閉漂移、16 MiB／輪斜率；前兩輪暖機，後六輪判定。實際平均取樣間距最多一秒、任一缺口最多十秒，時間必須覆蓋完整八輪。保留原生 60 秒 Blob URL 撤銷及五筆關閉後樣本，不強制 GC、不重啟／重載清快取。

RSS 可能重複計入 shared pages，kernel RSS 計數亦非同步且非精確瞬時快照；取樣也可能漏掉短暫尖峰或首度觀察前就結束的子程序。Firefox／WebKit 沒有沿用 Chromium 的 CDP V8 isolate 介面，報告的 isolate heap／main heap 明確為 null，不以零冒充已量到獨立 Worker heap。Worker 的記憶體包含在整個程序樹 RSS；來源、完整編輯輸出與子模型重開各另取一個程序 RSS 檢查點。

每輪三個模型 Worker 與一個原檔指紋 Worker 必須有原生 close；應用 terminate 呼叫另存，兩者不可混為一談。其他未收到的 layout Worker 事件保留原值。若正常關閉失敗，只對已記錄且重新核對 start identity 的本次程序做失敗清理，該結果仍為失敗。

## 觀察器範圍

沿用已驗收的固定 Playwright chooser adapter 與隔離 DOM reader。實際 File／Blob 讀取仍套用 1 MiB／次、16 MiB／parser realm 的配置前保護；獨立指紋 Worker 只可按 1 MiB 分塊讀完原檔一次。一般及停用 eval 的小檔原生 chooser 對照必須先成功，之後才開大模型。

由於隔離世界不能讀 Netron 主世界的 JavaScript，測試 init script 另接受專用觀察事件，將白名單計數與 Worker／URL metadata 放到一個 data attribute；DOM reader 只讀該字串。沒有呼叫模型 API、改選取／接線、插入可見元素或保存 File／Blob。未知資料欄位不複製；超過 metadata 上限或型別不符直接失敗。每筆輸出仍由 Node 重新解析並比對完整 payload，不以此橋接資料當成匯出成功旗標。

測試環境的 read-only 校驗、原始 provider digest／CRC／job／來源與每輪證據需一起核對，才能宣稱通過。這不代替 macOS Safari／Windows Firefox、私有 custom runtime、MLIR 長時間負載、其他硬體或無限期不洩漏。


## 首次實際執行：觀察器主世界衝突

[40673748946](https://github.com/koviankevin/tflite-explorer/actions/runs/40673748946) 的 Firefox 142.0.1／WebKit 26.0 都進入第一輪：1.25 GiB 實體檔、獨立完整指紋、一般／停用 eval chooser、pattern JSON 及原生匯出已執行；尚未完成完整 payload 比對與八輪。兩者在 `locator.dispatchEvent` 等待 HTML 觀察事件時碰到 Netron 的 `window.eval() not supported`，整輪 failure。來源 `13c6526e5d473d86cf160c678bf0c6945b084dbd`、候選 build `4f430e93781fc171`／275 核心檔。原始 [Firefox](results/desktop-physical-firefox-observer-failure-2026-10-28.json)／[WebKit](results/desktop-physical-webkit-observer-failure-2026-10-28.json)及 [provider／CRC／來源核對](results/desktop-physical-observer-review-2026-10-28.json)保留失敗。

這是觀察傳輸的世界選擇錯誤。後續以專用 `contentScript` selector 在隔離世界直接派送唯一的觀察事件，從未插入文件的 output 讀取同一份白名單資料；不改 Netron、CSP 或 window.eval。每次先移除前次 metadata attribute，未取得新回應就失敗，不能用舊快照冒充成功。VM 的主世界／隔離世界共用 DOM 測試在原 dispatch 路徑先失敗，修正後通過，並確認主世界 eval 保持停用、回應遺失不會重用資料、註冊明確設定 contentScript。真實引擎仍需重跑；新增開模型前的觀察傳輸 preflight，不能拿單元測試代替。

未完成階段的原始 RSS 仍保留：Firefox 取樣峰值 2,826,616,832 bytes，相對基準成長 2,008,670,208 bytes，已超過事先固定的 768 MiB 成長門檻；WebKit 分別為 1,402,253,312／705,003,520 bytes。這是第一輪部分操作的觀察值，不能宣稱八輪合格或證明持續洩漏；修正觀察器後仍沿用原門檻，並追查 Firefox 的資源來源。兩者正常關閉後，所有已追蹤 PID/start identity 均消失，未強制清理。Worker 的原始事件不改寫，沒有獨立 isolate heap 數值。

## 完整八輪重測：功能通過、RSS 峰值不合格

[40676323150](https://github.com/koviankevin/tflite-explorer/actions/runs/40676323150) 已於 2026-10-28 11:11 UTC 結束，受測來源 `e157eecfd317d8bff0236ff7981c1a5da0d57784`、候選 build `9d49909371cffa07`／275 核心檔。Firefox 142.0.1 與 WebKit 26.0 都完成八輪完整編輯、>1 GiB 子模型匯出重開、完整權重／custom options／固定輸出 SHA、原檔指紋、pattern 正反例；每個引擎的 24 個模型及八個指紋 Worker 都收到原生 close，沒有 page error，所有已追蹤 PID/start identity 正常結束，未強制清理。隔離觀察器修正已由這次實際執行確認。

兩個 job 的最終狀態仍為 failure，唯一判定項都是 `browser-peak-growth`；不能寫成八輪驗收通過。

| 引擎 | 取樣 RSS 峰值 bytes | 相對最初基準成長 bytes | 暖機後關閉漂移 bytes | 關閉斜率 bytes／輪 |
| --- | ---: | ---: | ---: | ---: |
| Firefox | 4,213,723,136 | 3,405,914,112 | 35,713,024 | 8,262,802.29 |
| WebKit | 1,524,629,504 | 816,934,912 | 26,128,384 | 10,014,485.94 |

峰值成長上限仍為 805,306,368 bytes（768 MiB）。Firefox 的最大取樣發生在子模型匯出相位，WebKit 在完整模型匯出相位；這是相位關聯，尚不足以把原因歸給 Blob、引擎內部複製或應用持有參照。關閉漂移／斜率在八輪門檻內，只能描述這次有限區間；仍需進一步定位峰值資源，不調高上限、重設基準或將 summed RSS 換成較小數值取得綠燈。

原始 [Firefox 報告](results/desktop-physical-firefox-cycles-2026-10-28.json)、[WebKit 報告](results/desktop-physical-webkit-cycles-2026-10-28.json)與 [provider digest／CRC／來源核對](results/desktop-physical-complete-review-2026-10-28.json)均保存。完整報告已重新計算原判定並核對來源、job／attempt、固定 fixture、native chooser、核心檔 HTTP 身分與程序清理；authentication passed 與 acceptance failed 分開標示。這次受測應用與正式 preview.18 的程式相同，只有測試工具／證據變動，未再次部署。

## 增加每個程序的記憶體分類

原報告可在 Node 中重播相同判定，確定峰值仍失敗；下一步觀察不調整應用、模型、八輪工作量或任何上限。先區分三個尚未證實的來源：輸出資料配置到記憶體、跨程序共享映射被 RSS 加總、應用參照未釋放。它們分別預測匯出相位的單一程序配置增加、多程序共享／映射欄位一起增加，或關閉後仍隨每輪累積。分類只能縮小範圍，不能直接證明 Blob 的儲存方式或共享到哪些實體頁面。

`process-memory-profile.mjs` 只讀既有 owned tree 已確認的 PID，取得 [Linux status 欄位](https://www.kernel.org/doc/html/latest/filesystems/proc.html)：VmRSS、RssAnon、RssFile、RssShmem，以及經字元白名單限制的程序名稱；不讀 cmdline、environ、模型資料或其他使用者的程序明細。讀 status 前後各核對一次 stat 的 PID／start ticks，PID 重用的數值完全丟棄。程序已退出／欄位缺失保留 exited／reused／null；權限及格式錯誤仍使 sampler 失敗，不能當作零或忽略。

每筆分類都錨定原有 RSS sample 的時間／相位／數值，另記後續讀取的起訖、各程序數值及與原 RSS 的差額。分類取樣不是同一瞬間，kernel RSS 計數亦可能非同步，不能把差額校正成零；分類合計不取代事先固定的 RSS 判定。原本取樣密度及缺口要求仍適用，讀取額外欄位的負擔也留在實測中。缺失欄位使完整分類數下降，不能宣稱已量到；沒有偽造獨立 Worker heap 或使用較小的 PSS 取得綠燈。

Node 正負例檢查單位／真正的零／未知值、只讀已確認 PID、讀取途中 PID 重用、權限失敗、時間／相位／RSS 錨點、合計及差額不可被改寫。完整真實引擎分類尚待執行及 provider 核對；只新增測試工具，正式站不需重新發布。

## 分類實測：匿名記憶體增量的位置

[40683234690](https://github.com/koviankevin/tflite-explorer/actions/runs/40683234690) 已完成八輪並核對 provider digest／CRC、來源 `c64657e6549d7924b650c046a5299658b01c2278`、候選 build `d06fb216d4a7d3c1`、275 核心檔 HTTP 身分及原判定。Firefox 1463 筆分類、WebKit 1486 筆，全部有完整欄位，沒有已退出或 PID 重用的分類缺口；最慢額外讀取分別約 34ms／91ms，原取樣密度及最大缺口仍在門檻內。每個引擎的八輪功能、完整 payload、權重／options、pattern 正反例及 24 模型／八指紋 Worker close 均完成，所有 owned 程序正常結束，errors 為空。

兩個 job 仍只有 `browser-peak-growth` 失敗：Firefox 峰值 4,100,616,192 bytes／增量 3,261,558,784 bytes；WebKit 峰值 1,503,100,928／增量 806,187,008 bytes。上限維持 805,306,368 bytes，WebKit 即使只超出 880,640 bytes，仍保留 failure，不重新量到較低值就宣稱修好。

Firefox 峰值附近，名稱為 firefox 的根程序匿名記憶體約 3175.5 MiB，最初約 227.2 MiB；全體共享欄位約 5 MiB、檔案映射約 428→452 MiB。第一次完整匯出已使根程序匿名記憶體升至約 1843.9 MiB，子模型匯出又升高。這將主要增量定位到根程序的匿名區域，較不支持主要只是共享欄位重複加總的解釋；仍須獨立 File／Blob／Worker 傳遞／URL／下載控制案例，不能由數字直接斷定哪個 API 複製資料。WebKit 的主要增量則在 WPEWebProcess，匿名記憶體最初約 214.2 MiB、峰值附近約 950.3 MiB，共享欄位約 6.3 MiB。

完整原始報告以不變的 provider ZIP 保存，減少純數值重複資料的儲存量：[Firefox 原始 ZIP](results/desktop-profile-firefox-2026-10-28.zip)、[WebKit 原始 ZIP](results/desktop-profile-webkit-2026-10-28.zip)。解壓後是各自唯一的 `desktop-physical-firefox.json`／`desktop-physical-webkit.json`，原 bytes／SHA 與 [完整來源核對及相位摘要](results/desktop-profile-review-2026-10-28.json)一致，沒有刪除取樣或改寫旗標。authentication passed 與 acceptance failed 分開保留。

另修正離線分類複核的 PID namespace 邊界：純資料驗證不把歷史 browser PID 與目前讀報告的 Node PID 比較；實際 live capture 仍排除自己的 Node 程序。相同實作在不同 VM reviewer PID 中先重現誤拒，修正後通過，既有這次分類摘要重新計算保持相同。這不改 live capture 的允許集合、RSS 判定或既有測量結果，無須因此重跑未變的八輪工作量。

## 單次 File／Blob 控制案例

`blob-control.yml` 是另一個唯讀、手動 hosted Linux CI，只接受 main／本 repository 與固定 Firefox／WebKit 引擎。不修改應用，也不成為 Pages 部署前置。它重建相同實體公開 fixture，獨立開啟瀏覽器，用原生選檔及明確按鈕分開量：Worker 建立 Blob、Worker File 小範圍讀回、傳回 main、建立 URL、原生下載、main File 包裝、清理參照及原本 60 秒自然 URL 撤銷。每段都有 500ms 程序樹 RSS 與分類，保留讀取時差及缺失欄位。

控制 Blob 由原檔真正的前 64 KiB 加上其餘原檔切片組成，輸出應與原檔逐 byte 相同。Worker 只讀 65,536+64+64 bytes，每次及累計都有配置前上限；下載後在 Node 以 1 MiB 分塊重算完整 SHA，必須等於實際 1,349,965,216 bytes fixture 的固定原 SHA。沒有用零值稀疏權重、小檔或跳過完整下載代替實體資料。只有報告上傳，模型、控制下載及自行建立的暫存資料皆在使用後清理。

這是用來分離原生 API 的診斷，不執行應用的模型編輯、pattern 或八輪記憶體驗收。報告明確使用 `diagnosticOnly: true`、`memoryAcceptance: not-evaluated`、`completed/failed`，不以控制案例的綠燈代替原本失敗的 RSS 門檻。故意保留各階段 alias，再明確清理以觀察變化；不強制 GC、不重啟中途瀏覽器、不縮短 URL timer。Native Worker close、完整輸出、乾淨來源及 owned PID/start ticks 清理仍須成功。

17 項相關 Node 檢查已通過，涵蓋相同 worker/page callback、>1 GiB 虛擬範圍的配置前讀取保護、操作順序、固定 60 秒 timer、所有權及實體 fixture 產生器；真實控制量測仍待 CI 執行，尚不能宣稱已找出配置來源。

### 跨組合邊界的單變量控制

第一版控制 [40691244307](https://github.com/koviankevin/tflite-explorer/actions/runs/40691244307) 已完成兩個引擎的原生下載、完整固定 SHA、Worker close、自然 URL 撤銷及 owned 程序清理；沒有重現應用的高峰。這是診斷結果，不是八輪記憶體驗收通過。原始八輪報告以同一判定器離線重播，兩個引擎仍都只有 `browser-peak-growth` 失敗。

第二版控制只在原本的 Worker File 首尾讀取之後、傳回主執行緒之前，增加一次 `[65,504, 65,568)` 的 64 bytes 讀取。這個範圍跨過原本 65,536 bytes typed prefix 與其餘原檔 File slice 的接點；第一版首尾讀取都沒有跨過它。額外相位為 `worker-boundary-read`，報告版本提升為 2，累計讀取由 65,664 增加至 65,728 bytes。Blob、下載內容與完整 SHA、取樣、參照保存、60 秒 URL timer 及程序清理保持相同。若這個微小讀取觸發大幅配置，才有證據進一步查組合 Blob 的讀取行為；若沒有，就不能把原因歸給它。

新 Node 測試先在缺少 boundary 動作的原版失敗，再驗證實際 Worker/page callbacks 的固定讀取範圍、一次性與順序限制；18 項相關檢查通過。真實引擎的第二版控制仍待 hosted CI。沒有修改應用或原記憶體門檻，也不要求重新部署正式站。

### Firefox 跨邊界控制結果：沒有重現大幅配置

[40714224427](https://github.com/koviankevin/tflite-explorer/actions/runs/40714224427) 已完成 Firefox 單一引擎的第二版控制。來源 `9c273a8a4beb68a4bdaca4e458d96c08e3f70a38`／tree `0f2d02a20a5d48d2dc8b81d9340fe8ed63fb2c4f`，與 PR 的受測內容一致；Node/build [40713815293](https://github.com/koviankevin/tflite-explorer/actions/runs/40713815293) 和 contract [40713815146](https://github.com/koviankevin/tflite-explorer/actions/runs/40713815146) 通過後沿用，沒有再跑不變的應用關卡。

跨接點讀取前的 owned 程序樹 RSS 為 725,778,432 bytes，讀取後為 698,527,744 bytes；補充分類的匿名記憶體為 294,674,432 → 265,916,416 bytes，該相位原始 RSS 取樣峰值 704,753,664 bytes。這次沒有重現原應用約 1.25 GiB 級別的額外配置，不能把單一組合邊界讀取判為原因；數值下降也不代表這個讀取會節省記憶體。這只檢查單一 64 bytes 跨接點讀取，沒有證明所有 Blob 結構、讀取模式或另一引擎的行為。

原生下載仍為完整 1,349,965,216 bytes，SHA 與固定實體 fixture 相同；累計 Worker 讀取 65,728 bytes、最大單次 65,536 bytes。唯一 Worker 原生 close、60 秒自然 URL 撤銷、乾淨來源及全部已知 owned PID/start identity 清理通過，沒有 page error。完整 [provider ZIP](results/blob-boundary-firefox-2026-10-28.zip) 與 [provider digest／ZIP CRC／來源、相位及完整 bytes 的獨立核對](results/blob-boundary-firefox-review-2026-10-28.json) 保留；原始 `blob-control-firefox.json` 在 ZIP 中，沒有刪減取樣。

這是排除一個簡單重現條件的診斷進展，不是應用八輪 RSS 驗收成功，也沒有因此調整上限或重新部署。下一個單變量是原應用在觸發下載後立即包裝輸出 File，控制案例目前則等原生下載完成才包裝；此差異仍未測，不能先改應用宣稱修正。

### File 包裝時機的控制

第三版報告保留相同實體 fixture、Blob 與讀取範圍，診斷 helper 僅接受封閉的 `after-download`／`during-download` 值。Hosted 入口沿用既有 workflow，此版固定預設執行 `during-download`：在 `link.click()` 後的 fulfilled-promise continuation 建立 File，對應應用 `await host.export()` 不等待原生下載完成就呼叫 `remember()` 的次序。下載完成後包裝的基準 helper 仍有 Node 回歸驗證。driver 讀取包裝計數後才等待 native download completion，兩種次序都有相同的後續取樣、完整 SHA、60 秒自然 URL 撤銷及清理，不增加 workflow 輸入或帳號權限。

報告記錄選項、頁面操作次序與時間、一次性包裝數，以及 driver 開始／結束等待的時間。這證明控制呼叫次序；不以 Playwright completion promise 的觀察時間冒充引擎內部實際複製區間。尚未改動應用，也未調整既有八輪 RSS 門檻。

20 項相關 Node 檢查通過，新增測試先在舊版以尚未包裝而失敗，再驗證真正的 page／worker callbacks、microtask 次序、只包裝一次、封閉選項、原有讀取預算及自然 timer。真實 Firefox 控制量測仍待 hosted CI；結果不能代替應用八輪驗收。

### Firefox 包裝時機結果：沒有單獨重現高峰

[40723799543](https://github.com/koviankevin/tflite-explorer/actions/runs/40723799543) 完成第三版 Firefox 控制，來源 `724dbe04cff5aeeaf15a34cc8ecf2fd516ae74af`／tree `e71c39f653bf38453e5382443c6f96f12fbaa84d`。頁面已包裝一次後 driver 才開始等待下載完成，兩個 driver 觀察時間相距約 4.36 秒；不將此觀察時間當成原生複製的精確區間。

Object URL 後的 RSS 697,057,280 → 下載完成後 700,764,160 bytes，該相位取樣峰值 703,639,552、整段控制最高 723,763,200 bytes。這個先包裝、後等待完成的簡單控制仍沒有重現原應用的大幅配置。完整 1,349,965,216 bytes 下載 SHA、65,728 bytes 累計／65,536 bytes 最大單次讀取、唯一 Worker close、自然 URL 撤銷及所有 owned PID/start identity 清理通過。保留 [原始 provider ZIP](results/blob-wrap-firefox-2026-10-29.zip) 與 [digest／CRC／來源、次序及量測核對](results/blob-wrap-firefox-review-2026-10-29.json)，沒有修改應用或門檻。

### Preview.21 應用的兩引擎八輪結果

新增手動 runtime／dtype 亂數後的應用另以 [40724931148](https://github.com/koviankevin/tflite-explorer/actions/runs/40724931148) 執行一次完整八輪。來源仍為 `724dbe04cff5aeeaf15a34cc8ecf2fd516ae74af`，與固定正式 preview.21 的 `src`／`vendor`／建置程式及相依套件沒有差異；候選 build `c62686e2d0079cef` 的來源 metadata 不同，沒有為此重新部署。

[獨立核對](results/desktop21-memory-review-2026-10-29.json)重新建置相同 292 檔，逐項比對所有實際 HTTP bytes／SHA、manifest、provider ZIP digest／CRC、來源與原 RSS 政策。失敗與成功報告都獨立重算判定；兩個引擎均完成完整八輪工作與 read／fingerprint audits，每個引擎的 24 個模型與八個指紋 Worker 關閉，全部 owned 程序正常清理，沒有 page error。權重、custom options、完整及局部匯出重開、pattern 正反例均通過。

| 引擎 | 八輪判定 | RSS 峰值 bytes | 相對基準成長 bytes | 暖機後關閉漂移 bytes | 關閉斜率 bytes／輪 |
| --- | --- | ---: | ---: | ---: | ---: |
| Firefox 142.0.1 | 失敗，只有 `browser-peak-growth` | 4,165,541,888 | 3,344,564,224 | 24,031,232 | 6,210,238.17 |
| Linux WebKit 26.0 | 本次通過 | 1,439,420,416 | 783,192,064 | 42,979,328 | 10,023,848.23 |

峰值成長上限仍為 805,306,368 bytes；WebKit 本次僅剩約 21 MiB 餘裕，先前其他來源的失敗仍保留，不能說已找到或修正其原因。Firefox 主程序在完整匯出相位的匿名記憶體約 1,848,414,208 bytes，在局部匯出相位的峰值附近約 3,350,495,232 bytes；主要配置位置仍在 parent。這是後續定位依據，不是配置呼叫堆疊或獨立 Worker heap。

保留 [Firefox 原始 ZIP](results/desktop21-memory-firefox-2026-10-29.zip) 與 [WebKit 原始 ZIP](results/desktop21-memory-webkit-2026-10-29.zip)，各含完整原始 JSON／所有取樣。這是目前來源的有限八輪結果；Firefox 記憶體仍待修正，也不代替其他 OS、公司模型、實體硬體或此來源數小時負載。

### 後續控制需涵蓋真實匯出組成

[結構診斷](results/desktop21-export-layout-2026-10-29.json)以目前 parser／draft／exporter 和公開 fixture header 觀察 Blob parts：21,005 個原始 OP 複製新增後，結構 Uint8Array 為 8,268,412 bytes，另有 1.25 GiB 來源切片、三個向原 metadata 回讀的 8 bytes 切片及 padding，共九個 parts。先前控制只有 64 KiB typed prefix 加上一個連續檔案切片。

這個 Node 診斷使用 opaque 虛擬權重，讀取的部分頁面有明確記錄；只用來觀察結構與範圍，沒有配置或核對整份實體權重，也沒有瀏覽器記憶體驗收。後續可分別控制約 8 MiB 的結構區與多個反向檔案切片，避免只憑簡單控制未重現就修改應用。真實八輪的物理資料完整性由上一節的原生下載及完整串流核對證明。

### 結構區大小控制

第四版控制將 typed prefix 長度由 65,536 改為實際匯出診斷量到的 8,268,412 bytes，其餘仍是一個連續來源檔案切片。Prefix 取原檔相同長度的 bytes，因此整份輸出仍必須等於原實體 fixture 的固定 SHA；這只模擬記憶體片段大小，不聲稱 prefix 內容就是編輯後的 header，也還沒有模擬真實的九個 parts。

Worker 按 64 KiB 頁面填入 prefix，最大實際單次讀取仍為 65,536 bytes。為容納這個結構區，控制程式的累計讀取預算由原簡單案例的 1 MiB 改為應用既有的 16 MiB realm 預算，預期實際為 8,268,604 bytes；應用本身的任何讀取／RSS 門檻都沒有改動。控制報告版本為 4，另記錄 `readPolicy`；跨接點讀取跟隨實際 prefix 邊界。舊 64 KiB helper 的讀取範圍仍有回歸檢查，不開放任意大小配置。

22 項相關 Node 檢查通過，新增大 prefix 測試先在舊版以 65,536 而非 8,268,412 bytes 失敗，再檢查分頁讀取、完整虛擬來源大小與非法 prefix 拒絕。包裝時機、原生下載及完整 SHA、500ms 取樣、60 秒自然撤銷與所有權清理保留。真實 Firefox 實測尚待完成，不能以這些 Node 檢查當成記憶體問題修正。

### 大 prefix 重現 Object URL 相位的配置

[40730432530](https://github.com/koviankevin/tflite-explorer/actions/runs/40730432530) 的第四版控制已完成，來源 `17bb484ce1aa563852b1a814b2d47d9e329e5836`。[原始 ZIP](results/blob-header-firefox-2026-10-29.zip)與 [provider digest／CRC／來源、完整 SHA 及分類核對](results/blob-header-firefox-review-2026-10-29.json)保留。原實體檔的全部 1,349,965,216 bytes SHA 仍相同，累計讀取 8,268,604 bytes、最大單次 65,536 bytes，Worker／自然 URL／owned 程序清理通過。

Worker 建立 Blob、File 讀回、跨接點讀取及傳回 main 後，RSS 檢查點仍約 680～711 MiB；建立 Object URL 後升至 2,068,127,744 bytes，匿名記憶體約 1.51 GiB。下載相位及整段控制最高 2,733,449,216 bytes。相較於前述 64 KiB prefix 的低峰，這重現了大型記憶體 prefix／File 混合 Blob 在 Object URL 相位的配置增量，沒有藉由 JavaScript 讀完整權重。

### 分段記憶體 Blob 的修正候選

`FlatbufferWriter` 改由共用 `memoryBlobParts` 將超過 64 KiB 的序列化結構區包成各自獨立的 64 KiB Blob，再與原本來源 File slices 合成；小結構區沿用原方式。序列化 table、offset、range 對照及權重切片都保持原樣，沒有磁碟暫存、強制 GC、提早撤銷 URL 或提高上限。

第五版控制在相同大 prefix／相同 bytes 下使用這個實際修正 helper，記錄 prefix parts 數量及最大大小，供 Firefox 原生測量。真實 writer 回歸先在舊版因多 MiB 記憶體 part 失敗，修正後原 fixture header SHA `dd3531a96a0148db3a3a02fd94524dbb6f96b4123630b36a2b43ef172c25d826` 保持相同。59 項相關 Node 檢查通過，涵蓋分段 byte 相等、writer、custom options、64-bit 外部 offset、量化、報告串流對照、權重、草稿與匯出重開；這還不是原生記憶體或正式部署成功，preview.22 須通過後續控制、實際八輪及受控發布。

### 分段仍不足，繼續隔離 prefix 的 Blob 表示

[40734255325](https://github.com/koviankevin/tflite-explorer/actions/runs/40734255325) 來源 `ee8437bd5828b6230d8cb874cdbf84bef84d67f6`，第五版使用 127 個各自獨立的記憶體 Blob，最大 65,536 bytes。[原始 ZIP](results/blob-chunk-firefox-2026-10-29.zip)與[獨立核對](results/blob-chunk-firefox-review-2026-10-29.json)證明完整原始檔 SHA、分頁及跨邊界讀取、60 秒自然撤銷、Worker 與 owned 程序清理保持有效。建立 Object URL 的 RSS 檢查點降至 1,312,296,960 bytes，但原生下載整段峰值仍為 2,256,601,088 bytes；自然 URL 撤銷檢查點仍約 1.94 GiB。分段只改變配置的量與時機，不能當成修正完成或通過應用上限，preview.22 不因此發布。

第六版控制回到單一相同大小 prefix，僅先經由 `new Response(new Blob([prefix])).blob()` 轉換，再與原檔切片合成。只轉換 8,268,412 bytes 結構區，沒有對整份權重執行 Response／arrayBuffer；不建立網路 request 或應用持久化快取。Mozilla 的 [MutableBlobStorage 原始碼](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/file/MutableBlobStorage.cpp)有可轉暫存檔的 Blob 路徑，這只是本次實驗動機；不能推定目前鎖定引擎一定使用該路徑。報告版本為 6，明確記錄 `memoryPolicy.kind=response-prefix-blob`，必須量實際 RSS 才能判斷。

新增兩項回歸先在舊版因過早發布 `built`、忽略轉換錯誤而失敗；修正後與所有權、實體 fixture 共 25 項相關 Node 檢查通過。新檢查驗證轉換只收到結構區、完成後才發布混合 Blob、錯誤不會變成可下載成功、任意 storage 選項及缺少 Response 均拒絕。最大單次／累計讀取、完整下載 SHA、取樣、自然撤銷、RSS 上限及原應用功能測試政策均未調整。

### Prefix-only Response 對照與實際匯出候選

[第六版 40735769423](https://github.com/koviankevin/tflite-explorer/actions/runs/40735769423)，來源 `7687b1d26507ae92d051173204cf5b29c67f7050`，已完成 Firefox 對照。[原始 ZIP](results/blob-response-firefox-2026-10-29.zip)與[獨立核對](results/blob-response-firefox-review-2026-10-29.json)包含完整原始 bytes／provider digest／CRC、固定來源、完整 1,349,965,216 bytes 下載 SHA、所有取樣與自然清理核對。最大單次 65,536、累計 8,268,604 bytes、60 秒 URL、Worker 與 owned 程序規則保持相同。

整段 RSS 峰值為 745,517,056 bytes（約 711 MiB）；Object URL 檢查點 691,933,184，下載檢查點 692,662,272，下載相位峰值 698,347,520 bytes。這次不再出現原來約 1.25 GiB 的配置增量，但仍是單一診斷，沒有聲稱實際應用八輪已通過或直接證明原生暫存檔的實作。

實際候選保留同步 writer／既有 export API，使用 WeakMap 在同一個 Worker 內記錄 Blob 的結構區長度，不讓快取持有模型。送出 TFLite 子模型、編輯工作區或進階 OP 編輯結果前，僅對超過 64 KiB 的新結構區執行本機 Response 轉換，再與原 Blob 的其餘切片組合；先完成轉換，再驗證候選及回傳下載結果。小型結構與 MLIR 原樣通過，轉換失敗回報原因，不用較高記憶體方式偷偷重試。沒有 fetch、模型上傳、OPFS 或應用持久化暫存，也沒有讀取完整權重。

48 項相關 Node 檢查通過：兩種真實 writer（完整模型／custom 子模型）的結構區準備、所有 output bytes／provenance 保持相同、權重與 custom options 重開、重複準備冪等、缺少 API／轉換失敗／短寫拒絕，以及原有量化、64-bit offsets、草稿、報告與控制子圖。新增測試調整公開 fixture 的 OP 數，確保完整與局部兩種 header 都實際超過 64 KiB，不以小模型誤當大型路徑。接著仍須跑實際八輪與必要發布關卡；正式站尚未改成這個候選。

### preview.22 候選的三引擎八輪與發布關卡

實際應用來源 `22d432f1ed47986bd812d8ec1e8ddea84f48bf20`、tree `099a57ce050b5a7a0d4aa15911b6f61c6105857c`，候選 build `1ca8281cc8277c96`／293 檔。這次是上節修正接入三個實際匯出入口後的完整應用驗證，不再只用 Blob 控制代表應用。

[Firefox／WebKit 八輪 40737474917](https://github.com/koviankevin/tflite-explorer/actions/runs/40737474917)與[獨立核對](results/desktop22-memory-review-2026-10-29.json)通過：重新建置相同來源，逐一比對所有 293 個 HTTP 檔 bytes／SHA 與 manifest；provider ZIP digest／CRC、來源、原 RSS 政策、全部讀取／指紋證據均重新判定。各引擎 24 個模型及八個完整原檔指紋 Worker 關閉，全部 owned 程序正常退出，沒有 page error。公開實體 1.25 GiB、21,005 OP 模型在每輪完成複製改模、整份下載與子模型匯出重開；完整權重、custom options、pattern 正負例及 32px 筆電操作通過。

| 引擎 | RSS 峰值 bytes | 相對基準成長 bytes | 暖機後關閉漂移 bytes | 關閉斜率 bytes／輪 |
| --- | ---: | ---: | ---: | ---: |
| firefox | 1,304,584,192 | 479,473,664 | 34,430,976 | 8450750.17 |
| webkit | 1,440,083,968 | 772,317,184 | 36,462,592 | 10382423.77 |

[Firefox 原始 ZIP](results/desktop22-memory-firefox-2026-10-29.zip)與[WebKit 原始 ZIP](results/desktop22-memory-webkit-2026-10-29.zip)保留全部原始 JSON。原峰值成長上限仍為 805,306,368 bytes；Firefox 從前次 3,344,564,224 bytes 降至 479,473,664。WebKit 本次餘裕約 31 MiB，不能當成所有設備或數小時負載的保證；歷史失敗均保留。Worker 記憶體包含於 owned RSS，未冒稱獨立 Worker isolate heap。

[Chromium 八輪 40737487020](https://github.com/koviankevin/tflite-explorer/actions/runs/40737487020)也通過：RSS 峰值 992,620,544、成長 474,218,496、關閉漂移 23,121,920 bytes，關閉斜率 1,713,532.34 bytes／輪。三引擎的讀取門檻、完整模型／子模型及自然 URL 釋放流程未降低，不使用強制 GC。

[四關卡獨立收據](results/prefix22-release-gates-2026-10-29.json)核對原始 provider artifacts、全新候選重建、原始判定與逐檔 scope。核心九筆沿用 [40700051621](https://github.com/koviankevin/tflite-explorer/actions/runs/40700051621)，fingerprint `d25a85aa0caf6999326ea9a4b45298714960c89f9d3146dfe888350f1e4dd01a` 相同；新 Chromium、[77 項發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/40737501030)與[六種網站切換](https://github.com/koviankevin/tflite-explorer/actions/runs/40737514449)均是本次 main 手動成功結果。原始 ZIP：[core](results/prefix22-gate-core-2026-10-29.zip)、[browser](results/prefix22-gate-browser-2026-10-29.zip)、[contract](results/prefix22-gate-contract-2026-10-29.zip)、[site](results/prefix22-gate-site-2026-10-29.zip)。

本節是候選驗收；當時正式站為 preview.21，需再完成準備產物審閱、受控部署與正式站／固定 Release 下載核對。其他 OS、公司模型／compiler／custom kernel、固定實體硬體 SLA 及本來源長時間量測仍待驗證；不把整體商品等級目標標成完成。

### preview.22 第一次部署的啟動驗證失敗

[40741440704 attempt 1](https://github.com/koviankevin/tflite-explorer/actions/runs/40741440704) 已成功準備並部署來源 `e654829c9c51a0f163ec3e986ce3e8b8bc8cbe3b`／build `04aa44009821ed92`，但正式站原生驗證等待 `welcome-open.onclick` 綁定 30 秒逾時，固定 Release 工作被略過。Pages 的 1,373 檔 bytes／SHA／MIME 全數核對成功，瀏覽器報告的 `errors`、`workers`、`checks` 都是空陣列；這不能證明逾時的原因，也不能當成正式交付完成。

[原始報告與截圖 ZIP](results/preview22-startup-failure-2026-10-29.zip)及[獨立 provider／CRC／來源／attempt 核對](results/preview22-startup-failure-review-2026-10-29.json)保留，沒有把失敗刪除或直接重跑到成功。三引擎八輪及隔離網站相同應用曾通過，故先補 CI 啟動資源觀察，區分網路／模組請求未完成、刻意延遲圖形初始化與 DOM 時序，而不提高逾時或變更應用猜測修正。

新的診斷只在選取任何模型前收錄同站 GET document／script／stylesheet／image，最多 128 筆、console errors 最多 32 筆，記錄相對路徑、狀態、content type、完成／失敗時間與刻意暫停的 zip 模組。URL query／credentials／外站網址及 file／data URLs 排除或遮罩；不讀取回應 body 或模型，不記錄認證 header。開檔按鈕與延遲圖形檢查已就緒時停止收錄，失敗則保留當下 pending 請求。原 30 秒門檻、原生請求路徑、刻意暫停及全部功能驗證不變。三項 Node 檢查涵蓋請求狀態、上限／同站範圍／開檔後停止，以及文字中的敏感 URL 遮罩。

### 相同公開應用的啟動診斷結果

[40745643509](https://github.com/koviankevin/tflite-explorer/actions/runs/40745643509) 使用診斷 driver 來源 `d6a0d2be828eb2473ce697ff1a635f219835a07a`，實際正式站應用仍為 `e654829c9c51a0f163ec3e986ce3e8b8bc8cbe3b`／`04aa44009821ed92`，site ID 也與第一次部署相同。沒有重部署應用、放寬啟動門檻或重跑大型八輪。

[原始 ZIP](results/preview22-startup-probe-2026-10-29.zip)與[獨立核對](results/preview22-startup-probe-review-2026-10-29.json)已驗 provider digest／CRC、來源、job／attempt／artifact 時間與啟動記錄範圍。這次開檔按鈕及版本控制在 1,018.213 ms 時已通過延遲圖形初始化前置檢查，84 個同站靜態請求、沒有截斷、沒有 failed requests 或 console errors；主 app.js 回應 HTTP 200／JavaScript MIME 並完成。快照中十個 pending 包含刻意暫停的 zip.js 與九個背景預載，不能將其當成已失敗的資源；它們沒有阻止開檔控制項就緒。

同一輪後續 30 項原生操作通過，包含原生選檔、32px、pattern／TFLite／MLIR 匯出重開、編輯草稿與手動 runtime。這次沒有重現第一次逾時；第一輪缺少請求證據，仍無法確定其確切原因，不宣稱已修正應用啟動。獨立 probe 的成功也不代替原發布工作流程的 verify_live／release 完成，固定 Release 尚未建立，第一次失敗資料仍保留。
