# 實體大型 TFLite 瀏覽器驗收（2026-10-27）

已通過 [CI 40429421681](https://github.com/koviankevin/tflite-explorer/actions/runs/40429421681)，工作本身 9m33s，測量程式 543.815s。受測來源 `eb0a330865fd5d6cbf01cff9109ee5ff9f94ae61`、clean tree `19355d7a9bf850d8fc8f712844bfa7d84a3d4fc5`，與本機固定部署包的 release metadata 完全相同：`0.2.0-preview.6`／build `0f8361cc44fcd547`。

執行環境 Ubuntu 24.04 runner、image `20261023.334.3`、Linux `6.17.0-1022-azure`、AMD EPYC 7763／4 vCPU、Node 22.23.3、Playwright 1.56.1、Chromium 141.0.7390.37。Hosted runner 類別固定，非固定實體硬體 SLA。Action runner 的 Node runtime 更新註記不影響測試實際使用的 Node 22.23.3；報告保留實際版本。

## 實際通過項目

- 順序寫滿非零權重、fsync、完整讀回 SHA 的實體來源 1,349,965,216 bytes、21,005 OP、21,011 tensors。完整 SHA `7ea3c8b317c42a3464b74ef8d9a80b27b42f912c1592b5c60daab670ffc66586`；1,342,177,280-byte 權重 SHA `a16ef6b52ac75f75437a7ac7031e68aafe3c4d7475426c7714d5cc77e433a525`。沒有使用 sparse、truncate 或縮小案例替代。
- 同一頁面八輪來源開啟 → 搜尋 → 實際下載 >1 GiB 子模型 → 關閉 → 原生選檔重開 → 正反例搜尋 → 關閉。來源每輪 7,000 組 RTR，兩種含 custom op 的參考 pattern 各一筆；重開原 pattern 一筆、另一種零筆。原生 pattern JSON 選檔匯入、下載匯出與結構比對亦通過。
- 四輪 prefix 匯出各 1,345,937,304 bytes，SHA 均為 `db8c1d07027fb13894e5ffc1756853ef01a4e7c8d11345052046c09c21c2ec40`；四輪分支／匯合／custom 雙輸出匯出各 1,345,937,352 bytes，SHA 均為 `e0785313d105ea885da6d7e6972730867126550159a439966be0a67ed3a8d9fb`。
- 每次匯出完整串流檢查大權重 SHA、原始八 bytes custom options、shape／perm／float 常數、tensor/buffer 編號及輸入／輸出邊界。Custom runtime 未提供，沒有聲稱可執行或數值等價。
- 16 個 model Workers 均收到真正 close，CDP worker target 消失；每輪關閉後 FileList=0、model Worker=0、未撤銷下載 URL=0。保留應用 60 秒撤銷 timer，沒有強制 GC。最後瀏覽器正常關閉，主程序不再存在。
- 原生 read audit：主頁讀取 pattern JSON 1,391 bytes；來源 Worker 每次 7,919,008 bytes，重開 prefix 3,891,096 bytes、branch 3,891,144 bytes；所有讀取都符合事前的單次 1 MiB／每 realm 16 MiB 上限，與 parser stats 相同。沒有頁面／Worker 錯誤或非 loopback GET 請求。

## 記憶體結果

1,106 筆樣本，固定每 500ms，關閉樣本另取五筆中位數；前兩輪熱身，後六輪判定。所有上限在測量前版控，沒有依結果放寬。

| 指標 | 量測 | 事前上限 |
| --- | --- | --- |
| Chromium 程序樹 RSS 取樣峰值／相對冷啟動成長 | 727.36／252.05 MiB | 成長 ≤768 MiB |
| 熱身後各輪關閉 RSS | 515.63、519.91、517.84、518.11、520.32、516.30 MiB | 斜率及漂移共同判定 |
| 第三至八輪 RSS 線性斜率 | 0.14 MiB／輪 | ≤16 MiB／輪 |
| 末三輪中位數相對第二輪 RSS 漂移 | 9.90 MiB | ≤128 MiB |
| 同範圍 main heap 漂移 | -0.04 MiB | ≤32 MiB |
| 來源／重開檢查點最大 Worker V8 used heap | 80.50 MiB | ≤512 MiB |
| 同檢查點最大 Worker backing storage | 14.80 MiB | ≤512 MiB |

這些結果支持此環境八輪內沒有超過既定累積門檻；有限測試不能證明永久沒有洩漏。RSS 可能重複計算共享頁、錯過短暫尖峰；Worker heap 是 isolate 檢查點，不是獨立 Worker OS RSS。數小時負載、其他引擎、公司實模／dialect／runtime 與固定實體硬體仍未驗收。

原始 [JSON](results/browser-lifecycle-2026-10-27.json) SHA-256 `ab81c82e6a50e568b879520aeda31e33def8ce9dbf111274621312325387ac5f`；artifact `12701373029` ZIP 15,425 bytes，已完整下載核對 GitHub digest `d43cae7b10ed83b233b8d946ce1cb78d0d26e041dc3de6c709029c1bfb75d805`。本機及 CI 的門檻負例／fixture／custom-export 共 12 項皆通過。較舊 sparse browser runner 的 FileList 斷言同步改為檢查現行 Worker 的實際 fileBytes 與清空的 input；本次未重跑該獨立完整工作流程，其餘舊案例不宣稱新驗證。

## 交付

[Pages 部署 40430663392](https://github.com/koviankevin/tflite-explorer/actions/runs/40430663392) 成功，`gh-pages` commit `5ae7e9e27fb1d6a27056440cd5f72ecec5adefa7`。[Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.6) 的固定 ZIP 29,453,947 bytes、SHA `82b358f03a6a18dea8d9e72fb445371d92f913c9ec67b4d2727baeb84f259193`，與 GitHub asset digest 一致；本機 247 ZIP entries CRC 及 246 manifest 檔案大小／SHA 均已核對。

2026-10-27 01:09:42 UTC 從正式站下載 manifest 與全部 246 個應用檔案，HTTP 成功、大小／SHA 全部相符，詳見 [線上逐檔核對](results/preview6-live-integrity.json)。CI 的 build release metadata 與本機 ZIP／正式站相同，不僅比對版本字串。本次收尾只有 README、驗收紀錄、raw evidence 與舊 browser runner 斷言更新，未改受測應用；正式站與 Release 保留上述固定 clean 來源，沒有為文件再次部署或重跑九分鐘測試。

內網帶私有 dialect 時，依 [升級流程](intranet-release.md) 固定此核心版本重新建置；公司資料與擴充留在內網。此輪只更新 GitHub，未同步 Sites。商品等級全目標仍依 [完成條件](product-readiness.md) 持續驗收。
