# 實體大模型的原生記憶體歸屬診斷

目前公開版仍為 [v1.4.0](quantization-validation.md#v140-正式交付)。v1.4.1 候選的 [41252363060](https://github.com/koviankevin/tflite-explorer/actions/runs/41252363060)在八輪功能／權重／options／pattern、Worker 與程序退出通過後，因 RSS slope 約 24.39 MiB／輪超過原 16 MiB 失敗；[原始證據與重判](legacy-shape-validation.md#主分支驗收失敗尚未發布)保留，沒有發布或改列通過。

本次只增加獨立、唯讀的 Hosted Linux 診斷。使用同一個實體 1.25 GiB／21,005 OP 合成模型、八輪／兩輪 warmup、500ms RSS 取樣、五次 settle、原 URL timer、原 16 MiB slope 與原 10 秒正常關閉規則。它不是記憶體修正，單次診斷通過也不能取代失敗的正式關卡。

`physical-memory-diagnostic.yml` 只有 main／workflow_dispatch、唯讀 repository 權限及單獨 concurrency；job／artifact 分別為 `diagnose`／`browser-memory-diagnostic-*`，與發布關卡的路徑、job 及名稱不同。報告另標示 `purpose=readonly-native-memory-attribution`、`releaseEvidenceEligible=false`；發布驗證器會明確拒絕此標記，即使其餘內容及 status 是 passed。新增拒絕案例先重現漏擋，再修正，原有不可變歷史報告仍可驗證。

## 補充觀察

- 使用既有 `/proc` probe，從產生原 RSS 樣本的同一份程序表取得當時 active 的 owned PID／startTicks。讀取 status 前後再次核對 startTicks；退出／重用保持 missing，不補零、不讀外來替代程序的記憶體。
- 每份補充分類保留原 RSS、phase、elapsedMs 與前後觀察時間，包含每個程序的 anonymous／file／shared RSS。它們不會取代或扣除原始 RSS；共享頁面可能重複計入，非同一瞬間的差值也會保留。
- 每次 phase 改變或至少十秒補上 Chromium process type、主頁 isolate 的 `Runtime.getHeapUsage`、`JSHeapTotalSize` 和 DOM counters。backing 欄位描述 array buffer／external string，不能直接冒充 Blob、全部瀏覽器或所有 Worker 的持有者。未提供的欄位記 null；不呼叫 GC 或 heap snapshot。
- 補充結果依原始 sample index 存放，避免 interval 與顯式 settle 觀察重疊時，完成順序弄亂原 RSS 對應。只收白名單身分與數值欄位，不收 command line、模型名稱、權重或測試 BIN。

每輪診斷最多 4,000 個樣本、24,000 筆程序紀錄、512 筆 CDP 詳細資料；超限會失敗，不悄悄省略而聲稱完整。用原失敗報告 envelope，加上最大數目的六程序合成觀察、512 筆詳細資料，實際 JSON 大小 11,186,025 bytes，低於 16 MiB 診斷 metadata 預算。這只是序列化大小的合成檢查，沒有執行瀏覽器、讀取實體模型、量測 OS 記憶體或證明效能改善。

48 項相關選測涵蓋原政策、PID／startTicks、真實 probe 組合、重疊觀察、缺漏／重用、白名單、預算及診斷報告不得發布。應用程式、parser、runtime、權重／custom options、套件版本與原 RSS／讀取／安全門檻不變。PR／main 來源核對後，只執行事先限定的一次診斷，保存成功或失敗的原始結果；實際歸屬與根因仍待觀察。
