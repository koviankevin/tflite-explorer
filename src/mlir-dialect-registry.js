// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=66e1f1fa94a943d8';
export const mlirDialects = validateDialectAdapters([]);
