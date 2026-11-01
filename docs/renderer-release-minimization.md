# Renderer 釋放變化的最小重現

本實驗接續[原八輪的觀察](physical-memory-attribution.md#八輪獨立診斷的觀察)，只用於釐清尚未發布的 v1.4.1 候選所遇到的原生記憶體問題。原正式失敗 `41252363060` 維持失敗，公開站與固定下載維持 v1.4.0；實驗不是發布關卡。

八輪原始資料中的大幅下降都發生在 release phase 開始後約 4～6 秒，且 renderer anonymous RSS 的下降量接近大型 source Worker 的 committed heap 加 backing；這只是待驗證的線索。原資料沒有 allocator 歸屬，不能因數量接近就確認根因。

先測一個排除條件明確的流程：原生選檔、局部定位第一個 OP、關閉模型，繼續取樣 45 秒。不匯出、不建立下載 Blob URL、不編輯或執行 interpreter。兩個合成 TFLite 保持原產生器的結構，分別為 3,005 與 21,005 個 OP，權重都縮為實際寫入、完整 readback 雜湊核對的 1 MiB；每份檔案小於 16 MiB。這不是超過 1 GiB 檔案的正式效能驗收，也不取代它。

獨立 workflow `renderer-release-probe.yml` 只有 main／手動入口、contents read 權限與十分鐘上限。每個案例使用新的隔離 Chromium、同一份乾淨來源、1280×640／圖字 32px、原生 chooser；500ms 取樣與原 10 秒正常關閉／observed-identity reap 規則保持。模型關閉仍要求 model Worker 在原五秒內退出，頁面 layout Worker 則在 context 關閉時核對。沒有 app 修改、GC／heap snapshot、時限放寬、安全設定改動或成功部署重跑。

訊號預先固定為：已關模型至少一秒後，同一 renderer 身分的相鄰完整觀察出現至少 100 MiB anonymous RSS 下降，間隔不超過 1.5 秒。保留總 RSS、原生分類、主頁 heap used／total 及差值，不扣除原 RSS。其他程序下降、PID／creation identity 改變、缺少 renderer 資料或過長的取樣缺口都不能冒充這個訊號。沒有觀察到訊號也照實記錄，不能解讀為修好正式記憶體失敗。

由既有 PID／startTicks guard 讀取原生資料，再投影為本次案例內的 ordinal labels；公開 JSON 只接受固定欄位、enum、數字和公開 Git／版本／雜湊字串。拒絕 PID、建立時間、路徑、環境、日誌與任意模型字串；上傳路徑只包含經驗證的單一 numeric report，private report／fixtures 不在 artifact 路徑。每個案例最多 512 個樣本、每個樣本 32 個程序，整份公開報告最多 8 MiB，超限明確失敗。

37 項相關選測通過，涵蓋既有 identity／memory probe、真正入口拒絕非 hosted 環境、結構縮小、延後釋放訊號與負例、缺漏／重用、公開欄位／報告預算、禁止發布，以及真實 workflow 的原件／fixture 上傳拒絕。實際 hosted probe 仍待必要 PR／來源核對後的一次限定執行；尚未取得這個最小案例的量測結果。

## 第一次執行與建置位置修正

PR #211 的 898 項 Node 測試通過、35 項既有選做略過，79 項必要契約全通過，實際受測 tree 與主分支相同。其後限定的一次 [41261551022](https://github.com/koviankevin/tflite-explorer/actions/runs/41261551022) 在 build 階段失敗，模型與瀏覽器尚未開啟，記憶體樣本為零。

原因是實驗將 core 輸出放在 runner 暫存目錄，違反既有 `buildDestination()` 僅接受專案輸出目錄的守門。從原報告的錯誤雜湊，與直接執行真正 builder guard 的錯誤逐字雜湊核對一致；[公開摘要](results/renderer-probe-build-failure.json)只列固定原因、來源、計數與 provider 校驗值，原始日誌與證據留在本機。

修正將 core 改放在專案 `build/` 下的獨立新目錄，報告／fixture 位置分開，沒有放寬 builder guard。實際 builder 契約回歸先重現相同拒絕，再驗證新位置可接受、原位置仍拒絕，相關選測增為 38 項且全通過。必要 PR／來源核對後，以修正來源事先限定一次 probe；原失敗和正式大模型失敗都不改列成功，也不重新執行原關卡。

## 第二次執行與顯示數量修正

PR #212 的 899 項 Node 測試、79 項發布契約通過，實際受測 tree 與主分支相同。修正建置位置後的 [41262415628](https://github.com/koviankevin/tflite-explorer/actions/runs/41262415628) 已開啟 3,005 OP 的小型模型，但 UI assertion 將畫面的分組數字 `3,005` 與原始字串 `3005` 比較，立即失敗。原錯誤訊息逐字重現的 SHA-256 與 artifact 相同；不是模型解析失敗或記憶體超標。保留一筆 baseline 樣本，尚無 loaded／closed 量測，不能用於判斷釋放。

六個觀察到的程序身分全部退出，model 與 layout Workers 皆關閉。原報告將失敗階段標為 cleanup，是 finally 覆寫了 ui 階段；現在於清理前記錄原錯誤，清理若另外失敗仍各自保留。數量比較改為與 UI 同樣的 en-US 分組格式，隔離 context 固定該 locale，不修改 app、parser、原測試門檻或正式部署。

回歸先重現相同的 `3,005 !== 3005`，再對兩個實驗規模核對正例並拒絕錯誤數量；原始 ZIP、日誌與失敗留在本機，公開僅有[固定欄位摘要](results/renderer-probe-count-failure.json)。修正來源的必要檢查與精確 tree 核對後，最多再執行一次本最小實驗；不重跑原大模型關卡或成功部署。
