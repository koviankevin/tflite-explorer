# 手動執行與 IO 下載的記憶體驗收

先前大型模型八輪與兩小時涵蓋開檔、編輯及匯出，不包含手動 interpreter；真實 WHILE 的取消／30 秒逾時也不證明反覆成功執行時的 IO 記憶體可釋放。本輪在既有 Hosted Chromium 正式站流程新增有限的八輪，不修改應用、workflow、Release 或重新部署。

公開合成 ADD 模型包含 4 MiB 實際非零 const，輸入及輸出各 4 MiB，shape `[1,1024,1024]`／float32。每輪原生開檔後手動執行三次，各用不同 raw BIN；每次開始要求舊 IO 不可下載。第三次下載 IO ZIP，核對完整 input／output bytes、模型 SHA 與來源 BIN，再關閉模型並要求專用 model／runtime Workers 的 close 事件及 CDP targets 均清空。合計八次開關、二十四次 CPU 與八份約 8 MiB IO。

只在擁有隨機 launch marker 的專屬瀏覽器程序量測；每 500 ms 取樣已觀測 PID／start-ticks 程序樹的 RSS 與 main V8 heap，拒絕超過 3 秒的取樣缺口。不強制 GC、不調短應用下載 URL 的 60 秒期限。第二輪暖機及最終關閉後都等 URL 自然 revoke（觀察最多 80 秒），再取五個一秒間隔的中位數。沿用既有上限：最終 RSS 漂移 128 MiB、main heap 32 MiB、關閉 RSS 斜率每輪 16 MiB、取樣峰值成長 768 MiB；六個測量輪的即時關閉值可能仍含期限內下載 Blob，因此保留原始資料與最終 revoke 後的比較。

流程預算 270 秒；不以空等湊數、假輸出、縮小 input、強制清理或放寬門檻代替。原十九種執行／四種分佈／const／草稿、pattern、TFLite／MLIR 匯出重開及實際運算取消／逾時驗收都保留。預期 Chromium 合計 33 項、82 個模型及 44 個 runtime Workers，這些目前是待執行要求，不是成功結果。

RSS 加總可能重複計算共享頁；500 ms 可漏掉瞬間峰值或未觀測的短程序。main heap 不等於 Worker V8／WASM backing storage，沒有宣稱連續 Worker heap 峰值。這是 Hosted Linux 的有限合成 CPU／IO 生命週期，不代替數小時 interpreter、其他 OS／引擎、custom kernels 或所有模型。結果、provider 產物與獨立核對仍待完成。
