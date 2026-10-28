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
