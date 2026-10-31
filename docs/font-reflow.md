# 排版途中切換圖字級

在 1280×640 的 Chrome 上，模型排版尚未結束時切到 32px，曾出現文字超框及節點標籤重疊。只檢查選單值、節點數及頁面沒有水平溢位，無法發現這個問題；[原始截圖](results/font-reflow-before.png)與[未修改候選的回歸報告](results/font-reflow-before.json)保留實際失敗。

Netron 在 `render()` 開始時把 `view.target` 暫時設為 null，之後依序建立、量測文字及非同步排版。原本的字級事件在沒有 target 時提前返回，只改 CSS 而沒有要求重新量測；於是 14px 的框可能顯示 32px 文字。回歸中 `Mul` 的文字約 59px 寬、43px 高，框卻只有約 40×27px。

修正保留「尚無模型」的防護，但不再把暫時沒有 target 視為不能重排。存在的 target 仍提供縮放值；排版途中則讓現有 render generation／queue 丟棄過期結果，按最新字級重新量測。

## 回歸方法與範圍

`test/browser/font-render-flow.mjs` 只暫緩一筆真實 `dagre.layout` 訊息，在 14px 文字已量測、target 尚未建立時，從可見選單依序切到 20px、32px，再送出完全相同的訊息。圖形資料、worker 演算法與回應幾何都未修改。最後直接比較 operator／argument 文字與背景框的實際邊界，並保存截圖；不以等候文字「剛好符合」取代驗證。

舊候選 `c3e7da7`／build `ff39550749434e50` 的原生回歸確實 exit 1，原因為上述文字邊界不符；該輪瀏覽器正常關閉，沒有將清理錯誤誤認為版面回歸。修正來源 `403352c`／build `3469aaf8c86bdc66` 的相同回歸在原生 Chrome／Edge 均 exit 0，每個瀏覽器五個 OP 的文字邊界通過，實際截圖也已檢視；[原始報告](results/font-reflow-native.json)、[Chrome](results/font-reflow-native-chrome.png)、[Edge](results/font-reflow-native-edge.png)保留該輪範圍。

後續把圖的輸入／輸出標籤也納入檢查，避免只驗 OP。相同未修改候選再次確實失敗：[七組文字／框線的原始報告](results/font-reflow-boundaries-before.json)顯示輸入標籤約 239px 寬，框仍只有約 119px。修正後完整七組邊界及新來源的正式網站關卡仍待補驗，不把第一輪五個 OP 成功擴大為尚未完成的範圍。

網站驗收對新來源必跑此情境，僅明確排除已發布、尚無此修正的 preview.1–34、v1.0.0、v1.0.1、v1.1.0，維持舊版回退能力。未知版本、重新包裝後的標籤及未來版本不能藉改名略過此檢查。原有其他驗收情境與發布關卡不變。

此修正只影響 SVG 字級事件，不改模型、權重、pattern 比對、資料格式或手動 interpreter。Windows 大模型的最後 browser close 逾時是另一個尚未解決的驗收問題，見 [Windows 大模型](windows-large-model.md)。
