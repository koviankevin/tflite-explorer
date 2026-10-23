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
相依；不跨 scope 搜尋 pattern。多輸出分組恢復為 `%result#N`。

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
多 block function 匯出會自動擴大為整個 enclosing `func.func`，逐字保留全部
blocks、successors、block arguments、returns、properties 與 attributes。介面
在選取計數與匯出按鈕標明範圍。Symbol dependencies 和獨立 region terminator
仍明確拒絕，不猜測外部 symbol 的定義。
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
