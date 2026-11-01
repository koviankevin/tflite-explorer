# Legacy shape 驗證修正（v1.4.1）

已於 [v1.4.1](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.1) 正式交付，build `c64f4143bf8463a2`。修正非空 concrete shape 因 legacy has_rank=false 被略過的檢查；保留 shape、rank flag、量化及權重，未知／動態資料仍明列未檢查。 以下候選與失敗紀錄維持其原受測來源與當時狀態；目前交付見[正式交付](#v141-正式交付)。

固定 TensorFlow 來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [interpreter_builder.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/core/interpreter_builder.cc#L786) 直接將 shape 轉為 dims；[schema](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/schema/schema.fbs#L321) 的 rank flag 另用於區分空 shape 的 scalar 與未知 rank。網站原本把非空舊 shape 也視為未知，造成實際重新接線的 FC 尺寸錯誤漏擋，以及可讀 TRANSPOSE 常數未檢查。

以真正序列化、解析及編輯流程建立差異控制：同樣的 FC `[2,3]`／weights `[5,4]`，只有 false flag 會漏擋；合法 TRANSPOSE `[2,3] → [3,2]` 則原先列為未檢查。修正後共用 shape 判定套用於語意、spatial、operand 與常數檢查：非空 concrete shape 可用，空 shape／false flag、負維度 signature 仍列未知／動態。最多 128 維及 int32 尺寸，保持常數讀取 1 MiB／tensor、4 MiB／輪；若 data／output 已知動態，直接略過，不先讀參數常數。

108 項相關選測通過；抽出共用合成 fixture 後的六項 caller／動態／維度邊界與十二項版本選擇亦通過。五個 hash 固定官方模型的前後 metadata／常數檢查沒有新增拒絕；micro_speech 與 person_detect 各多一個可檢查 OP。每份原樣匯出與整圖切出均重新解析，shape／rank／量化與所有 payload 保留；person_detect 原有 14 個量化失敗不會變成通過。這些有限公開案例不代表任意 kernel 或公司模型已驗證。

真正 LiteRT.js 2.6.0 CPU WASM 對 canonical、legacy、legacy 編輯及切出 FC 的輸出均為 `[10,10,10,10,10,26,26,26,26,26]`。不整除的 legacy FC 負例會執行後才由輸出 shape 契約判失敗，`invoked=true`；不能寫成 compile／allocation 失敗或零 invoke。該負例也回報 `Tensors with strides or padding are not yet supported`，因此沒有 IO ZIP；這個原有 runtime 封存限制尚未修正。

最初測試 harness 曾缺少 FC 第三個輸入，且誤把切圖報告當成編輯常數檢查入口；已保留初版並修到真正 caller red。另保留先前 CPU 測試錯誤假設「負例不得 invoke／必有 IO」的失敗，後續依實際 pinned runtime 判定，不修改 runtime 或放寬規則。瀏覽器、PR／main 關卡及正式交付仍待完成；不覆蓋 v1.4.0 的發布證據。

上述 CPU 與無 IO 的結果保留原受測來源；後續候選的[部分 IO 保存修正](runtime-partial-io.md)讓同一 padded-output 負例可保留可讀 inputs，仍維持 runtime 失敗與 output 缺漏，不將舊結果改列成功。

## Windows 候選與來源範圍

來源 `decacbcafdeac8972c79c48225fe326f3192c870`／tree `ec58b5b9bfedb95a4cdf619bd86861f8df86a1ab`、build `28812015057240a2`，325 個核心檔。Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 各完成隔離原生選檔、1280×640／32px、不合法 FC 的零下載阻擋、兩個合法 legacy RESHAPE 的常數檢查／報告、實際匯出重開與兩個 OP 搜尋。原始 false flag、shape 與 8-byte 參數常數保留，報告／實際檔案 byte ranges 已比對。各三個模型 Worker、零個自動 runtime Worker；八／十一個觀察到的程序身分均在原 10 秒正常關閉規則內退出。

兩端的錯誤訊息及報告截圖已實際檢視；這是經完整性核對的原始 HTML 隔離 fixture 與原生操作，沒有正式 HTTPS 文件傳輸、實體 RSS 或歷史 Chrome／OneDrive 關閉修復的主張。[候選收據](results/legacy-shape-candidate.json)與[原始紀錄、失敗、截圖及讀取器](results/legacy-shape-candidate-evidence.zip)保留 SHA-256／ZIP CRC。模型、權重及 BIN／BMP 留在本機，未放入公開 evidence ZIP。

先計算四關卡的實際 dependency scope：核心 88 檔與既有 run `41247699658` 相同，可沿用；browser 345、contract 644、site 393 檔的 scope 已改變，須完成其必要新證據。新版本瀏覽器流程另核對 legacy 情境；只略過確定舊的不可變版本，其他新／未知版本仍必須驗證。PR／main 與正式交付仍待完成。

## 主分支驗收失敗，尚未發布

PR #206 已合併，主分支 `02f4288885dc07fc16ede730b361e65891b09fa8`／tree `e00f06da5ead4fe2924062a9177d4acce60f5b3c` 與實際 PR checkout 相同。903 項中 868 通過、35 項既有選做略過，78 項發布契約及九筆核心量測通過。主分支 build `e0554cfed416b2cb` 的 [網站關卡](https://github.com/koviankevin/tflite-explorer/actions/runs/41252371471)已核對原始 digest／CRC、六種版本切換及 37 項完整候選操作；新增 legacy 情境、既有量化／32px／pattern／MLIR、手動 runtime、八輪 CPU／IO 與原 RSS 規則均通過。主分支 [78 項發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/41252367051)亦獨立核對。

但同一次 [實體大模型八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41252363060)最終失敗，原結果保留，v1.4.1 沒有準備或發布。實體 1,349,965,216 bytes／21,005 OP 的八輪完整／局部／組合輸出、權重／options、pattern、讀取規則與 57 個 Worker 關閉、六個觀察到的程序退出均通過；關閉後六個量測點的 RSS slope 為 **25,575,775.09 bytes／輪**，超過原 **16 MiB／輪**。RSS drift 22,220,800 bytes、main heap drift 176,148 bytes 和正常關閉不會抵銷這個失敗。

第 3 輪關閉後 RSS 約 626 MB，第 4～8 輪約 782～798 MB；較早通過的來源也有約 640／790 MB 的階梯波動。兩份報告的八輪完整、局部與組合檔案 SHA-256、權重及讀取 bytes 逐項相同；這只證明資料保留，不是同一環境的因果 A/B 或記憶體修復。每輪 release phase 觀察到的程序數都是六個，未發現數量缺口；仍缺 per-PID anonymous／file／shared RSS、JS heap total 與 backing／embedder 分類，不能判定是活物件持有、原生配置／GC 時機或其他原因。

[失敗收據](results/legacy-shape-memory-failure.json)及[原始報告、日誌與獨立原政策重判](results/legacy-shape-memory-failure-evidence.zip)已核對 provider digest、ZIP CRC 和逐筆雜湊。沒有換用舊 browser 證據、扣除 RSS、強制 GC、縮短 URL／runtime timer、放寬門檻或重跑碰綠燈。正式網站與固定 Release 仍為 v1.4.0。後續先補唯讀的原生記憶體歸屬診斷；診斷產物須與正式發布證據分開，不能因單次診斷通過便宣稱根因修好。

後續收集器與單次執行界線見[原生記憶體歸屬診斷](physical-memory-attribution.md)；其資料不能選作發布證據，v1.4.1 仍未發布。

## 索引修正後的新來源驗收

原 RSS 失敗之後，實際模型索引配置已減量；來源 `c0dd77c8` 的[四項必要主分支關卡](results/model-index-allocation-main.json)全部取得並核對原始報告。實體大模型八輪沿用原 fixture、timer、RSS 與 read audit 規則，完整／局部／組合匯出重開通過，slope −834,413.71 bytes／輪、drift 1,912,832 bytes。HTTP 候選 38 項操作包含 legacy FC 阻擋、合法 RESHAPE 常數／匯出重開，以及部分 IO 的三組真正手動 CPU。舊失敗不改列成功，新的有限通過不宣稱所有 allocation 或 Windows Chrome 歷史問題已修復。v1.4.1 正式部署及固定下載仍待完成。

## v1.4.1 正式交付

固定來源 `25e7debc8ccb793ddc3fefe8fd3e2dff8fb70704`／tree `b25b113c8c6fcd79b86b76956e0c14a59e992328`、build `c64f4143bf8463a2` 已完成[發布流程](https://github.com/koviankevin/tflite-explorer/actions/runs/41270750871)，四個工作第一次 attempt 全成功。325 核心檔、全站 1,470 檔、38 項正式 HTTPS 操作、四份實際固定下載與權威 deployment 已核對。正式站包含 15 組 32px 文字框、搜尋／pattern／MLIR 與 TFLite 匯出重開、逐 OP／量化／legacy shape 報告、部分 IO、19 種手動 runtime 及八輪／24 次 CPU／IO。一般編輯匯出零自動推論；失敗／未知與有意的 crash recovery 不冒充通過或正常關閉。

固定 ZIP 41,294,984 bytes，SHA-256 `5ac4467b5052dc1ee7b79248571e0f06c8f6cd50b7239bca00b67ff831f7b8df`；checksum、manifest、gates 四份實際下載皆與準備工件一致，tag／Latest／權威 Pages deployment 已核對。Site ID `c4976f5eab2708e87299c97fdd817c0bb3a38150c4bd3a094f3c757c4babdaa1`，保留 v1.4.0／v1.3.1 與永久 baseline。[最終收據](results/model-index-v1.4.1-published.json)只含來源、雜湊、計數與有限結果；原始報告、截圖、環境及程序身分完整留在本機，沒有上傳本機原始紀錄。舊 tag／assets 不改寫，成功部署不重跑，沒有同步 Sites／GH Studio。歷史 Windows Chrome／網路守門與任意 kernel／公司 dialect／長期 SLA 的界線仍保留，完整商品等級目標未完成。
