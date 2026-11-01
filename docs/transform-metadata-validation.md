# SQUEEZE／CONCATENATION 的 metadata 驗證（v1.4.6 候選）

目前正式版仍為 [v1.4.5](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.5)。以下是未發布候選的有限驗證；一般編輯／匯出仍只做靜態檢查，interpreter 保持手動。數值與來源見[候選收據](results/transform-metadata-candidate.json)。

## 已重現與修正

未修改的來源 `cf5e93d853983bd759f922a03c85e66d22d684fd` 曾實際編輯、序列化並重開五份非法合成模型：CONCATENATION 的動態輸入掩蓋錯誤 axis、輸入 rank 或輸出 rank；SQUEEZE 的動態輸入掩蓋越界 axis 或指定已知大小為 2 的維度。原本完整 shape 推導在動態 extent 提前返回，逐 OP 報告也沒有共用這兩個 OP 的規則。

現在先檢查可確定的 dtype 關係、axis、rank、已知非 axis 尺寸及 SQUEEZE 單位維度，再判斷是否能推導完整 shape。明確 axes 能推導輸出 rank；隱式 squeeze 只能依已知維度提供 rank 範圍時，不猜測未知尺寸。五份原始錯誤匯出檔在編輯與序列化報告入口均被拒絕，原檔雜湊未變，檢查沒有讀取權重。

規則對照固定 TensorFlow 來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [squeeze.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/squeeze.cc) 與 [concatenation.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/concatenation.cc)。原始參考檔與 SHA-256 保留；負軸、重複軸、scalar、零尺寸與真正 CUSTOM32 同名 OP 的行為有分別檢查。

## 本機與原生瀏覽器結果

27 項新增 metadata 回歸、239 項相關測試與 13 項版本選測通過。真正 CPU suite 包含十組正例及三組預期 allocation 失敗；正例包含多輸入／負軸 CONCATENATION、INT8 version 2、重複與等價 SQUEEZE 軸、scalar 結果及全常數 scalar concat。動態合法模型可匯出重開，不因完整 shape 未知而被誤擋。

乾淨候選來源 `dc97e616ca0213f9b66199f94d55ad5fb216d014`／tree `92644c663979c73c17b4e828e24119623593e312`、build `99f9aea67d344b0e`，329 核心檔。Windows Chrome 156.0.8078.76 與 Edge 156.0.4314.50 每端六組實際選檔／接線案例，1280×640、模型圖與編輯字級 32px：

- 三份非法動態模型均拒絕並顯示 subgraph／OP／input／output，零下載。
- 靜態 concat、靜態重複軸 squeeze 與合法動態 squeeze 可下載模型及逐 OP JSON，重開後搜尋兩個 OP。
- 十二份實際下載獨立核對型別、shape／signature、options／OP version、輸出及連線；concat 常數 8 bytes 相同，squeeze 無權重而明列不適用。六份模型的 singleton pattern 各兩筆，未連接的 OP→OP 負例各零筆。
- 四份靜態下載另真正 CPU invoke，兩個 outputs 均得到 concat `[1, 2, 3, 4]` 或 squeeze `[1, 2]`；四份 IO ZIP 的 digest、CRC 與長度通過。動態案例沒有冒充 CPU 通過。
- 兩張實際報告截圖已查看；報告在 viewport 內、長內容換行。每端九個 model Worker、一個 layout Worker 及一個 recovery Worker 均關閉，零自動 runtime Worker。

Edge 依原十秒上限正常關閉，觀察到的十一個自有程序皆退出。**Chrome 功能通過，但原生整輪因 `normal browser.close exceeded10s` 失敗**；失敗當時仍有兩個已確認身分的程序，後來同一 session 以 exit 1 結束，再次唯讀檢查已無原八個程序身分存活。較晚退出不替代原失敗，也不能證明這次的底層根因。沒有重跑碰綠燈、調整 flags／timer／門檻、改防毒或 OneDrive 設定。

原生測試使用與 manifest 綁定的原始 HTML fixture；它證明實際 chooser、接線、下載及本機程式行為，不代表正式 HTTPS transport 或實體 RSS。正式來源、必要主分支關卡、網站及不可變 Release 尚待接續。

## 規則界線

靜態通過只代表列出的 metadata 規則。未知或動態完整 shape、非支援 packing／dtype、超出目前 kernel rank 的 squeeze、非 NONE activation、scalar concat 的常數所有權條件與真正 custom kernel 保持明確未檢查。全常數 scalar concat 有手動 CPU 正例，也不因此將未知 scalar 一概標為靜態通過。量化數值、任意 runtime／公司契約仍需另外驗證。

本輪單次 metadata 量測涵蓋 CONCAT rank 64、64／512／4,096 個輸入，最多 262,144 個維度欄位；沒有讀權重或執行 kernel。數值受 JIT／環境影響，不當成延遲 SLA 或洩漏證據。完整商品等級目標與歷史 Windows 關閉／網路注入界線保留，沒有同步 Sites／GH Studio。
