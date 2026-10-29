# 手動執行與 IO 下載的記憶體驗收

先前大型模型八輪與兩小時涵蓋開檔、編輯及匯出，不包含手動 interpreter；真實 WHILE 的取消／30 秒逾時也不證明反覆成功執行時的 IO 記憶體可釋放。本輪在既有 Hosted Chromium 正式站流程新增有限的八輪，不修改應用、workflow、Release 或重新部署。

公開合成 ADD 模型包含 4 MiB 實際非零 const，輸入及輸出各 4 MiB，shape `[1,1024,1024]`／float32。每輪原生開檔後手動執行三次，各用不同 raw BIN；每次開始要求舊 IO 不可下載。第三次下載 IO ZIP，核對完整 input／output bytes、模型 SHA 與來源 BIN，再關閉模型並要求專用 model／runtime Workers 的 close 事件及 CDP targets 均清空。合計八次開關、二十四次 CPU 與八份約 8 MiB IO。

只在擁有隨機 launch marker 的專屬瀏覽器程序量測；每 500 ms 取樣已觀測 PID／start-ticks 程序樹的 RSS 與 main V8 heap，拒絕超過 3 秒的取樣缺口。不強制 GC、不調短應用下載 URL 的 60 秒期限。第二輪暖機及最終關閉後都等 URL 自然 revoke（觀察最多 80 秒），再取五個一秒間隔的中位數。沿用既有上限：最終 RSS 漂移 128 MiB、main heap 32 MiB、關閉 RSS 斜率每輪 16 MiB、取樣峰值成長 768 MiB；六個測量輪的即時關閉值可能仍含期限內下載 Blob，因此保留原始資料與最終 revoke 後的比較。

流程預算 270 秒；不以空等湊數、假輸出、縮小 input、強制清理或放寬門檻代替。原十九種執行／四種分佈／const／草稿、pattern、TFLite／MLIR 匯出重開及實際運算取消／逾時驗收都保留。Chromium 實際合計 33 項、82 個模型及 44 個 runtime Workers 全部 close，下列結果已由原始資料核對。

## 已核對結果

[Hosted 正式站工作流程 40878472302](https://github.com/koviankevin/tflite-explorer/actions/runs/40878472302)在 attempt 1 成功；測試 driver `fa9442724ca0f907102ba79a8eb78c3204168a2e`，合併 main `0f6c79cc66b5bdc0a43ca323028b5a5b3edffdf9` 完整 tree 同為 `6d07acb8a01ce66344d271e2aafca30d1e464ff1`。固定應用仍為 preview.30／build `f3ff13b75b83ee57`，site ID `ff1f2e3d7bafb505f8f0bf1037977746625f4c1e4c98e84779bbd301df76d956`，來源 `0ee55ba2803038b22b0c11dfc38b6f890aedca5c`。src／vendor／scripts／package／workflow blobs 相同；沒有重跑成功的測試或部署。

[獨立收據](results/runtime-io30-review.json)核對 provider digest、ZIP CRC、run／job／attempt／來源／時段、固定版本、完整 input／output SHA、原始 policy／411 次取樣、URL 期限及程序清理；讀取器實際 exit 0 後才寫入此批證據。本機三項新檢查包含外部 20 秒上限的真正 CPU／全部 4 MiB output bytes，以及 stale IO、Worker、URL、取樣缺口與記憶體門檻負例；必要 PR [Node／建置 40878465984](https://github.com/koviankevin/tflite-explorer/actions/runs/40878465984)及 [contract 40878465999](https://github.com/koviankevin/tflite-explorer/actions/runs/40878465999)成功。

| 指標 | 原始結果 |
| --- | --- |
| 八輪／手動 CPU／完整 IO bytes | 8／24／8 份，全部正確 |
| 實際模型 | 4,195,488 bytes，SHA `26d19cdb359ccea2b405369cecfd5ad56486d4925c982f93646075d489a76daf` |
| 本輪流程時間 | 180,590 ms，包含原有 URL 等待與自然 settle |
| RSS 最終相對暖機漂移 | −7,225,344 bytes |
| main V8 heap 最終相對暖機漂移 | −338,260 bytes |
| 測量六輪關閉 RSS 斜率 | 12,608,892.34 bytes／輪；當時可含期限內的下載 Blob |
| 取樣 RSS 峰值／相對初始成長 | 769,863,680／140,251,136 bytes |
| 取樣數／最大間隔 | 411／643 ms |
| 八個下載 URL 壽命 | 60,000～60,001 ms，全部自然 revoke |
| 新增 Worker／程序清理 | 8 model／24 runtime 全 close；6 個觀測 PID／start-ticks 全正常退出，無強制清理 |

原有的 kernel 取消／30 秒逾時與正常模型恢復仍通過，總計 33 項功能。保留[原始 provider ZIP](results/runtime-io30-native.zip)、[run 中繼資料](results/runtime-io30-run.json)、[jobs](results/runtime-io30-jobs.json)、[artifact](results/runtime-io30-artifact.json)與[檔案及稽核程式 SHA 清單](results/runtime-io30-archive.json)。ZIP 內的截圖是同一 run 先前的實際 kernel 逾時畫面，不是記憶體圖；記憶體結果以原始 JSON 時序為準。程式稽核文字需按原 build/qa 路徑與對應 imports／來源復原後重播。

RSS 加總可能重複計算共享頁；500 ms 可漏掉瞬間峰值或未觀測的短程序。main heap 不等於 Worker V8／WASM backing storage，沒有宣稱連續 Worker heap 峰值。此有限範圍內沒有觀測到持續累積，不代替數小時 interpreter、其他 OS／引擎、custom kernels 或所有模型。完整商品等級目標仍在進行。
