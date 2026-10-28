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
