export const operatorKey = (name) => String(name).replace(/[^a-z0-9]/gi, '').toUpperCase();
export const LORA_PATTERN = 'Mul0 -> FC -> Add0\nMul0 -> BMM0 -> BMM1 -> Add0';
