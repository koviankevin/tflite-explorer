# 實體大模型瀏覽器生命週期驗收

這是獨立、手動啟動的 CI 門檻，與 `performance.yml` 的 Node 核心效能互補。執行 `.github/workflows/browser-lifecycle.yml`，使用隔離的 Ubuntu 24.04 runner、Node 22.23.3、lockfile 的 Playwright 1.56.1 與其 Chromium。受控 Pages 發布已要求這項關卡及來源相依 fingerprint；尚未通過的執行不得當成發布證據。新增的 [兩小時負載](lifecycle-soak.md)是額外驗收，不取代這份固定八輪門檻。

## 固定案例與操作

實際順序寫滿非零權重、fsync，再完整 SHA-256 讀回的 TFLite：1,349,965,216 bytes、21,005 OP、21,011 tensors，權重 1,342,177,280 bytes。不是 sparse/truncate 或僅有邏輯長度的模擬。生成器驗收小案例只驗證生成及匯出契約；CI 不接受以小檔替代完整檔案。

同一瀏覽器與頁面八輪，前兩輪為熱身。每輪從原生選檔開啟來源，確認 7,000 組 Reshape → Transpose → Reshape；交替選 custom prefix 與含分支／匯合／雙輸出的 custom branch pattern。實際下載 >1 GiB 子模型，關閉來源，原生選檔重開下載檔，確認原 pattern 一筆、另一組零筆。兩種匯出都完整串流核對權重 SHA-256、原始 custom options、常數與 tensor/buffer 編號；同類重複匯出 SHA 必須一致。另從原生選檔匯入 pattern JSON、下載匯出並對照原結構。

每次關閉都等待真正的 model Worker close，並核對 CDP target 消失和選檔 FileList 清空。下載 Blob URL 使用應用原本的 60 秒 timer；不加速、不強制 GC。等待原生 revoke 後才量測五筆關閉樣本的中位數，刪除當輪自有下載檔。測試觀察器只存數值、字串與統計，不能保存 File、Blob、Worker 或 RPC 原始資料。

## 事先固定門檻

完整常數在 `test/browser/lifecycle-policy.mjs`，不依當次量測自動放寬：

- 每 500ms 加總該次啟動 Chromium 的主程序與所有子程序 RSS；相對冷啟動樣本的最大成長 ≤768 MiB。
- 第三至八輪關閉後 RSS 的線性斜率 ≤16 MiB／輪；末三輪中位數相對第二輪 ≤128 MiB，main JS heap ≤32 MiB。
- 每輪來源及重開後，實際 model Worker V8 used heap 與 backing storage 各 ≤512 MiB；缺值、零 used heap、缺輪次、非有限數字皆失敗。
- 原生 File/Blob 讀取單次 ≤1 MiB、每個 realm 累計 ≤16 MiB，超限在配置前拒絕；沒有整檔讀入記憶體的替代方案。
- 關閉後 FileList=0、model Worker=0、未撤銷 URL=0；八輪正反例、權重與 options 均須通過。

## 證據界線

報告保留 source commit/tree/dirty、實際 build ID、runner image、引擎版本、完整數值樣本及失敗；不保存或上傳模型。source 必須 clean。應核對工作流程 conclusion、報告 status、八輪結果及受測來源，不能僅讀 passed 字串。

RSS 包含共享頁的重複計算，也可能漏掉 500ms 內的短暫尖峰；Worker 與 renderer 可能共用 OS process，不能宣稱取得獨立 Worker RSS。Worker 透過 CDP [Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/) session 的 [Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) 取得 isolate V8 與 backing storage；是固定檢查點，不是連續峰值。量測後立即 detach，沒有保留 remote object 或強制 GC。

有限八輪只證明該環境與操作在既定上限內，不能證明永遠不洩漏。合成 custom op 未提供 runtime，不代表公司模型、dialect、數值等價性、其他瀏覽器或固定實體硬體 SLA 已驗收。公司內網仍需用同版核心與實模進行自身驗收。
