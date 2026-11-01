# 卷積／pooling 動態 shape 的 metadata 驗證（v1.4.5 候選）

目前正式網站與固定下載是 [v1.4.4](fully-connected-validation.md#v144-正式交付)。本候選補上可確定的 rank／bias／參數檢查與逐 OP 報告，尚未發布；一般編輯／匯出仍不自動執行 interpreter。

## 已重現與修正

在未修改的應用上，四份真實序列化的合成模型已經歷編輯、匯出及重新開啟：動態 input 掩蓋錯誤的 CONV_2D filter rank、input rank、DEPTHWISE_CONV_2D bias dtype，以及 AVERAGE_POOL_2D output rank。原本 stride／window 為零已被編輯入口擋下，未誤列為新增修正。

根因是完整 shape 推導在動態 extent 提前返回，跳過仍可判定的 rank／bias 條件；序列化報告原本也沒有共用 spatial 規則。現在先檢查可確定的 rank、參數、已知 filter／bias 尺寸，再決定是否能推導完整 shape。四份原始匯出檔在編輯及報告入口均拒絕，未重寫原檔或讀取權重。

規則對照 TensorFlow 固定來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/conv.cc#L339)、[depthwise_conv.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/depthwise_conv.cc#L99) 與 [pooling.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/pooling.cc#L68)。原始參考檔及 SHA-256 保留在[候選收據](results/spatial-metadata-candidate.json)。

## 已核對的候選

23 項新回歸、170 項相關測試及 13 項版本選測通過。既有真正 CPU suite 的五種 spatial 正例與 allocation 負例仍通過。動態合法 shape、legacy rank、hybrid filter、未知 rank／packing、custom 同名隔離、未讀權重與手動 runtime 的狀態都有針對性檢查。

乾淨來源 `6e663566e36e753bb442d0ba34952e9981ed6052`／tree `ec465d337f03bedc3788387ff7b185c1ff82bcba`，build `0b239da23a4ef7e4`，329 核心檔。Chrome／Edge 每端六組原生案例，三個非法模型皆零下載；合法靜態卷積、動態 depthwise 與靜態 pooling 可接線、查看逐 OP 報告、下載並重開搜尋。1280×640、圖／編輯字級 32px 的報告版面數值與兩張實際截圖已核對；每端十個 Worker（九個 model Worker）與觀察到的自有程序依原十秒規則正常退出，零自動 runtime。

十二份實際下載（六模型、六報告）已獨立核對型別／shape／signature、options／OP version、連線與可適用的原始常數 bytes；pooling 沒有權重，明列不適用。每份 singleton pattern 為兩筆、未連接的同類 OP→OP 負例為零。四份靜態下載另真正 CPU invoke，兩個 outputs 均得到卷積 `[12, 16, 24, 28]` 或 pooling `[5, 6, 8, 9]`；四份 IO ZIP 的 digest／CRC／長度核對通過。動態案例未冒充 CPU 通過。

第一輪兩端都停在 fixture 與 schema 預設值的比對差異；改以實際原始檔解碼後比較，應用未變，原失敗保留。後續成功沒有覆蓋歷史紀錄。

## 待接續與界線

必要 main 關卡、正式 HTTPS 與 v1.4.5 不可變 Release 尚待接續；核心 scope 未變可重新核對既有可信 main 證據，其他三個 scope 已變更。未知或動態 shape、其他 dtype／packing 明列未檢查；靜態通過只代表列出的 metadata 規則，不是 kernel、量化數值或公司契約保證。Chrome 歷史雲端統計／網路注入、實體 RSS 與完整商品等級目標的界線不變。沒有同步 Sites／GH Studio 或重跑成功的 v1.4.4 部署。
