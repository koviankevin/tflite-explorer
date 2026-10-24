# MLIR adapter 與內部 dialect 接入

`model-formats.js` 僅辨識副檔名，前端不載入 parser。Worker 透過
`openModelFile()` 接上 TFLite 或 MLIR；MLIR parser 使用動態 import。
兩者回傳相同搜尋／繪圖索引，以及格式能力 `capabilities.tfliteExport`／`mlirExport`。

`mlir-engine.js` 使用 Netron 的 parser；文字解析完畢後，若有
`context.buildMLIRModel`，將 block 與 source metadata 交給 adapter 建立模型。
這避免 upstream viewer 攤平 block 或省略常數時丟失搜尋所需的結構。
匯出另記錄 operation／type／SSA use 的原始文字範圍，以及 aliases／resources。
generic block arguments 必須登記到 SSA scope，才能正確區別巢狀同名值；
結果的原始 SSA 名稱需保留 grouped results 的 `#N`，包括混合結果群組。
更新 Netron 時須保留這些接點並執行 MLIR 測試。

## Generic operations 與顯示擴充

未知 dialect 使用 generic operations 時不需預先列舉 op 名稱。
Pattern 保留 qualified `dialect.op` 的 namespace 與大小寫；文字搜尋仍不分大小寫。
`parseMLIR(bytes, { metadata, dialects })` 的 `metadata` 是完整 upstream
`mlir-metadata.json` 文字；`dialects` 可在公司版本傳入 namespace decorator：

```js
const dialects = [{
    namespace: 'company',
    describeOperation({ name, attributes, scope }) {
        return [{ name: 'Internal category', type: 'string', value: 'accelerator' }];
    }
}];
```

在公司版本的 worker 呼叫 `openModelFile()` 時傳入 `dialects`。新增的
attributes 只補充顯示，不覆蓋 canonical `dialect.op` 或 SSA 接線。
內部 definitions、匿名範例和 metadata 留在公司 repo；不用修改搜尋、
pattern library 或圖形控制。不要從模型檔案或網路動態執行 JavaScript。

若輸入是公司專用 custom assembly，先透過公司的 compiler 輸出 generic
形式。若必須直接支援該語法，在 `openModelFile()` 的 MLIR 解析分支替換
parser implementation，回傳 `indexModel()` 可接受的 model，並保留
`sourceFormat: 'mlir'` 及 `capabilities: { tfliteExport: false }`。
只有能提供等價原文範圍／SSA identity、並通過匯出 round-trip 的 parser 才啟用
`mlirExport: true`；顯示模型不是可用於匯出的完整 IR。
這需要真正解析該語法；decorator 或 op 名稱清單不能替代 parser。

## 範圍與驗證

每個 block 是一個 graph／搜尋範圍；巢狀 scope 路徑包含 owning op、region
及 block。跨 scope 使用的值在該 graph 顯示為輸入，不推斷記憶體與控制
相依；一般 pattern 預設逐 block 搜尋，跨 block 模式在同一 region 比對 SSA 和
successors，不跨 function／巢狀 region。多輸出分組恢復為 `%result#N`。

執行 `node --test test/*.test.mjs`。新增 dialect 必須至少測完整 op 名稱、
不同 namespace 的同名 op、SSA 多輸出、重複 SSA 名稱的不同 scopes、
自訂 type／attributes、圈選 JSON round trip 和無效語法診斷。
瀏覽器另測實際檔案選擇、搜尋定位、圈選與 TFLite／MLIR 來回切換。

## 局部 MLIR 匯出

`mlir-export.js` 使用 worker 內的 `index.mlir`，不從圖形／顯示 attributes
重建 IR。依原 block 順序擷取選定 operations，保留完整 region；以 parser
記錄的 SSA use 範圍替換外部值，避免修改 strings、attributes 或巢狀同名值。
型別與 attributes 保留原始 lexemes，aliases 和 resource dictionaries
一併帶入。輸入／輸出以 generic `func.func` 包裝；原有 `func.return`
只有與全部輸出相容時才直接保留，其餘情況產生新的 return。

下載前由 `mlir-validate.js` 檢查來源 context 的 SSA，再重新解析及檢查
生成的子圖；這是本機結構檢查，不等於 LLVM／內部 dialect 的語意驗證。
Parser 必須提供不可變的定義型別、每個 operand 使用型別及原文範圍；
不可用被覆寫的 display `value.type` 代替。驗證失敗回傳 `MLIRValidationError`
的結構化 diagnostics，worker 原樣交給介面呈現，成功後才建立 Blob。
`exportMLIR(index,graph,nodes,{scope:'slice',selections})` 會透過 `mlir-slice.js`
匯出同一 function 直接 body 的局部 CFG；`selections` 為 `{graph,nodes}[]`。
介面預設 slice；程式介面預設 `scope:'auto'` 保持既有呼叫的行為（多 block
保留 function，單 block 擷取 SSA 子圖）。明確指定 function 也支援單 block 函式。
完整 function 模式逐字保留 enclosing `func.func`；局部模式移除未選取的資料運算，
保留可達控制路徑並新增 entry block，依 worklist 裁掉未使用的 block arguments。
SSA 外部值變成函式輸入，cyclic CFG 內必要的 producer 會遞迴保留，避免把每輪
更新的條件／迴圈值凍結為一次性輸入。必要 producer 清單回傳在 `result.slice.added`。

只有部分路徑執行的資料輸出使用 `(valid: i1,value)`；caller 須傳同型別 seed，
未經定義路徑回傳 valid=false 與原 seed，經過定義的路徑保留最近一次值。
有效性與資料皆透過額外 block arguments 傳遞，不產生 undef／poison。
多 return 出口以第一個 i32 結果回傳原始出口編號。註解及回傳 metadata 記錄
輸入來源、條件輸出及實際 result positions。SSA／CFG 重建後仍須通過相同驗證。
新版局部檔案帶有原始結構對照，既有跨 block pattern 可沿用；原始函式介面需要
完全相同時使用完整 function。未知 memory effects
與原函式 ABI 不推斷。最多 4096 原始 blocks、128 資料輸出、131072 個條件值
block 傳遞組合；無可達出口、跨 function、獨立 nested block 選取與 symbol
dependencies 明確拒絕，不猜測可執行語意。

### 匯出後的 pattern 相容性

`mlir-pattern-projection.js` 在 `func.func` 的 discardable string attribute
`model_lens.slice_pattern` 保存 version 1 結構對照，最多 8 MiB。內容只有已保留
operator 的真實位置、原始相對順序、block／argument arity／slot 與帶 ports 的
SSA／argument／CFG 邊，不含來源模型、權重或被刪除運算的候選節點。被裁掉但屬於
原 block 介面的 arguments 可作邏輯比對節點；額外 entry、seed、valid、return
介面不會混入原始圖。單 block 擷取與再次局部匯出也會保留／攤平同一份來源結構。

解析器一次驗證 schema、真實 op 類型／位置／順序、普通資料 op 的 SSA ports、
真實 CFG 出口與 SHA-256 結構摘要。摘要綁定實際 body 和對照，不依 SSA 名稱、
block 標籤或排版；MLIR compiler 原樣 print/parse 可沿用。這是自包含資料完整性
檢查，並非來源身分或歷史的數位簽章，不執行模型提供的程式碼。摘要或對照失效時
只比對實際結構；原有 SSA／dominance 檢查仍先執行。若公司 pass 改變結構或移除
這個屬性，需要從原模型重新匯出才能取得新的有效對照。

Matcher 共用既有 typed adjacency 索引、取消及工作上限。有有效對照的 region
只按來源結構匹配，不與新增 ABI 結構取聯集，避免新增 arguments 啟用原本不符的
pattern；沒有有效對照則保留實際結構的嚴格規則。候選限定在實際保留的來源
operators，新增常數／entry branch／輸出 return 不會成為候選或建立 pattern。
沿用帶 ports 的匹配邊去重，不重複列出同一匹配。
來源結構命中標示「原始結構」，點選仍以實際 IR 的 blocks、ports、控制箭頭顯示。
一般 MLIR 不改變嚴格規則；舊 pattern JSON schema／localStorage 不需升級。
較早未帶對照的局部 MLIR 無法恢復已裁掉的 slots，需從原模型重新匯出一次。
規格參考 [MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/#operations)。

本機驗證與 compiler 驗證的範圍及重跑方式見 [MLIR 驗證說明](mlir-verification.md)。

詳細資料的單一 attribute 預覽最多 16 Ki 字元，避免大型 dense／string
payload 傳入圖形面板；匯出仍擷取完整原文，不使用截短的預覽文字。

## 控制流程與 dialect 驗證介面

公司版本在 `src/mlir-dialect-registry.js` 匯入本機 adapter。Worker 開檔、
顯示、來源驗證、匯出結果重驗證都共用同一份 registry。`mlir-ir.js` 整理
region 與 SSA identity；`mlir-dialects.js` 集中處理語意。搜尋與匯出器不需
加入公司 op 名稱。模型檔不能載入 JavaScript，adapter 不經網路動態執行。

```js
// company-dialect.js — 僅放在公司版本
export const companyDialect = {
    namespace: 'company',
    describeOperation({ name, attributes, scope }) { return []; },
    operationSemantics({ name, op }) {
        if (name === 'company.region') {
            return { isolated: true, regionKind: 'ssacfg' };
        }
        if (name === 'company.br') {
            return {
                terminator: true,
                branch: true,
                successorOperands({ uses }) {
                    if (op.successors.length !== 1) throw new Error('需要一個 successor');
                    return [uses]; // 此例所有 operands 傳給唯一 successor
                }
            };
        }
        if (name === 'company.finish') return { terminator: true };
        return {};
    }
};
// mlir-dialect-registry.js
// import { companyDialect } from './company-dialect.js';
// export const mlirDialects = [companyDialect];
```

`operationSemantics` 是同步的 build-time hook，可回傳：

| 欄位 | 契約 |
| --- | --- |
| `isolated` | true 禁止 region 擷取外層 SSA；op 本身的 operands 仍可使用外層值 |
| `regionKind` | `ssacfg` 或 `graph`，也可為 `(regionIndex) => kind` |
| `terminator` | 宣告 block 結束，後面不得有其他 operation |
| `branch` | 分支操作，必須提供 `successorOperands` |
| `successorOperands({op,uses,typeOf})` | 每個 successor 對應一組原始 SSA uses，順序與 `op.successors` 相同；失敗可 throw Error。核心檢查目標、entry predecessor、argument 數量與型別 |
| `exportBranch({op,source,conditions,successors,attributes})` | 局部 CFG 匯出用；同步回傳單一 generic branch operation 文字。conditions 是未作 successor 傳值的 `{name,type}` 值；successors 為依原出口順序的 `{label,values:[{name,type}]}`，已包含裁剪後的傳值及輸出 slots。`attributes(op,omitNames)` 可取原始屬性文字。未提供時僅支援內建 cf branches，完整 function 模式不需此 hook |
| `verify({op,uses,typeOf})` | 回傳 `{code,message}[]` 補充公司規則，不可回傳 Promise |

`uses` 含原始名稱、結果編號、使用型別和 source range；`op` 是 parser 原始
operation，可讀取 `getAttr()`、`regions`、`successors`。不要用顯示 attributes
預覽或被覆寫的 tensor 型別實作驗證。每個 namespace 註冊一個 adapter，集中
dispatch op 名稱。Adapter 規則錯誤時應拒絕匯出，不能猜測成功。

內建規則包含 `builtin.module`、`func.func`／`func.return`、generic
`cf.br`／`cf.cond_br`／`cf.switch`。未知 branch 即使能畫圖，也會要求 adapter，
因為 successor 名稱不足以知道 operands 如何傳到每個 block arguments。
未知多 block region 依 MLIR 規則檢查 SSA dominance；單 block 未註冊 region
採保守 SSA 順序檢查，公司 op 若為 graph region 應明確宣告 `regionKind:'graph'`。
Graph region 不允許多 blocks。完整 ODS 規則、memory effects、region branch
interfaces 和 private verifiers 不在目前通用檢查範圍。

新增 adapter 至少測 diamond／loop 的 argument routing、錯誤路由、isolation、
region kind、SSA shadowing、diagnostics、匯出 round trip，並以公司的 compiler
驗證同一份檔案。Custom assembly 仍須先由 compiler 轉為 generic 格式。

## 跨 block pattern 接點

`mlir-pattern.js` 僅在 Worker 按需載入，使用同一份 `operationSemantics` 和
不可變 SSA uses 建立索引；公司分支只需提供正確的 `successorOperands`，不必
另寫 matcher。四種邊是 `contains`、`ssa`、`argument` 和 `control`。Branch
到 block argument 的綁定保留 successor 編號及 source result port，argument
節點保留 slot，SSA 邊保留 operand／result ports；不將所有前驅資料流攤平成
普通的 op → op 邊。這可區分不同 phi-like routing，並自然表達迴圈。

Region 的 project 共用 source SSA／dominance 檢查 cache；圖儲存量隨原始
operations、arguments、uses 和 successors 線性增加，不做 transitive closure。
Pattern 另保存同 block 內被選 operators 的相對順序，無須建立 O(N²) 順序邊。
Matcher 透過類型與帶 port 的鄰接索引成長，支援有向循環，保留取消與工作上限。
結果以實際節點及有類型的匹配邊去重，分開列出不同 region／function 的匹配。

主執行緒只載入 `mlir-pattern-spec.js` 做 JSON schema 驗證，不能因此載入 MLIR
parser。Version 2 的 `mode:'mlir-cfg'` 節點包含 operator、block、argument；
最多 32 operators、32 blocks、256 結構節點、512 邊。只輸出白名單欄位，沿用
1 MiB／50 組 library 上限；匯出也檢查大小，以免產生無法匯入的檔案。
Library 使用 v2 localStorage key，首次從舊 v1 key 讀取既有 patterns；只將之後
的儲存寫入 v2，保留原 key，避免尚未重新整理的舊分頁覆蓋新版結構。

新增 dialect 應以 `test/mlir-cross-block.test.mjs` 為範例，另測 branch operand
groups、同一 successor 的不同出口、loop-carried arguments、名字改變後的匹配、
錯誤路由拒絕、跨 function 拒絕、JSON round trip 及每個結果 block 的定位 DTO。
