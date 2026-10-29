# 共用公開 runtime module（候選，尚未部署）

目前正式站仍為 preview.31。此分支準備 preview.32；Hosted Chromium／WebKit 功能與原有記憶體驗收通過，Firefox 功能通過但原 RSS slope 仍失敗。候選尚未發布，不能宣告 Firefox 問題已修復。

[原始 File／HTTP 對照](desktop-runtime-io.md#本機-file-對照的實際結果)顯示：空 Worker 與同 bytes 的本機 File 走勢接近，HTTP fetch 則重現較大父程序波動。原應用 RSS slope 仍失敗；此修正針對反覆載入相同公開 WASM 的成本，不將診斷值扣除或放寬門檻。

第一次明確、符合 preflight 的手動執行才取得固定 LiteRT 2.6.0 WASM。串流讀取上限固定為 10,948,854 bytes，核對 MIME、完整長度與固定 SHA-256，然後非同步編譯；同一頁面的並行及後續請求共用一份 stateless `WebAssembly.Module`。失敗不自動重試，後續明確執行才可重新準備；快取不寫入 IndexedDB，也不接收模型、權重、輸入、輸出或 Instance。

[WebAssembly.Module 文件](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module)說明 compiled code 可分享給 Worker；[Emscripten instantiateWasm](https://emscripten.org/docs/api_reference/module.html#Module.instantiateWasm)提供初始化接點。本案以已封裝的固定 generated loader／wasm-utils 原始碼為準，沒有修改第三方 loader。各次 Worker 取得 module 後建立自己的 Instance、imports 與 memory；公開 code 的重用不會共用模型狀態。

30 秒的執行請求期限、取消、錯誤與 Worker 終止保留。非同步回呼只綁定明確 request slot，不捕捉 `check()` 的原始 File 參數；完成／取消／逾時會清空 payload、進度及 resolve 回呼，晚到的 module 不會再送出舊模型。已開始的公開編譯可能在背景完成，只保留這份固定 code，不能啟動已取消的模型請求。單頁至多一個公開準備工作／module；不持久化私有資料。

兩項新 client 回歸先在舊來源失敗：沒有供應已準備 module，且準備期間已送出模型。修正後轉綠。第一次 Node runner 無法序列化 assertion 裡的 WebAssembly.Module，該診斷錯誤原樣保留；改為布林 identity 斷言後取得真正的兩項失敗，再修改應用。

48 項選測通過，包括固定 SHA／MIME／大小／串流失敗、並行只下載／編譯一次、無背景重試、缺少 WASM 的環境仍能匯入、取消／30 秒期限／新舊請求與不同 client 隔離、raw BIN、四種亂數、輸入視窗清理及真實 CPU reference。新 hook 用同一個 compiled module 建立兩組不同 Instance／memory，對實際 BIN 取得 `[4, 6]`、`[40, 60]`。這是 Node 證據，不是瀏覽器或 RSS 通過。

新應用的 warm 取消改用真正的 WHILE invoke，分別按取消及切換模型分頁，要求五秒內 native close、無舊 IO 並保留原編輯歷史。舊固定版本仍暫停 WASM；原本另有的真 WHILE 30 秒逾時／恢復流程也保留。新應用不必在已 warm 的頁面重抓 WASM，不能沿用「每次執行必有 WASM GET」的假設。仍須補 fresh context 的 cold 準備取消、再次執行、單次公開下載與 native Worker close 證據，且新應用的原 RSS、完整 IO／匯出、三引擎、發布四關卡及正式站核對均尚未完成。


候選 native 流程另加入獨立 fresh context（重用已核對的示範檔，不產生新模型或 IO 檔）：先要求開檔／導覽零 WASM GET，再暫停首次公開 WASM 下載，對真正 runtime Worker 僅讀取常數 `1` 確認 context 就緒，原生按取消並觀察 close／輸入清理。放行公開下載後連續手動執行兩次，要求總共一次 WASM GET、三個 runtime 及一個 model native close、沒有舊 IO，最後正常關閉 context。此 helper 放在原記憶體驗收之後，不改其 baseline 或判定；新結果尚待 Hosted 執行，不能以語法或 unit 測試代替。


## 第一批 Firefox 原始結果與測試修正

[40933429392](https://github.com/koviankevin/tflite-explorer/actions/runs/40933429392) 來源 `774d76e7f1685fbc526e7648e1fdfc0ad40ddf2f`、tree `14af0a4bfff8c6b5e503bf2fd109dd395d91db07`、build `a71f6dd544f8449f`，在 warm 取消的載入攔截等待失敗。Provider digest／CRC、來源／job／attempt／305 檔及原圖已核對，讀取器 exit 0；[原始資料](results/runtime-module32-first-firefox.zip)和[逐檔雜湊／界線](results/runtime-module32-first-firefox.json)保留。

已完成十四項主要操作，四次實際示範模型 CPU、raw multi-input ADD／MUL 的 ZIP CRC／完整數值、亂數與 dtype 拒絕均通過；七個觀測 runtime Workers 全部 close，沒有 page error。失敗是 `Runtime loading cancellation gate not observed`，尚未到 RSS 或獨立 cold context；不能宣稱新效能通過。

原始路由記錄能看到主 Worker 與 WASM，沒有 Worker 內 transitive JS import 請求；因此新測試把 warm 取消移到實際 true-predicate WHILE，而不修改應用來重抓 WASM。兩次 runtime runs 保持：第一次手動取消，第二次關閉 loop 模型分頁，回到既有結果及原編輯頁，檢查 IO 清除與 Undo。新增 loop 模型及重啟既有結果的兩個 model contexts 明確計數並要求全部 native close，沒有降低 RSS 或 close 要求。

新 loop 檔僅由公開 `runtimeLoopFixture(true)` 序列化產生，不在 Node 執行；使用已驗證 SHA／大小／檔案身分及 flush 意圖的精確清理 helper，只允許原 WASM／新固定 `.tflite` 兩個檔名。只有 native loop model／runtime 消費者已關閉才刪除；失敗而未觀測關閉時保留並寫入報告。12 項 helper／loop 選測及語法檢查通過；其中實際 Node CPU reference 只執行 false predicate。新 native 結果仍待取得，應用程式與原 RSS flow／policy 未變。

## 第二批 Firefox：執行與分佈通過，指南的 warm 假設待修

[40939718626](https://github.com/koviankevin/tflite-explorer/actions/runs/40939718626) 來源 `2932697bd99771f42663364433836ea4adc8b912`、tree `9c3da411cfc5009d290f4b25cbf3c72c329b352f`、build `8b2dcead11a3faa7` 已完成十九種 runtime 情境：實際 WHILE 手動取消與關閉分頁、raw BIN／CPU／ZIP、四種 const／input 分佈、v3 草稿／Redo／同 bytes 匯出、custom 與 signature 拒絕均通過，沒有 page error。這包含使用者要求的 const 同步功能，但仍只是候選的部分證據；正式 const 功能已在 preview.31 交付。

流程接著在指南等待第二次 WASM GET 失敗：`Guide busy runtime was not observed`。同一頁已共用 compiled module，不應要求每次重新下載。Provider、CRC、來源與全部 305 core 檔已核對，reader exit 0；[原始 ZIP／截圖](results/runtime-module32-warm-firefox.zip)與[逐檔 SHA／失敗界線](results/runtime-module32-warm-firefox.json)保留，沒有到達 RSS 或 cold context，不能宣告效能修復。

指南的新 warm 測試改用真正的 true-predicate WHILE，在實際 invoke 後開啟 F1，要求導覽停用、保持對話框開啟直到原有 30 秒期限終止 Worker，再要求導覽即時恢復、沒有 IO。前一步仍完整保留有限示範模型的成功 CPU／IO 斷言；deadline 與 memory 門檻不變。關閉 loop 分頁回原模型，核對既有編輯歷史未變。這新增兩個明確計數且必須 native close 的 model contexts，runtime 仍兩次；舊固定版本保留原 WASM hold 成功完成測試。公開暫存 helper 額外只允許固定 `guide-busy.tflite`，先記錄意圖、核對完整 SHA／檔案身分，在消費者關閉後精確刪檔與空目錄，否則保留原因。

## 第三批候選：功能與 const 正常，Firefox RSS 未修復

同一來源 `19728b95ec8a6c27a754c122384a47cd38f78474`、tree `5dc30653c9fe30fd120df63477ac8e2df26ef155`、build `e10444709f7d5d9d` 已取得下列獨立核對。Provider digest／ZIP CRC、來源、全部 305 core 檔與原圖均檢查；[原始資料與讀取器](results/runtime-module32-native-originals.zip)及[逐檔 SHA／實際退出紀錄](results/runtime-module32-native-originals.json)永久保留，沒有改寫失敗。

| Hosted 引擎 | 功能與原生關閉 | 原有八輪記憶體結果 |
| --- | --- | --- |
| [Chromium](https://github.com/koviankevin/tflite-explorer/actions/runs/40941944370) | 33 項、19 runtime／分佈、5 指南；86 model／44 runtime close | 通過；RSS slope 7,593,984 bytes／輪，final drift 11,767,808 bytes，main heap drift −284,896 bytes |
| [WebKit](https://github.com/koviankevin/tflite-explorer/actions/runs/40942282717) | 17 項、19 runtime／分佈、5 指南；67 model／20 runtime close | 通過；RSS slope 15,196,277.03 bytes／輪，final drift 48,992,256 bytes |
| [Firefox](https://github.com/koviankevin/tflite-explorer/actions/runs/40941850313) | 17 項、19 runtime／分佈、5 指南；67 model／20 runtime close | **失敗**；RSS slope 27,376,493.71 bytes／輪，高於原 16 MiB 上限；final drift 119,689,216 bytes，peak growth 353,263,616 bytes |

每個引擎仍驗證實際 CPU、raw BIN、四種 const／input 分佈、v3 草稿、Redo、逐 bytes 相同的 TFLite 重匯出與重新開啟。新 warm WHILE 的手動取消、分頁關閉及指南的實際 30 秒期限均通過，公開 loop 暫存的八個意圖／完成事件及原生關閉後刪除也已核對。Chromium／WebKit 的獨立 cold context 完成取消、兩次後續 CPU、一次 WASM GET、三個 runtime／一個 model close 和三次輸入清理；Firefox 在原 RSS 失敗後沒有到此步，不能沿用別的引擎宣稱通過。

Firefox 的八輪原 RSS context 確實只有 **一次 WASM GET**，八個 model／24 個 runtime 全 close、24 次輸入清理、八份完整 IO 數值與 CRC、自然 URL 期限及七個 owned processes 退出均核對。409 個匿名／file／shared 分類樣本全部可讀。依原六輪窗口另計的父程序與 Web Content 匿名斜率約為 12,605,615.54 與 14,362,097.37 bytes／輪；這些是稍後採樣的診斷欄位，沒有從實際 RSS 扣除。單次公開下載不是剩餘問題已解決的證據，也不足以判定物件洩漏或配置所有權。

接下來先區分每次輸入 File／輸出 Blob 傳送、compiled module clone／Instance、runtime native allocations 的成本。以公開、無公司資料的限量對照分開驗證；不強制 GC、不修改原 RSS flow／policy／baseline、不假造 close，也不重跑成功部署。候選維持未發布。

[1.25 GiB／21,005 OP 實體八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/40941943495)、[main 發布契約](https://github.com/koviankevin/tflite-explorer/actions/runs/40941944769)及上述版本切換關卡均成功；核心範圍與可信 main run `40885892195` 的 87 檔 fingerprint 完全相同而沿用。四關卡的 provider／CRC／來源範圍認證 exit 0。它們不取代額外 Firefox RSS 的失敗，也不代表 preview.32 已正式交付。

獨立讀取器的兩項格式修正亦保留：WebKit reader 起初錯用早於 desktop RSS 檔案加入的正式版基準，改為與 app 修正前 `940a9e5` 的四個完全相同 protocol／policy／fixture 檔比較；Chromium reader 起初誤要求 Desktop 專有的 `crcVerified` 欄位，原 Chromium schema 記錄的是完整 input／output SHA 和 `bytesVerified`。僅修讀取器並重核原檔，沒有重跑成功流程、改寫觀測或宣稱未記錄的 Chromium IO CRC。最終 WebKit、Chromium 與 Firefox 失敗診斷讀取器皆 exit 0。

## 限量 File／IO／module 對照

保留應用程式、原 RSS flow／policy／baseline 與 workflow 檔案不變。Cached candidate 的 Firefox 額外診斷先跑相同 fresh empty Worker baseline，再分開量：每輪重新選擇公開 4 MiB input File 與模型大小 File；同樣流程加上 Worker 傳回 8 MiB IO Blob、每輪第三次實際下載並等待原生 60 秒 URL 期限；單次完整 SHA 驗證／編譯公開 WASM 後複製 module 到 24 個 fresh Workers，只讀 exports 數量，不建立 Instance。每組八輪、每輪三個 Worker，要求真正 native close 與完整 owned-process 退出。這些都是診斷協定，沒有模型解析、LiteRT 執行或效能合格判定。

原 HTTP／單一 File 對照程式未修改，已有上方 authenticated 原始結果；非 cached 舊版本保留其三組流程。新 cached 候選改測本次假設，不把舊對照假裝成新來源執行，也不略過原有功能與實際 runtime RSS 驗收。新診斷的 summed RSS 每 500 ms 觀察；匿名／file／shared 只在 settled windows 擷取，不能宣稱連續 component 峰值或獨立 Worker heap。報告仍使用既有有界 artifact，不放寬讀取上限。

公開輸入固定為 byte 25／7，IO 為完整 input bytes 與逐值加一後的 bytes；實際下載逐檔核對完整 SHA。只有固定三個新檔名可由暫存 helper 使用；先 flush 意圖，核對大小、SHA、dev／inode／mtime，來源 File 在原生消費者關閉後清理，完成下載的 owned copy 精確刪除並移除空目錄，失敗則保留原因。沒有 recursive delete、使用者模型或隱藏的清理操作。

另加入明確的失敗傳遞：只有完整結束且 browser／owned processes 都退出的純數值 RSS 失敗，才接著收集獨立 cold-page 證據，最後仍拋回同一個原始 RSS error。協定／Worker close／程序退出失敗直接停止；後續 cold 失敗也不能取代原始失敗。十九項 Node 選測通過，包含真實 Blob／公開 WASM compile、檔案清理與四組失敗傳遞；Hosted 結果列於下段。

### 已取得的結果與下一個修正

[40948691875](https://github.com/koviankevin/tflite-explorer/actions/runs/40948691875) 使用來源 `878b48d9b27b9832c8b04e69cd422fec76d0bbbd`、tree `fae2abf98311ea0e840a166fff4b6185b9453061`、build `9e4320a0110c2522`。應用、原 RSS flow／policy 與 workflows 與上批相同；provider／CRC／全部 305 core 檔認證及獨立讀取器均 exit 0。[原始失敗與讀取器](results/firefox-payload32-originals.zip)、[SHA inventory／退出紀錄](results/firefox-payload32-originals.json)保留，沒有改寫結果。

| 公開合成對照 | 六輪 closed RSS slope（bytes／輪） | 等自然 URL 釋放後 drift（bytes） |
| --- | ---: | ---: |
| 重新選 File／讀取，無 IO Blob | 3,180,836.57 | 15,216,640 |
| 同樣 File，加 IO Blob 回傳與下載 | 27,688,725.94 | −1,818,624 |
| 一次公開 compile，24 module clones，無 Instance | 1,210,777.60 | 6,823,936 |
| 原應用實際 runtime／IO | **27,718,217.14，原驗收失敗** | 120,291,328 |

三組新對照各 24 個 native Worker close、51 個 settled component observations 全部可讀；十二個來源／下載副本均核對完整 SHA／身分並清除，八個下載仍使用自然 60 秒 URL。公開 compiled module 只取得一次，沒有模型解析或推論。較大 slope 可在不建立 WASM Instance 的 IO 路徑重現；這是下一步修改配置／傳送的依據，不能推論特定 Firefox 物件洩漏，也不能把負 final drift 當作原應用已合格。Slope 窗口仍含尚未到期的 URL，沒有扣除其 bytes 或改門檻。

原應用仍完成 17 功能、19 runtime／分佈、5 指南、67 model／20 runtime close、原八輪 24 CPU 與完整 IO。這次在保留原 RSS 失敗的前提下，也完成獨立 cold context：一次 GET、三個 runtime／一個 model close、取消後兩次 CPU 及三次輸入清理。整個 job 仍為 **failure**。

另有新的 Node ownership seam 反例：保留指向已移除 File input 的參考時，確認後的元素仍包含選取 File；原有「清空 DOM／確認回呼」斷言無法涵蓋這個狀態。已確認的 BIN 身分仍正確傳回。此測試以 [HTML filename-mode 設定空值會清空 selected files 的規則](https://html.spec.whatwg.org/multipage/input.html#dom-input-value-filename)作為清理契約，尚不是實際瀏覽器或 RSS 所有權證據。

接下來補上移除前明確清空 File input，並將 runtime IO 改為有界 bytes 的 Worker ownership transfer，下載時才建立 Blob；保留直接 Node reference 的既有 Blob 預設、ZIP manifest／CRC／內容、30 秒取消和自然 URL 期限。先取得回歸失敗與真實傳送／CPU 證據，再執行原有三引擎及 RSS 驗收。尚未完成修正，preview.32 維持未發布。

## IO 修正候選（待 Hosted 驗收）

瀏覽器 runtime 的 ZIP 改為單一、最多 17 MiB 的 owned `Uint8Array`，經 `postMessage` transfer list 移交 buffer；不傳送 Blob、共享記憶體或指向 WASM／模型 buffer 的片段。主頁只保存目前 IO bytes，按下載時才建立 ZIP Blob。原有直接 Node `executeRuntime`／`runtimeArchive` 呼叫仍預設 Blob；ZIP 格式、manifest、CRC、BIN 內容、16 MiB tensor IO 預算、30 秒取消及原生 60 秒 URL 期限不變。

輸入確認先保留已驗證的 File 身分，再清空所有 File inputs 的 value 並移除控制項；取消與被新請求取代也使用相同清理。新回歸先在舊來源失敗：要求 transferable archive 卻取得 Blob，以及保留的 detached inputs 仍有 File。修正後 46 項選測通過，含真正 Node Worker 的移交／detachment、8 MiB IO 完整 SHA／獨立 ZIP CRC、實際 CPU `[4,6]`／`[40,60]`、新舊 archive 路徑、亂數／草稿與確認／取消／替換清理。這些是 Node 證據，尚不代表瀏覽器 RSS 已修復。

Hosted 瀏覽器另加入 fresh context，在確認執行與取消後保留原生 chooser 的元素 handle，直接讀取 detached FileList，要求 disconnected、零 files、空 value；確認仍需完成一次真正 CPU 執行，取消不得再建立 runtime Worker。此證據在原記憶體量測後收集，不修改其 baseline。已完成的獨立診斷不再每次重跑，正式記錄引用其原始 archive；原有實際 runtime RSS 仍完整重新執行。新應用、三引擎、四發布關卡及正式交付仍待完成。
