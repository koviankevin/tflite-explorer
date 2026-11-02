# 大型 Canvas 總覽的連線排版

Canvas pattern 總覽依實際連線安排各層的位置。較窄的主幹會對齊相連的分支與匯合，不再讓每一層都從最左側開始。沒有前置依賴的獨立來源會放在最早使用者的前一層，減少權重／常數等晚用來源集中在第一層造成的超寬圖；這項規則依連線判斷，不猜測 custom OP 的型別或語意。

跨越多層的連線、回邊與迴圈保留原始端點，沿分區側邊的折線通道繪製，縮小時也保留通道。不同 functions／subgraphs 保持分區；搜尋定位、縮放、框選與 pattern 匯出沿用原始節點識別。此修改僅計算顯示座標，不會改寫模型、tensor／SSA、控制流程或權重。

排版仍在 model Worker 執行。迴圈以迭代式 SCC 計算處理；分層後只做三組前後連線排序與線性壓緊，不因跨越多層的連線建立大量虛擬節點。每側最多使用八條通道並重用，因此密集連線仍可能重疊；這是大圖概略總覽，不保證全圖無交叉。純長鏈縮到全圖時仍可能看不清文字，可搜尋定位、放大或先收合 pattern。

這項修正適用 `src/overview-layout.js` 與 `src/overview-canvas.js` 的 Canvas 總覽。一般 Netron SVG 圖的排版維持原流程。移植到內網時，兩個檔案須一起更新，因為 renderer 必須支援側邊折線及真正的最後一段箭頭；內部 dialect adapter 不需因此改寫。

相關驗證包含寬輸入／窄主幹、分支與匯合、晚用來源、側邊長線與迴圈、32px 字級、兩種圖方向、Canvas 縮放／平移後命中與框選，以及既有 pattern 和模型匯出測試。公司內部模型未納入公開測試資料。

## 緊湊節點與鍵盤移圖

Canvas 節點依標題與位置摘要估算寬度，不再讓短名稱使用固定 28em 寬框；長名稱有 18em 加留白的寬度上限。可見文字以實際 Canvas 字型量測並加省略號，完整名稱保留在 tooltip 與可存取控制項。摘要只列 OP 編號／block 或 pattern 的 OP 數，減少重複名稱；模型、搜尋與匯出資料不變。循環群組依各欄的實際最大寬度排版，仍保留可選取且不交疊的節點。

按圖上方「鍵盤移圖」後，W／A／S／D 或方向鍵分別向上／左／下／右移動視窗，每次 80px；搭配 Shift 每次 240px。＋／－縮放、Home 顯示全圖。Canvas、一般 SVG 與編輯圖共用按鍵規則；編輯圖先點空白處或 Tab 到圖面。按鍵只在圖面內處理，輸入框、下拉選單、可編輯文字與組字期間保留原行為；Ctrl／Alt／Meta 組合鍵也不攔截。平移不改變 zoom 或已選取的 OP。

## v1.4.8 正式交付

2026-11-02 完成 [v1.4.8](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.8) 正式交付，來源 `c399043d55eaa5e1ce5edd5cc2d2bc6d0817c8ae`，build `391ebd7faebe5ad6`。正式網站與固定 ZIP 使用同一份已審閱產物；[發布工作流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41428517612) 的 prepare、deploy、verify_live 與 release 均成功。329 核心檔與完整站台 1,485 檔、四份真正公開下載的大小／SHA-256／manifest、Latest／tag 與 GitHub Pages deployment 已核對。

保留原本 38 項正式網站操作、15 個 32px 字框、19 個手動執行案例、八輪 runtime IO 與 24 次 CPU 執行。新的正式來源實體模型關卡完成 1,349,965,216-byte TFLite 的八輪開啟、完整編輯、匯出、重開、custom options／權重與資源釋放檢查，固定記憶體／URL 政策未變更。

Edge 正式站另外以 1366×768、32px 實際開啟本機合成 MLIR（2,125 OP、分支／匯合／迴圈與 custom OP），載入既存 pattern 並得到預期 529 筆匹配，建立 1,608 節點 Canvas 總覽；定位第 251 筆並展開後為 1,609 節點，實際拖曳框選一個 OP，滾輪縮放與鍵盤平移後選取保留，關閉模型也沒有 console error。原本 v1.4.7 的手動檢查找到側欄在清空 graph target 後才發出 select／blur；v1.4.8 先關閉側欄，再釋放舊 target，並以三個實際 Netron 事件回歸案例鎖定。v1.4.7 的成功自動化結果、固定下載與該手動錯誤紀錄均保留。

上述為公開合成資料驗收；不代表公司模型、私有 dialect、任意 kernel 或編譯器語意已驗收。密集圖的通道重用仍可能產生交疊，長鏈縮到全圖仍需放大或搜尋定位。

## v1.5.0 正式交付

2026-11-02 完成 [v1.5.0](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.5.0)，來源 `2648437c63a449174d9cd08767942e6dbe856221`，build `f019cdbbb96af0dc`；[發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41451270113)的 prepare、deploy、verify_live、release 全部成功。331 核心檔、完整站台 1,487 檔、四份真正公開下載的大小／SHA-256／manifest、Latest／tag 與 GitHub Pages deployment 均已核對。[交付收據](results/compact-navigation-v1.5.0-published.json)保留來源、關卡與鍵盤原始量測摘要。

原有 38 項正式 HTTPS 操作完整保留，另外在 SVG、編輯圖及跨 block 的分支／迴圈 Canvas 案例驗證 WASD／Shift 的八種實際按鍵、80／240px 距離、選取保留與搜尋框保護；匯出重開與原 pattern 檢查仍通過。1,094 項 Node 檢查有 1,059 通過與 35 項原有選做略過；79 項發布契約、九個 fresh-process 效能量測及 1,349,965,216-byte／21,005 OP 實體 TFLite 八輪關卡均以原有規則通過。發布仍保留 15 個字框、19 個手動 runtime 情境與八輪／24 次 CPU 驗收，不放寬時間、RSS 或 URL 政策。

Windows Edge 正式站另以獨立無介面環境開啟公開合成 MLIR（2,125 OP、529 筆匹配），收合為 1,608 個節點、展開定位第 251 筆後為 1,609 個節點；1366×768／32px 無頁面橫向溢位，實際移圖距離符合 80／240px，關閉模型與瀏覽器成功。[32px 畫面](results/compact-navigation-32px-edge.png)顯示節點與分支／匯合。額外測試的暫存 profile／DOM 讀取與非同步等待失敗皆保留本機原始紀錄；本機防毒注入的外部請求已封鎖，原始 CSP／載入警告另列環境限制，沒有關閉防毒或修改瀏覽器安全設定。此額外結果不取代乾淨 CI 的來源關卡，也不宣稱所有 Windows 環境問題均已解決。

本機合成 20,001 OP 排版五個量測樣本的中位數由約 105ms 增至 153ms，32px 短名稱寬度由 928 降到約 216～273；這是有界文字估算的成本，不是瀏覽器或 1GB 開檔 SLA。正式效能關卡保持原上限。公開合成驗收不代表公司模型、私有 dialect 或任意 kernel 語意已驗收；密集連線仍可能交疊。
