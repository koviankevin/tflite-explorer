import { tflite as schema } from '../vendor/netron/tflite-schema.js';
import { FlatbufferWriter } from '../src/flatbuffer-writer.js';

export async function customFixture({ external = false, optionBytes = null, inlineWithExternal = null } = {}) {
    const options = optionBytes || Uint8Array.of(255, 0, 6, 0, 2, 128, 1, 42);
    const weight = new Uint8Array(new Float32Array([2, 3]).buffer);
    const tensors = Array.from({ length: 10 }, (_, i) => ({ name: `tensor_${i}`, shape: Int32Array.of(2), type: 0, buffer: i === 0 ? 1 : i === 5 ? 3 : 0, is_variable: false, has_rank: true }));
    for (const id of [7,8,9]) {
        tensors[id].type = 9;
        tensors[id].quantization = { scale: Float32Array.of(.25), zero_point: [3n], quantized_dimension: 0 };
    }
    const add = (inputs, output) => ({ opcode_index: 0, inputs: Int32Array.from(inputs), outputs: Int32Array.of(output), intermediates: new Int32Array(), builtin_options: Object.assign(new schema.AddOptions(), { fused_activation_function: 0, pot_scale_int16: true }) });
    const custom = { opcode_index: 1, inputs: Int32Array.of(4,5,-1), outputs: Int32Array.of(7,8), intermediates: Int32Array.of(6), custom_options: external ? inlineWithExternal : options, custom_options_format: 0, large_custom_options_offset: external ? 1n : 0n, large_custom_options_size: external ? BigInt(options.length) : 0n, mutating_variable_inputs: [false,false,false] };
    const model = {
        version: 3, operator_codes: [{ deprecated_builtin_code: 0, builtin_code: 0, version: 1 }, { deprecated_builtin_code: 32, builtin_code: 32, custom_code: 'InternalSplitFoo', version: 3 }],
        subgraphs: [{ name: 'custom-branches', tensors, inputs: Int32Array.of(1,2), outputs: Int32Array.of(9), operators: [add([1,2],4), custom, add([7,8],9)] }],
        buffers: [new Uint8Array(), Uint8Array.of(4,5,6,7,0,0,0,0), Uint8Array.of(80,82,73,86,65,84,69), weight].map(data => ({ data, offset: 0n, size: 0n })),
        metadata: [{ name: 'internal.runtime', buffer: 2 }], metadata_buffer: Int32Array.of(2), description: 'Synthetic custom-op extraction fixture; implementation supplied by runtime.'
    };
    let blob = new FlatbufferWriter().finish(model, new Blob());
    if (external) {
        const padding = (16 - blob.size % 16) % 16;
        custom.large_custom_options_offset = BigInt(blob.size + padding);
        blob = new Blob([new FlatbufferWriter().finish(model, new Blob()), new Uint8Array(padding), options]);
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), options, weight, model };
}
