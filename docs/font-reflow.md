# 排版途中切換圖字級

在 1280×640 的 Chrome 上，模型排版尚未結束時切到 32px，曾出現文字超框及節點標籤重疊。只檢查選單值、節點數及頁面沒有水平溢位，無法發現這個問題；[原始截圖](results/font-reflow-before.png)與[未修改候選的回歸報告](results/font-reflow-before.json)保留實際失敗。

Netron 在 `render()` 開始時把 `view.target` 暫時設為 null，之後依序建立、量測文字及非同步排版。原本的字級事件在沒有 target 時提前返回，只改 CSS 而沒有要求重新量測；於是 14px 的框可能顯示 32px 文字。回歸中 `Mul` 的文字約 59px 寬、43px 高，框卻只有約 40×27px。

修正保留「尚無模型」的防護，但不再把暫時沒有 target 視為不能重排。存在的 target 仍提供縮放值；排版途中則讓現有 render generation／queue 丟棄過期結果，按最新字級重新量測。

## 回歸方法與範圍

`test/browser/font-render-flow.mjs` 只暫緩一筆真實 `dagre.layout` 訊息，在 14px 文字已量測、target 尚未建立時，從可見選單依序切到 20px、32px，再送出完全相同的訊息。圖形資料、worker 演算法與回應幾何都未修改。最後直接比較 operator／argument 文字與背景框的實際邊界，並保存截圖；不以等候文字「剛好符合」取代驗證。

舊候選 `c3e7da7`／build `ff39550749434e50` 的原生回歸確實 exit 1，原因為上述文字邊界不符；該輪瀏覽器正常關閉，沒有將清理錯誤誤認為版面回歸。修正來源 `403352c`／build `3469aaf8c86bdc66` 的相同回歸在原生 Chrome／Edge 均 exit 0，每個瀏覽器五個 OP 的文字邊界通過，實際截圖也已檢視；[原始報告](results/font-reflow-native.json)、[Chrome](results/font-reflow-native-chrome.png)、[Edge](results/font-reflow-native-edge.png)保留該輪範圍。

後續把圖的輸入／輸出標籤也納入檢查，避免只驗 OP。相同未修改候選再次確實失敗：[七組文字／框線的原始報告](results/font-reflow-boundaries-before.json)顯示輸入標籤約 239px 寬，框仍只有約 119px。

修正來源 `7068a7e`／build `c2530ff70d952076` 的完整七組邊界已在原生 Chrome／Edge 通過，[實際報告](results/font-reflow-boundaries-native.json)、[Chrome 截圖](results/font-reflow-boundaries-chrome.png)、[Edge 截圖](results/font-reflow-boundaries-edge.png)均保留。兩端使用完全相同的 font flow SHA；獨立讀取器重新核對五個 OP、兩個圖輸入／輸出、32px 與每個實際文字／框線座標，debug log 的兩個正常退出亦無 forced kill。[校驗收據及測試原文](results/font-reflow-verification.json)記錄完整雜湊。後續若只有文件／證據變更，沿用這批相同應用與測試程式的結果；新的正式網站來源關卡與部署仍須完成。

網站驗收對新來源必跑此情境，僅明確排除已發布、尚無此修正的 preview.1–34、v1.0.0、v1.0.1、v1.1.0，維持舊版回退能力。未知版本、重新包裝後的標籤及未來版本不能藉改名略過此檢查。原有其他驗收情境與發布關卡不變。

此修正只影響 SVG 字級事件，不改模型、權重、pattern 比對、資料格式或手動 interpreter。Windows 大模型的最後 browser close 逾時是另一個尚未解決的驗收問題，見 [Windows 大模型](windows-large-model.md)。

## 合併後驗證與 v1.2.0 正式交付

[PR #184](https://github.com/koviankevin/tflite-explorer/pull/184) 的實際 checkout 為 `f476897`，完整 tree 與合併後 `bb3bd37` 一致。原始 job 日誌已核對 813 項測試：778 通過、35 項既有條件略過、零失敗／取消；發布契約 78 項通過。

[Main 網站驗收](https://github.com/koviankevin/tflite-explorer/actions/runs/41174045604)另在正常 HTTP 的隔離候選執行必跑的字級回歸，實際核對 13 個 OP 加兩個輸入／輸出標籤，共 15 組 32px 文字框。完整 34 項操作、TFLite／MLIR 匯出重開與 pattern、19 種手動執行情境、八輪／24 次 CPU／IO、原記憶體判定及正常程序退出通過。原始 artifact digest、CRC、來源、實際報告與 scope 皆已核對；這是 Linux 候選證據，不把它寫成 Windows 完整大檔通過或正式站已更新。必要關卡已補齊，正式交付仍待固定準備包與正式站／Release 核對。

後續 [main 實體八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41174035077)已完成，原判定、40 個模型 Worker、自然 URL 釋放及正常程序退出通過；[四項關卡收據](results/product-readiness-main-verification.json)與[原始封存](results/product-readiness-main-evidence.zip)保留。核心量測沿用完全相同的 88 個依賴檔案，文件／證據更新不重跑相同程式的已成功驗收。

上述為發布前的來源關卡；後續已以精確來源 `f592e3d9df7ed48fae2ca19e353c7215638959a3`／build `d69754e5b6791ecd` 完成 [v1.2.0 正式交付](product-readiness-v1.2.md)。[最終收據](results/product-readiness-v1.2-published.json)另核對正式站 34 項實際操作、同一字級回歸的 15 組實際文字框、完整 1,445 檔及四份固定下載。原候選報告不改寫為正式報告；Windows 大模型正常關閉仍未通過。
