# Affine 量化欄位檢查與報告（v1.4.0）

已於 [v1.4.0](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.0) 正式交付，build `d36b95c7320aa6f2`。新增量化欄位的靜態結果，不自動執行 interpreter，也不修改原始權重或量化參數。下方保留候選與各輪驗收的來源界線，最終結果見[正式交付](#v140-正式交付)。

TensorFlow 固定來源 `7bc5d217d3bd79426527d0055fd3b54812f52e93` 的 [interpreter_builder.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/core/interpreter_builder.cc#L615) 會依非空 shape 核對 affine 量化軸，並不以舊檔的 `has_rank=false` 略過；單一 scale 也仍須檢查非空 shape 的軸範圍。[schema](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/compiler/mlir/lite/schema/schema.fbs#L157) 另規定 QuantizationDetails 會取代 affine 欄位，不能把未知編碼當成 affine 錯誤或已驗證的 codec。

舊版共用檢查只在多個 scale 且完整 known(shape) 時檢查軸，因此漏掉非空 shape／has_rank=false 的來源；同時會錯把其他量化編碼的 affine 欄位拿來判斷。現在共用模組會核對 scale／zero point 數量、有限正 scale、非空 shape 的 quantized_dimension、可知的 per-axis channel 數，以及已支援 dtype 的 zero point 範圍。未知 rank／channel、其他 QuantizationDetails 及超出檢視預算都明列未驗證。

修改／新增／重接 builtin OP 時，確定無效的欄位會附 OP／port 位置阻擋匯出。原樣保留或切出的來源仍可下載，報告列明量化失敗，避免為了通過檢查而修改舊模型。量化檢查通過只代表本段列出的 metadata 規則，不保證 kernel、custom runtime 或數值等價。

報告中的 tensor 編號屬匯出結果。每輪最多檢查 262,144 個 metadata 值、列出 65,536 筆 tensor；省略筆數也計入未驗證。畫面一次只增加 100 筆，完整下載保留同一份界線。既有 4 MiB 常數讀取預算、16 MiB 報告上限、自然 URL／runtime 計時及安全規則不變。檢查只讀已解析 metadata，不增加權重讀取。

四個最小回歸在修改前皆確實失敗，修正後 84 項相關選測及 11 項發布版本選擇通過。真正的 LiteRT.js 2.6.0／CPU WASM 另核對四次有效 int8 ADD 的輸出 bytes（原始、舊 rank flag、重接及切圖），以及只改量化軸後 compile 失敗、零 invoke／IO。第一版 CPU 測試曾要求 runtime 回傳未實際提供的詳細欄位文字而失敗；原文保留，後續用有效軸／無效軸的差異控制，不宣稱取得不存在的詳細日誌。

官方固定 person_detect 原檔的 88 個量化 tensor 中，靜態檢查找到 14 個確定無效的軸，包含舊日誌最後六個；其餘 74 個的本項 metadata 通過。原樣及整圖切出重開後，14 個失敗、量化欄位與 57 份權重 payload 均保留；沒有宣稱原檔 CPU 已可執行。另四份既有官方小型模型的量化 metadata 沒有新增誤擋，原 CPU／dynamic policy 證據保持各自範圍。

來源 `70946a2`／build `aed1e9427c1b7a48` 的 Windows Chrome／Edge 已完成隔離原生選檔、32px、無效欄位阻擋、未知 codec 保留未驗證、204 筆報告的 100→200 分批顯示，以及實際匯出重開／202 個 OP 搜尋。四個模型 Worker、零個自動 runtime Worker 與八／十一個已觀察原生程序身分均正常關閉。初版數值驗收雖通過，截圖仍發現重複說明將真正錯誤推到下方；縮短 UI 並優先／自動展開失敗及未知項目後，再以 tensor #1 而非原本第一筆 tensor #0 補驗排序。初版與調整後的截圖／來源都保留。

這些是原始 HTML 完整性受核對的隔離文件 fixture 與實際原生 UI 操作，不是正式 HTTPS 文件傳輸或實體 RSS 測試，也不表示已修復歷史 Chrome 長負載／OneDrive 關閉問題。報告文字／介面調整只改兩個 app 模組；validator、serializer、parser、runtime／vendor 未變，四種合成 fixture bytes 亦逐項相同，據此沿用已完成的 CPU／公開模型證據，僅補跑受影響的 12 項報告測試與兩端 UI。

[候選收據](results/quantization-validation-candidate.json)與[59 份原始紀錄／截圖及讀取器](results/quantization-validation-evidence.zip)已核對 SHA-256／ZIP CRC。模型、權重、BIN／BMP 與完整 primary-source 檔案只留在本機；公開封存只含 metadata、公開合成操作與雜湊來源。這是候選階段證據；後續 PR／main 與正式發布結果另列下方。

## 未實作 dtype 的覆蓋界線

後續檢查另找到「數值及軸合法，但 dtype 的 zero point 範圍規則尚未實作」仍被列為通過的問題；先新增負例確實重現，再改為未驗證。目前範圍規則為 INT8／UINT8／INT16／INT32；INT64、INT4、UINT16、FLOAT32 等其他 dtype 的 affine metadata 不會因部分欄位合法而列為已檢查。這不代表該模型一定不能執行。

20 項相關 Node 與實際序列化 INT4 報告通過；INT4 三筆都列為未驗證，零筆誤列已檢查。三種既有原生 UI fixture、CPU 控制，以及四份固定公開模型的完整量化檢查物件逐項未變。conv10 的 INT64 bias 則正確由一筆通過改為未驗證，沒有新增失敗或改動資料；原檔的舊 CPU 通過不會被改標失敗。這批只改量化檢查器的未實作分支，UI、parser、serializer、runtime／vendor 未變，沿用已核對的原生／CPU／資料保留證據，不宣稱另跑未執行的瀏覽器案例。[後續收據](results/quantization-dtype-followup.json)與[原始 red／green 及有限範圍沿用核對](results/quantization-dtype-followup-evidence.zip)保留來源與界線。

## 主分支發布前驗收

PR #203 合併來源 `655e5dd384ac3b9e0a05642d77095bb388333e27`／tree `402703eba099a1f12aa4ddcb2e7b0e583d187e9c` 與實際受測 PR tree 相同；895 項中 860 通過、35 項既有選做略過，78 項發布契約及九筆核心量測已核對。下列四項 main／workflow_dispatch 關卡也完成 provider digest、ZIP CRC、來源 scope 與原始政策重判，[收據](results/quantization-main.json)及[50 份原始紀錄與讀取器](results/quantization-main-evidence.zip)保留。這些是發布前關卡，正式來源與 HTTPS／Release 結果另列下方。

| 關卡 | 結果 |
| --- | --- |
| 核心效能 | [41247699658](https://github.com/koviankevin/tflite-explorer/actions/runs/41247699658)，九筆原政策量測通過；88 檔 scope 與既有核心相同 |
| 實體大模型 | [41247710612](https://github.com/koviankevin/tflite-explorer/actions/runs/41247710612)，實體 1,349,965,216 bytes／21,005 OP 八輪，完整／局部／組合匯出重開、權重／custom options／pattern、讀取審計與 57 個 Worker 關閉／程序退出依原政策通過 |
| 發布契約 | [41247718697](https://github.com/koviankevin/tflite-explorer/actions/runs/41247718697)，78 項通過，零略過 |
| 網站與版本切換 | [41247731894](https://github.com/koviankevin/tflite-explorer/actions/runs/41247731894)，六種版本切換、36 項完整 HTTP 候選操作；量化失敗／未知／204 筆清單、100→200 展開及 202 OP 重開搜尋通過，新增情境零自動 runtime；既有 15 組實際 32px 框、19 種手動 runtime 與八輪／24 次 CPU／IO 及原記憶體規則均通過 |

實體大模型原量測為 RSS slope -19,425,806.63 bytes／輪、drift 25,538,560 bytes、main heap drift 179,968 bytes、sampled peak 1,113,288,704 bytes；依原政策重判通過，不是記憶體歸零或任意模型 SLA 的保證。

另以無權重的 21,005 OP／21,007 個量化 tensor 合成鏈，實際序列化／重開／常數檢查後建立完整報告：本機 Node 報告大小 13,785,165 bytes，低於原 16 MiB；21,007 筆皆檢查、零省略，檢視 42,014 個值，組裝約 98.21 ms。固定 v1.3.1 formatter 對同一組物件為 6,590,093 bytes／46.15 ms；完整生成、解析、匯出與檢查約 3.88 秒。這是 metadata 規模與報告大小的有限對照，不包含 1 GiB 權重、瀏覽器 RSS 或 interpreter；不得拿來替代上面的實體關卡。

量化報告只涵蓋本次修改／組合或切出的 scopes；未列出的其他 subgraphs 沒有重新做這項檢查。模型、權重與測試輸入仍全程本機，安全、讀取、RSS、自然 URL／runtime 計時上限均未放寬；Windows Chrome 長負載／OneDrive 的既有關閉問題仍保留。

## v1.4.0 正式交付

證據選用 PR #204 的受測 merge tree 與實際主分支相同。正式來源 `685804b1a2bed1d99926ee3816b38dfa757391b6`／tree `4469b419e7bbe8e5a07e26925c9ee425461e9180`，build `d36b95c7320aa6f2`。先以 [41249891909](https://github.com/koviankevin/tflite-explorer/actions/runs/41249891909) 只準備工件，獨立核對 provider digest、ZIP CRC、324 個核心檔、四項證據來源／scope 與版本歷史後，再由 [41250059080](https://github.com/koviankevin/tflite-explorer/actions/runs/41250059080) 以相同 build／site ID 發布。四個 jobs 皆在第一次 attempt 成功，沒有重跑成功部署。

正式 HTTPS 已逐一核對全站 1,468 檔的 bytes／SHA-256／MIME，36 項瀏覽器操作通過；包括量化失敗／未知／正常三種情境、無效重接阻擋、204 筆報告的 100→200 展開、實際六次下載／202 OP 重開搜尋、四個模型 Worker 關閉，新增流程零自動 runtime。原 15 組 32px 框、19 種手動 runtime、八輪／24 次 CPU／IO 與原 RSS／清理規則也依原政策核對。intentional crash recovery 的強制終止與正常關閉保持不同判定。

實際下載 [v1.4.0 固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.4.0) 的 ZIP、checksum、manifest 與 gates 四個 assets，逐一符合準備工件；ZIP 41,290,170 bytes，SHA-256 `911623417c53fb884a9a6e812531fdb9d99b3f58d45f050558876acd61e5b951`。Tag、Latest、不可變來源及權威 Pages deployment 均核對。Site ID 為 `8f6eff2a2ad97de14a78172e085b73084e163a49a6ebdf6dcb28b92acfbdeb6c`，保留 v1.3.1／v1.3.0 及永久 baseline，舊 assets 不變。

[最終收據](results/quantization-v1.4.0-published.json)與[原始發布紀錄及獨立讀取器](results/quantization-v1.4.0-evidence.zip)保留來源、官方 digest 與有限範圍；大型準備工件及四份實際下載留在本機並記錄雜湊，不在 evidence ZIP 重複嵌入。原 Windows Chrome 長負載／OneDrive 關閉問題、正式站額外網路守門失敗，以及任意 kernel／未知量化編碼／公司環境的未驗證範圍仍保留。僅交付 GitHub 正式站與固定 Release，未同步 Sites／GH Studio；完整商品等級目標仍進行中。
