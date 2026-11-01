# Renderer 釋放變化的最小重現

本實驗接續[原八輪的觀察](physical-memory-attribution.md#八輪獨立診斷的觀察)，只用於釐清尚未發布的 v1.4.1 候選所遇到的原生記憶體問題。原正式失敗 `41252363060` 維持失敗，公開站與固定下載維持 v1.4.0；實驗不是發布關卡。

八輪原始資料中的大幅下降都發生在 release phase 開始後約 4～6 秒，且 renderer anonymous RSS 的下降量接近大型 source Worker 的 committed heap 加 backing；這只是待驗證的線索。原資料沒有 allocator 歸屬，不能因數量接近就確認根因。

先測一個排除條件明確的流程：原生選檔、局部定位第一個 OP、關閉模型，繼續取樣 45 秒。不匯出、不建立下載 Blob URL、不編輯或執行 interpreter。兩個合成 TFLite 保持原產生器的結構，分別為 3,005 與 21,005 個 OP，權重都縮為實際寫入、完整 readback 雜湊核對的 1 MiB；每份檔案小於 16 MiB。這不是超過 1 GiB 檔案的正式效能驗收，也不取代它。

獨立 workflow `renderer-release-probe.yml` 只有 main／手動入口、contents read 權限與十分鐘上限。每個案例使用新的隔離 Chromium、同一份乾淨來源、1280×640／圖字 32px、原生 chooser；500ms 取樣與原 10 秒正常關閉／observed-identity reap 規則保持。模型關閉仍要求 model Worker 在原五秒內退出，頁面 layout Worker 則在 context 關閉時核對。沒有 app 修改、GC／heap snapshot、時限放寬、安全設定改動或成功部署重跑。

訊號預先固定為：已關模型至少一秒後，同一 renderer 身分的相鄰完整觀察出現至少 100 MiB anonymous RSS 下降，間隔不超過 1.5 秒。保留總 RSS、原生分類、主頁 heap used／total 及差值，不扣除原 RSS。其他程序下降、PID／creation identity 改變、缺少 renderer 資料或過長的取樣缺口都不能冒充這個訊號。沒有觀察到訊號也照實記錄，不能解讀為修好正式記憶體失敗。

由既有 PID／startTicks guard 讀取原生資料，再投影為本次案例內的 ordinal labels；公開 JSON 只接受固定欄位、enum、數字和公開 Git／版本／雜湊字串。拒絕 PID、建立時間、路徑、環境、日誌與任意模型字串；上傳路徑只包含經驗證的單一 numeric report，private report／fixtures 不在 artifact 路徑。每個案例最多 512 個樣本、每個樣本 32 個程序，整份公開報告最多 8 MiB，超限明確失敗。

37 項相關選測通過，涵蓋既有 identity／memory probe、真正入口拒絕非 hosted 環境、結構縮小、延後釋放訊號與負例、缺漏／重用、公開欄位／報告預算、禁止發布，以及真實 workflow 的原件／fixture 上傳拒絕。實際 hosted probe 仍待必要 PR／來源核對後的一次限定執行；尚未取得這個最小案例的量測結果。
