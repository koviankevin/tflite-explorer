# Firefox／WebKit 手動執行與 IO 程序 RSS

目前固定 preview.31 已核對 Chromium 的八輪／24 次手動 CPU 與 IO；Firefox／WebKit 的既有十七項操作不包含這組反覆執行的 RSS 量測。本次只補測試與原始資料，不更動應用、固定 Release、既有 Chromium 判定器、workflow YAML 或門檻。

在既有 Hosted Linux Desktop engine compatibility 工作流程執行；每個引擎另外啟動獨立 browser，以 Node 直屬 child 和每次隨機環境標記核對 ownership。只讀已知 PID／start-ticks 與其觀測後的 descendants／orphans，正常關閉後要求全部觀測身分退出；不讀任意使用者程序環境或發送強制終止訊號。

每輪原生選取一份 4 MiB const 的 ADD TFLite，對 4 MiB raw BIN 手動點三次執行；確認三個 runtime Worker close、輸入視窗無 File 控制項／確認回呼、下載 IO ZIP、獨立 Python CRC 與全部 input／output bytes 的 SHA-256，最後關閉模型。八輪共二十四次執行、八份 IO。每份 ZIP 的 URL ID／大小與實際下載對應，等待網站原有 60 秒 revoke，不縮短 timer、不 forced GC、不改寫 close 事件。模型與資料皆來自公開合成 fixture。

每 500ms 讀取 owned browser process RSS，settle 為五個間隔一秒的原始樣本中位數，保留索引供獨立重算。先跑兩輪 warmup；八輪、270 秒觀察預算、3 秒取樣缺口、128 MiB settled drift、16 MiB／輪 slope、768 MiB peak growth 與 80 秒 URL 期限均取自既有 Chromium runtime policy，不提高數值。量測從頁面初始化完成後、第一次開檔前的 idle baseline 開始；設定階段另有時間戳。

這是額外的 **RSS-only** 判定器，mainHeap 與 workerIsolateHeap 必須明列 `null`，不能拿 RSS 代替。原 Chromium main heap／CDP acceptance 完整保留。RSS 加總可能重複計算共享頁；取樣會漏掉短峰值與未觀測程序，不能證明獨立 Worker heap 峰值、所有模型、數小時或其他 OS 已通過。

每次生成 fixture、BIN 或 IO 前，先在 `build/events.jsonl` flush 寫入意圖；報告列出三十三個精確生成檔及 create／delete 事件。只 unlink 登記的可再生合成檔，最後非遞迴移除獨占空目錄。報告保留 SHA、bytes、時間與數字 metadata，不保存 BIN 或模型內容。

24 項本機 Node 檢查通過，包含真 CPU reference、共享 RSS 門檻一致、取樣中位數、過早 URL revoke、錯誤 IO／CRC、殘留 Worker、PID reuse／foreign process、防止用 RSS 偽造 heap、暫存邊界和 URL observer 的原生參數／回傳／例外。這些是判定器與基礎工具檢查，**Hosted Firefox／WebKit 八輪的結果仍待取得**；不能以本機 unit 綠燈宣告新量測成功。
