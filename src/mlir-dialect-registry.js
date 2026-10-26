// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=d3740856bb6e74d3';
export const mlirDialects = validateDialectAdapters([]);
