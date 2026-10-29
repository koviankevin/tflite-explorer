# 惰性權重 decoder 的 reader 隔離

本頁記錄的修正已在 [preview.31 正式交付](preview31.md#發布狀態)核對；原始失敗、診斷與當時的待驗證狀態保留於下文，不改寫歷史。

preview.31 初次 Firefox／WebKit candidate 都在示範檔實際 CPU 開始前失敗：`Tensor 15 is invalidly specified in schema`。兩引擎各十三項探索／編輯／MLIR 流程已通過，但示範 CPU 為失敗，尚未走到輸入清理檢查。原始 ZIP／provider digest／CRC／來源與畫面保留，沒有將它改寫為成功。

同一來源 `e273de6568663f63ae3465ef44f003d506445c5c` 的一般建置為 build `cce9e9e1a2f35306`，桌面流程先匯入解析器再建置則為 `3cf6f539a384da32`。兩者 demo 分別為 12,624／12,616 bytes，SHA 為 `b417c9581c3c18d16f41cb9ebccf5d64ac461eeda333a620882fd191c65eb83d`／`f5ffe821c52198e421eb732e2238ad12fabab2628775327c441c07c61cceaa92`。獨立讀取器首先因 build ID 不同而拒絕；後續失敗稽核明列此差異，未取消成功驗收對建置身分的一致要求。

本機隔離程序也重現：先產生 demo，再單純 import model-engine，後一次 demo 就少了八個 inline weight bytes。原因是 module top level 永久改寫共用 `schema.Buffer.decode`，將原 inline payload 表示為舊檔案 offset／size；後續一般 builder 又用同一個 schema，重新序列化時失去該 payload。這是 import side effect，與新輸入視窗的 callback cleanup 是不同根因。

修正保留原有 lazy decoder 的邏輯，但只由 parseModel 的 reader table wrapper 使用；不改寫產生器共用的 Buffer decoder。大型模型仍以 byte ranges 表示權重，custom options／來源 bytes／shape 規則不變。新的隔離 child regression 要求 import 前後 demo 完全相同、原 generated decoder 身分不變、權重仍為八 bytes 的 inline payload；有十五秒外部程序上限。

新回歸修正前失敗，修改後與示範實際 CPU／custom inline及external options／超過 2 GiB offset／實體 fixture 契約／輸入視窗等十八項本機測試通過。這次改到解析核心，不能沿用舊 core fingerprint；四個現有 main 關卡及 Firefox／WebKit candidate 均須對修正版重新驗證。舊關卡與失敗保留，不放寬門檻，不修改 workflow 或正式 preview.30。

目前仍為 preview.31 的未發布修正；固定正式版與新版本交付須依發布證據確認。此頁不是所有 importer 併發、所有模型或長時間記憶體的完整保證。

[原始本機 red／green ZIP](results/reader-isolation31-unit.zip)及[SHA／byte 清單](results/reader-isolation31-unit.json)保留未正規化輸出。

[首輪兩引擎失敗與 Chromium 成功的原始產物](results/reader-isolation31-initial.zip)及[來源、provider ZIP／SHA、讀取器歷程與檔案清單](results/reader-isolation31-initial.json)另行保存；兩引擎的 authentication 通過不代表 acceptance 成功。
