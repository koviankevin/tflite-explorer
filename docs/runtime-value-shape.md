# 值相依 shape 的執行輸出

## 問題與可重現證據

v1.12.2 的 LiteRT.js 2.6.0 CompiledModel 在三個合成模型中回報執行通過，但 TRANSPOSE permutation、EXPAND_DIMS axis、RESHAPE shape 作模型輸入時，下載的 output 數值錯誤。三個常數參數對照及 GATHER／ADD 整數 input 對照正確。Chrome／Edge 均重現，實際下載的 input BIN 與提供資料相同。不能以「載入、配置、Invoke 沒拋錯」代替這些已知數值的驗證。

同一批模型 SHA 與 BIN 在 ai-edge-litert 2.3.0 標準 Interpreter 的 default／without-default-delegates 兩組共 16 例全部正確；同版本 CompiledModel 則重現三個錯誤。這排除了網站 ZIP 保存及模型本身不合法這兩個解釋。最小 TRANSPOSE 為一個 float、兩個 inputs、一個 OP，仍能重現。

官方 CompiledModel 註冊外部 output allocation，原始碼另對 constant output 複製；非 constant 的 shape 參數可使 kernel 在 Invoke 時重新配置 output。這與失效 output buffer 的假說一致，但尚無該預編譯二進位的內部指標追蹤，不能宣稱已修好上游 C++。原始失敗及獨立對照見[候選證據](results/value-shape-runtime-candidate.json)。

## 候選實作，尚未正式發布

1.12.3 候選在所有 subgraphs 檢查上述三個 OP 的 shape 參數。模型 input、producer 結果、variable 或沒有固定 buffer 的參數使用標準 TFLite Interpreter；常數參數與其他模型保留既有 CompiledModel。這項選擇只影響使用者手動執行，不影響讀取、搜尋、編輯或一般匯出。

Interpreter 使用官方 `@tensorflow/tfjs-tflite@0.0.1-alpha.10` 的 compatibility WASM，沒有 TFJS Tensor 轉換或 dequantization。原始 WASM 位元組保持不變；載入器的 116 個 embind factories 預先產生為固定 JS 函式，移除舊 global lookup fallback。`scripts/lib/interpreter-bindings.mjs`、`scripts/data/` 及重建測試可重現載入器。缺少預先產生的 binding 明確失敗，不退回字串執行或錯誤 backend。Apache／Emscripten 授權、npm integrity、來源 revision、修改說明及每檔 SHA 保留於 `vendor/tflite-interpreter/0.0.1-alpha.10/`。

原始載入器在正式 CSP 下會因 Function constructor 失敗；候選載入器已在禁止字串編譯的 VM 及 Chrome／Edge CSP 下通過。沒有加入 `unsafe-eval`、放寬 CSP 或改動防毒設定。參考 harness 曾被 Windows 防毒注入額外腳本，原失敗保留；隔離測試阻擋外部請求，逐一核對實際被阻擋的是 Chrome／Edge 的防毒腳本，沒有把它們算成應用程式請求。

每次執行建立獨立 Instance／memory／Worker，Invoke 後重新取得原生 output pointers，依實際 dtype／shape 複製及保存資料。只在本機快取兩種固定、SHA 驗證過的公開 WASM Module；不快取模型、inputs、outputs 或 Instance。既有 128 MiB 模型、512 MiB 配置估算、16 MiB IO、30 秒及取消／關閉規則保留。

## 驗收與仍有的界線

候選本機 Chrome／Edge 在 1280×640、32px，各以原生選檔、raw BIN、明確手動執行及實際 IO ZIP 下載完成八例。模型 SHA 與最初失敗版本一致，輸入原始 bytes、輸出數值、output shape、實際 backend 和模型 SHA 全部核對。每個瀏覽器的八個 model Workers、八個 runtime Workers 及 Netron Worker 均關閉。

相關 Node runtime 測試 105 項通過；新增 Interpreter cache 與發布 proof 的測試亦通過。標準 Interpreter 測試直接使用實際 WASM，涵蓋八個完整數值對照、禁止字串編譯、錯誤 backend 在讀取前拒絕，以及執行後 shape 與宣告不同時明確失敗並保存實際 shape。1.12.3 起的發布關卡要求八份固定模型的數值與 IO 證據；只改 passed／numericMatches、替換模型、退回錯誤 engine 或漏掉下載都不能通過。

標準 Interpreter 是另一個固定版本，並不保證支援所有新 kernel／operator version。其公開 IO binding 僅接受 float32、int32、uint8、bool、int16、int8、float64、uint32；值相依模型的其他 IO dtype 先標未能驗證，不能退回已知有問題的 CompiledModel。內部常數 int64 axis 與既有模型路徑不因此改寫。未知 shape_signature、custom kernel、超額模型等既有未驗證界線保留。

此修正只針對已重現的三種值相依 transform 與對照，不代表任意 kernel 組合、所有控制流程路徑、數值精度或與編輯前模型等價都已驗證。正式站與固定 Release 仍待完成；正式版本以 README 為準。

## 主分支關卡

[PR #297](https://github.com/koviankevin/tflite-explorer/pull/297) 已合併至 `ff6dbf3b3691d5fcd33da24d8d9b6f32fed603b7`，完整 tree 與 PR 實際受測 merge tree 相同。Node 1,157 項通過、35 項既有環境略過、零失敗；沒有重跑相同內容。

四項 main 手動關卡的官方 artifact digest、ZIP CRC、原始報告、政策及來源 fingerprint 都已核對，乾淨來源重建與逐檔 manifest 相同，見[完整收據](results/value-shape-v1.12.3-main-gates.json)：九筆核心效能、83 項發布契約、53 項隔離網站操作及 1,349,965,216 bytes／21,005 OP 實體 TFLite 的八輪生命周期全部通過。六輪正式量測的 RSS slope 為 2,180,944.46 bytes／cycle、drift 為 13,049,856 bytes；保留原上限與不強制 GC 的規則，瀏覽器正常關閉，觀察到的程序全部回收。這是該 Hosted 大模型流程的量測，不能延伸成 Windows 或標準 Interpreter 任意模型的 RSS 保證。

網站報告包含八個已知模型的實際數值 proof；全部 285 個觀察到的 Workers 關閉，瀏覽器程序清理完成。這些結果提供待發布版本的來源證據，不表示正式網站已切換。標準 Interpreter 缺少較新 kernel 時，可能顯示載入失敗及通用 INVALID_ARGUMENT，原始缺少 opcode／version 的診斷仍保留；後續可再改善其分類，沒有 Invoke 或錯誤的通過結果。

參考來源：[官方 npm 套件](https://www.npmjs.com/package/@tensorflow/tfjs-tflite)、[TFLite runner 型別](https://github.com/tensorflow/tfjs/blob/cc8d9d72d2244b50a7f5127900404709595e65fd/tfjs-tflite/src/tflite_model.ts)、[CompiledModel 原始碼](https://github.com/google-ai-edge/LiteRT/blob/b53c5cb860ff58cc918e9e7aa73c9b192dc9cb5f/litert/runtime/compiled_model.cc)、[Emscripten DYNAMIC_EXECUTION／EMBIND_AOT](https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution)。
