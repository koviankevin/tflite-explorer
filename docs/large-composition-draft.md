# 大型 v2 組合草稿手動還原

Hosted Chromium 的大型 v2 手動儲存、取消、還原及相同 bytes 重匯出已通過，見下方原始證據。正式站維持 preview.26；此輪只補驗收，不重新部署應用。

## 實際操作與固定門檻

沿用 `large-edit-draft.yml`，保留原 v1 的手動 JSON、完整指紋、途中取消、32px 視角／Redo、完整修改模型匯出重開及 pattern 檢查。另在同一個 Chromium／context／頁面完成 v2：

1. 原生選檔開啟實際寫滿並讀回 SHA 的 1,349,965,216-byte／21,005 OP TFLite，從 prefix 與分支／匯合的實際匹配各加入四個 OP。
2. 接起兩段並複製新增 ADD，設定明確輸入／輸出。Undo 最後一個輸出介面命令，留下六步歷史／一步 Redo；以 1366×640／32px 縮放、平移後，真正按「儲存編輯草稿」下載 v2 JSON。
3. 核對兩組片段、完整原模型指紋、八個來源 OP、接線、介面、Redo 及視角；Redo 後先實際匯出，核對所有權重／custom options 與既定組合 SHA。
4. 關閉模型，匯入 JSON 並重新選原模型，在完整指紋 IO 途中取消，確認讀取停止且未套用任何 OP、接線或介面。
5. 再關閉並以新的原生 File 重新選取原模型，在 1280×640 還原。核對圖上九個 OP、分組、每個 input port、介面選項、32px、縮放／捲動及 Redo；繼續 Undo／Redo，實際重匯出並比對還原前後所有 bytes。
6. 關閉來源，以原生選檔開啟重匯出的九 OP 模型。原 prefix／branch pattern 各一筆、錯誤連線 pattern 零筆、預設 reshape／transpose pattern 一筆。

原有門檻不變：每項操作 90 秒、50ms 主執行緒探針與 Long Task 各最多 750ms、取消回應最多 1,500ms、500ms 取樣 RSS 峰值成長最多 768 MiB、Worker heap／backing storage 各最多 512 MiB。指紋只在指定參數邊界使用有序完整讀取 facade，每次最多 1 MiB；parser／main 仍是單次 1 MiB、每 realm 16 MiB，不能利用指紋放寬解析器。

新增 v2 後，報告版本為 2：八個模型 Worker 均須 terminate 並有原生 close，六次指紋觀察中四次完整、兩次取消。程序 RSS 改用既有 PID／start-ticks 所有權追蹤，包含曾觀察後被 reparent 的後代；瀏覽器關閉後所有觀察到的程序都須退出。報告保留取樣及量測界線，不宣稱連續 Worker 峰值或獨立 Worker OS RSS。

仍保留自然 60 秒 URL 撤銷、不強制 GC、不重啟或重載頁面清空記憶體；只上傳有上限的數值報告及截圖，沒有模型、權重或草稿。原 v1 歷史證據見 [大型手動草稿](large-edit-draft.md)，有限八輪組合另見 [組合生命週期](composition-lifecycle.md)。本項一次大檔恢復驗收不代替數小時、其他引擎、OS 斷電或公司環境。

28 項本機相關 Node 檢查與兩份腳本語法檢查已通過，涵蓋指紋讀取保護、v1／v2 還原及程序所有權；這些不是瀏覽器成功證據。真實 Hosted 結果及獨立產物核對見下方。


## 已核對的結果

[40822713475](https://github.com/koviankevin/tflite-explorer/actions/runs/40822713475) 的九個流程檢查通過；[原始 provider ZIP](results/large-composition-draft-2026-10-29.zip)、[完整原始報告](results/large-composition-draft-native-2026-10-29.json)與[獨立核對](results/large-composition-draft-review-2026-10-29.json)保存。PR head `36caf856dc0f7dd778e0a23c1299a7d234a86b26`，實際 checkout `8bb76dc69a2fc9c71899b50292ec01c15236e271`、tree `4f4d19a8a215c6c9c6e70982831496bb8bfd1b9b`、build `b25a812047ccabf3`；獨立乾淨重建吻合。合併後 main `92a376091ecc1f7fbdaea18980cd13148c0e3644` 的完整 tree 相同，沿用此次原生驗收，沒有在 main 重跑瀏覽器。

| v2 實際操作 | 耗時 | 主執行緒最大計時間隔 |
| --- | ---: | ---: |
| 手動下載草稿 JSON | 8.21 秒 | 51.9ms |
| 重新選原模型並還原 | 8.93 秒 | 53.8ms |
| 還原後下載組合模型 | 14.65 秒 | 60.7ms |

上述五個 v2 階段皆無 Long Task，取消回應 32ms、停止於 15728640 bytes，未套用部分變更。v2 JSON 2320 bytes，不含模型／權重；六步歷史／一步 Redo、兩組片段、所有接線及介面、32px、縮放與捲動均還原，之後 Undo／Redo 可繼續。

重匯出 1345938408 bytes／九個 OP，SHA `7652cbcfe610e6c9c2e49b6e53ce26fce5e2505a87c12bb52def9b824ec08086`，與還原前及既定八輪組合結果完全相同。六段共 1342177320 bytes 的完整非零權重／custom options 串流比對通過；重開後 prefix／branch 各一筆、錯誤連線零筆、預設 reshape／transpose 一筆。[重開後的 pattern 搜尋截圖](results/large-composition-draft-reopen-2026-10-29.png)為探索圖預設 14px；還原編輯區的 32px、視角與介面由同次原生流程及 JSON／DOM 斷言核對。

八個模型 Worker 都 terminate 並原生 close，六次手動指紋觀察包含四次完整與兩次取消；六個觀察到的 owned PID／start-ticks 全部正常退出。RSS 取樣峰值 905646080 bytes、相對 baseline 成長 396103680 bytes，六個 Worker 檢查點均在原門檻內；八個 URL 自然撤銷，無強制 GC 或重啟。原 v1 所有流程同次保留並通過，不代表所有引擎或數小時負載。

[main 四關卡核對](results/large-composition-draft-gates-review-2026-10-29.json)確認新 [contract 40823317812](https://github.com/koviankevin/tflite-explorer/actions/runs/40823317812) 的[原始產物](results/large-composition-draft-contract-2026-10-29.zip)，並以相同模組 fingerprint 沿用 core 40700051621、browser 40819856581、site 40814696559。正式 preview.26 應用及部署未改。

截圖另確認返回探索後「加入組合草稿」按鈕選取標示可能殘留，已列入[已知問題](known-issues.md#待修工作區切換按鈕選取標示)。本頁的資料還原與匯出驗收不把此介面缺陷寫成已修復。
