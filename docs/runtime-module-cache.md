# 共用公開 runtime module 與 IO 下載修正

最新 [preview.32](preview32.md#發布狀態)已完成必要 Chromium 四項關卡、正式站與不可變 Release 核對並交付。Firefox 最後一次八輪亦在原 RSS 政策下通過；依使用者指示，之後 Firefox 與 Safari／WebKit 為選做，不再自行補跑。以下保留各次診斷的來源與當時結果，早期失敗或待測文字屬歷史紀錄。

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

## IO bytes／File cleanup 候選

瀏覽器 runtime 的 ZIP 改為單一、最多 17 MiB 的 owned `Uint8Array`，經 `postMessage` transfer list 移交 buffer；不傳送 Blob、共享記憶體或指向 WASM／模型 buffer 的片段。主頁只保存目前 IO bytes，按下載時才建立 ZIP Blob。原有直接 Node `executeRuntime`／`runtimeArchive` 呼叫仍預設 Blob；ZIP 格式、manifest、CRC、BIN 內容、16 MiB tensor IO 預算、30 秒取消及原生 60 秒 URL 期限不變。

輸入確認先保留已驗證的 File 身分，再清空所有 File inputs 的 value 並移除控制項；取消與被新請求取代也使用相同清理。新回歸先在舊來源失敗：要求 transferable archive 卻取得 Blob，以及保留的 detached inputs 仍有 File。修正後 46 項選測通過，含真正 Node Worker 的移交／detachment、8 MiB IO 完整 SHA／獨立 ZIP CRC、實際 CPU `[4,6]`／`[40,60]`、新舊 archive 路徑、亂數／草稿與確認／取消／替換清理。這些是 Node 證據，尚不代表瀏覽器 RSS 已修復。

Hosted 瀏覽器另加入 fresh context，在確認執行與取消後保留原生 chooser 的元素 handle，直接讀取 detached FileList，要求 disconnected、零 files、空 value；確認仍需完成一次真正 CPU 執行，取消不得再建立 runtime Worker。此證據在原記憶體量測後收集，不修改其 baseline。已完成的獨立診斷不再每次重跑，正式記錄引用其原始 archive；原有實際 runtime RSS 仍完整重新執行。新應用、三引擎、四發布關卡及正式交付仍待完成。

### IO 候選的原始結果

來源 `5746284846937690178f2ed63347a2bffd8c8980`、tree `44c585aa68dd10adf9ea2d8de55eb973c26f8913`、build `dc29d2173f196ffa` 的 [三引擎原始檔與讀取器](results/runtime-io32-originals.zip)、[SHA inventory](results/runtime-io32-originals.json)保留 68 個成員，完整 ZIP SHA 為 `d8dbbe601cb2f7f6d844c20b1e26622f151b88fbbe2fbf48c1390b738e5f0500`。Provider／source／306 core、獨立功能與 RSS、四關卡讀取器皆實際 exit 0；這表示證據可核對，**不表示 Firefox 效能通過**。失敗讀取器最初誤要求 producer 成功路徑才有的 root `sourceUnchanged`；更正為核對真實存在的 nested RSS end-source 觀測、clean source 與 provider 原檔。原失敗 log 也保留，未改寫觀測。

| 引擎 | closed RSS slope（bytes／輪） | final drift（bytes） | 原驗收 |
| --- | ---: | ---: | --- |
| Firefox | 37,970,856.23 | 120,406,016 | **失敗：closed-rss-slope** |
| WebKit | 11,507,185.37 | 47,869,952 | 通過 |
| Chromium | 8,887,383.77 | 1,536,000 | 通過 |

[Desktop 40956588799](https://github.com/koviankevin/tflite-explorer/actions/runs/40956588799) 的兩引擎均完成 17 功能／19 runtime／5 指南、原生 67 model／20 runtime close。獨立 cold contexts 完成一次 GET／三次 runtime／一次 model close；新增 retained input handle 在確認和取消後都由一個 File 變成零 File，元素 disconnected 且 value 空白。這證實清理契約，不能證實 Firefox RSS 根因。Firefox slope 比先前 27,718,217.14 更高，不能宣稱記憶體改善；八輪 24 CPU／IO、自然 60 秒 URL、原門檻／fixture／baseline 均未改動，owned processes 最後全部退出。

[Chromium 40956969105](https://github.com/koviankevin/tflite-explorer/actions/runs/40956969105) 完成 33 功能、19 runtime、5 指南、86 model／44 runtime close、相同 retained input 與 cold 證據。原 Chromium lifecycle 記錄完整 input／output SHA 與 `bytesVerified`，沒有 Desktop 的 `crcVerified` 欄位；讀取器依實際 schema 驗證，未宣稱不存在的觀測。核心 40885892195 的 87 個 executed scope 檔相同而重用；大型實體模型 40956689353、contract 40956690681、site 40956969105 三個新 main workflow_dispatch 成功，四關卡 provider evidence 已認證。額外 Firefox RSS 仍失敗，因此 **preview.32 未發布，正式站／固定 Release 仍為 preview.31**。

### 下一個 ownership 修正（尚待 Hosted）

第一次明確下載 IO 時只建立一個 Blob，保存在本次 session 的 IO 物件，後續下載重用它；原 transferred bytes 立即以標準 `ArrayBuffer.transfer(0)` 退還 backing storage。若瀏覽器沒有這個 API，則清零 retained view 並丟棄 owned reference，不宣稱強制釋放或獨立 heap 證據。Blob snapshot 必須在退還 bytes 後仍保持完整 ZIP／SHA／CRC。原生 URL 的既有 60 秒期限不變。

開始下一次執行、取消、reset／換模型及 late result 不再只丟棄物件，而明確退還舊 owned bytes；下載 Blob 只清除 session 的引用，已建立 URL 仍按原期限到期。部分 view／shared memory 不可 detach 或清零；不新增 IO 持久快取、runtime 重用、隱私資料儲存、推論觸發或 forced GC。舊程式上先取得真實回歸失敗（未 retire bytes、未 cache Blob、session 未清理），修改後 51 項選測通過，含實際 Worker 的 8 MiB IO、CPU reference、fallback、cancel／restart 的 late-result 隔離。這是資源所有權修正，仍需原 Hosted RSS 驗收，不能先稱 Firefox 問題已解決。

### Ownership 修正後仍未達標

[Firefox 40961709357](https://github.com/koviankevin/tflite-explorer/actions/runs/40961709357) 使用來源 `d0f3ff92389a087a0f78842d953009b1bbce4477`、tree `d5d3b49813bb1189ac691de8f08b6b7e8579375c`、build `ceb24629a446ce6c`，沒有重跑成功部署。PR150 的必要 Node／建置與 contract 通過，合併完整 tree 與受測 head 相同；本機 51 項選測及最後 20 項 ownership／session 檢查 exit 0。新增 Blob 快取、owned bytes retirement、零化 fallback 及 late result 隔離確實完成，但本次 job 仍是 **failure**。

306 core 檔、provider digest／CRC／source、17 功能／19 runtime／5 指南、67 model／20 runtime close、實際八輪 24 CPU／8 份完整 IO 均通過；獨立 cold 的一次 GET／三個 runtime／一個 model close，以及 retained native File input 的確認／取消也通過。Provider 與獨立失敗讀取器分別實際 exit 0，沒有拿認證成功取代原 RSS 判定。原始 [24 檔證據 ZIP](results/runtime-io-ownership32-originals.zip)及 [SHA inventory／退出紀錄](results/runtime-io-ownership32-originals.json)保留；ZIP SHA `bae8380f06e0567c43df92411f6f12ea0ebf99989d12d9a0c855bde912a82deb`。

| 原門檻指標 | d0f3ff9 本次觀測 | 判定 |
| --- | ---: | --- |
| 測量六輪 closed RSS slope | **18,457,629.26 bytes／輪** | **超過 16,777,216，失敗** |
| 最終 URL 自然釋放後 drift | 122,642,432 bytes | 低於 134,217,728 |
| sampled peak growth | 266,063,872 bytes | 低於原上限 |
| 最大取樣缺口 | 563 ms | 通過 |

上一批不同應用的 slope 是 37,970,856.23，這次較低；兩者都是單次有界八輪觀測，不是根因歸屬或所有負載的效能保證。原 60 秒 URL、baseline／fixture／門檻與 30 秒 runtime deadline 不變，不做 forced GC 或 RSS 扣除。所有觀測 PID／start-ticks 退出。頁面匿名記憶體在第 3～8 輪 settled medians 為 170.07、178.82、189.36、184.39、189.67、198.03 MiB；父程序為 178.18、188.94、201.17、214.04、226.96、240.10 MiB。這是觀測欄位，不能直接認定哪些物件洩漏。

不為了碰到綠燈重跑同一程式。下一步逐一驗證大型暫存分配：同一模型連續手動執行能否用已清零、限量且真正移交所有權的 session buffer，避免每次重建完整 ZIP；raw BIN 的 private arrayBuffer 是否能在 little-endian 環境直接建立 typed view，避免額外 copy。兩者都須先有真實 red、bytes／型別／cancel／late-result 正負例，再以原 RSS 流程驗收。若仍不足才補新的無 WASM ownership 對照，不從對照值扣除驗收 RSS。

只有主發布四關卡的 core executed scope 相同可沿用；瀏覽器、contract、site fingerprints 已因兩個 runtime 模組及測試改變。由於首要 Firefox RSS 尚未通過，沒有再觸發整批發布驗證；preview.32 繼續未發布，正式 preview.31 的 const 分佈功能不受影響。

### raw BIN 配置候選（待 Hosted）

已用實際 `runtimeInput` 重現另一份 4 MiB 配置：公開 File 的 `arrayBuffer()` 只讀一次、回傳內容及 hash 正確，但原程式又配置同大小 typed tensor。新路徑在 native little-endian 環境直接建立 private buffer 的 typed view；big-endian 路徑保留逐值轉換，零值／亂數邏輯不變。不加入 input／模型快取、不修改 buffer 或延長 Worker 生命週期。

仍檢查 File 宣告長度與實際回傳 buffer 長度、dtype／shape 預算、boolean 只能為 0／1，拒絕 shared buffer 及缺少 TypedArray constructor。新增四項回歸涵蓋 4 MiB 實際 async raw path／零額外 tensor backing storage、各整數／浮點／64-bit 與手動 endian-conversion 路徑、零長度、無效資料及原 bytes 不被修改。舊路徑的實際 identity 斷言先失敗；修改後 58 項選測通過，包含既有 4 MiB const 真正 CPU／8 MiB IO 及獨立 ZIP CRC、shared module 的 fresh Instance、session 及 const 分佈。只證實配置及正確性，尚不能宣稱 Firefox RSS 達標；仍須原 Hosted 八輪。

### raw BIN 候選原始結果

[Firefox 40964827311](https://github.com/koviankevin/tflite-explorer/actions/runs/40964827311) 的來源為 `71ea9855333b3ee880012a9b737eee166d643e9b`、tree `9a4c0361a77aaf206ee29ef4ec8434572518c2e7`、build `2ae5400d34745e36`。原流程仍以 **closed RSS slope 18,495,546.51 bytes／輪失敗**，最終 drift 121,647,104、sampled peak growth 260,694,016、最大取樣缺口 590 ms。相較上一批 18,457,629.26，沒有證據顯示 raw BIN copy 移除改善剩餘 slope；因此不重跑同一版、不放寬門檻、不發布。

17 功能／19 runtime／5 指南、實際 CPU／8 份 IO、native Worker／程序退出、cold context 及 retained File input 清理均通過。306 core、provider digest／CRC／source 與獨立失敗讀取器實際 exit 0，原 workflow watch exit 1 保留；[26 檔原始證據](results/runtime-bin32-originals.zip)及[SHA inventory](results/runtime-bin32-originals.json)已核對（ZIP SHA `515ad55172ecd20456f689976e424c4e36710e02fcb62dfd668ec0a404d9faf3`）。四個 executed dependency scopes 比對完成；core 的 87 檔不變，其他三關因 runtime／測試來源改變而需要新證據，但尚未在 Firefox 失敗時重跑整批。

### 同一模型的有界 ZIP buffer 重用候選

每次明確開始新執行，消耗本次 session 的舊 IO bytes，先清零，再移交一個最多 17 MiB 的 owned ArrayBuffer 給新的 runtime Worker。相同 ZIP 長度直接寫入這個 buffer；長度改變時使用標準 transfer resize，沒有該 API 則清理舊 buffer 並配置有界新 buffer。Worker 及 WASM Instance／memory 仍每次重新建立；不加入跨模型、持久、全域或含前次資料的快取。舊 IO 物件與 views 不再可讀，已轉成下載 Blob 的結果沿原期限到期，不進入重用路徑。

輸入選擇期間的 buffer 由特定 request 持有；取消、reset、換模型、metadata／同步 client 錯誤均清理該 request。client 接手後，在準備失敗、取消、clone／Worker 建構失敗或 ineligible plan 清理未送出的 buffer；成功則以真正 postMessage transfer list 移交，callback 不把私有資料留在公開 Module promise。每次 executeRuntime 仍驗證模型及輸入、產生新 manifest 與完整 ZIP。

舊 archive API 忽略 ioBuffer 而重新配置 ZIP 的實際 identity 斷言先失敗。修改後 **66 項 Node 選測通過**：same-size backing identity、resize／無 transfer fallback、部分／shared／超限拒絕、零化及 detachment、取消／錯誤／換模型、三個 fresh 真實 Workers 的完整 8 MiB IO 與獨立 CRC，以及真正 CPU 跨 fresh Instance／memory 重用 IO 後的 `[4,6]`／`[40,60]`。這些只證明有界分配與內容正確性，仍待原 Hosted Firefox RSS；不宣稱此候選已達標或已發布。

### ZIP 重用候選仍未改善 RSS

[Firefox 40967529897](https://github.com/koviankevin/tflite-explorer/actions/runs/40967529897) 使用來源 `0ad9cfa12a6a607c49372fcb90cf7be1d4c72f56`、tree `43245f1cae91f652a9c4be973355703a29c2d2ae`、build `393210e4d4747a8a`。**closed RSS slope 18,691,686.4 bytes／輪仍失敗**；final drift 121,061,376、sampled peak growth 286,449,664、最大取樣缺口 603 ms。這批沒有改善約 18 MiB／輪的剩餘問題，不繼續憑配置猜測修改應用，不重跑碰綠燈，也沒有發布。

17 功能／19 runtime／5 指南、完整 CPU／IO、native Worker／程序退出、cold 與 retained File input 清理仍通過；306 core／provider／SHA／CRC 及獨立失敗讀取器均實際 exit 0，原 workflow watch exit 1 保留。[25 檔原始證據及研究紀錄](results/runtime-io-reuse32-originals.zip)、[SHA inventory](results/runtime-io-reuse32-originals.json)已逐檔核對，ZIP SHA `3f1537489570def7f3657844c0e8e4a142f79c3e2e725e03eace0f5b3fd1f98d`。核心 87 檔 scope 不變；其餘範圍改變仍須新證據，未在 Firefox 失敗時啟動整批發布關卡。

### 獨立原生持有者診斷（待 Hosted）

新增純測試的獨立 raw IO 控制頁：公開 4 MiB model-size／input Files，24 個 fresh Workers、八份 8 MiB 原始 input／逐 byte 加一 output 下載。主頁使用同一份受核對的 IO ownership helper，交接前清零／detach，Worker 真正 transfer 回傳，最後才建立 octet-stream Blob；沿用自然 60 秒 URL 與完整下載 SHA／身分／清理。沒有模型解析、LiteRT／WASM Instance 或推論，也不宣稱 raw 控制檔是 TFLite／ZIP。原 RSS flow／policy／fixture 及發布安全規則完全不變。

獨立控制的原 RSS／settled observations 全部結束後，才開啟一次原生 about:memory，以 verbose／anonymize 及普通 Measure 讀取有界 DOM 文字，不用私有 Services／gCurrentReports API，不按 GC、CC 或 Minimize。開始前先讀實際安裝的公開 Firefox omni.ja，核對來源 SHA、Measure 按鈕 wiring、ordinary getReports handler 沒有顯式 collection 呼叫；不能用主分支原始碼假裝成受測版本。最多 512 KiB 原文及 hash 放入既有 artifact，超限、未完成或關頁失敗都明確報錯，不截斷後宣稱完整。它是含 reporter 自身成本的單次原生分類快照，不能替代原 RSS、連續 Worker heap 或可歸因的 allocation trace。

此設計參考 [Mozilla about:memory 說明](https://firefox-source-docs.mozilla.org/performance/memory/about_colon_memory.html)及 [Measure 的原始實作](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/aboutmemory/content/aboutMemory.js)。固定工具的 [NetworkObserver](https://github.com/microsoft/playwright/blob/v1.56.1/browser_patches/firefox/juggler/NetworkObserver.js) request hook 只接受 HTTP channels，不能直接據此認定它的 response cache 持有 blob 下載；[DownloadInterceptor](https://github.com/microsoft/playwright/blob/v1.56.1/browser_patches/firefox/juggler/TargetRegistry.js)完成事件也會刪除 handler／UUID map，這仍不足以證明 native channel 已釋放。先取得實際物件分類再歸因。

新診斷只在 candidate Firefox 執行，先完成原有 RSS／cold 流程，再獨立啟動控制瀏覽器。只有完整結束且 owned processes 全退出的純數值 RSS 失敗才繼續診斷，最後仍拋回同一原始失敗；protocol／live-process 失敗不繼續，診斷失敗不能取代原 RSS 或較早 cold error。25 項選測通過，涵蓋來源／按鈕／非 forcing 邊界、一次 Measure／關頁／容量、實際 ArrayBuffer transfer 的 raw 控制程式、舊三組控制、公共暫存清理及失敗傳遞；沒有在本機啟動瀏覽器，原生 UI 與 bundle 路徑仍待 Hosted 證據。


### 原生入口首次失敗與修正

[40973263249](https://github.com/koviankevin/tflite-explorer/actions/runs/40973263249)／來源 `26039faf706ebbf48de2f4b9405b6fee1b7183df`、build `2dec27637311cc63` 的原 RSS 仍以 **17,782,725.49 bytes／輪失敗**。17 功能／19 runtime／5 指南、cold、retained inputs、完整 IO 與 native 清理通過。獨立 raw IO 在零模型、零 WASM Instance 下重現 **20,104,689.37 bytes／輪**，24 個 Workers 全 close、八份下載及兩份來源檔完整 SHA／身分／清理、自然 60 秒 URL 與 51 組 settled observations 均核對；不做 RSS 扣除，也不據此歸因 Firefox 或工具。

實際安裝 bundle 的 ordinary Measure 來源與 wiring 核對成功，來源 83,368 bytes／SHA `9e0e1f941213265e86f257d802e34026e336816df6445d447406ebb156fbc480`；但 `about:memory` 等待 DOMContentLoaded 十秒逾時，**Measure 呼叫為零，沒有取得物件分類或 heap 資料**。[21 檔原始證據](results/firefox-native32-originals.zip)及[逐檔 SHA／讀取器紀錄](results/firefox-native32-originals.json)保留，包括首次 reader 錯把建置後帶 cache query 的 helper 與 source helper 相比而失敗的 log。改用固定乾淨 source 與 Linux LF 後，控制與原始失敗核對真正 exit 0；未修改 producer 原文。

測試工具改以 commit 導頁，要求實際 page URL、DOM ownerDocument.URL 及可見 Measure 按鈕都符合原生頁面。只允許 TimeoutError 在這些條件下恢復；錯 URI、缺按鈕或其他協定錯誤仍失敗，保留導頁觀測及正常關頁。另在完整流程前，以獨立 marked browser 做一次原生入口探測，失敗即清楚停下；成功才執行原完整驗收及熱 IO 後的另一份快照。各瀏覽器只 Measure 一次，不強制 GC／CC／minimize、不改原 RSS 協定或門檻。診斷後另記錄新觀測的 descendant identities 再正常關閉，不把此 witness 加入 RSS samples。Node 邊界測試通過；實際原生入口修正仍待 Hosted，候選未發布。


### commit 導頁仍無法讀取原生頁面

[40977788545](https://github.com/koviankevin/tflite-explorer/actions/runs/40977788545)／來源 `dd3d12284988d033ad8117a3e124df1d876944d7`、build `d9192af10f1a2d68` 在獨立前置探測十秒逾時，協定 page URL 仍為 `about:blank`；尚未觀察 DOM URL，因此不能斷言實際原生畫面沒有開啟。零次 Measure、零模型／runtime，沒有進入原功能或 RSS 流程；探測頁正常關閉，六個觀察到的程序全部退出。provider／CRC／來源與 306 檔、獨立 preflight reader 均實際 exit 0。完整 [16 檔原始 archive](results/native-navigation32-originals.zip)／[逐檔 SHA](results/native-navigation32-originals.json)保留；ZIP SHA `51293c3bac65e520ecd2e7ddf03da4df0f2ecb32151e47d30bf6aafc88eade69`。這是診斷入口失敗，不是新的 RSS 或功能合格證據。

下一個純測試改動使用 Linux 原生 ordinary SIGRTMIN 報告，僅對獨立空白／公開 raw IO 瀏覽器執行一次。依固定 [Playwright upstream config](https://github.com/microsoft/playwright/blob/v1.56.1/browser_patches/firefox/UPSTREAM_CONFIG.sh) 的 Firefox revision `361373160356d92cb5cd4d67783a3806c776ee78`，[nsMemoryInfoDumper.cpp](https://github.com/mozilla-firefox/firefox/blob/361373160356d92cb5cd4d67783a3806c776ee78/xpcom/base/nsMemoryInfoDumper.cpp) 將普通訊號與 minimize／GC／CC 訊號分開。此為固定上游來源依據，不假稱已獨立重建安裝的 binary。每次另核對固定 Firefox 版本、pidfd、PID／start-ticks／parent、每次 launch marker、bundle executable 及實際 SigCgt handler bit；不支援即失敗，不向名稱搜尋到的程序送訊號，不送 SIGRTMIN+1／+2。

Firefox 使用事前登記的獨占 TMPDIR。完整 gzip 最多 512 KiB，解壓最多 16 MiB，版本／schema／root PID 均檢查，原始 compressed／uncompressed SHA 與全部 gzip bytes 放入既有 4 MiB provider 容量；不截斷後聲稱完整。另整理各程序 explicit 類別，不將百分比／count 當 bytes、不以其扣除 RSS。原生訊號輸出沒有匿名化，因此只能用空白或公開控制資料，不能接使用者的模型或應用瀏覽器。正常關閉及所有觀察程序退出後，僅刪除完全相同的已知報告，再移除空目錄；變動／未知檔保留且顯示失敗。原 RSS flow／fixture／policy、自然 60 秒 URL、runtime 30 秒與 workflow YAML 不變。39 項 Node 選測涵蓋實際 Python guard、拒絕／gzip／暫存身分及舊失敗傳遞；真實原生訊號與候選完整驗收仍待 Hosted，沒有發布。


### 取得第一份完整原生報告與解析缺口

[40979528580](https://github.com/koviankevin/tflite-explorer/actions/runs/40979528580)／來源 `c332e82dac18b287f3dac46e9d5e7f20fac9c484`、build `ba844c084162f6da` 完成 17 功能／19 runtime／5 指南、cold／retained inputs 與原有 CPU／IO／native 清理；原 RSS **19,285,723.43 bytes／輪仍失敗**，drift 77,115,392、peak growth 253,444,096、最大缺口 565 ms。獨立 raw IO 以零模型／零 WASM 重現 19,913,113.6 bytes／輪，24 Workers、八份下載、兩份來源與自然 60 秒 URL／51 組 settled observations 都核對。

空白 Firefox 的 ordinary SIGRTMIN 已實際成功：pidfd／caught handler／PID／start-ticks／parent／launch marker／bundle executable 核對，完整 gzip 74,320 bytes、解壓 1,287,990 bytes、4,304 筆／五個 report groups。壓縮 SHA `70638954df3a63de2a1658cdd85092e37139df2284c1b8f00fea4e034cb09efc`，解壓 SHA `4319c3941b5a3590b7eb491c2342439170808f48c068eaf2677c1a61e666f853`；所有觀察程序正常退出、身分／SHA 清理及空目錄移除通過。這是第一份已獨立核對的完整原生資料，沒有把它當成應用修復。

熱 IO 報告則在 parser 要求每個 process label 都包含 PID 時失敗。該輪程式只保存檔案 SHA／大小，解析失敗後仍清理了 76,800-byte 原文，**無法還原或驗證熱報告內容，不提供虛構分類或歸因**。provider／CRC／306 檔／原 RSS／cold 完整 gzip／hot 控制協定的獨立 reader 均實際退出；[21 檔原始證據](results/native-signal32-originals.zip)／[SHA inventory](results/native-signal32-originals.json)包含首次嚴格 reader 的失敗 log。ZIP SHA `bc03a4f7df6f4796287162cd67f059fac986fbfeb0e3d1a266b3a744f4b5fa18`。

固定 [nsIMemoryReporter.idl](https://github.com/mozilla-firefox/firefox/blob/361373160356d92cb5cd4d67783a3806c776ee78/xpcom/base/nsIMemoryReporter.idl) 將 process 定義為名稱，沒有 PID 格式保證。修正後完整保留標籤，無 PID 群組使用 null，額外 metadata 不會讓已存在的 PID 遺失；root 仍須匹配實際 sender PID。任何 schema／解壓／root 檢查失敗，都在失敗物件附完整、有界的原始 gzip 與 SHA，不將它標成有效量測。成功與失敗的 native bytes 都先透過 driver 的 flush checkpoint 寫入既有 provider JSON，再准許清理暫存；checkpoint 缺少或寫入失敗就保留原檔並回報。兩個實際回歸先紅、42 項選測通過；修正後熱報告仍待新 Hosted。應用、原 RSS、計時與 workflow 不變，未發布。


### 冷熱原生報告完整核對與本機 Response 候選

[40981715597](https://github.com/koviankevin/tflite-explorer/actions/runs/40981715597)／來源 `702f3e380807362be5a7ae97b5bcd2fdc39f3bc5`、build `de70899f36ab0528` 的 17 功能／19 runtime／5 指南、cold／retained input、CPU／IO 與 native 清理均通過；原 RSS **18,839,727.54 bytes／輪仍失敗**，drift 122,462,208、peak growth 273,694,720、最大缺口 570 ms。新標籤 parser 正確讀取 `Utility (pid 4542, sandboxingKind 0)`，不再要求 PID 後立即右括號。冷／熱兩份完整 gzip、壓縮及解壓 SHA、root／schema／類別加總、flush checkpoint／身分清理與所有觀察程序退出均獨立核對；冷 4,297 筆／1,285,693 bytes，熱 2,590 筆／788,702 bytes。

獨立 raw IO 仍以零模型／零 WASM 重現 19,736,868.57 bytes／輪。八份下載完整 bytes、24 Workers、兩份來源／51 組 settled observations 與自然 URL 期限通過。熱 web 程序在所有 URL 已 revoke 後，仍回報六筆各 8,388,608 bytes 的 `explicit/dom/memory-file-data/large/file(...)`；其 SHA-1 一致，對應同內容的公開控制輸出。父程序 heap-allocated 冷／熱為 199,091,032／195,161,824 bytes，shmem-allocated 為 44,610,583／267,991,362 bytes。這些是不同瀏覽器與時點的 reporter 觀測，不是 reachability、持有者堆疊、同一程序 baseline 或 RSS 扣除，不能單憑差值宣告洩漏來源。完整 [23 檔原始證據與分析](results/native-labels32-originals.zip)／[SHA inventory](results/native-labels32-originals.json)已保存，ZIP SHA `8d04c95c29e4666c784b7efc288a0a077764696d0e34ea91d403f7fcfeead982`。

候選修正只在使用者明確下載 runtime IO 時，以 `new Response(ownedBytes, {headers: ...}).blob()` 消費本機、完整且有界的 ZIP。這沿用既有大型模型 prefix 轉換的方式，不呼叫 fetch、不加入 OPFS／應用持久快取或新 Worker，也不處理模型權重。固定 Firefox 的 [FetchBody::ConsumeBody](https://github.com/mozilla-firefox/firefox/blob/361373160356d92cb5cd4d67783a3806c776ee78/dom/fetch/Fetch.cpp) 會在已知、非 private 的 principal 下允許 [MutableBlobStorage](https://github.com/mozilla-firefox/firefox/blob/361373160356d92cb5cd4d67783a3806c776ee78/dom/file/MutableBlobStorage.cpp) 使用瀏覽器管理的 temporary file，預設門檻 1 MiB；private browsing 仍限記憶體，其他引擎／設定也不保證同一實作。這是候選機制的來源依據，改善仍須實際原 RSS 驗證。

同一 IO 的 in-flight 請求去重；完成且型別／長度正確、來源結果仍有效才快取 Blob 並 retire 原 bytes。reset、take buffer／新執行取消舊準備，舊 promise 不能覆蓋新 request；每個 terminal path 清理 WeakMap，沒有完成結果的全域快取。UI 顯示準備狀態、避免重複點選，換來源／重置不下載舊結果，錯誤可重試且不重新推論。host.export／URL create/revoke 60 秒、原 RSS flow／fixture／policy、runtime 30 秒均不改。54 項 Node 選測通過，包含完整 8 MiB ZIP SHA／獨立 CRC、真實 CPU、transfer／reuse、取消／錯誤／來源代次及套件邊界；Firefox 原生記憶體仍待候選 Hosted。未發布。


### 本機 Response 修正的既有八輪通過

[40985499197](https://github.com/koviankevin/tflite-explorer/actions/runs/40985499197)／來源 `769707e17ad5bbbe904048a96888fed80c5598bd`、tree `1b6c834757bc9c6678742fc32ffe55e82869ab66`、build `95baa2d69d0d3a46` 已完成。原 RSS policy／fixture／flow／URL 60 秒／runtime 30 秒不變，closed RSS slope **7,556,066.74 bytes／輪通過**，較前一輪 18,839,727.54 低；drift 56,414,208、peak growth 258,711,552、最大缺口 588 ms，全部原門檻通過。17 功能／19 runtime／5 指南、完整 CPU／IO、cold／retained input、native Worker／程序／來源清理均通過。

獨立 direct-Blob raw 控制仍約 19,844,417.83 bytes／輪，作為未使用新下載轉換的對照；它不載入模型／WASM，也不扣除或替代應用 RSS。冷熱完整 native gzip、307 core 檔、provider digest／CRC、SHA／來源與獨立成功 reader 均實際 exit 0；完整 [22 檔原始證據](results/runtime-io-response32-originals.zip)／[SHA inventory](results/runtime-io-response32-originals.json)保存，ZIP SHA `4a29d5311b3f4a0cdde1f3a0cc8d4fe02b5024e580a74547cd9d9c3c283a87ed`。這是有限 Hosted Linux 正常流程的改善，不證明所有 engine／private mode／數小時或任意模型；候選尚未發布。

使用者在本輪完成時明確調整 Firefox 為選做，見[現行驗收範圍](desktop-engines.md#現行驗收範圍)。已完成的這輪只讀取並保存結果，後續不排 Firefox、不作部署阻擋。使用者隨後明確將 Safari／WebKit 也改為選做，必要範圍只保留 Chrome／Edge；後續僅排 Chromium 與正式發布完整性核對。核心效能 87 檔 dependency fingerprint 與已交付來源完全相同，值為 `2172ba567df7da91fedf1790ad56b1e05a2b49cfd718574f305bb3835f5f741d`；可於 provider／scope 再核對後沿用既有 core 結果，其餘三關卡須按新來源核對。
