# Firefox／WebKit 手動執行與 IO 程序 RSS

目前固定 preview.31 已核對 Chromium 的八輪／24 次手動 CPU 與 IO；Firefox／WebKit 的既有十七項操作不包含這組反覆執行的 RSS 量測。本次只補測試與原始資料，不更動應用、固定 Release、既有 Chromium 判定器、workflow YAML 或門檻。

在既有 Hosted Linux Desktop engine compatibility 工作流程執行；每個引擎另外啟動獨立 browser，以 Node 直屬 child 和每次隨機環境標記核對 ownership。只讀已知 PID／start-ticks 與其觀測後的 descendants／orphans，正常關閉後要求全部觀測身分退出；不讀任意使用者程序環境或發送強制終止訊號。

每輪原生選取一份 4 MiB const 的 ADD TFLite，對 4 MiB raw BIN 手動點三次執行；確認三個 runtime Worker close、輸入視窗無 File 控制項／確認回呼、下載 IO ZIP、獨立 Python CRC 與全部 input／output bytes 的 SHA-256，最後關閉模型。八輪共二十四次執行、八份 IO。每份 ZIP 的 URL ID／大小與實際下載對應，等待網站原有 60 秒 revoke，不縮短 timer、不 forced GC、不改寫 close 事件。模型與資料皆來自公開合成 fixture。

每 500ms 讀取 owned browser process RSS，settle 為五個間隔一秒的原始樣本中位數，保留索引供獨立重算。先跑兩輪 warmup；八輪、270 秒觀察預算、3 秒取樣缺口、128 MiB settled drift、16 MiB／輪 slope、768 MiB peak growth 與 80 秒 URL 期限均取自既有 Chromium runtime policy，不提高數值。量測從頁面初始化完成後、第一次開檔前的 idle baseline 開始；設定階段另有時間戳。

這是額外的 **RSS-only** 判定器，mainHeap 與 workerIsolateHeap 必須明列 `null`，不能拿 RSS 代替。原 Chromium main heap／CDP acceptance 完整保留。RSS 加總可能重複計算共享頁；取樣會漏掉短峰值與未觀測程序，不能證明獨立 Worker heap 峰值、所有模型、數小時或其他 OS 已通過。

每次生成 fixture、BIN 或 IO 前，先在 `build/events.jsonl` flush 寫入意圖；報告列出三十三個精確生成檔及 create／delete 事件。只 unlink 登記的可再生合成檔，最後非遞迴移除獨占空目錄。報告保留 SHA、bytes、時間與數字 metadata，不保存 BIN 或模型內容。

24 項本機 Node 檢查通過，包含真 CPU reference、共享 RSS 門檻一致、取樣中位數、過早 URL revoke、錯誤 IO／CRC、殘留 Worker、PID reuse／foreign process、防止用 RSS 偽造 heap、暫存邊界和 URL observer 的原生參數／回傳／例外。這些是判定器與基礎工具檢查，當時 Hosted Firefox／WebKit 八輪的結果尚未取得，後續原始結果見下文；不能以本機 unit 綠燈宣告新量測成功。

## 首次原始結果

來源 `77fa037ce2e58d4606318e357652b52031c04bf6`、tree `e49c5c1f4a9deed7b38bd96bf9b51afcc02b02ec`、candidate build `5e40f9c11ec3a0e8` 的 [40911201837](https://github.com/koviankevin/tflite-explorer/actions/runs/40911201837) 已終止。PR #138 必要 Node／contract 成功且 head／merge 完整 tree 一致；src、scripts、vendor、相依及 workflow 與固定 preview.31 完全無差異，build 的來源 metadata 不同，未重新發布應用。

| 引擎 | 結果與範圍 |
| --- | --- |
| WebKit 26.0 | 額外八輪／24 次 CPU、八份完整 IO SHA／CRC、8 model／24 runtime close、24 次輸入清理、33 個生成檔清理及四個觀測程序正常退出均通過。448 次樣本、最終 RSS drift 42,733,568 bytes、slope 13,783,742.17 bytes／輪、peak growth 311,021,568 bytes；八個 URL 均自然保持約 60 秒。既有十七項功能也通過。這是 RSS-only，不宣稱主／Worker isolate heap。 |
| Firefox 142.0.1 | **失敗：closed-rss-slope**。八輪／24 次 CPU／八份 IO 與 Worker／程序／檔案清理完成，但 slope 24,380,328.23 bytes／輪超過原 16 MiB／輪。426 次樣本；URL 全釋放後 drift 28,348,416 bytes、peak growth 398,712,832 bytes 與 547ms 最大取樣缺口均未超限。七個觀測程序正常退出。整體 matrix 為 failure，不用功能或最終 drift 成功掩蓋斜率失敗。 |

兩個原始 provider ZIP 的 digest／CRC、來源／job／attempt／時間與完整 304 檔 manifest 已獨立核對。WebKit 另重算判定器、每份實際 input／output 的預期 SHA、native URL／Worker、取樣中位數索引與 cleanup；讀取器真正 exit 0。Firefox 的 authentication-only 與失敗結果分開。[原始 ZIP／中繼資料／獨立收據與讀取器](results/desktop-runtime31-original.zip)、[檔案 SHA 與退出記錄](results/desktop-runtime31-original.json)保留；不調整政策、不 forced GC、不重跑成功部署。

## Firefox 分類診斷

原始 RSS 在 cycle 3～8 呈鋸齒狀，與六份尚在正常 60 秒期限內的 IO URL 同時存在；最後等待 URL 釋放後明顯下降。這些關聯不足以判定洩漏、配置器行為或應用參照。

依序區分：(1) Blob／跨程序共享頁保留到 revoke，預測其變化與未到期 URL 數及釋放時間對應；(2) Worker／WASM 配置器或程式碼快取延後歸還，預測匿名或檔案頁變化不僅取決於 IO URL；(3) 關閉後的應用 File／IO 參照仍保留，需實際所有權證據，不能只由 RSS 推論。

只為 Firefox 加上既有 `process-memory-profile.mjs` 的輔助分類：每筆原 RSS 樣本後，對同一組已知 PID／start-ticks 讀取 RssAnon／RssFile／RssShmem，記錄較晚的觀測起訖、與原 RSS 差額及 missing／reused，不校正或取代原值、不使用較小的 PSS 取得綠燈，也不稱為 JS heap。原 500ms／3 秒缺口與全部門檻不變，額外讀取成本也算在實測中。WebKit 原始成功證據沿用，不為此診斷重跑；當時新的 Firefox 原始資料尚待取得；後續結果見下節。即使診斷時通過也不能將原始失敗寫成已修復的應用 bug。

## 分類結果與無模型對照

[Firefox 分類 40914299113](https://github.com/koviankevin/tflite-explorer/actions/runs/40914299113) 已終止，來源 `b80eacfd06d1469437f287ca93494052054da8c6`／tree `72ee06f57a80682042ab50e0e42ae1f9444e0129`／build `c6bcc615b830264c`。獨立 provider SHA／CRC／來源／304 manifest、全部 IO 預期 SHA、原 RSS 判定與分類錨點重算通過，讀取器實際 exit 0；量測本身仍因 slope 21,842,446.63 bytes／輪失敗。416 筆分類完整，沒有 exited／reused 缺值；最終 RSS drift 28,364,800 bytes、peak growth 397,369,344 bytes。七個觀測程序正常退出。[原始資料／離線歸屬／讀取器](results/firefox-runtime31-profile.zip)及[逐檔雜湊與明確結果](results/firefox-runtime31-profile.json)保留。

大幅鋸齒主要出現在父程序匿名記憶體，其 window median 在約 213～343 MB 間變動，最終只比 warmup 高 1,556,480 bytes。頁面程序匿名記憶體最終高 25,133,056 bytes；整組共享欄位保持 4,239,360 bytes，file 欄位變化較小。這反駁「共享頁隨每份 IO 大量線性增加」的簡單解釋，不能把匿名記憶體直接稱為 JS heap，亦未排除頁面參照問題。各程序中位數與較晚讀取的總量不校正為原 RSS。

固定工具版本的[網路觀察原始碼](https://github.com/microsoft/playwright/blob/v1.56.1/browser_patches/firefox/juggler/NetworkObserver.js)會收集回應片段並合併，再決定是否超過每份 10 MiB 的保留上限；整頁上限是 100 MiB。本案 WASM 為 10,948,854 bytes，超過單份上限；這提供暫時複製／GC 成本的疑點，不是已確認的根因。來源 URL／取得時間／SHA 保存在封存檔，沒有修改第三方工具或減去這些記憶體取得綠燈。

下一步只在 Hosted Firefox 加入兩個獨立 browser 的無模型對照：empty／fetch 各八輪、每輪三個原生 Worker。empty 只回報 0 bytes；fetch 僅完整讀取同一份已核對的公開 WASM，回報長度，**不載入或編譯模型、不呼叫 runtime／app API、不產生 IO ZIP**。兩組均保留原始 RSS／每程序分類、五樣本中位數、真實 close 與正常程序退出。只清除對照用的小型 Worker-script URL，網站的 60 秒 IO URL 行為不變。對照本身不給 RSS 驗收綠燈；隨後原應用八輪仍跑相同門檻，保留原判定。原始結果與界線見下節；WebKit 成功不重跑，正式 preview.31 不重發。

## 無模型對照的實際結果

[40919347381](https://github.com/koviankevin/tflite-explorer/actions/runs/40919347381) 已以 failure 結束，來源 `88e3ad10f67dce4752db896914a8ed61dab04b13`／tree `d02b2c853547bbc313c8c2fdf72d2576d49d5074`／build `8febc9d7b74ca3a3`。PR #140 的兩項必要檢查成功，合併完整 tree 相同；src、scripts、vendor、相依、workflow 與原應用 RSS flow／policy 都沒有變動。沒有重新部署正式站。

原始 provider ZIP digest／CRC、job／attempt／時間／來源、304 檔 manifest、全部應用 IO 預期 SHA、原 RSS 判定及每筆程序分類錨點已獨立核對，讀取器真正 exit 0。[原始 ZIP、完整資料與讀取器](results/firefox-runtime31-network.zip)及[逐檔 SHA 與退出紀錄](results/firefox-runtime31-network.json)保留；核對成功不代表量測通過。

| 流程 | 原始觀測與判定 |
| --- | --- |
| 空 Worker 對照 | 八輪、24 個 native Worker close、七個觀測程序正常退出；130 筆完整 RSS／分類。Cycle 2→8 RSS 差 2,129,920 bytes，後六輪 slope 1,490,826.97 bytes／輪。父程序匿名欄位的每輪中位數為 171,933,696～176,254,976 bytes，變動約 4.3 MB。只回報 0 bytes，沒有模型、推論、WASM HTTP 讀取或 IO ZIP。 |
| 只讀取 WASM 對照 | 八輪、24 次 HTTP GET，各完整讀到 10,948,854 bytes，24 個 native Worker close、七個觀測程序正常退出；133 筆完整 RSS／分類。Cycle 2→8 RSS 差 117,731,328 bytes，後六輪 slope 8,300,134.4 bytes／輪；父程序匿名欄位的中位數為 178,040,832～332,832,768 bytes，出現約 155 MB 的鋸齒。沒有編譯 WASM、模型、推論或 IO ZIP。 |
| 原應用 CPU／IO | 仍只因 **closed-rss-slope 21,129,625.6 bytes／輪**失敗，超過原 16 MiB／輪。八輪／24 次 CPU／八份 IO 的 SHA／CRC、8 model／24 runtime close、24 次輸入及 33 個生成檔清理完成；419 筆完整分類、七個觀測程序正常退出。URL 自然釋放後 RSS drift 27,299,840 bytes、peak growth 440,860,672 bytes，最大樣本缺口 551ms。既有十七項功能也完成。 |

對照的 `passed` 只表示實驗順序、bytes 長度、close、來源與清理有效，**沒有給對照 RSS 設性能通過判定**。每次 HTTP body 的實測是長度；SHA 來自另行完整核對的靜態來源，不能宣稱對每個 fetch body 都另做了 digest。兩組各用獨立新 browser，輪次時間相近但並非完全一致，不能直接相減或把其中一組當作另一組的精確基線。

無模型 fetch 已重現父程序的大幅波動，因此「模型推論或 IO ZIP 必然造成那段父程序波動」不成立。原應用父程序在 URL 全釋放後只比 warmup 高 1,986,560 bytes，頁面程序匿名欄位則高 23,379,968 bytes；這些值沒有從原 RSS 扣除。仍未證明每筆記憶體的所有權、工具網路觀察與 Firefox 原生網路配置各占多少，也沒有排除應用頁面的保留。不能只憑 fetch 的不同斜率替原應用驗收轉綠。

下一個可區分的變因是「HTTP 回應」與「Worker 讀取相同資料的配置」：可用同一份公開 WASM 的本機 File，讓 Worker 只讀相同 bytes 而不經 HTTP，再比對原始父程序／頁面欄位。這仍是待執行的因果對照，不是已找到的修正；原失敗、全部門檻、自然 URL 期限和正式 preview.31 保持不變。

## 準備中的本機 File 對照

Firefox 的無模型控制新增第三組 `file`，既有 empty／HTTP fetch 組與後續原應用八輪保持。Node 從同一個已核對 manifest 的公開 WASM 來源取得完整 bytes，檢查 MIME、大小與 SHA，建立獨占暫存檔；真正的 native chooser 選取後，24 個 Worker 各收到 File，只執行 `arrayBuffer()` 並回報長度，不經 HTTP 載入、不編譯 WASM、不讀模型或產生 IO。檔案輸入在量測結束時清空，所有 native Worker 與 owned browser 正常結束後才清理暫存檔。

產檔及刪除意圖透過既有 `buildEvent` flush 保存；只 unlink 同一獨占目錄的 `public-runtime.wasm`，先核對 dev／inode／大小／mtime／SHA，再非遞迴移除空目錄。寫入意圖失敗時不執行刪除；意外改變或無法驗證的檔案會保留並讓控制流程失敗。實驗報告只留 metadata／SHA，不保存該 WASM 或 File payload。

33 項相關 Node 檢查通過，包含真 Blob 的 File-worker 讀取、錯誤／超量規模、native chooser 觀察 adapter、原 RSS／程序分類、刪除意圖失敗時保留，以及真 CPU reference。這不等於 Hosted Firefox File 對照已成功；新實測及原應用 RSS 結果仍待取得。File 組也只作因果診斷，不提供替代 RSS 通過判定，原 16 MiB／輪、自然 IO URL 期限、網路限制與正式版本都沒有變動。
