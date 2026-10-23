# MLIR 匯出檔的編譯器驗證

這份說明區分「網站能重新讀取」、「MLIR 通用結構有效」及「內部 dialect 語意有效」。
三者不能互相替代。網站匯出前會在本機 Worker 檢查來源與生成結果的語法／SSA；
這是下述明確範圍的 JavaScript 結構檢查，不是在瀏覽器執行 LLVM verifier，
也不能取代公司 dialect 的 compiler 檢查。

## 網站匯出前的本機檢查

`mlir-validate.js` 獨立走訪原始 region／block、SSA 宣告與使用紀錄。
宣告型別與 operand 使用型別在 parser 階段分別保存，避免 Netron 覆寫
`value.type` 後掩蓋衝突。來源以目前 graph 所屬 function context 檢查；
另一個 function 的錯誤不會蓋掉目前範圍的診斷。

檢查包括未定義／不可見的 SSA、結果編號、重定義與可見外層名稱衝突、
型別一致性、跨 block SSA dominance、已知 function isolation、entry arguments
與 return signature。型別 aliases 以解析後的型別比較；未知 type／attribute
仍保留 opaque 內容，不宣稱理解內部 dialect 語意。

來源檢查先於切圖輸入轉換，避免將 `%missing` 誤當成合法的新 argument。
生成的子圖會再次解析及檢查；只有兩階段均通過才建立可下載 Blob。
失敗時回傳結構化 diagnostics，在頁面顯示來源／匯出階段、行、欄、operator、
原因與原文片段。最多顯示前 20 項；診斷不會上傳或寫入遠端 log。

Generic `cf.br`、`cf.cond_br`、`cf.switch` 支援多 block：檢查目標 block、禁止
entry predecessor、branch operands 與 block arguments 的數量／型別、condition
型別、operand segments、block labels 唯一和 terminator 位置。`mlir-ir.js`
以 reverse postorder 計算 immediate dominators，建立 dominator tree 的區間
索引，讓每個跨 block SSA dominance 查詢為 O(1)，儲存量隨 blocks／edges
線性增加。支援 backedges、irreducible CFG、textual forward references 和
巢狀 captures；同 block 仍檢查先定義後使用。不可達 blocks 依 LLVM 規則
處理跨 block dominance，同 block 的先後順序仍需有效。

圈選位於多 block function 時，匯出保留整個 enclosing `func.func`，包含
所有 blocks、terminators、block arguments 和返回路徑。這是保留控制流程的
function 擷取；pattern 搜尋仍以 block 為範圍。未知 branch／terminator 規則
需透過 [dialect adapter](mlir-adapters.md) 擴充，否則明確拒絕匯出。
Symbol dependencies 不自動擷取；完整 dialect ODS／private verifier 仍需在公司
工具驗證。無法完整對應 operands 或 custom assembly 會拒絕匯出。

本機測試以移除候選 dominator 後的路徑可達性，交叉核對循環及 irreducible
圖的 dominance，並測試 15,000-block CFG，避免 stack overflow 或 B×B 儲存。
Compiler 正負例同時呼叫本機檢查器，對照真正 LLVM/MLIR verifier 的結果。
驗證只依賴隨網站提供的 JavaScript 與本機 File／Worker；沒有模型上傳端點。

## 2026-10-23 實測

多 block 功能新增後：全套 124 項測試以 IREE verifier 執行，全數通過、0 略過；
獨立 upstream LLVM 18.1.8 `mlir-opt` 的 34 項 compiler 正負例也全部通過。
包含 diamond、loop、非文字順序的合法 dominance、switch 多出口，以及實際由
瀏覽器下載的四 block custom-op function；正規化後比較資料流及 CFG successors。
錯誤的 join 使用、branch 目標／arguments／condition、entry predecessor、
duplicate blocks、terminator 位置及 loop use-before-def 在兩套檢查均被拒絕。

以下是先前單 block 匯出功能的測試記錄：

| 工具 | 檢查 | 結果 |
| --- | --- | --- |
| upstream `mlir-opt`，Ubuntu LLVM 18.1.8 | 20 項獨立 compiler 測試，含正式站實際下載檔 | 20 通過、0 失敗、0 略過 |
| IREE compiler `20241104.1068` 的 `iree-opt`，LLVM 20.0.0git | 相同 20 項 compiler 檢查及原有 52 項測試 | 72 通過、0 失敗、0 略過 |

實際下載檔為 `mlir-export-custom-submodel (1).mlir`，含 generic custom ops、
opaque tensor element type、aliases、properties、大整數、dense attributes、
兩個 split 結果及分支／匯合。兩套工具的直接 parse／verify 均以 exit code 0
結束；沒有停用任何 verifier。Compiler 正規化輸出後再讀回，operations、
SSA 邊、輸入／輸出型別也與匯出檔一致。

正例另含兩個切圖輸入／輸出、巢狀 region、captured values、混合結果群組、
重複 return operand、無輸出 op，以及不需要 unknown flag 的已註冊 Arith ops。
負例確認語法錯誤、未定義 SSA、型別不一致、無效 result number、重定義、
use-before-definition、return signature 錯誤與錯誤的 Arith operand 數量均被拒絕。
未加 allow flag 的未知 dialect 也確實失敗。

獨立 verifier 找到舊巢狀 fixture 曾以 block argument 重用仍可見的外層 SSA
名稱，已改為合法的 `%nested_x`／`%nested_y`；另外保留 compiler 負例，
避免再把此類 shadowing 誤當成有效 MLIR。不同 `func.func` 中使用相同名稱
仍可各自成立。

這些結果涵蓋測試檔及所列 toolchain，不代表任意內部 dialect 的 verifier
或 pass pipeline 已通過。公司工具還可能要求原 module／function attributes、
常數 producer 或其他 context；切圖邊界轉成 arguments 後需重新驗證。

## 在公司環境重跑

測試檔為 `test/mlir-compiler.test.mjs`。工具透過 argv 直接啟動，模型文字走
stdin，不經 shell。沒有指定 compiler 時會明確略過這 20 項，不能計作通過。

```sh
MLIR_OPT=/path/to/mlir-opt \
MLIR_EXPORTED_FILE=/path/to/extracted.mlir \
node --test test/mlir-compiler.test.mjs
```

PowerShell：

```powershell
$env:MLIR_OPT = 'C:\toolchain\bin\mlir-opt.exe'
$env:MLIR_EXPORTED_FILE = 'C:\models\extracted.mlir'
node --test test/mlir-compiler.test.mjs
```

`MLIR_OPT_COMMAND` 可改用 JSON argv array 指定 wrapper（例如 WSL）；不會
將字串交給 shell 執行。工具必須提供 `mlir-opt` 相容的輸入與參數介面。
正式模型仍應另用已註冊公司 dialect 的工具，直接執行其驗證與所需 pipeline。

## 以 mlir-opt 檢查

```sh
mlir-opt --version
mlir-opt --allow-unregistered-dialect extracted.mlir -o verified.mlir
```

不指定 pass 時，`mlir-opt` 仍會 parse、執行 verifiers，再列印 IR。
成功退出表示這個 toolchain 接受該檔案的語法與適用的通用／已註冊規則。
`verified.mlir` 可能正規化 SSA 名稱與列印格式，不能用逐位元相同判定連線等價。
來源：[官方 mlir-opt 教學](https://mlir.llvm.org/docs/Tutorials/MlirOpt/#mlir-opt-basics)。

不要加入 `--mlir-very-unsafe-disable-verifier-on-parsing`。
`--verify-each` 預設啟用，控制每個 transformation pass 後的驗證；
不是「不跑 pass 就不驗證」。
來源：[MlirOptMain.cpp 的選項與預設值](https://github.com/llvm/llvm-project/blob/main/mlir/lib/Tools/mlir-opt/MlirOptMain.cpp)。

## 未註冊 dialect 能驗證到哪裡

`--allow-unregistered-dialect` 允許 generic 格式的未知 operations。
這個旗標不是關閉 verifier：若 dialect 已註冊、但 op 未註冊，
該 dialect 仍須明確允許 unknown operations，否則拒絕。
來源：[Verifier.cpp](https://github.com/llvm/llvm-project/blob/main/mlir/lib/IR/Verifier.cpp)。

未載入 dialect 的 `!namespace.type<...>` 與 `#namespace.attr<...>`
可保留為 opaque type／attribute；載入 dialect 後則交給該 dialect 的 parser。
因此，通用模式接受不等於內部 parser 一定接受。
來源：[DialectSymbolParser.cpp](https://github.com/llvm/llvm-project/blob/main/mlir/lib/AsmParser/DialectSymbolParser.cpp)。

generic operation 的 `<{...}>` properties 與 `{...}` attributes 有各自的語法位置。
未註冊 op 的 properties 可作為 attribute 保存；已註冊 op 會交給其
`setOpPropertiesFromAttribute` 規則轉換／檢查。
來源：[Operation.cpp](https://github.com/llvm/llvm-project/blob/main/mlir/lib/IR/Operation.cpp)、
[generic parser](https://github.com/llvm/llvm-project/blob/main/mlir/lib/AsmParser/Parser.cpp)。

## 語法與 SSA 的負例

驗證程式除接受正確匯出檔，也應確認以下故意破壞的檔案以非零退出碼失敗：

| 破壞方式 | 應偵測的問題 |
| --- | --- |
| 移除括號或型別分隔符 | generic 語法錯誤 |
| 把 operand 改成未宣告 `%missing` | 未定義 SSA 值 |
| 將同一值的使用型別改成不同 type | SSA 使用型別不一致 |
| 使用不存在的 `%result#N` | 多輸出結果編號錯誤 |
| 在 SSA dominance 適用的區域，把使用移到定義之前 | dominance 違規 |
| 修改 `func.return` 使其與 function signature 不符 | 已註冊 Func dialect 的驗證失敗 |

MLIR parser 會拒絕未解析的 SSA forward references、型別不一致及無效 result number；
verifier 另檢查適用區域的 operand dominance。
來源：[SSA parser](https://github.com/llvm/llvm-project/blob/main/mlir/lib/AsmParser/Parser.cpp)、
[dominance verifier](https://github.com/llvm/llvm-project/blob/main/mlir/lib/IR/Verifier.cpp)。

## 公司環境的驗證

需用已註冊公司 dialect、operations、types、attributes、properties 的工具，
才能執行該 dialect 的 ODS constraints、traits／interfaces 及 custom verifiers。
未知 op 的矩陣維度限制、layout 規則、裝置限制等，不能靠 upstream 的
unregistered 模式證明有效。
來源：[ODS verification ordering](https://mlir.llvm.org/docs/DefiningDialects/Operations/#verification-ordering)。

若工具以 `MlirOptMain` 為基礎且支援 dialect plugins，可使用其
`--load-dialect-plugin` 載入相容的 dialect library；實際庫路徑與支援參數
應由公司 tool 的 `--help` 確認，不能假定所有內部工具都提供此選項。
來源：[MlirOptMain.cpp 的 dialect plugin 載入](https://github.com/llvm/llvm-project/blob/main/mlir/lib/Tools/mlir-opt/MlirOptMain.cpp)。

建議以產生原始 IR dump 的同版公司 toolchain 驗證，記錄版本、完整命令、
exit code 與 diagnostics，再測需要的 pass pipeline。這是重現與相容性檢查的建議，
不是保證任何公司工具都能直接執行：讀取／驗證通過也不代表子圖具備完整 runtime、
外部 symbols、資源、記憶體或執行環境相依。
