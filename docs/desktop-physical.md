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
