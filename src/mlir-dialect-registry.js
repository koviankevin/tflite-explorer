// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=4e44cfa55e34993c';
export const mlirDialects = validateDialectAdapters([]);
