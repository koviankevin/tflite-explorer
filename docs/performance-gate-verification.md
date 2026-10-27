# 核心效能關卡驗收（2026-10-27）

這輪新增測試、policy、CI 與文件；`src/`／`vendor/` 沒有修改。正式站沿用 `0.2.0-preview.5` 的既有驗收，本輪不重新建置或部署相同網站。完整操作方式與界線見 [核心效能門檻](performance-gate.md)。

## 最終 GitHub CI

[Core performance gate run 40426428095](https://github.com/koviankevin/tflite-explorer/actions/runs/40426428095) 及 measure job、policy 負例、九筆量測、artifact 上傳全部成功。受測來源 `eace77e5eff822103001b7d1b012d73b0a4f7aef`，tree `0924c7d01ad1b4f1a5b14159e2f1b5da44661df4`，dirty=false、sourceUnchanged=true、referenceEnvironment=true。

環境為 Linux x64、Ubuntu 24.04 runner image `20261023.334.3`、Node.js 22.23.3、4 CPU、AMD EPYC 7763。每一列是三個全新子程序各項指標的最大值，不是同一筆樣本或平均數。

| 案例 | 解析 | Pattern | 單次精確搜尋／快取切段 | 程序 RSS 峰值 |
| --- | --- | --- | --- | --- |
| TFLite 3,001 OP | 140.47 ms | 26.55 ms | 搜尋 0.85 ms | 122.45 MiB |
| TFLite 21,001 OP | 433.35 ms | 135.04 ms | 搜尋 2.95 ms | 260.70 MiB |
| MLIR 20,010 OP | 932.66 ms | 232.39 ms | 切段 111.94 ms | 925.75 MiB |

- 大型 TFLite 每筆讀取 3,828,428 bytes、最大單次 64 KiB；7,000 筆匹配及 7,003 個含邊界的總覽節點符合預期。取消量測最慢 2.38 ms。
- MLIR 匯出最慢 2,823.35 ms、重開 1,553.13 ms、再次匯出並雜湊 2,593.52 ms。SSA／dominance 與原 pattern 重開匹配一筆；輸出 6,390,031 bytes。
- MLIR 路徑發現最慢 544.43 ms、每次 work 不超過 50,000、可見 helpers 最多 97；熱身後 20 次首／尾分段切換及收起的新增模板為零、cached work=0、cache hit=1，切段前後匯出 SHA-256 相同。
- 全部原始九筆結果保存於 [CI JSON](results/performance-core-2026-10-27.json)，policy SHA-256 `2585d4f7e12b2cd608b6a83696db6837c7af014b19244de133e36865bfd013a3`。

Artifact `12699882032`、名稱 `core-performance-eace77e5eff822103001b7d1b012d73b0a4f7aef-1`，ZIP SHA-256 `73d7e8267e6371a3e145ef7ae6b236ec681df4db22273de2aef7c471c65afff8` 已核對，ZIP CRC 通過。報告 JSON SHA-256 `5df3dc5ccfedce626b6c054d332904aa45464ccd7d6fa7661d95b3309f2287d8`；逐一以受測 commit 的 Git blobs 核對 251 個來源檔，避免 Windows LICENSE checkout 換行差異誤判成程式不同。獨立重新執行 policy 評估也通過。原始報告已進版控，不依賴 artifact 30 天保留期。

## 本機探索與失敗保留

Windows Node.js 24.19.0 的三種案例、各三輪探索量測均符合時間、RSS、讀取及取消上限。首次完整 runner 因大型虛擬總覽的 expected count 少算兩個輸入／輸出邊界而回傳 exit 1；核對 `patternOverviewSnapshot()` 的 boundary 建立後，把預期從 7,001 修正為 7,003，沒有放寬任何效能上限。原失敗 JSON 及僅針對新 policy 重評估的紀錄分開保留於本機 proof 目錄；重評估未冒充最終來源重跑。上述 GitHub CI 另從固定最終 commit 重新執行全部九筆，作為正式證據。

首次探索程式還曾同時保留來源 index、重開 index 及暫時 provenance，之後改為符合關模／重開的參照生命週期，沒有強制 GC。五個 policy 正負例測試與三個既有 performance 操作計數／取消測試共八項通過。缺數據、未知／非有限數值、本應非零的耗時／RSS 被記成零、超量讀取、縮小／變更 fixture、結構截斷、少一輪、重複 iteration、快取新增模板或 SSA／匯出不同均不能得到通過。

Git CLI 原有 OAuth token 缺少 workflow scope，第一次推送被 GitHub 拒絕。使用已連線 GitHub 工具的既有權限，並以 expected head 及禁止 force 的快轉更新完成發布；沒有擴大 token 權限或修改安全規則。

## 未涵蓋

這是 Node 合成核心處理關卡；不是實體 >1 GiB File 的冷讀取、瀏覽器／Worker 反覆重開的長時間 RSS／洩漏率、固定實體硬體 SLA、公司模型／dialect、native verifier 或數值等價性。MLIR 的三筆 RSS 約 926 MiB，距 1 GiB 門檻有限，後續仍應追查大型結構與匯出對照的記憶體成本。Pages 手動發布尚未強制綁定此 CI，完整發布關卡仍列商品化後續。
