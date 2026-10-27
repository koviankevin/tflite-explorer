// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=0f8361cc44fcd547';
export const mlirDialects = validateDialectAdapters([]);
