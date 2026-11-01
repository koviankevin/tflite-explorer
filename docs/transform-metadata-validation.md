# SQUEEZE／CONCATENATION 的 metadata 驗證（v1.4.6）

已於 [v1.4.6](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.6) 正式交付，build `6d032862ea5b71d5`。一般編輯／匯出仍只做靜態檢查，interpreter 保持手動。下方候選與失敗維持原受測來源及當時狀態；目前交付見[正式交付](#v146-正式交付)。

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

## 四項主分支關卡已核對（尚未發布）

[PR #233](https://github.com/koviankevin/tflite-explorer/pull/233) 已合併為 `2bf6ad9e5b042661c4abe56a439ce6fda9f3489b`，完整 tree 與實際 PR checkout 相同。Node 1,055 項中 1,020 通過、35 個既有選做略過；79 項契約及九筆 PR core 量測的原始來源／報告亦已核對。正式 core 沿用相同 88 檔 scope 的可信 main `41269145087`，重新核對 provider 狀態、原始 ZIP digest／CRC 與政策；PR core 不當成 main dispatch 證據。

[四關卡收據](results/transform-metadata-main.json)對應來源 `2bf6ad9e5b042661c4abe56a439ce6fda9f3489b`／tree `b192b99eb99ab6cbd7b7dc5b15921c7c9b80bc48`、build `c80ac02ed3c24a33`。新來源的 79 項契約零略過、六種版本切換及 824 檔 HTTP 候選／38 項操作通過，含 15 組 32px 文字框、19 種手動 runtime、部分 IO、八輪／24 次 CPU／IO 與原記憶體規則；實際 provider 截圖已查看。六組 transform 原生案例另保留其候選來源，不宣稱字面新增在原 38 項 smoke 中。

[實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41299693978)使用原 1,349,965,216-byte／21,005 OP fixture，完整／局部／組合匯出重開、權重／custom options／pattern 與正常程序退出通過。1,957 次取樣、57 個 Worker 及六個觀察到的自有程序均依原政策核對；關閉後 RSS slope −26,018,026.06 bytes／輪、drift −122,814,464 bytes、main heap drift 176,112 bytes，sampled peak 1,102,196,736 bytes。負 slope 是此有限輪次的觀察，不是長期不洩漏保證。沒有 forced GC、RSS 扣除或 timer／門檻修改。

上述主分支驗收完成當時，正式 HTTPS、v1.4.6 不可變 Release 與四份公開下載尚待接續、正式版為 v1.4.5；後續交付見下節。Windows Chrome 原生關閉失敗及完整商品等級目標繼續保留。

## v1.4.6 正式交付

固定來源 `dd896a29820b367e01f8e4ed0c34cc66a7b49646`／tree `1c703c67bd6edec9e9a54ab4d335efc09ffd5053`、build `6d032862ea5b71d5` 已由[同一次發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41301573028)完成。329 核心檔、全站 1,485 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對，含搜尋／pattern、TFLite／MLIR 匯出重開、逐 OP／量化／legacy shape、15 組 32px 文字框、19 種手動 runtime、部分 IO 及八輪／24 次 CPU／IO 原記憶體規則。六組 transform 原生案例另保留其候選來源，不宣稱字面包含在原 38 項 smoke。

第一次 verify_live 工作因原八分鐘上限被 GitHub 取消，官方 annotation、原始報告與 artifact `13081967188` 完整保留；報告功能通過不把取消改列成功。只補跑失敗驗證一次：attempt 2 的 verify_live／release 成功，prepare／deploy 沿用 attempt 1 的結果。GitHub 對沿用工作建立新 metadata ID，但原步驟與執行時間均相同；已與原始紀錄核對，沒有重新部署、刪 artifact 或修改時限／安全規則。新驗證 report 另由同一 job 的 checkout、build／site、完整 checks、測試步驟時間與 upload ID／digest／bytes 綁定；官方 REST 與原始日誌的時間範圍均通過，未正規化時間。

固定 ZIP 41,315,520 bytes，SHA-256 `5c4fa5d545c75245c03b589af5b7c468e55ed8d0d2d97ec5194b9f07ea4df882`；四份實際公開下載均與準備包一致。Site ID `9acc791162b8be2cbf93b24d49054e21505fa23fdbf29b574e607dba8dd20d67`，tag／Latest／權威 deployment 核對完成，保留 v1.4.5／v1.4.4 與永久 baseline；舊 v1.4.5 tag、四份附件及首次失敗 artifact 都未改寫。[最終數值收據](results/transform-metadata-v1.4.6-published.json)保留來源、範圍與有限結果；原始報告、日誌、截圖及檔案另保留。

未知完整 shape／packing、量化數值、公司 kernel／dialect、Windows Chrome 歷史正常關閉與 CI 時間餘裕仍有界線。有限驗收不代表完整商品等級目標已完成。沒有同步 Sites／GH Studio，成功部署沒有重跑。
