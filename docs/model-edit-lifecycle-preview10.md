# preview.10 大型模型編輯驗收核對（2026-10-27）

## 已通過的 main v2

main `d28e42fb70d0f81329dd49d08b6f5db8b136f7db`、tree `6c6956d42735b03b7247b992356df0586dfcebc5`、clean，build `eb1992e298197fc6`。
[大型生命週期 run 40503469247](https://github.com/koviankevin/tflite-explorer/actions/runs/40503469247) 於台北時間 20:24–20:36 成功。
原始 [v2 JSON](results/model-edit-final-browser-2026-10-27.json) SHA-256 `fe8445415c71c9126a5f6ff1206374c27ec4d1f388076a96e99de17529dbf35d`。
原始 Artifact `12734038329`（18,962 bytes）已完整下載，ZIP SHA-256 `1347cdae8b1e1f94afbd1b459a2d80620b638dfe277b3aa01253d048bfab0652` 與 GitHub digest 一致。

實體來源 1,349,965,216 bytes、21,005 OP；權重 1,342,177,280 bytes，順序寫入非零資料、fsync、完整讀回 SHA，配置磁碟空間至少等於檔案大小。八輪均在 OP #0 後新增 HugeWeightProject，輸出 21,006 OP／1,350,445,736 bytes 的整份模型。八份完整輸出 SHA 一致：`6371d2132d4f1816666c04f3132ae0f395de5f54777d6adcab55f0c07ea6665b`。

每輪下載模型與報告、磁碟重新解析完整輸出，逐段比對七個 ranges，共 1,342,177,328 bytes；權重 SHA 為 `a16ef6b52ac75f75437a7ac7031e68aafe3c4d7475426c7714d5cc77e433a525`，原始 custom options、常數及 ID 皆通過。八次候選解析各實際讀取 8,399,528 bytes；24 個 model Worker 全部終止，CDP targets 消失。每輪 FileList=0、model Worker=0、未撤銷 URL=0；未強制 GC、未縮短 60 秒 Blob URL timer。

| 指標 | 實測 | 固定上限 |
| --- | ---: | ---: |
| Chromium 程序樹 RSS 取樣峰值 | 872.11 MiB | 以相對冷啟動成長判定 |
| RSS 取樣峰值相對冷啟動成長 | 391.36 MiB | 768 MiB |
| 第三至八輪關閉 RSS 斜率 | -0.22 MiB／輪 | 16 MiB／輪 |
| 末三輪關閉 RSS 中位數相對第二輪漂移 | 9.11 MiB | 128 MiB |
| main heap 漂移 | 0.30 MiB | 32 MiB |
| Worker V8 used heap 檢查點最大值 | 85.66 MiB | 512 MiB |
| Worker backing storage 檢查點最大值 | 15.24 MiB | 512 MiB |
| 每 realm 原生累計讀取最大值 | 16,318,536 bytes | 16,777,216 bytes |
| 原生單次讀取最大值 | 65,536 bytes | 1,048,576 bytes |

完整匯出（含下載保存）11.483–16.030 秒。RSS 每 500ms 取樣，可能漏掉短暫尖峰並重複計算共享頁；Worker heap 為檢查點、非連續峰值。八輪只證明此操作與環境內未超過既定界線。Node 22.23.3／Playwright 1.56.1／Chromium 141.0.7390.37／Ubuntu 24.04 hosted runner；不代表公司模型、dialect、custom runtime 或數值正確性。

## 完整下載檔原生重開仍待實測

上述 run 的完整模型在瀏覽器透過「開啟修改結果」重開保留的 File；實際下載到磁碟的完整檔由 Node 重新解析並比對 bytes。原生選檔重開只用於後續 >1 GiB 子模型。不得將此紀錄寫成「瀏覽器從磁碟原生選檔重開完整下載檔已驗收」。

本次補強 `test/browser/model-lifecycle.mjs`：下載完整模型及報告後，關閉編輯對話框與來源 Worker，再使用原生 chooser 選入保存的完整下載檔。仍維持每輪三個 Worker、八次候選解析及全部舊門檻；逐輪記錄 `modelEdit.reopenMethod = native-chooser-downloaded-full-model`。原有「開啟修改結果」UI 的覆蓋保留於既有隔離 UI 測試。

**補強版本僅完成語法與 diff 檢查，尚未跑大型瀏覽器測試。** 本工作環境當時可用 RAM 未達程式要求的 4 GiB（cgroup 8 GiB 幾乎已用完），沒有已登入的 `gh` CLI；GitHub connector 具有讀取及 PR 操作，但未提供 workflow dispatch。沒有因此降門檻、把舊綠燈改綁新來源，或重跑同一舊程式冒充新驗收。

可在符合資源條件的 Linux 執行 `npm ci`、`npx playwright install --with-deps chromium`，以乾淨已提交 checkout 執行 `LIFECYCLE_REPORT=/absolute/output/new.json node test/browser/model-lifecycle.mjs`；正式發布證據仍須在最終 main dispatch `browser-lifecycle.yml`。本次合併會變更 browser 與 contract 的來源 scope，須取得對應新 run。

## 其他發布關卡與剩餘證據

原 main 的四份 Artifact 均已下載核對 GitHub digest，使用該 main 未修改的 `assertRun`、`readArtifact`、`assertReport`、`sourceScope` 重判定通過；見 [核對收據](results/model-edit-four-gate-recheck-2026-10-27.json)。這是已取得證據的再判定，並非新的線上發布收據。

| 關卡 | main run | 結果 |
| --- | --- | --- |
| core performance | [40503475445](https://github.com/koviankevin/tflite-explorer/actions/runs/40503475445) | 通過 |
| browser lifecycle v2 | [40503469247](https://github.com/koviankevin/tflite-explorer/actions/runs/40503469247) | 通過；有上述原生重開覆蓋界線 |
| release contract | [40503480942](https://github.com/koviankevin/tflite-explorer/actions/runs/40503480942) | 通過 |
| isolated versioned site | [40503488236](https://github.com/koviankevin/tflite-explorer/actions/runs/40503488236) | site-upgrade 通過；public-smoke job skipped，並非正式站 preview.10 已通過 |

20 項 lifecycle／fixture／custom-export／release-gate 既有 Node 測試於原 main 通過，零略過、失敗或取消；不是補強後的真實瀏覽器測試。

接續順序：

1. 合併並在最終 main 執行補強後的大型原生重開驗收，檢查八輪 reopenMethod、24 Worker、八次候選解析及全部舊限制；重跑被來源 scope 改動影響的關卡。
2. PR #24 已於查核期間合併為 `478f65d6afea0484d05c200d1d51d9ecc0d7079b`，更新 `release-evidence.json` 並保存原始報告；本 PR 沿用現有報告，不重複保存。補強程式合併後，仍需選擇與其新來源 scope 相容的證據。
3. PR #24 之後的 [prepare run 40522228659](https://github.com/koviankevin/tflite-explorer/actions/runs/40522228659) 已以 `publish=false` 成功，controller/core source 為 `478f65d6afea0484d05c200d1d51d9ecc0d7079b`，build `f2591e6d3d458f9f`、site `b7c453c93b54b285f01b3cc8f51b1556b5b08215e0c448da4b6a10a833ea5e2b`。此 prepare 沿用已核對的四個原 main runs；不是本 PR 新 chooser 路徑的驗收。若採用本補強，須重做相容關卡與準備。
4. prepare run 的 deploy、verify_live、release jobs 全部 skipped；只有以上均成功後才可按發布流程提升固定快照，仍需 deploy、正式站逐檔 SHA、瀏覽器 smoke 與固定 Release assets 的成功證據。本任務沒有 dispatch 發布或覆蓋正式網站。查核時最新正式 GitHub Release 為 preview.9，並無 preview.10 Release；沒有把舊 gh-pages 分支內容當作現行正式網站證據。

全部為公開合成資料。未讀取或上傳公司模型、dialect、runtime；公司內網仍須自行驗證語意與執行結果。
