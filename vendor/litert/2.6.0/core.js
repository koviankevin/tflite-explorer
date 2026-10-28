// src/wasm_binding_types.ts
var ElementType = {
  NONE: 0,
  FLOAT32: 1,
  INT32: 2,
  UINT8: 3,
  INT64: 4,
  STRING: 5,
  BOOL: 6,
  INT16: 7,
  COMPLEX64: 8,
  INT8: 9,
  FLOAT16: 10,
  FLOAT64: 11,
  COMPLEX128: 12,
  UINT64: 13,
  RESOURCE: 14,
  VARIANT: 15,
  UINT32: 16,
  UINT16: 17,
  INT4: 18,
  BFLOAT16: 19
};
var ElementTypeName = {
  [ElementType.NONE]: "NONE",
  [ElementType.FLOAT32]: "FLOAT32",
  [ElementType.INT32]: "INT32",
  [ElementType.UINT8]: "UINT8",
  [ElementType.INT64]: "INT64",
  [ElementType.STRING]: "STRING",
  [ElementType.BOOL]: "BOOL",
  [ElementType.INT16]: "INT16",
  [ElementType.COMPLEX64]: "COMPLEX64",
  [ElementType.INT8]: "INT8",
  [ElementType.FLOAT16]: "FLOAT16",
  [ElementType.FLOAT64]: "FLOAT64",
  [ElementType.COMPLEX128]: "COMPLEX128",
  [ElementType.UINT64]: "UINT64",
  [ElementType.RESOURCE]: "RESOURCE",
  [ElementType.VARIANT]: "VARIANT",
  [ElementType.UINT32]: "UINT32",
  [ElementType.UINT16]: "UINT16",
  [ElementType.INT4]: "INT4",
  [ElementType.BFLOAT16]: "BFLOAT16"
};
var TensorBufferType = {
  HOST_MEMORY: 1,
  WEB_GPU_BUFFER: 20,
  WEB_GPU_BUFFER_FP16: 21,
  WEB_GPU_BUFFER_PACKED: 26
};
var TensorBufferTypeName = {
  [TensorBufferType.HOST_MEMORY]: "HOST_MEMORY",
  [TensorBufferType.WEB_GPU_BUFFER]: "WEB_GPU_BUFFER",
  [TensorBufferType.WEB_GPU_BUFFER_FP16]: "WEB_GPU_BUFFER_FP16",
  [TensorBufferType.WEB_GPU_BUFFER_PACKED]: "WEB_GPU_BUFFER_PACKED"
};

// src/datatypes.ts
var Float16ArrayCtor = typeof Float16Array !== "undefined" ? Float16Array : void 0;
var BigInt64ArrayCtor = typeof BigInt64Array !== "undefined" ? BigInt64Array : void 0;
var BigUint64ArrayCtor = typeof BigUint64Array !== "undefined" ? BigUint64Array : void 0;
var DATATYPES = Object.freeze([
  {
    dtype: "float32" /* FLOAT32 */,
    typedArrayConstructor: Float32Array,
    elementType: ElementType.FLOAT32
  },
  {
    dtype: "int32" /* INT32 */,
    typedArrayConstructor: Int32Array,
    elementType: ElementType.INT32
  },
  {
    dtype: "uint8" /* UINT8 */,
    typedArrayConstructor: Uint8Array,
    elementType: ElementType.UINT8
  },
  {
    dtype: "int8" /* INT8 */,
    typedArrayConstructor: Int8Array,
    elementType: ElementType.INT8
  },
  {
    dtype: "bool" /* BOOL */,
    typedArrayConstructor: Uint8Array,
    elementType: ElementType.BOOL
  },
  {
    dtype: "uint16" /* UINT16 */,
    typedArrayConstructor: Uint16Array,
    elementType: ElementType.UINT16
  },
  {
    dtype: "int16" /* INT16 */,
    typedArrayConstructor: Int16Array,
    elementType: ElementType.INT16
  },
  {
    dtype: "float16" /* FLOAT16 */,
    typedArrayConstructor: Float16ArrayCtor,
    elementType: ElementType.FLOAT16
  },
  {
    dtype: "int64" /* INT64 */,
    typedArrayConstructor: BigInt64ArrayCtor,
    elementType: ElementType.INT64
  },
  {
    dtype: "uint64" /* UINT64 */,
    typedArrayConstructor: BigUint64ArrayCtor,
    elementType: ElementType.UINT64
  },
  {
    dtype: "float64" /* FLOAT64 */,
    typedArrayConstructor: Float64Array,
    elementType: ElementType.FLOAT64
  }
]);
function getDataType(val) {
  for (const dataTypeMapping of DATATYPES) {
    if (dataTypeMapping.dtype === val || dataTypeMapping.typedArrayConstructor === val || dataTypeMapping.typedArrayConstructor && val instanceof dataTypeMapping.typedArrayConstructor || dataTypeMapping.elementType === val) {
      return dataTypeMapping;
    }
  }
  if (typeof val === "string") {
    throw new Error(`DType ${val} is not supported.`);
  } else if (val instanceof Object) {
    throw new Error(`Typed array ${"name" in val ? val.name : val.constructor.name} is not supported.`);
  } else {
    throw new Error(`Element type ${ElementTypeName[val] ?? val} is not supported.`);
  }
}

// src/global_litert.ts
var LiteRtNotLoadedError = class extends Error {
  constructor() {
    super(
      "LiteRT is not initialized yet. Please call loadLiteRt() and wait for its promise to resolve to load the LiteRT WASM module."
    );
  }
};
var globalLiteRt = void 0;
var globalLiteRtPromise = void 0;
function getGlobalLiteRt() {
  if (!globalLiteRt) {
    throw new LiteRtNotLoadedError();
  }
  return globalLiteRt;
}
function hasGlobalLiteRt() {
  return Boolean(globalLiteRt);
}
function setGlobalLiteRt(liteRt) {
  globalLiteRt = liteRt;
}
function getGlobalLiteRtPromise() {
  return globalLiteRtPromise;
}
function hasGlobalLiteRtPromise() {
  return Boolean(globalLiteRtPromise);
}
function setGlobalLiteRtPromise(promise) {
  globalLiteRtPromise = promise;
}

// src/accelerator_types.ts
var AcceleratorDefaultTensorBufferType = {
  "webgpu": TensorBufferType.WEB_GPU_BUFFER_PACKED,
  "wasm": TensorBufferType.HOST_MEMORY
};
var TensorBufferTypeToAccelerator = {
  [TensorBufferType.HOST_MEMORY]: "wasm",
  [TensorBufferType.WEB_GPU_BUFFER]: "webgpu",
  [TensorBufferType.WEB_GPU_BUFFER_FP16]: "webgpu",
  [TensorBufferType.WEB_GPU_BUFFER_PACKED]: "webgpu"
};

// src/environment.ts
var DESIRED_WEBGPU_FEATURES = [
  "shader-f16",
  "subgroups"
];
var Environment = class _Environment {
  constructor(options) {
    this.options = options;
    this.liteRtEnvironment = getGlobalLiteRt().liteRtWasm.LiteRtEnvironment.create(
      options.webGpuDevice
    );
  }
  liteRtEnvironment;
  static async create(options = {}) {
    let webGpuDevice = null;
    if ("webGpuDevice" in options) {
      if (options.webGpuDevice) {
        webGpuDevice = options.webGpuDevice;
      }
    } else {
      try {
        webGpuDevice = await createDefaultWebGpuDevice();
      } catch (e) {
        console.warn("Failed to create default WebGPU device:", e);
      }
    }
    return new _Environment({
      ...options,
      webGpuDevice
    });
  }
  get webGpuDevice() {
    return this.options.webGpuDevice;
  }
  delete() {
    this.liteRtEnvironment.delete();
  }
};
async function createDefaultWebGpuDevice() {
  const adapterDescriptor = {
    powerPreference: "high-performance"
  };
  const adapter = await navigator.gpu.requestAdapter(adapterDescriptor);
  if (!adapter) {
    throw new Error("No GPU adapter found.");
  }
  const requiredLimits = {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D
  };
  const requiredFeatures = [];
  for (const feature of DESIRED_WEBGPU_FEATURES) {
    if (adapter.features.has(feature)) {
      requiredFeatures.push(feature);
    }
  }
  return await adapter.requestDevice({
    requiredFeatures,
    requiredLimits
  });
}

// src/wasm_utils.ts
function emscriptenVectorToArray(vector) {
  const array = new Array(vector.size());
  for (let i = 0; i < vector.size(); ++i) {
    array[i] = vector.get(i);
  }
  vector.delete();
  return array;
}
function fillEmscriptenVector(data, vector) {
  for (const item of data) {
    vector.push_back(item);
  }
}

// src/tensor.ts
function parseData(remainingArgs) {
  const data = remainingArgs.shift();
  const liteRtWasm = getGlobalLiteRt().liteRtWasm;
  if (data instanceof liteRtWasm.LiteRtTensorHandle) {
    return { liteRtTensorHandle: data };
  } else if (ArrayBuffer.isView(data)) {
    return { typedArray: data };
  } else if (data instanceof GPUBuffer) {
    return { gpuBuffer: data };
  } else {
    throw new Error(
      `Unknown type (${data?.constructor.name ?? data}) provided to create a Tensor`
    );
  }
}
function parseShape(remainingArgs) {
  if (Array.isArray(remainingArgs[0]) || remainingArgs[0] instanceof Int32Array) {
    return { shape: remainingArgs.shift() };
  } else {
    return {};
  }
}
function shiftUntilDefined(remainingArgs) {
  while (remainingArgs.length > 0 && remainingArgs[0] === void 0) {
    remainingArgs.shift();
  }
}
function parseDataType(remainingArgs) {
  shiftUntilDefined(remainingArgs);
  if (typeof remainingArgs[0] === "string") {
    const dtype = remainingArgs.shift();
    return { dataType: getDataType(dtype).dtype };
  } else {
    return {};
  }
}
function parseEnvironment(remainingArgs) {
  shiftUntilDefined(remainingArgs);
  if (remainingArgs[0] instanceof Environment) {
    return { environment: remainingArgs.shift() };
  } else {
    return {};
  }
}
function parseOnDelete(remainingArgs) {
  shiftUntilDefined(remainingArgs);
  if (remainingArgs[0] instanceof Function) {
    return { onDelete: remainingArgs.shift() };
  } else {
    return {};
  }
}
function parseArgs(args) {
  return {
    ...parseData(args),
    ...parseShape(args),
    ...parseDataType(args),
    ...parseEnvironment(args),
    ...parseOnDelete(args)
  };
}
var Tensor = class _Tensor {
  liteRtTensorHandle;
  /** @deprecated Use liteRtTensorHandle instead. */
  get liteRtTensorBuffer() {
    console.warn(
      "liteRtTensorBuffer is deprecated. Use liteRtTensorHandle instead."
    );
    return this.liteRtTensorHandle;
  }
  type;
  get shape() {
    return this.type.layout.dimensions;
  }
  get dtype() {
    return this.type.dtype;
  }
  environment;
  deletedInternal = false;
  onDelete;
  static copyFunctions = /* @__PURE__ */ new Map();
  constructor(a, b, c, d, e) {
    const {
      typedArray,
      gpuBuffer,
      liteRtTensorHandle,
      liteRtTensorBuffer,
      shape,
      dataType,
      environment,
      onDelete
    } = parseArgs([a, b, c, d, e]);
    this.onDelete = onDelete;
    this.environment = environment ?? getGlobalLiteRt().getDefaultEnvironment();
    const handle = liteRtTensorHandle ?? liteRtTensorBuffer;
    if (handle) {
      if (shape) {
        throw new Error(
          "A LiteRtTensorHandle cannot be provided with a shape."
        );
      }
      if (dataType) {
        throw new Error(
          "A LiteRtTensorHandle cannot be provided with a data type."
        );
      }
      this.liteRtTensorHandle = handle;
    } else if (gpuBuffer) {
      if (!shape) {
        throw new Error("A GPUBuffer must be provided with a shape.");
      }
      if (!dataType) {
        throw new Error("A GPUBuffer must be provided with a data type.");
      }
      const [liteRtTensorHandle2, webGpuBufferPtr] = webGpuBufferToLiteRtTensorHandle(
        gpuBuffer,
        shape,
        dataType,
        this.environment
      );
      this.liteRtTensorHandle = liteRtTensorHandle2;
      const onDelete2 = this.onDelete;
      this.onDelete = () => {
        const liteRtWasm = getGlobalLiteRt().liteRtWasm;
        liteRtWasm.wgpuBufferRelease(webGpuBufferPtr);
        onDelete2?.();
      };
    } else if (typedArray) {
      this.liteRtTensorHandle = typedArrayToLiteRtTensorHandle(
        typedArray,
        shape,
        dataType,
        environment
      );
    } else {
      throw new Error("No data provided to create a Tensor.");
    }
    this.type = liteRtTensorHandleToTensorType(this.liteRtTensorHandle);
  }
  static fromTypedArray(data, shape, environment) {
    return new _Tensor(data, shape, environment);
  }
  static placeholderCounter = 0;
  /**
   * Creates a symbolic placeholder Tensor for JIT graph compilation.
   */
  static createPlaceholder(options = {}) {
    const globalLiteRt2 = getGlobalLiteRt();
    const liteRtWasm = globalLiteRt2.liteRtWasm;
    const shape = options.shape ?? [1];
    const dtype = options.dataType ?? "float32";
    const name = options.name || `placeholder_${_Tensor.placeholderCounter++}`;
    const dimensionsVector = new liteRtWasm.VectorInt32();
    fillEmscriptenVector(shape, dimensionsVector);
    const layout = liteRtWasm.LiteRtLayout.create(dimensionsVector);
    dimensionsVector.delete();
    const rankedTensorType = liteRtWasm.LiteRtRankedTensorType.create(
      { value: getDataType(dtype).elementType },
      layout
    );
    layout.delete();
    const handle = liteRtWasm.LiteRtTensorHandle.createPlaceholder(
      rankedTensorType,
      name
    );
    rankedTensorType.delete();
    return new _Tensor(handle, options.environment);
  }
  ensureNotDeleted() {
    if (this.deleted) {
      throw new Error("Tensor is deleted and cannot be used.");
    }
  }
  add(other) {
    return add(this, other);
  }
  mul(other) {
    return mul(this, other);
  }
  sub(other) {
    return sub(this, other);
  }
  div(other) {
    return div(this, other);
  }
  pow(other) {
    return pow(this, other);
  }
  minimum(other) {
    return minimum(this, other);
  }
  maximum(other) {
    return maximum(this, other);
  }
  floorDiv(other) {
    return floorDiv(this, other);
  }
  floorMod(other) {
    return floorMod(this, other);
  }
  equal(other) {
    return equal(this, other);
  }
  notEqual(other) {
    return notEqual(this, other);
  }
  less(other) {
    return less(this, other);
  }
  greater(other) {
    return greater(this, other);
  }
  lessEqual(other) {
    return lessEqual(this, other);
  }
  greaterEqual(other) {
    return greaterEqual(this, other);
  }
  logicalAnd(other) {
    return logicalAnd(this, other);
  }
  logicalOr(other) {
    return logicalOr(this, other);
  }
  logicalNot() {
    return logicalNot(this);
  }
  select(trueVal, falseVal) {
    return select(this, trueVal, falseVal);
  }
  relu() {
    return relu(this);
  }
  toString() {
    this.ensureNotDeleted();
    return `${this.type.dtype}[${Array.from(this.type.layout.dimensions).join(
      ", "
    )}]`;
  }
  batchMatMul(other, adjX, adjY) {
    return batchMatMul(this, other, adjX, adjY);
  }
  fullyConnected(weights, bias) {
    return fullyConnected(this, weights, bias);
  }
  softmax(beta) {
    return softmax(this, beta);
  }
  logistic() {
    return logistic(this);
  }
  tanh() {
    return tanh(this);
  }
  gelu(approximate) {
    return gelu(this, approximate);
  }
  relu6() {
    return relu6(this);
  }
  leakyRelu(alpha) {
    return leakyRelu(this, alpha);
  }
  elu() {
    return elu(this);
  }
  hardSwish() {
    return hardSwish(this);
  }
  logSoftmax() {
    return logSoftmax(this);
  }
  conv2d(filter, options) {
    return conv2d(this, filter, options);
  }
  depthwiseConv2d(filter, options) {
    return depthwiseConv2d(this, filter, options);
  }
  reshape(shape) {
    return reshape(this, shape);
  }
  transpose(perm) {
    return transpose(this, perm);
  }
  concat(others, axis = 0) {
    const list = Array.isArray(others) ? [this, ...others] : [this, others];
    return concat(list, axis);
  }
  slice(begin, size) {
    return slice(this, begin, size);
  }
  pad(paddings) {
    return pad(this, paddings);
  }
  expandDims(axis) {
    return expandDims(this, axis);
  }
  squeeze(squeezeDims) {
    return squeeze(this, squeezeDims);
  }
  tile(multiples) {
    return tile(this, multiples);
  }
  unpack(num, axis = 0) {
    return unpack(this, num, axis);
  }
  split(numSplits, axis = 0) {
    return split(this, numSplits, axis);
  }
  mean(axes, keepDims = false) {
    return mean(this, axes, keepDims);
  }
  sum(axes, keepDims = false) {
    return sum(this, axes, keepDims);
  }
  reduceMax(axes, keepDims = false) {
    return reduceMax(this, axes, keepDims);
  }
  argMax(axis = 0, outputType = "int32") {
    return argMax(this, axis, outputType);
  }
  resizeBilinear(size, alignCornersOrOptions, halfPixelCenters) {
    return resizeBilinear(this, size, alignCornersOrOptions, halfPixelCenters);
  }
  resizeNearestNeighbor(size, alignCornersOrOptions, halfPixelCenters) {
    return resizeNearestNeighbor(
      this,
      size,
      alignCornersOrOptions,
      halfPixelCenters
    );
  }
  maxPool2d(filterSizeOrOptions, strides, padding) {
    return maxPool2d(this, filterSizeOrOptions, strides, padding);
  }
  avgPool2d(filterSizeOrOptions, strides, padding) {
    return avgPool2d(this, filterSizeOrOptions, strides, padding);
  }
  transposeConv2d(filter, outputShape, options = {}) {
    return transposeConv2d(this, filter, outputShape, options);
  }
  gather(indices, axis = 0, batchDims = 0) {
    return gather(this, indices, axis, batchDims);
  }
  gatherNd(indices) {
    return gatherNd(this, indices);
  }
  oneHot(depth, onValue = 1, offValue = 0, axis = -1) {
    return oneHot(this, depth, onValue, offValue, axis);
  }
  embeddingLookup(ids) {
    return embeddingLookup(this, ids);
  }
  topK(k) {
    return topK(this, k);
  }
  nonMaxSuppression(scores, maxOutputSize, options = {}) {
    return nonMaxSuppression(this, scores, maxOutputSize, options);
  }
  cumsum(axis = 0, exclusive = false, reverse2 = false) {
    return cumsum(this, axis, exclusive, reverse2);
  }
  reverse(axes) {
    return reverse(this, axes);
  }
  spaceToDepth(blockSize) {
    return spaceToDepth(this, blockSize);
  }
  depthToSpace(blockSize) {
    return depthToSpace(this, blockSize);
  }
  pRelu(alpha) {
    return pRelu(this, alpha);
  }
  dynamicUpdateSlice(update, startIndices) {
    return dynamicUpdateSlice(this, update, startIndices);
  }
  abs() {
    return abs(this);
  }
  neg() {
    return neg(this);
  }
  sqrt() {
    return sqrt(this);
  }
  rsqrt() {
    return rsqrt(this);
  }
  exp() {
    return exp(this);
  }
  log() {
    return log(this);
  }
  sin() {
    return sin(this);
  }
  cos() {
    return cos(this);
  }
  ceil() {
    return ceil(this);
  }
  floor() {
    return floor(this);
  }
  round() {
    return round(this);
  }
  async data() {
    this.ensureNotDeleted();
    if (this.liteRtTensorHandle.bufferType().value === TensorBufferType.HOST_MEMORY) {
      return this.toTypedArray();
    }
    const copy = await this.copyTo("wasm");
    const data = await copy.data();
    copy.delete();
    return data;
  }
  toTypedArray() {
    this.ensureNotDeleted();
    const liteRtWasm = getGlobalLiteRt().liteRtWasm;
    if (this.liteRtTensorHandle.isWebGpuMemory()) {
      throw new Error(
        "Cannot convert a Tensor with WebGPU memory to a TypedArray."
      );
    }
    if (this.liteRtTensorHandle.bufferType().value !== liteRtWasm.LiteRtTensorBufferType.HOST_MEMORY.value) {
      throw new Error(
        "Cannot convert a Tensor with non-host memory to a TypedArray."
      );
    }
    if (this.liteRtTensorHandle.size() !== this.liteRtTensorHandle.packedSize() || this.liteRtTensorHandle.offset() !== 0) {
      throw new Error("Tensors with strides or padding are not yet supported.");
    }
    const rankedTensorType = this.liteRtTensorHandle.tensorType();
    const elementType = rankedTensorType.elementType();
    const byteWidth = liteRtWasm.liteRtGetByteWidth(elementType);
    rankedTensorType.delete();
    const typedArrayConstructor = getDataType(
      elementType.value
    ).typedArrayConstructor;
    if (typedArrayConstructor === void 0) {
      throw new Error(
        `DType ${ElementTypeName[elementType.value]} is not supported in this environment (missing TypedArray constructor).`
      );
    }
    if (typedArrayConstructor.BYTES_PER_ELEMENT !== byteWidth) {
      throw new Error(
        `Byte width ${byteWidth} of the tensor's element type ${ElementTypeName[elementType.value]} does not match the expected byte width ${typedArrayConstructor.BYTES_PER_ELEMENT} of the ${typedArrayConstructor.name}.`
      );
    }
    const dataPtr = this.liteRtTensorHandle.lock(
      getGlobalLiteRt().liteRtWasm.LiteRtTensorBufferLockMode.READ
    );
    try {
      const uint8Array = liteRtWasm.HEAPU8.slice(
        dataPtr,
        dataPtr + this.liteRtTensorHandle.packedSize()
      );
      const typedArray = new typedArrayConstructor(
        uint8Array.buffer,
        uint8Array.byteOffset,
        uint8Array.byteLength / byteWidth
      );
      return typedArray;
    } finally {
      this.liteRtTensorHandle.unlock();
    }
  }
  getBufferType() {
    this.ensureNotDeleted();
    return this.liteRtTensorHandle.bufferType().value;
  }
  /**
   * Returns the underlying GPUBuffer of the Tensor.
   *
   * Note that the lifetime of the returned GPUBuffer is dependant upon how the
   * Tensor was created. If the Tensor was constructed from a GPUBuffer, then
   * the GPUBuffer will NOT be released when the Tensor is deleted. If the
   * Tensor was copied/moved to GPU from host memory, then the GPU buffer will
   * be released when the Tensor is deleted.
   *
   * The GPU buffer may be larger than the actual data in the tensor.
   *
   * @return The GPUBuffer containing the Tensor's data.
   */
  toGpuBuffer() {
    this.ensureNotDeleted();
    const liteRtWasm = getGlobalLiteRt().liteRtWasm;
    if (!this.liteRtTensorHandle.isWebGpuMemory()) {
      throw new Error(
        "Cannot convert a Tensor with non-WebGPU memory to a GPUBuffer."
      );
    }
    const bufferTypeValue = this.liteRtTensorHandle.bufferType().value;
    if (bufferTypeValue !== liteRtWasm.LiteRtTensorBufferType.WEB_GPU_BUFFER.value && bufferTypeValue !== liteRtWasm.LiteRtTensorBufferType.WEB_GPU_BUFFER_PACKED.value) {
      throw new Error(
        "Cannot convert a Tensor with host memory to a GPUBuffer."
      );
    }
    if (this.liteRtTensorHandle.size() !== this.liteRtTensorHandle.packedSize() || this.liteRtTensorHandle.offset() !== 0) {
      throw new Error("Tensors with strides or padding are not yet supported.");
    }
    const gpuBufferId = this.liteRtTensorHandle.getWebGpuBuffer();
    return liteRtWasm.WebGPU.getJsObject(gpuBufferId);
  }
  getCopyFunctionSet(destination) {
    this.ensureNotDeleted();
    const sourceBufferType = this.getBufferType();
    const copyFunctions = _Tensor.copyFunctions.get(sourceBufferType);
    if (!copyFunctions) {
      throw new Error(
        `TensorBufferType ${TensorBufferTypeName[sourceBufferType] ?? sourceBufferType} does not support copying or moving`
      );
    }
    const destinationBufferType = typeof destination === "string" ? AcceleratorDefaultTensorBufferType[destination] : destination;
    if (destinationBufferType == null) {
      throw new Error(
        `Unknown destination '${destination}' for copying or moving.`
      );
    }
    const copyFunctionSet = copyFunctions.get(destinationBufferType);
    if (!copyFunctionSet) {
      const supportedDestinations = [...copyFunctions].map(
        ([key]) => TensorBufferTypeName[key] ?? key
      );
      throw new Error(
        `TensorBufferType ${TensorBufferTypeName[sourceBufferType]} does not support copying or moving to ${TensorBufferTypeName[destinationBufferType]}. It supports the following TensorBufferTypes: [${supportedDestinations.join(
          ", "
        )}].`
      );
    }
    return [copyFunctionSet, destinationBufferType];
  }
  /**
   * Copies the tensor to the given accelerator.
   *
   * @param destination The accelerator or buffer type to copy to.
   * @return A promise that resolves to the copied tensor.
   */
  async copyTo(destination, options) {
    const [copyFunctionSet, destinationBufferType] = this.getCopyFunctionSet(destination);
    if (!copyFunctionSet.copyTo) {
      throw new Error(
        `Copying to ${TensorBufferTypeName[destinationBufferType]} is not supported by this tensor.`
      );
    }
    return copyFunctionSet.copyTo(this, options);
  }
  /**
   * Moves the tensor to the given accelerator.
   *
   * @param destination The accelerator or buffer type to move to.
   * @return A promise that resolves to the moved tensor.
   */
  async moveTo(destination, options) {
    const [copyFunctionSet, destinationBufferType] = this.getCopyFunctionSet(destination);
    if (!copyFunctionSet.moveTo) {
      throw new Error(
        `Moving to ${TensorBufferTypeName[destinationBufferType]} is not supported by this tensor.`
      );
    }
    return copyFunctionSet.moveTo(this, options);
  }
  get bufferType() {
    return this.liteRtTensorHandle.bufferType().value;
  }
  get accelerator() {
    const accelerator = TensorBufferTypeToAccelerator[this.bufferType];
    if (accelerator === void 0) {
      throw new Error(
        `TensorBufferType ${TensorBufferTypeName[this.bufferType]} has an unknown accelerator type.`
      );
    }
    return accelerator;
  }
  get deleted() {
    return this.deletedInternal;
  }
  delete() {
    if (this.deletedInternal) {
      return;
    }
    this.deletedInternal = true;
    this.liteRtTensorHandle.delete();
    this.onDelete?.();
  }
};
function liteRtTensorHandleToTensorType(liteRtTensorHandle) {
  const liteRtRankedTensorType = liteRtTensorHandle.tensorType();
  const elementType = liteRtRankedTensorType.elementType();
  const liteRtLayout = liteRtRankedTensorType.layout();
  const dimensions = liteRtLayout.dimensions();
  liteRtLayout.delete();
  liteRtRankedTensorType.delete();
  return {
    dtype: getDataType(elementType.value).dtype,
    layout: { dimensions: emscriptenVectorToArray(dimensions) }
  };
}
function webGpuBufferToLiteRtTensorHandle(gpuBuffer, shape, dtype, environment) {
  const globalLiteRt2 = getGlobalLiteRt();
  const liteRtWasm = globalLiteRt2.liteRtWasm;
  const dimensionsVector = new liteRtWasm.VectorInt32();
  fillEmscriptenVector(shape, dimensionsVector);
  const layout = liteRtWasm.LiteRtLayout.create(dimensionsVector);
  dimensionsVector.delete();
  const rankedTensorType = liteRtWasm.LiteRtRankedTensorType.create(
    { value: getDataType(dtype).elementType },
    layout
  );
  layout.delete();
  const importedGpuBufferPtr = liteRtWasm.WebGPU.importJsBuffer(gpuBuffer);
  const liteRtTensorHandle = liteRtWasm.LiteRtTensorHandle.createFromWebGpuBuffer(
    environment.liteRtEnvironment,
    rankedTensorType,
    liteRtWasm.LiteRtTensorBufferType.WEB_GPU_BUFFER_PACKED,
    importedGpuBufferPtr,
    gpuBuffer.size
  );
  rankedTensorType.delete();
  return [liteRtTensorHandle, importedGpuBufferPtr];
}
function typedArrayToLiteRtTensorHandle(data, shape, dataType, environment) {
  const globalLiteRt2 = getGlobalLiteRt();
  const liteRtWasm = globalLiteRt2.liteRtWasm;
  environment = environment ?? globalLiteRt2.getDefaultEnvironment();
  const elementType = dataType ? getDataType(dataType).elementType : getDataType(data).elementType;
  const dimensionsVector = new liteRtWasm.VectorInt32();
  fillEmscriptenVector(shape ?? [data.length], dimensionsVector);
  const layout = liteRtWasm.LiteRtLayout.create(dimensionsVector);
  dimensionsVector.delete();
  const expectedNumElements = layout.numElements();
  if (data.length !== expectedNumElements) {
    layout.delete();
    throw new Error(
      `Number of elements ${data.length} of the provided TypedArray does not match the expected number of elements ${expectedNumElements}.`
    );
  }
  const rankedTensorType = liteRtWasm.LiteRtRankedTensorType.create(
    { value: elementType },
    layout
  );
  layout.delete();
  const arrayType = data.constructor;
  const bufferSize = arrayType.BYTES_PER_ELEMENT * data.length;
  const expectedBufferSize = rankedTensorType.bytes();
  if (bufferSize !== expectedBufferSize) {
    rankedTensorType.delete();
    throw new Error(
      `Byte length ${bufferSize} of the provided TypedArray does not match the expected buffer size ${expectedBufferSize}.`
    );
  }
  const liteRtTensorHandle = liteRtWasm.LiteRtTensorHandle.createManaged(
    environment.liteRtEnvironment,
    liteRtWasm.LiteRtTensorBufferType.HOST_MEMORY,
    rankedTensorType,
    bufferSize
  );
  rankedTensorType.delete();
  const dataPtr = liteRtTensorHandle.lock(
    liteRtWasm.LiteRtTensorBufferLockMode.WRITE
  );
  try {
    const uint8Data = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
    liteRtWasm.HEAPU8.set(uint8Data, dataPtr);
  } finally {
    liteRtTensorHandle.unlock();
  }
  return liteRtTensorHandle;
}
function makeBinOp(op) {
  return (a, b) => {
    if (a.environment !== b.environment) {
      throw new Error(
        "Cannot perform arithmetic operations on tensors from different environments."
      );
    }
    a.ensureNotDeleted();
    b.ensureNotDeleted();
    const resultHandle = op(
      getGlobalLiteRt().liteRtWasm,
      a.liteRtTensorHandle,
      b.liteRtTensorHandle
    );
    return new Tensor(resultHandle, a.environment);
  };
}
function makeUnaryOp(op) {
  return (a) => {
    a.ensureNotDeleted();
    const resultHandle = op(getGlobalLiteRt().liteRtWasm, a.liteRtTensorHandle);
    return new Tensor(resultHandle, a.environment);
  };
}
var add = makeBinOp(
  (wasm, a, b) => wasm.add(a, b)
);
var mul = makeBinOp(
  (wasm, a, b) => wasm.mul(a, b)
);
var sub = makeBinOp(
  (wasm, a, b) => wasm.sub(a, b)
);
var div = makeBinOp(
  (wasm, a, b) => wasm.div(a, b)
);
var pow = makeBinOp(
  (wasm, a, b) => wasm.pow(a, b)
);
var minimum = makeBinOp(
  (wasm, a, b) => wasm.minimum(a, b)
);
var maximum = makeBinOp(
  (wasm, a, b) => wasm.maximum(a, b)
);
var floorDiv = makeBinOp(
  (wasm, a, b) => wasm.floorDiv(a, b)
);
var floorMod = makeBinOp(
  (wasm, a, b) => wasm.floorMod(a, b)
);
var equal = makeBinOp(
  (wasm, a, b) => wasm.equal(a, b)
);
var notEqual = makeBinOp(
  (wasm, a, b) => wasm.notEqual(a, b)
);
var less = makeBinOp(
  (wasm, a, b) => wasm.less(a, b)
);
var greater = makeBinOp(
  (wasm, a, b) => wasm.greater(a, b)
);
var greaterEqual = makeBinOp(
  (wasm, a, b) => wasm.greaterEqual(a, b)
);
var lessEqual = (a, b) => greaterEqual(b, a);
var logicalAnd = makeBinOp(
  (wasm, a, b) => wasm.logicalAnd(a, b)
);
var logicalOr = makeBinOp(
  (wasm, a, b) => wasm.logicalOr(a, b)
);
var logicalNot = makeUnaryOp(
  (wasm, a) => wasm.logicalNot(a)
);
function select(condition, trueVal, falseVal) {
  ensureTensorsOk([condition, trueVal, falseVal]);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.select(
    condition.liteRtTensorHandle,
    trueVal.liteRtTensorHandle,
    falseVal.liteRtTensorHandle
  );
  return new Tensor(resultHandle, condition.environment);
}
var relu = makeUnaryOp(
  (wasm, a) => wasm.relu(a)
);
function batchMatMul(x, y, adjX = false, adjY = false) {
  x.ensureNotDeleted();
  y.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.batchMatMul(
    x.liteRtTensorHandle,
    y.liteRtTensorHandle,
    adjX,
    adjY
  );
  return new Tensor(resultHandle, x.environment);
}
function fullyConnected(input, weights, bias) {
  input.ensureNotDeleted();
  weights.ensureNotDeleted();
  bias?.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.fullyConnected(
    input.liteRtTensorHandle,
    weights.liteRtTensorHandle,
    bias?.liteRtTensorHandle
  );
  return new Tensor(resultHandle, input.environment);
}
function softmax(a, beta = 1) {
  a.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.softmax(a.liteRtTensorHandle, beta);
  return new Tensor(resultHandle, a.environment);
}
var logistic = makeUnaryOp(
  (wasm, a) => wasm.logistic(a)
);
var tanh = makeUnaryOp(
  (wasm, a) => wasm.tanh(a)
);
function gelu(input, approximate = false) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.gelu(input.liteRtTensorHandle, approximate);
  return new Tensor(resultHandle, input.environment);
}
var relu6 = makeUnaryOp(
  (wasm, a) => wasm.relu6(a)
);
function leakyRelu(a, alpha = 0.2) {
  a.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.leakyRelu(a.liteRtTensorHandle, alpha);
  return new Tensor(resultHandle, a.environment);
}
var elu = makeUnaryOp(
  (wasm, a) => wasm.elu(a)
);
var hardSwish = makeUnaryOp(
  (wasm, a) => wasm.hardSwish(a)
);
var logSoftmax = makeUnaryOp(
  (wasm, a) => wasm.logSoftmax(a)
);
function parsePadding(padding = "SAME") {
  if (typeof padding === "number") {
    return padding;
  }
  return padding.toUpperCase() === "VALID" ? 1 : 0;
}
function conv2d(input, filter, options = {}) {
  input.ensureNotDeleted();
  filter.ensureNotDeleted();
  if (options.bias) options.bias.ensureNotDeleted();
  const strideH = options.strideH ?? 1;
  const strideW = options.strideW ?? 1;
  const padding = parsePadding(options.padding);
  const dilationH = options.dilationH ?? 1;
  const dilationW = options.dilationW ?? 1;
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.conv2d(
    input.liteRtTensorHandle,
    filter.liteRtTensorHandle,
    options.bias?.liteRtTensorHandle,
    strideH,
    strideW,
    padding,
    dilationH,
    dilationW
  );
  return new Tensor(resultHandle, input.environment);
}
function depthwiseConv2d(input, filter, options = {}) {
  input.ensureNotDeleted();
  filter.ensureNotDeleted();
  if (options.bias) options.bias.ensureNotDeleted();
  const strideH = options.strideH ?? 1;
  const strideW = options.strideW ?? 1;
  const padding = parsePadding(options.padding);
  const depthMultiplier = options.depthMultiplier ?? 1;
  const dilationH = options.dilationH ?? 1;
  const dilationW = options.dilationW ?? 1;
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.depthwiseConv2d(
    input.liteRtTensorHandle,
    filter.liteRtTensorHandle,
    options.bias?.liteRtTensorHandle,
    strideH,
    strideW,
    padding,
    depthMultiplier,
    dilationH,
    dilationW
  );
  return new Tensor(resultHandle, input.environment);
}
function reshape(input, shape) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.reshape(input.liteRtTensorHandle, shape);
  return new Tensor(resultHandle, input.environment);
}
function transpose(input, perm) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.transpose(input.liteRtTensorHandle, perm);
  return new Tensor(resultHandle, input.environment);
}
function ensureTensorsOk(tensors) {
  tensors = Array.isArray(tensors) ? tensors : [tensors];
  for (let i = 0; i < tensors.length; i++) {
    const tensor = tensors[i];
    tensor.ensureNotDeleted();
    if (tensor.environment !== tensors[0].environment) {
      throw new Error(
        `Tensor 0 and tensor ${i} are from different environments`
      );
    }
  }
}
function concat(inputs, axis = 0) {
  if (inputs.length === 0) {
    throw new Error("concat requires at least one input tensor.");
  }
  ensureTensorsOk(inputs);
  const rank = inputs[0].type.layout.dimensions.length;
  const normalizedAxis = axis < 0 ? axis + rank : axis;
  if (normalizedAxis < 0 || normalizedAxis >= rank) {
    throw new Error(
      `concat axis ${axis} is out of bounds for tensor of rank ${rank}.`
    );
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const handles = inputs.map((t) => t.liteRtTensorHandle);
  const resultHandle = wasm.concatenation(handles, normalizedAxis);
  return new Tensor(resultHandle, inputs[0].environment);
}
var concatenation = concat;
function slice(input, begin, size) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.slice(input.liteRtTensorHandle, begin, size);
  return new Tensor(resultHandle, input.environment);
}
function pad(input, paddings) {
  input.ensureNotDeleted();
  const rank = input.type.layout.dimensions.length;
  let paddingsTensor;
  let ownsPaddingsTensor = false;
  if (paddings instanceof Tensor) {
    ensureTensorsOk([input, paddings]);
    if (paddings.type.dtype !== "int32") {
      throw new Error(
        `pad requires paddings tensor to have dtype 'int32', but got '${paddings.type.dtype}'.`
      );
    }
    const padDims = paddings.type.layout.dimensions;
    if (padDims.length !== 2 || padDims[0] !== rank || padDims[1] !== 2) {
      throw new Error(
        `pad requires paddings shape to be [${rank}, 2], but got [${padDims.join(", ")}].`
      );
    }
    paddingsTensor = paddings;
  } else {
    if (paddings.length !== rank || paddings.some((p) => p.length !== 2)) {
      throw new Error(`pad requires paddings shape to be [${rank}, 2].`);
    }
    const flatPaddings = new Int32Array(rank * 2);
    for (let i = 0; i < rank; ++i) {
      if (paddings[i][0] < 0 || paddings[i][1] < 0) {
        throw new Error("pad values must be non-negative.");
      }
      flatPaddings[i * 2] = paddings[i][0];
      flatPaddings[i * 2 + 1] = paddings[i][1];
    }
    paddingsTensor = Tensor.fromTypedArray(
      flatPaddings,
      [rank, 2],
      input.environment
    );
    ownsPaddingsTensor = true;
  }
  let resultHandle;
  try {
    const wasm = getGlobalLiteRt().liteRtWasm;
    resultHandle = wasm.pad(
      input.liteRtTensorHandle,
      paddingsTensor.liteRtTensorHandle
    );
  } finally {
    if (ownsPaddingsTensor) {
      paddingsTensor.delete();
    }
  }
  return new Tensor(resultHandle, input.environment);
}
function expandDims(input, axis) {
  input.ensureNotDeleted();
  const rank = input.type.layout.dimensions.length;
  const normalizedAxis = axis < 0 ? axis + rank + 1 : axis;
  if (normalizedAxis < 0 || normalizedAxis > rank) {
    throw new Error(
      `expandDims axis ${axis} is out of bounds for tensor of rank ${rank}.`
    );
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.expandDims(input.liteRtTensorHandle, normalizedAxis);
  return new Tensor(resultHandle, input.environment);
}
function squeeze(input, squeezeDims) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.squeeze(input.liteRtTensorHandle, squeezeDims);
  return new Tensor(resultHandle, input.environment);
}
function tile(input, multiples) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.tile(input.liteRtTensorHandle, multiples);
  return new Tensor(resultHandle, input.environment);
}
function pack(inputs, axis = 0) {
  if (inputs.length === 0) {
    throw new Error("pack requires at least one input tensor.");
  }
  ensureTensorsOk(inputs);
  const rank = inputs[0].type.layout.dimensions.length;
  const normalizedAxis = axis < 0 ? axis + rank + 1 : axis;
  if (normalizedAxis < 0 || normalizedAxis > rank) {
    throw new Error(
      `pack axis ${axis} is out of bounds for input tensor of rank ${rank}.`
    );
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const handles = inputs.map((t) => t.liteRtTensorHandle);
  const resultHandle = wasm.pack(handles, normalizedAxis);
  return new Tensor(resultHandle, inputs[0].environment);
}
function unpack(input, num, axis = 0) {
  input.ensureNotDeleted();
  const rank = input.type.layout.dimensions.length;
  const normalizedAxis = axis < 0 ? axis + rank : axis;
  if (normalizedAxis < 0 || normalizedAxis >= rank) {
    throw new Error(
      `unpack axis ${axis} is out of bounds for tensor of rank ${rank}.`
    );
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandles = wasm.unpack(
    input.liteRtTensorHandle,
    num,
    normalizedAxis
  );
  return resultHandles.map((h) => new Tensor(h, input.environment));
}
function split(input, numSplits, axis = 0) {
  input.ensureNotDeleted();
  const rank = input.type.layout.dimensions.length;
  const normalizedAxis = axis < 0 ? axis + rank : axis;
  if (normalizedAxis < 0 || normalizedAxis >= rank) {
    throw new Error(
      `split axis ${axis} is out of bounds for tensor of rank ${rank}.`
    );
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandles = wasm.split(
    input.liteRtTensorHandle,
    normalizedAxis,
    numSplits
  );
  return resultHandles.map((h) => new Tensor(h, input.environment));
}
function mean(a, axes, keepDims = false) {
  a.ensureNotDeleted();
  const axesArray = normalizeAxes(axes, a.type.layout.dimensions.length);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.mean(a.liteRtTensorHandle, axesArray, keepDims);
  return new Tensor(resultHandle, a.environment);
}
function normalizeAxes(axes, rank) {
  if (axes === void 0) {
    return Array.from({ length: rank }, (_, i) => i);
  }
  const axesArray = typeof axes === "number" ? [axes] : axes;
  return axesArray.map((axis) => axis < 0 ? axis + rank : axis);
}
function sum(a, axes, keepDims = false) {
  a.ensureNotDeleted();
  const axesArray = normalizeAxes(axes, a.type.layout.dimensions.length);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.sum(a.liteRtTensorHandle, axesArray, keepDims);
  return new Tensor(resultHandle, a.environment);
}
function reduceMax(a, axes, keepDims = false) {
  a.ensureNotDeleted();
  let axesArray;
  if (axes === void 0) {
    const rank = a.type.layout.dimensions.length;
    axesArray = Array.from({ length: rank }, (_, i) => i);
  } else if (typeof axes === "number") {
    axesArray = [axes];
  } else {
    axesArray = axes;
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.reduceMax(a.liteRtTensorHandle, axesArray, keepDims);
  return new Tensor(resultHandle, a.environment);
}
function argMax(a, axis = 0, outputType = "int32") {
  a.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.argMax(a.liteRtTensorHandle, axis, outputType);
  return new Tensor(resultHandle, a.environment);
}
function resizeBilinear(input, size, alignCornersOrOptions, halfPixelCenters) {
  input.ensureNotDeleted();
  let alignCorners = false;
  let halfPixel = false;
  if (typeof alignCornersOrOptions === "boolean") {
    alignCorners = alignCornersOrOptions;
    halfPixel = halfPixelCenters ?? false;
  } else if (alignCornersOrOptions) {
    alignCorners = alignCornersOrOptions.alignCorners ?? false;
    halfPixel = alignCornersOrOptions.halfPixelCenters ?? false;
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.resizeBilinear(
    input.liteRtTensorHandle,
    Array.from(size),
    alignCorners,
    halfPixel
  );
  return new Tensor(resultHandle, input.environment);
}
function resizeNearestNeighbor(input, size, alignCornersOrOptions, halfPixelCenters) {
  input.ensureNotDeleted();
  let alignCorners = false;
  let halfPixel = false;
  if (typeof alignCornersOrOptions === "boolean") {
    alignCorners = alignCornersOrOptions;
    halfPixel = halfPixelCenters ?? false;
  } else if (alignCornersOrOptions) {
    alignCorners = alignCornersOrOptions.alignCorners ?? false;
    halfPixel = alignCornersOrOptions.halfPixelCenters ?? false;
  }
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.resizeNearestNeighbor(
    input.liteRtTensorHandle,
    Array.from(size),
    alignCorners,
    halfPixel
  );
  return new Tensor(resultHandle, input.environment);
}
function parsePoolParams(filterSizeOrOptions, strides, padding) {
  let filterHeight = 2;
  let filterWidth = 2;
  let strideH = 2;
  let strideW = 2;
  let paddingVal = 0;
  if (typeof filterSizeOrOptions === "object" && !Array.isArray(filterSizeOrOptions)) {
    const opts = filterSizeOrOptions;
    if (opts.filterSize !== void 0) {
      if (Array.isArray(opts.filterSize)) {
        filterHeight = opts.filterSize[0];
        filterWidth = opts.filterSize[1];
      } else {
        filterHeight = opts.filterSize;
        filterWidth = opts.filterSize;
      }
    }
    if (opts.filterHeight !== void 0) filterHeight = opts.filterHeight;
    if (opts.filterWidth !== void 0) filterWidth = opts.filterWidth;
    if (opts.strides !== void 0) {
      if (Array.isArray(opts.strides)) {
        strideH = opts.strides[0];
        strideW = opts.strides[1];
      } else {
        strideH = opts.strides;
        strideW = opts.strides;
      }
    } else {
      strideH = filterHeight;
      strideW = filterWidth;
    }
    if (opts.strideH !== void 0) strideH = opts.strideH;
    if (opts.strideW !== void 0) strideW = opts.strideW;
    paddingVal = parsePadding(opts.padding);
  } else {
    if (filterSizeOrOptions !== void 0) {
      if (Array.isArray(filterSizeOrOptions)) {
        filterHeight = filterSizeOrOptions[0];
        filterWidth = filterSizeOrOptions[1];
      } else {
        filterHeight = filterSizeOrOptions;
        filterWidth = filterSizeOrOptions;
      }
    }
    if (strides !== void 0) {
      if (Array.isArray(strides)) {
        strideH = strides[0];
        strideW = strides[1];
      } else {
        strideH = strides;
        strideW = strides;
      }
    } else {
      strideH = filterHeight;
      strideW = filterWidth;
    }
    paddingVal = parsePadding(padding);
  }
  return { filterHeight, filterWidth, strideH, strideW, paddingVal };
}
function maxPool2d(input, filterSizeOrOptions, strides, padding) {
  input.ensureNotDeleted();
  const { filterHeight, filterWidth, strideH, strideW, paddingVal } = parsePoolParams(filterSizeOrOptions, strides, padding);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.maxPool2d(
    input.liteRtTensorHandle,
    filterHeight,
    filterWidth,
    strideH,
    strideW,
    paddingVal
  );
  return new Tensor(resultHandle, input.environment);
}
function avgPool2d(input, filterSizeOrOptions, strides, padding) {
  input.ensureNotDeleted();
  const { filterHeight, filterWidth, strideH, strideW, paddingVal } = parsePoolParams(filterSizeOrOptions, strides, padding);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.avgPool2d(
    input.liteRtTensorHandle,
    filterHeight,
    filterWidth,
    strideH,
    strideW,
    paddingVal
  );
  return new Tensor(resultHandle, input.environment);
}
function transposeConv2d(input, filter, outputShape, options = {}) {
  ensureTensorsOk(
    options.bias ? [input, filter, options.bias] : [input, filter]
  );
  let strideH = 1;
  let strideW = 1;
  if (options.strides !== void 0) {
    if (Array.isArray(options.strides)) {
      strideH = options.strides[0];
      strideW = options.strides[1];
    } else {
      strideH = options.strides;
      strideW = options.strides;
    }
  }
  if (options.strideH !== void 0) strideH = options.strideH;
  if (options.strideW !== void 0) strideW = options.strideW;
  const padding = parsePadding(options.padding);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.transposeConv2d(
    input.liteRtTensorHandle,
    filter.liteRtTensorHandle,
    Array.from(outputShape),
    options.bias?.liteRtTensorHandle,
    strideH,
    strideW,
    padding
  );
  return new Tensor(resultHandle, input.environment);
}
function gather(input, indices, axis = 0, batchDims = 0) {
  ensureTensorsOk([input, indices]);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.gather(
    input.liteRtTensorHandle,
    indices.liteRtTensorHandle,
    axis,
    batchDims
  );
  return new Tensor(resultHandle, input.environment);
}
function gatherNd(input, indices) {
  ensureTensorsOk([input, indices]);
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.gatherNd(
    input.liteRtTensorHandle,
    indices.liteRtTensorHandle
  );
  return new Tensor(resultHandle, input.environment);
}
function oneHot(indices, depth, onValue = 1, offValue = 0, axis = -1) {
  indices.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.oneHot(
    indices.liteRtTensorHandle,
    depth,
    onValue,
    offValue,
    axis
  );
  return new Tensor(resultHandle, indices.environment);
}
var embeddingLookup = makeBinOp((wasm, weights, ids) => wasm.embeddingLookup(weights, ids));
function topK(input, k) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const handles = wasm.topK(input.liteRtTensorHandle, k);
  return {
    values: new Tensor(handles[0], input.environment),
    indices: new Tensor(handles[1], input.environment)
  };
}
function nonMaxSuppression(boxes, scores, maxOutputSize, options = {}) {
  ensureTensorsOk([boxes, scores]);
  const iouThreshold = options.iouThreshold ?? 0.5;
  const scoreThreshold = options.scoreThreshold ?? 0;
  const softNmsSigma = options.softNmsSigma ?? 0;
  const wasm = getGlobalLiteRt().liteRtWasm;
  const handles = wasm.nonMaxSuppressionV5(
    boxes.liteRtTensorHandle,
    scores.liteRtTensorHandle,
    maxOutputSize,
    iouThreshold,
    scoreThreshold,
    softNmsSigma
  );
  return {
    selectedIndices: new Tensor(handles[0], boxes.environment),
    selectedScores: new Tensor(handles[1], boxes.environment),
    validOutputs: new Tensor(handles[2], boxes.environment)
  };
}
function cumsum(input, axis = 0, exclusive = false, reverse2 = false) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.cumsum(
    input.liteRtTensorHandle,
    axis,
    exclusive,
    reverse2
  );
  return new Tensor(resultHandle, input.environment);
}
function reverse(input, axes) {
  input.ensureNotDeleted();
  const axesArray = typeof axes === "number" ? [axes] : axes;
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.reverse(input.liteRtTensorHandle, axesArray);
  return new Tensor(resultHandle, input.environment);
}
function spaceToDepth(input, blockSize) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.spaceToDepth(input.liteRtTensorHandle, blockSize);
  return new Tensor(resultHandle, input.environment);
}
function depthToSpace(input, blockSize) {
  input.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.depthToSpace(input.liteRtTensorHandle, blockSize);
  return new Tensor(resultHandle, input.environment);
}
var pRelu = makeBinOp(
  (wasm, input, alpha) => wasm.prelu(input, alpha)
);
function dynamicUpdateSlice(operand, update, startIndices) {
  operand.ensureNotDeleted();
  update.ensureNotDeleted();
  const wasm = getGlobalLiteRt().liteRtWasm;
  const resultHandle = wasm.dynamicUpdateSlice(
    operand.liteRtTensorHandle,
    update.liteRtTensorHandle,
    startIndices
  );
  return new Tensor(resultHandle, operand.environment);
}
var abs = makeUnaryOp(
  (wasm, a) => wasm.abs(a)
);
var neg = makeUnaryOp(
  (wasm, a) => wasm.neg(a)
);
var sqrt = makeUnaryOp(
  (wasm, a) => wasm.sqrt(a)
);
var rsqrt = makeUnaryOp(
  (wasm, a) => wasm.rsqrt(a)
);
var exp = makeUnaryOp(
  (wasm, a) => wasm.exp(a)
);
var log = makeUnaryOp(
  (wasm, a) => wasm.log(a)
);
var sin = makeUnaryOp(
  (wasm, a) => wasm.sin(a)
);
var cos = makeUnaryOp(
  (wasm, a) => wasm.cos(a)
);
var ceil = makeUnaryOp(
  (wasm, a) => wasm.ceil(a)
);
var floor = makeUnaryOp(
  (wasm, a) => wasm.floor(a)
);
var round = makeUnaryOp(
  (wasm, a) => wasm.round(a)
);

// src/signature_runner.ts
function shapesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
var CompiledModelSignatureRunner = class {
  constructor(signatureIndex, liteRtModel, liteRtCompiledModel, options) {
    this.signatureIndex = signatureIndex;
    this.liteRtModel = liteRtModel;
    this.liteRtCompiledModel = liteRtCompiledModel;
    this.options = options;
    this.liteRtSimpleSignature = liteRtModel.getSignature(signatureIndex);
    const inputNames = emscriptenVectorToArray(this.liteRtSimpleSignature.inputNames());
    const inputDetails = [];
    for (let i = 0; i < inputNames.length; i++) {
      const name = inputNames[i];
      const tensorType = liteRtModel.getInputTensorType(signatureIndex, i);
      const requirements = liteRtCompiledModel.getInputBufferRequirements(signatureIndex, i);
      inputDetails.push(makeTensorDetails(name, i, tensorType, requirements));
    }
    this.inputDetails = Object.freeze(inputDetails);
    const outputNames = emscriptenVectorToArray(this.liteRtSimpleSignature.outputNames());
    const outputDetails = [];
    for (let i = 0; i < outputNames.length; i++) {
      const name = outputNames[i];
      const tensorType = liteRtModel.getOutputTensorType(signatureIndex, i);
      const requirements = liteRtCompiledModel.getOutputBufferRequirements(signatureIndex, i);
      outputDetails.push(makeTensorDetails(name, i, tensorType, requirements));
    }
    this.outputDetails = Object.freeze(outputDetails);
  }
  inputDetails;
  outputDetails;
  liteRtSimpleSignature;
  deletedInternal = false;
  /**
   * The string key corresponding to this signature in the model.
   */
  get key() {
    this.ensureNotDeleted();
    return this.liteRtSimpleSignature.key();
  }
  /**
   * Get details about each input tensor.
   */
  getInputDetails() {
    this.ensureNotDeleted();
    return this.inputDetails;
  }
  /**
   * Get details about each output tensor.
   */
  getOutputDetails() {
    this.ensureNotDeleted();
    return this.outputDetails;
  }
  async run(input) {
    this.ensureNotDeleted();
    const inputArray = this.inputsToArray(input);
    const { inputsOnAccelerator, cleanup } = await this.ensureInputsOnAccelerator(inputArray);
    let outputArray;
    try {
      outputArray = await this.runWithArray(inputsOnAccelerator);
    } finally {
      cleanup();
    }
    if (Array.isArray(input) || input instanceof Tensor) {
      return outputArray;
    } else {
      return this.outputsToRecord(outputArray);
    }
  }
  inputsToArray(input) {
    if (Array.isArray(input)) {
      if (input.length !== this.inputDetails.length) {
        throw new Error(
          `run() called with ${input.length} inputs, but signature expects ${this.inputDetails.length} inputs`
        );
      }
      return input;
    }
    if (input instanceof Tensor) {
      if (this.inputDetails.length !== 1) {
        throw new Error(
          `run() called with a single tensor, but signature expects ${this.inputDetails.length} inputs`
        );
      }
      return [input];
    }
    const inputArray = [];
    for (const inputDetails of this.inputDetails) {
      if (!(inputDetails.name in input)) {
        throw new Error(
          `run() called with input record that is missing input ${inputDetails.name} with index ${inputDetails.index}`
        );
      }
      inputArray.push(input[inputDetails.name]);
    }
    return inputArray;
  }
  outputsToRecord(output) {
    const outputRecord = {};
    for (let i = 0; i < this.outputDetails.length; i++) {
      outputRecord[this.outputDetails[i].name] = output[i];
    }
    return outputRecord;
  }
  /**
   * Ensures that all input tensors are on the correct accelerator. Copies any
   * tensors that are not on the correct accelerator.
   *
   * @param inputs The input tensors to be passed to the signature. They must
   *     be in the same order and quantity as the input details.
   * @return A promise that resolves to a list of input tensors that are on the
   *     correct accelerator, and a cleanup function that deletes any tensors
   *     that were copied.
   */
  async ensureInputsOnAccelerator(inputs) {
    const toDelete = [];
    const inputsOnAccelerator = [];
    const inputDetails = this.getInputDetails();
    if (inputs.length !== inputDetails.length) {
      throw new Error(`ensureInputsOnAccelerator() called with ${inputs.length} inputs, but signature expects ${inputDetails.length} inputs`);
    }
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const bufferType = input.getBufferType();
      const supportedBufferTypes = inputDetails[i].supportedBufferTypes;
      if (supportedBufferTypes.size === 0) {
        throw new Error(`Tensor ${inputDetails[i].name} with index ${inputDetails[i].index} has no supported buffer types.`);
      }
      if (input.type.dtype !== inputDetails[i].dtype || !shapesEqual(input.type.layout.dimensions, inputDetails[i].shape)) {
        const expectedTypeStr = `${inputDetails[i].dtype}[${Array.from(inputDetails[i].shape).join(", ")}]`;
        throw new Error(
          `TensorBuffer ranked tensor type ${input.toString()} does not match expected ranked tensor type ${expectedTypeStr}`
        );
      }
      if (supportedBufferTypes.has(bufferType)) {
        inputsOnAccelerator.push(input);
      } else {
        const newBufferType = supportedBufferTypes.values().next().value;
        const copy = await input.copyTo(newBufferType);
        toDelete.push(copy);
        inputsOnAccelerator.push(copy);
      }
    }
    return {
      inputsOnAccelerator,
      cleanup: () => {
        for (const tensor of toDelete) {
          tensor.delete();
        }
      }
    };
  }
  async runWithArray(input) {
    for (let i = 0; i < input.length; i++) {
      const inputTensor = input[i];
      const expectedRankedTensorType = this.liteRtModel.getInputTensorType(this.signatureIndex, i);
      const inputRequirements = this.liteRtCompiledModel.getInputBufferRequirements(
        this.signatureIndex,
        i
      );
      getGlobalLiteRt().liteRtWasm.checkTensorBufferCompatible(
        inputTensor.liteRtTensorHandle,
        expectedRankedTensorType,
        inputRequirements
      );
      expectedRankedTensorType.delete();
      inputRequirements.delete();
    }
    const outputTensorHandles = await this.liteRtCompiledModel.run(
      this.signatureIndex,
      input.map((tensor) => tensor.liteRtTensorHandle)
    );
    return outputTensorHandles.map(
      (tensorHandle) => new Tensor(tensorHandle, this.options.environment)
    );
  }
  get deleted() {
    return this.deletedInternal;
  }
  ensureNotDeleted() {
    if (this.deleted) {
      throw new Error(
        "CompiledModelSignatureRunner is deleted and cannot be used."
      );
    }
  }
  delete() {
    if (this.deletedInternal) {
      return;
    }
    this.deletedInternal = true;
    this.liteRtSimpleSignature.delete();
  }
};
function makeTensorDetails(name, index, tensorType, requirements) {
  const layout = tensorType.layout();
  const dimensions = emscriptenVectorToArray(layout.dimensions());
  layout.delete();
  const supportedBufferTypes = new Set(emscriptenVectorToArray(requirements.supportedTypes()).map(({ value }) => value));
  const details = {
    name,
    index,
    dtype: getDataType(tensorType.elementType().value).dtype,
    shape: new Int32Array(dimensions),
    supportedBufferTypes
  };
  tensorType.delete();
  requirements.delete();
  return details;
}

// src/compiled_model.ts
var CompiledModel = class {
  constructor(model, liteRtCompiledModel, options, onDelete) {
    this.model = model;
    this.liteRtCompiledModel = liteRtCompiledModel;
    this.options = options;
    this.onDelete = onDelete;
    const numSignatures = model.liteRtModel.getNumSignatures();
    const compiledModelSignatureRunners = {};
    for (let i = 0; i < numSignatures; i++) {
      const compiledModelSignatureRunner = new CompiledModelSignatureRunner(
        i,
        model.liteRtModel,
        liteRtCompiledModel,
        options
      );
      compiledModelSignatureRunners[compiledModelSignatureRunner.key] = compiledModelSignatureRunner;
    }
    this.compiledModelSignatureRunners = Object.freeze(compiledModelSignatureRunners);
    this.defaultSignature = Object.values(this.signatures)[0];
    this.key = this.defaultSignature.key;
  }
  defaultSignature;
  compiledModelSignatureRunners;
  key;
  deletedInternal = false;
  get signatures() {
    this.ensureNotDeleted();
    return this.compiledModelSignatureRunners;
  }
  getInputDetails() {
    this.ensureNotDeleted();
    return this.defaultSignature.getInputDetails();
  }
  getOutputDetails() {
    this.ensureNotDeleted();
    return this.defaultSignature.getOutputDetails();
  }
  async run(inputOrSignatureName, maybeInput) {
    this.ensureNotDeleted();
    const [signature, input] = this.parseRunInputs(inputOrSignatureName, maybeInput);
    return await signature.run(input);
  }
  parseRunInputs(inputOrSignatureName, maybeInput) {
    let signature;
    let input;
    if (typeof inputOrSignatureName === "string") {
      signature = this.signatures[inputOrSignatureName];
      if (!signature) {
        throw new Error(
          `No signature named ${inputOrSignatureName} found in model.`
        );
      }
      if (!maybeInput) {
        throw new Error(
          `No input provided for signature ${inputOrSignatureName}`
        );
      }
      input = maybeInput;
    } else {
      signature = this.defaultSignature;
      input = inputOrSignatureName;
    }
    return [signature, input];
  }
  get deleted() {
    return this.deletedInternal;
  }
  ensureNotDeleted() {
    if (this.deleted) {
      throw new Error("CompiledModel is deleted and cannot be used.");
    }
  }
  get isFullyAccelerated() {
    this.ensureNotDeleted();
    return this.liteRtCompiledModel.isFullyAccelerated();
  }
  delete() {
    if (this.deletedInternal) {
      return;
    }
    this.deletedInternal = true;
    this.liteRtCompiledModel.delete();
    this.model.delete();
    for (const signatureRunner of Object.values(
      this.compiledModelSignatureRunners
    )) {
      signatureRunner.delete();
    }
    this.onDelete();
  }
};

// src/load_utils.ts
async function urlToUint8Array(url) {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}
async function readableStreamDefaultReaderToUint8Array(reader) {
  let byteOffset = 0;
  let array = new Uint8Array(
    1024
    /* arbitrary starting size */
  );
  const MAX_ARRAY_SIZE = 2e9;
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      if (array.byteLength < byteOffset + value.byteLength) {
        if (byteOffset + value.byteLength > MAX_ARRAY_SIZE) {
          throw new Error(`Model is too large (> ${MAX_ARRAY_SIZE} bytes).`);
        }
        const newArray = new Uint8Array(Math.min(
          MAX_ARRAY_SIZE,
          Math.max(array.byteLength, value.byteLength) * 2
        ));
        newArray.set(array);
        array = newArray;
      }
      array.set(value, byteOffset);
      byteOffset += value.byteLength;
    }
    if (done) {
      break;
    }
  }
  return array.slice(0, byteOffset);
}

// src/model.ts
var Model = class {
  constructor(liteRtModel, onDelete) {
    this.liteRtModel = liteRtModel;
    this.onDelete = onDelete;
  }
  delete() {
    this.liteRtModel.delete();
    this.onDelete();
  }
};

// src/model_types.ts
function fillCompileOptions(compileOptions = {}, environment, defaultThreadCount) {
  return {
    environment,
    accelerator: compileOptions.accelerator ?? (environment.webGpuDevice ? "webgpu" : "wasm"),
    cpuOptions: compileOptions.cpuOptions ?? { numThreads: defaultThreadCount },
    gpuOptions: compileOptions.gpuOptions ?? {},
    webNNOptions: compileOptions.webNNOptions ?? {}
  };
}

// src/wasm_feature_detect.ts
var WASM_RELAXED_SIMD_CHECK = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  5,
  1,
  96,
  0,
  1,
  123,
  3,
  2,
  1,
  0,
  10,
  15,
  1,
  13,
  0,
  65,
  1,
  253,
  15,
  65,
  2,
  253,
  15,
  253,
  128,
  2,
  11
]);
var WASM_THREADS_CHECK = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  4,
  1,
  96,
  0,
  0,
  3,
  2,
  1,
  0,
  5,
  4,
  1,
  3,
  1,
  1,
  10,
  11,
  1,
  9,
  0,
  65,
  0,
  254,
  16,
  2,
  0,
  26,
  11
]);
var WASM_FEATURE_VALUES = {
  "relaxedSimd": void 0,
  "threads": void 0,
  "jspi": void 0,
  "webnn": void 0
};
function isJspiSupported() {
  return "Suspending" in WebAssembly;
}
function isWebNnSupported() {
  return typeof navigator !== "undefined" && !!navigator.ml;
}
async function tryWasm(wasm) {
  try {
    await WebAssembly.instantiate(wasm);
    return { supported: true };
  } catch (e) {
    return { supported: false, error: e };
  }
}
var WASM_FEATURE_CHECKS = {
  "relaxedSimd": () => {
    if (WASM_FEATURE_VALUES.relaxedSimd === void 0) {
      WASM_FEATURE_VALUES.relaxedSimd = tryWasm(WASM_RELAXED_SIMD_CHECK);
    }
    return WASM_FEATURE_VALUES.relaxedSimd;
  },
  "threads": () => {
    if (WASM_FEATURE_VALUES.threads === void 0) {
      try {
        if (typeof MessageChannel !== "undefined") {
          new MessageChannel().port1.postMessage(new SharedArrayBuffer(1));
        }
        WASM_FEATURE_VALUES.threads = tryWasm(WASM_THREADS_CHECK);
      } catch (e) {
        WASM_FEATURE_VALUES.threads = Promise.resolve({ supported: false, error: e });
      }
    }
    return WASM_FEATURE_VALUES.threads;
  },
  "jspi": () => {
    if (WASM_FEATURE_VALUES.jspi === void 0) {
      const supported = isJspiSupported();
      WASM_FEATURE_VALUES.jspi = Promise.resolve({
        supported,
        error: supported ? void 0 : new Error("JSPI is not supported")
      });
    }
    return WASM_FEATURE_VALUES.jspi;
  },
  "webnn": () => {
    if (WASM_FEATURE_VALUES.webnn === void 0) {
      const supported = isWebNnSupported();
      WASM_FEATURE_VALUES.webnn = Promise.resolve({
        supported,
        error: supported ? void 0 : new Error("WebNN is not supported")
      });
    }
    return WASM_FEATURE_VALUES.webnn;
  }
};
async function supportsFeature(feature) {
  const check = WASM_FEATURE_CHECKS[feature]?.();
  if (!check) {
    throw new Error(`Unknown feature: ${feature}`);
  }
  return (await check).supported;
}
async function throwIfFeatureNotSupported(feature) {
  const check = WASM_FEATURE_CHECKS[feature]?.();
  if (!check) {
    throw new Error(`Unknown feature: ${feature}`);
  }
  const result = await check;
  if (!result.supported) {
    throw result.error;
  }
}

// src/authored_model.ts
function isPlaceholderSpec(value) {
  return typeof value === "object" && value !== null && !(value instanceof Tensor) && "shape" in value && Array.isArray(value.shape) && (value.shape.length === 0 || typeof value.shape[0] === "number");
}
function normalizeCompileArgs(args) {
  if (args.length === 0) {
    throw new Error("compile() requires at least one input specification.");
  }
  if (args.length === 1) {
    const arg = args[0];
    if (typeof arg === "object" && arg !== null && !(arg instanceof Tensor) && !isPlaceholderSpec(arg) && "signatures" in arg) {
      const sigs = arg.signatures;
      if (Array.isArray(sigs)) {
        return sigs.map((item, idx) => {
          if (Array.isArray(item)) {
            return { name: `signature_${idx}`, rawInputs: item };
          } else if (typeof item === "object" && item !== null && "inputs" in item) {
            const rawInputs = Array.isArray(item.inputs) ? item.inputs : [item.inputs];
            return { name: item.name ?? `signature_${idx}`, rawInputs };
          } else {
            return { name: `signature_${idx}`, rawInputs: [item] };
          }
        });
      } else if (typeof sigs === "object" && sigs !== null) {
        return Object.keys(sigs).map((name) => {
          const val = sigs[name];
          const rawInputs = Array.isArray(val) ? val : [val];
          return { name, rawInputs };
        });
      }
    }
    if (Array.isArray(arg)) {
      const isMultiSig = arg.length > 0 && arg.every(
        (item) => Array.isArray(item) || typeof item === "object" && item !== null && !(item instanceof Tensor) && !isPlaceholderSpec(item) && "inputs" in item
      );
      if (isMultiSig) {
        return arg.map((item, idx) => {
          if (Array.isArray(item)) {
            return { name: `signature_${idx}`, rawInputs: item };
          } else {
            const rawInputs = Array.isArray(item.inputs) ? item.inputs : [item.inputs];
            return { name: item.name ?? `signature_${idx}`, rawInputs };
          }
        });
      }
    }
    if (typeof arg === "object" && arg !== null && !(arg instanceof Tensor) && !isPlaceholderSpec(arg) && !Array.isArray(arg)) {
      const keys = Object.keys(arg);
      const isDictInput = keys.every(
        (k) => arg[k] instanceof Tensor || isPlaceholderSpec(arg[k])
      );
      if (!isDictInput && keys.length > 0) {
        return keys.map((name) => {
          const val = arg[name];
          const rawInputs = Array.isArray(val) ? val : [val];
          return { name, rawInputs };
        });
      }
    }
  }
  return [{ name: "serving_default", rawInputs: args }];
}
var AuthoredModel = class {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.options = options;
  }
  compiledModels = [];
  compilationPromise;
  cacheKeyToSignature = /* @__PURE__ */ new Map();
  deletedInternal = false;
  get compiledModel() {
    return this.compiledModels.length > 0 ? this.compiledModels[this.compiledModels.length - 1] : void 0;
  }
  get deleted() {
    return this.deletedInternal;
  }
  ensureNotDeleted() {
    if (this.deletedInternal) {
      throw new Error("AuthoredModel is deleted and cannot be used.");
    }
  }
  parseInputs(args, requireTensors) {
    let rawInputs = [];
    let isSingleInput = false;
    let isArrayInput = false;
    let isDictInput = false;
    let dictKeys = [];
    if (args.length === 1) {
      const first = args[0];
      if (first instanceof Tensor || isPlaceholderSpec(first)) {
        rawInputs = [first];
        isSingleInput = true;
      } else if (Array.isArray(first)) {
        rawInputs = first;
        isArrayInput = true;
      } else if (typeof first === "object" && first !== null) {
        dictKeys = Object.keys(first).sort();
        rawInputs = dictKeys.map((k) => first[k]);
        isDictInput = true;
      }
    } else {
      rawInputs = args;
    }
    const inputTensors = [];
    const normalizedInputs = [];
    for (let i = 0; i < rawInputs.length; i++) {
      const item = rawInputs[i];
      if (item instanceof Tensor) {
        inputTensors.push(item);
        normalizedInputs.push({
          shape: item.type.layout.dimensions,
          dtype: item.type.dtype
        });
      } else if (!requireTensors && isPlaceholderSpec(item)) {
        const dtype = item.dataType ?? "float32";
        normalizedInputs.push({
          shape: item.shape,
          dtype
        });
      } else {
        const expected = requireTensors ? "Tensor" : "Tensor or PlaceholderSpec ({ shape: Dimensions, dataType?: DType })";
        throw new Error(`Input at index ${i} is not a valid ${expected}.`);
      }
    }
    const cacheKey = isDictInput ? dictKeys.map(
      (k, i) => `${k}:${normalizedInputs[i].dtype}[${normalizedInputs[i].shape.join(",")}]`
    ).join(";") : normalizedInputs.map((n) => `${n.dtype}[${n.shape.join(",")}]`).join(";");
    return {
      normalizedInputs,
      inputTensors: requireTensors ? inputTensors : void 0,
      cacheKey,
      isSingleInput,
      isArrayInput,
      isDictInput,
      dictKeys
    };
  }
  async compileSignaturesInternal(specs) {
    const globalLiteRt2 = getGlobalLiteRt();
    const liteRtWasm = globalLiteRt2.liteRtWasm;
    const environment = this.options.environment ?? globalLiteRt2.getDefaultEnvironment();
    const parsedSignatures = [];
    const batchSeenKeys = /* @__PURE__ */ new Set();
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const parsed = this.parseInputs(
        spec.rawInputs,
        /* requireTensors= */
        false
      );
      if (batchSeenKeys.has(parsed.cacheKey)) {
        throw new Error(
          `Duplicate signature input specification for '${parsed.cacheKey}'. Each signature in a compile call must have distinct input shapes or dtypes.`
        );
      }
      batchSeenKeys.add(parsed.cacheKey);
      const sigName = spec.name ?? (specs.length === 1 ? "serving_default" : `signature_${i}`);
      parsedSignatures.push({ name: sigName, parsed });
    }
    const wasmSignatureSpecs = [];
    const allPlaceholders = [];
    const allOutputs = [];
    let modelDataPtr = 0;
    let modelSize = 0;
    const signatureOutputsMeta = [];
    try {
      for (const { name, parsed } of parsedSignatures) {
        const placeholders = parsed.normalizedInputs.map(
          (norm, idx) => {
            const placeholderName = parsed.isDictInput ? parsed.dictKeys[idx] : `input_${idx}`;
            return Tensor.createPlaceholder({
              shape: norm.shape,
              dataType: norm.dtype,
              environment,
              name: placeholderName
            });
          }
        );
        allPlaceholders.push(...placeholders);
        let symbolicOutputs;
        if (parsed.isSingleInput) {
          symbolicOutputs = this.fn(placeholders[0]);
        } else if (parsed.isArrayInput) {
          symbolicOutputs = this.fn(placeholders);
        } else if (parsed.isDictInput) {
          const dictArg = {};
          parsed.dictKeys.forEach((k, idx) => {
            dictArg[k] = placeholders[idx];
          });
          symbolicOutputs = this.fn(dictArg);
        } else {
          symbolicOutputs = this.fn(...placeholders);
        }
        let outputTensors = [];
        let outputFormat = "single";
        let outputDictKeys;
        if (symbolicOutputs instanceof Tensor) {
          outputTensors = [symbolicOutputs];
          outputFormat = "single";
        } else if (Array.isArray(symbolicOutputs)) {
          outputTensors = symbolicOutputs;
          outputFormat = "array";
        } else if (typeof symbolicOutputs === "object" && symbolicOutputs !== null) {
          outputDictKeys = Object.keys(symbolicOutputs);
          outputTensors = outputDictKeys.map((k) => symbolicOutputs[k]);
          outputFormat = "dict";
        } else {
          throw new Error(
            "AuthoredModel function must return a Tensor, Tensor[], or Record<string, Tensor>."
          );
        }
        for (let i = 0; i < outputTensors.length; i++) {
          if (!(outputTensors[i] instanceof Tensor)) {
            throw new Error(
              `Output at index ${i} for signature '${name}' is not a Tensor.`
            );
          }
        }
        allOutputs.push(...outputTensors);
        wasmSignatureSpecs.push({
          name,
          inputHandles: placeholders.map((p) => p.liteRtTensorHandle),
          outputHandles: outputTensors.map((o) => o.liteRtTensorHandle)
        });
        signatureOutputsMeta.push({
          outputFormat,
          outputDictKeys
        });
      }
      const modelData = liteRtWasm.createModelDataFromTensorGraph(wasmSignatureSpecs);
      modelDataPtr = modelData.modelDataPtr;
      modelSize = modelData.modelSize;
    } finally {
      for (const p of allPlaceholders) {
        p.delete();
      }
      for (const o of allOutputs) {
        o.delete();
      }
    }
    const wasmModel = liteRtWasm.loadModel(
      environment.liteRtEnvironment,
      modelDataPtr,
      modelSize
    );
    const filledCompileOptions = fillCompileOptions(
      this.options,
      environment,
      liteRtWasm.getThreadCount()
    );
    let wasmCompiledModel;
    try {
      wasmCompiledModel = await liteRtWasm.compileModel(
        environment.liteRtEnvironment,
        wasmModel,
        filledCompileOptions
      );
    } catch (e) {
      liteRtWasm._free(modelDataPtr);
      wasmModel.delete();
      throw e;
    }
    const loadedModel = new Model(wasmModel, () => {
      liteRtWasm._free(modelDataPtr);
    });
    const compiledModel = new CompiledModel(
      loadedModel,
      wasmCompiledModel,
      filledCompileOptions,
      () => {
      }
    );
    this.compiledModels.push(compiledModel);
    for (let i = 0; i < parsedSignatures.length; i++) {
      const { name, parsed } = parsedSignatures[i];
      const meta = signatureOutputsMeta[i];
      this.cacheKeyToSignature.set(parsed.cacheKey, {
        compiledModel,
        signatureName: name,
        cacheKey: parsed.cacheKey,
        outputFormat: meta.outputFormat,
        outputDictKeys: meta.outputDictKeys
      });
    }
    return compiledModel;
  }
  /**
   * Compiles the model graph ahead of time into a CompiledModel.
   *
   * Can be invoked with:
   * 1. A single signature (e.g. `compile({ shape: [1, 256, 256, 3] })` or `compile(specA, specB)`)
   * 2. Multiple signatures as an array of input tuples (e.g. `compile([ [{shape: [1, 10]}], [{shape: [4, 10]}] ])`)
   * 3. Multiple named signatures as a dictionary (e.g. `compile({ lowRes: [{shape: [1, 10]}], highRes: [{shape: [4, 10]}] })`)
   *
   * When multiple signatures are provided in a single compile() call, they share the same constant weight buffers.
   * Multiple compile() calls are permitted; each call generates a new CompiledModel.
   */
  async compile(...args) {
    this.ensureNotDeleted();
    const specs = normalizeCompileArgs(args);
    if (specs.length === 1 && specs[0].name === "signature_0") {
      specs[0].name = "serving_default";
    }
    this.compilationPromise = this.compileSignaturesInternal(specs);
    await this.compilationPromise;
  }
  /**
   * Returns true if a compiled signature exists in the model for the given input specs or tensors.
   */
  hasCompiledSignature(...args) {
    this.ensureNotDeleted();
    if (this.compiledModels.length === 0) {
      return false;
    }
    const { cacheKey } = this.parseInputs(
      args,
      /* requireTensors= */
      false
    );
    return this.cacheKeyToSignature.has(cacheKey);
  }
  /**
   * Executes the authored tensor model with concrete inputs.
   *
   * If the input shape/type has not been compiled yet, it is compiled silently under the hood
   * with a notice logged to the console.
   */
  async run(...args) {
    this.ensureNotDeleted();
    const parsed = this.parseInputs(
      args,
      /* requireTensors= */
      true
    );
    if (this.compilationPromise) {
      await this.compilationPromise;
    }
    this.ensureNotDeleted();
    let signature = this.cacheKeyToSignature.get(parsed.cacheKey);
    if (!signature) {
      console.log(
        `[LiteRT] JIT compiling model for input shape/type '${parsed.cacheKey}' under the hood...`
      );
      this.compilationPromise = this.compileSignaturesInternal([
        { name: "serving_default", rawInputs: args }
      ]);
      await this.compilationPromise;
      signature = this.cacheKeyToSignature.get(parsed.cacheKey);
    }
    const rawOutputs = await signature.compiledModel.run(
      signature.signatureName,
      parsed.inputTensors
    );
    switch (signature.outputFormat) {
      case "single":
        return rawOutputs[0];
      case "array":
        return rawOutputs;
      case "dict": {
        const result = {};
        signature.outputDictKeys.forEach((k, idx) => {
          result[k] = rawOutputs[idx];
        });
        return result;
      }
      default: {
        const exhaustiveCheck = signature.outputFormat;
        throw new Error(`Unhandled output format: ${exhaustiveCheck}`);
      }
    }
  }
  delete() {
    if (this.deletedInternal) {
      return;
    }
    this.deletedInternal = true;
    for (const model of this.compiledModels) {
      model.delete();
    }
    this.compiledModels.length = 0;
    this.cacheKeyToSignature.clear();
  }
};

// src/litert_web.ts
function isWebGPUSupported() {
  return !!(typeof globalThis !== "undefined" && globalThis.navigator && globalThis.navigator.gpu);
}
function getDefaultEnvironment() {
  return getGlobalLiteRt().getDefaultEnvironment();
}
function loadAndCompile(model, compileOptions) {
  return getGlobalLiteRt().loadAndCompile(model, compileOptions);
}
function author(fn, compileOptions) {
  return getGlobalLiteRt().author(fn, compileOptions);
}
function getWebGpuDevice() {
  return getGlobalLiteRt().getWebGpuDevice();
}
function setWebGpuDevice(device) {
  getGlobalLiteRt().setWebGpuDevice(device);
}
var LiteRt = class {
  liteRtWasm;
  defaultEnvironment;
  objectsToDelete = /* @__PURE__ */ new Set();
  constructor(wasmModule) {
    this.liteRtWasm = wasmModule;
    this.liteRtWasm.setupLogging();
  }
  setDefaultEnvironment(environment) {
    this.defaultEnvironment = environment;
  }
  getDefaultEnvironment() {
    if (!this.defaultEnvironment) {
      throw new Error("Default environment is not set.");
    }
    return this.defaultEnvironment;
  }
  setWebGpuDevice(device) {
    const oldEnvironment = this.getDefaultEnvironment();
    this.setDefaultEnvironment(new Environment({
      ...oldEnvironment.options,
      webGpuDevice: device
    }));
  }
  getWebGpuDevice() {
    return this.getDefaultEnvironment().webGpuDevice;
  }
  /**
   * Registers an object to be deleted when this LiteRt instance is deleted.
   * Internal use only.
   */
  _registerObjectForDeletion(object) {
    this.objectsToDelete.add(object);
  }
  /**
   * Unregisters an object from being deleted when this LiteRt instance is
   * deleted. Internal use only.
   */
  _unregisterObjectForDeletion(object) {
    this.objectsToDelete.delete(object);
  }
  /**
   * Loads and compiles a LiteRt model.
   *
   * @param model The model data. This can be a string (the model url), a URL
   *     object, a Uint8Array (the model bytes), or a
   *     ReadableStreamDefaultReader (for streaming model loading).
   * @param compileOptions The options for compiling the model. This includes
   *     the accelerator to use ('webgpu' or 'wasm') and the WebGPU device
   *     (for direct GPU model inputs / outputs).
   * @returns A promise that resolves to the CompiledModel.
   */
  async loadAndCompile(model, compileOptions = {}) {
    let modelData;
    if (typeof model === "string" || model instanceof URL) {
      modelData = await urlToUint8Array(model);
    } else if (model instanceof Uint8Array) {
      modelData = model;
    } else if (model instanceof ReadableStreamDefaultReader) {
      modelData = await readableStreamDefaultReaderToUint8Array(model);
    } else {
      throw new Error("Unsupported model type.");
    }
    const environment = compileOptions.environment ?? this.getDefaultEnvironment();
    const accelerator = compileOptions.accelerator ?? (environment.webGpuDevice ? "webgpu" : "wasm");
    const isWebGpu = accelerator === "webgpu";
    if (isWebGpu && !environment.webGpuDevice) {
      throw new Error(
        "WebGPU was requested but no WebGPU device is set in the environment."
      );
    }
    const filledCompileOptions = fillCompileOptions(
      compileOptions,
      environment,
      this.liteRtWasm.getThreadCount()
    );
    const ptr = this.liteRtWasm._malloc(modelData.byteLength) >>> 0;
    if (ptr === 0) {
      throw new Error(
        `Failed to allocate ${modelData.byteLength} bytes of Wasm memory for the model.`
      );
    }
    this.liteRtWasm.HEAPU8.set(modelData, ptr);
    const wasmModel = this.liteRtWasm.loadModel(
      filledCompileOptions.environment.liteRtEnvironment,
      ptr,
      modelData.byteLength
    );
    const wasmCompiledModel = await this.liteRtWasm.compileModel(
      filledCompileOptions.environment.liteRtEnvironment,
      wasmModel,
      filledCompileOptions
    );
    const loadedModel = new Model(wasmModel, () => {
      this.liteRtWasm._free(ptr);
    });
    const compiledModel = new CompiledModel(
      loadedModel,
      wasmCompiledModel,
      filledCompileOptions,
      () => {
        this.objectsToDelete.delete(compiledModel);
      }
    );
    this.objectsToDelete.add(compiledModel);
    const isWebNn = accelerator === "webnn";
    const acceleratorRequested = isWebGpu || isWebNn;
    if (acceleratorRequested && !compiledModel.isFullyAccelerated) {
      if (isJspiSupported()) {
        console.warn(
          `%c[LiteRT]%c Model not fully compiled for ${accelerator}. Partially delegating to WASM execution.`,
          "background: #FFA000; color: black; font-weight: bold; padding: 2px 5px; border-radius: 3px;",
          "font-weight: bold;"
        );
      } else {
        console.warn(
          `%c[LiteRT]%c Model not fully compiled for ${accelerator} on non-JSPI browser. Falling back to WASM execution.`,
          "background: #D32F2F; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;",
          "color: #D32F2F; font-weight: bold;"
        );
        compiledModel.delete();
        const fallbackCompileOptions = {
          ...compileOptions,
          accelerator: "wasm"
        };
        return this.loadAndCompile(modelData, fallbackCompileOptions);
      }
    }
    return compiledModel;
  }
  /**
   * Authors a tensor arithmetic function into an AuthoredModel.
   */
  author(fn, compileOptions = {}) {
    const environment = compileOptions.environment ?? this.getDefaultEnvironment();
    const model = new AuthoredModel(fn, { ...compileOptions, environment });
    this.objectsToDelete.add(model);
    return model;
  }
  delete() {
    for (const object of this.objectsToDelete) {
      object.delete();
    }
  }
};

// src/load.ts
import { createWasmLib } from "./wasm-utils.js";

// src/url_path_utils.ts
function pathToString(path) {
  return path;
}
function appendPathSegment(path, segment) {
  if (!path) return segment;
  if (!segment) return path;
  const pathWithSlash = path.endsWith("/") ? path : path + "/";
  const segmentWithoutSlash = segment.startsWith("/") ? segment.substring(1) : segment;
  return pathWithSlash + segmentWithoutSlash;
}

// src/load.ts
var WASM_JS_FILE_NAME = "litert_wasm_internal.js";
var WASM_JS_COMPAT_FILE_NAME = "litert_wasm_compat_internal.js";
var WASM_JS_THREADED_FILE_NAME = "litert_wasm_threaded_internal.js";
var WASM_JS_JSPI_FILE_NAME = "litert_wasm_jspi_internal.js";
async function load(path, options) {
  const pathString = pathToString(path);
  const isFullFilePath = pathString.endsWith(".wasm") || pathString.endsWith(".js");
  const relaxedSimd = await supportsFeature("relaxedSimd");
  if (options?.threads) {
    if (options?.jspi) {
      throw new Error(
        "The `threads` and `jspi` options are mutually exclusive."
      );
    }
    if (isFullFilePath) {
      console.warn(
        `The \`threads\` option was specified, but the wasm path ${pathString} is a full file path. Whether threads are available or not will depend on the loaded file. To allow LiteRT.js to load the threaded wasm file, use a directory path instead of a full file path.`
      );
    }
    if (!relaxedSimd) {
      throw new Error(
        "Threads are only supported with relaxed SIMD, and the current browser does not support relaxed SIMD."
      );
    }
    await throwIfFeatureNotSupported("threads");
  }
  if (options?.jspi) {
    if (isFullFilePath) {
      console.warn(
        `The \`jspi\` option was specified, but the wasm path ${pathString} is a full file path. Whether JSPI is available or not will depend on the loaded file. To allow LiteRT.js to load the JSPI wasm file, use a directory path instead of a full file path.`
      );
    }
    await throwIfFeatureNotSupported("jspi");
  }
  let fileName = WASM_JS_COMPAT_FILE_NAME;
  if (relaxedSimd) {
    if (options?.threads) {
      fileName = WASM_JS_THREADED_FILE_NAME;
    } else if (options?.jspi) {
      fileName = WASM_JS_JSPI_FILE_NAME;
    } else {
      fileName = WASM_JS_FILE_NAME;
    }
  }
  let jsFilePath = path;
  if (pathString.endsWith(".wasm")) {
    throw new Error(
      "Please load the `.js` file corresponding to the `.wasm` file, or load the directory containing it."
    );
  } else if (!pathString.endsWith(".js")) {
    jsFilePath = appendPathSegment(path, fileName);
  }
  return createWasmLib(LiteRt, jsFilePath);
}

// src/load_litert.ts
function loadLiteRt(path, options) {
  if (hasGlobalLiteRtPromise()) {
    throw new Error("LiteRT is already loading / loaded.");
  }
  setGlobalLiteRtPromise(load(path, options).then(async (liteRt) => {
    setGlobalLiteRt(liteRt);
    liteRt.setDefaultEnvironment(
      await Environment.create()
    );
    return liteRt;
  }).catch((error) => {
    setGlobalLiteRtPromise(void 0);
    throw error;
  }));
  return getGlobalLiteRtPromise();
}
function unloadLiteRt() {
  if (hasGlobalLiteRtPromise() && !hasGlobalLiteRt()) {
    throw new Error(
      "LiteRT is loading and can not be unloaded or canceled until it is finished loading."
    );
  }
  if (hasGlobalLiteRt()) {
    getGlobalLiteRt().delete();
    setGlobalLiteRt(void 0);
  }
  setGlobalLiteRtPromise(void 0);
}

// src/streamed_loading.ts
var compilationLock = Promise.resolve();
async function loadModelAndWeights(modelData, weightsStream, compileOptions = {}) {
  const liteRt = getGlobalLiteRt();
  const wasm = liteRt.liteRtWasm;
  const env = compileOptions.environment ?? liteRt.getDefaultEnvironment();
  if (!env.webGpuDevice) {
    throw new Error(
      "WebGPU device is required for streamed loading in this implementation."
    );
  }
  const myTurn = compilationLock;
  let resolveLock;
  compilationLock = new Promise((resolve) => {
    resolveLock = resolve;
  });
  await myTurn;
  try {
    wasm.registerStreamWeightsCallback(async (queue, wasmRequests) => {
      try {
        const requests = [];
        try {
          const count = wasmRequests.size();
          for (let i = 0; i < count; i++) {
            requests.push(wasmRequests.get(i));
          }
        } finally {
          wasmRequests.delete();
        }
        requests.sort((a, b) => a.offset - b.offset);
        console.log(
          `[StreamWeights] Starting loading session for ${requests.length} tensors:`,
          JSON.stringify(requests)
        );
        const reader = weightsStream.getReader();
        let streamOffset = 0;
        let buffer = new Uint8Array(0);
        let reqIndex = 0;
        try {
          while (reqIndex < requests.length) {
            const req = requests[reqIndex];
            const relStart = req.offset - streamOffset;
            const relEnd = relStart + req.length;
            if (relEnd <= buffer.length) {
              if (relStart < 0) {
                throw new Error(
                  `Stream logic error: weight starts before current buffer (req.offset=${req.offset}, streamOffset=${streamOffset}).`
                );
              }
              let weightData = buffer.subarray(relStart, relEnd);
              if (weightData.byteLength % 4 !== 0) {
                const paddedSize = weightData.byteLength + 3 & ~3;
                const paddedData = new Uint8Array(paddedSize);
                paddedData.set(weightData);
                weightData = paddedData;
              }
              const gpuBuffer = wasm.WebGPU.getJsObject(req.wgpuBufferId);
              if (!gpuBuffer) {
                throw new Error(
                  `Failed to find GPUBuffer for ID: ${req.wgpuBufferId}`
                );
              }
              console.log(
                `[StreamWeights] Writing ${weightData.byteLength} bytes to GPUBuffer ${req.wgpuBufferId} (tflId=${req.tflId}, first 5 bytes=${Array.from(weightData.slice(0, 5))})`
              );
              queue.writeBuffer(gpuBuffer, 0, weightData);
              reqIndex++;
            } else {
              const { done, value } = await reader.read();
              if (done) {
                throw new Error(
                  `Stream ended before all weights were loaded.`
                );
              }
              const newBuffer = new Uint8Array(buffer.length + value.length);
              newBuffer.set(buffer);
              newBuffer.set(value, buffer.length);
              buffer = newBuffer;
            }
            if (reqIndex < requests.length) {
              const nextStartRel = requests[reqIndex].offset - streamOffset;
              const bytesToDiscard = Math.min(nextStartRel, buffer.length);
              if (bytesToDiscard > 1024 * 1024 || bytesToDiscard === buffer.length) {
                buffer = buffer.slice(bytesToDiscard);
                streamOffset += bytesToDiscard;
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        return true;
      } catch (e) {
        console.error("Error in streamWeightsOnWeb:", e);
        return false;
      }
    });
    try {
      const ptr = wasm._malloc(modelData.byteLength) >>> 0;
      if (ptr === 0) {
        throw new Error(
          `Failed to allocate ${modelData.byteLength} bytes of Wasm memory for the model.`
        );
      }
      wasm.HEAPU8.set(modelData, ptr);
      const wasmModel = wasm.loadModel(env.liteRtEnvironment, ptr, modelData.byteLength);
      const loadedModel = new Model(wasmModel, () => {
        wasm._free(ptr);
      });
      const fullOptions = fillCompileOptions(
        compileOptions,
        env,
        wasm.getThreadCount()
      );
      const wasmCompiledModel = await wasm.compileModel(
        env.liteRtEnvironment,
        wasmModel,
        fullOptions
      );
      const compiledModel = new CompiledModel(
        loadedModel,
        wasmCompiledModel,
        fullOptions,
        () => {
          liteRt._unregisterObjectForDeletion(compiledModel);
        }
      );
      liteRt._registerObjectForDeletion(compiledModel);
      return compiledModel;
    } finally {
      wasm.registerStreamWeightsCallback(void 0);
    }
  } finally {
    resolveLock();
  }
}

// src/cpu_copy_functions.ts
async function copyHostMemoryToHostMemory(cpuTensor, options = {}) {
  const environment = options.environment ?? cpuTensor.environment;
  const liteRtWasm = getGlobalLiteRt().liteRtWasm;
  const srcTensorHandle = cpuTensor.liteRtTensorHandle;
  const bufferType = srcTensorHandle.bufferType();
  if (bufferType.value !== TensorBufferType.HOST_MEMORY) {
    throw new Error(
      "Source tensor is not in host memory. Cannot copy to host memory."
    );
  }
  const srcTensorMemoryPtr = srcTensorHandle.lock(
    liteRtWasm.LiteRtTensorBufferLockMode.READ
  );
  let destTensorHandle;
  try {
    destTensorHandle = liteRtWasm.LiteRtTensorHandle.createManaged(
      environment.liteRtEnvironment,
      liteRtWasm.LiteRtTensorBufferType.HOST_MEMORY,
      srcTensorHandle.tensorType(),
      srcTensorHandle.size()
    );
    const destMemoryPointer = destTensorHandle.lock(
      liteRtWasm.LiteRtTensorBufferLockMode.WRITE
    );
    try {
      const srcTensorMemoryView = new Uint8Array(
        liteRtWasm.HEAPU8.buffer,
        srcTensorMemoryPtr,
        srcTensorHandle.size()
      );
      liteRtWasm.HEAPU8.set(srcTensorMemoryView, destMemoryPointer);
    } finally {
      destTensorHandle.unlock();
    }
  } finally {
    srcTensorHandle.unlock();
  }
  if (!destTensorHandle) {
    throw new Error("Failed to create destination tensor handle.");
  }
  return new Tensor(destTensorHandle, environment);
}

// src/gpu_copy_functions.ts
async function cpuTensorToGpuTensor(cpuTensor, options = {}) {
  const environment = options.environment ?? cpuTensor.environment;
  const device = environment.webGpuDevice;
  if (!device) {
    throw new Error(
      "No WebGPU device is available. Did you forget to pass a destination environment that has a WebGPU device?"
    );
  }
  const liteRtWasm = getGlobalLiteRt().liteRtWasm;
  const byteLength = cpuTensor.liteRtTensorHandle.size();
  const paddedByteLength = byteLength + 3 & ~3;
  const stagingBuffer = device.createBuffer({
    size: paddedByteLength,
    usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true
  });
  const mappedBuffer = await stagingBuffer.getMappedRange();
  const mappedArray = new Uint8Array(mappedBuffer);
  const cpuMemoryPtr = cpuTensor.liteRtTensorHandle.lock(
    liteRtWasm.LiteRtTensorBufferLockMode.READ
  );
  try {
    const cpuMemoryView = new Uint8Array(
      liteRtWasm.HEAPU8.buffer,
      cpuMemoryPtr,
      cpuTensor.liteRtTensorHandle.size()
    );
    mappedArray.set(cpuMemoryView);
  } finally {
    cpuTensor.liteRtTensorHandle.unlock();
  }
  stagingBuffer.unmap();
  const buffer = device.createBuffer({
    size: paddedByteLength,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(
    stagingBuffer,
    0,
    buffer,
    0,
    paddedByteLength
  );
  device.queue.submit([commandEncoder.finish()]);
  stagingBuffer.destroy();
  return new Tensor(
    buffer,
    cpuTensor.type.layout.dimensions,
    cpuTensor.type.dtype,
    environment,
    () => {
      buffer.destroy();
    }
  );
}
async function gpuTensorToCpuTensor(gpuTensor, options = {}) {
  const environment = options.environment ?? gpuTensor.environment;
  const device = gpuTensor.environment.webGpuDevice;
  if (!device) {
    throw new Error(
      "No WebGPU device is available. Does the source tensor have a WebGPU device?"
    );
  }
  const liteRtWasm = getGlobalLiteRt().liteRtWasm;
  const tensorHandle = gpuTensor.liteRtTensorHandle;
  const bufferType = tensorHandle.bufferType();
  if (bufferType !== liteRtWasm.LiteRtTensorBufferType.WEB_GPU_BUFFER_PACKED) {
    throw new Error(`Cannot convert a tensor with a non-WebGPU buffer type ${bufferType} to a CPU tensor.`);
  }
  const gpuBuffer = liteRtWasm.WebGPU.getJsObject(
    tensorHandle.getWebGpuBuffer()
  );
  const byteOffset = tensorHandle.offset();
  const tensorType = tensorHandle.tensorType();
  const layout = tensorType.layout();
  const numElements = layout.numElements();
  const elementTypeVal = tensorType.elementType().value;
  const arrayConstructor = getDataType(elementTypeVal).typedArrayConstructor;
  layout.delete();
  tensorType.delete();
  if (arrayConstructor === void 0) {
    throw new Error(
      `DType ${ElementTypeName[elementTypeVal]} is not supported in this environment (missing TypedArray constructor).`
    );
  }
  let mappableBuffer = gpuBuffer;
  let cleanupBuffer = () => {
  };
  if (!(gpuBuffer.usage & GPUBufferUsage.MAP_READ)) {
    mappableBuffer = device.createBuffer({
      size: gpuBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    cleanupBuffer = () => {
      mappableBuffer.destroy();
    };
    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      gpuBuffer,
      0,
      mappableBuffer,
      0,
      gpuBuffer.size
    );
    device.queue.submit([commandEncoder.finish()]);
  }
  await mappableBuffer.mapAsync(GPUMapMode.READ);
  const mappedBuffer = mappableBuffer.getMappedRange();
  const mappedArray = new arrayConstructor(mappedBuffer, byteOffset, numElements);
  const cpuTensor = new Tensor(mappedArray, gpuTensor.type.layout.dimensions, environment);
  mappableBuffer.unmap();
  cleanupBuffer();
  return cpuTensor;
}

// src/tensor_copy_functions.ts
function makeMoveTo(copyTo) {
  return async (tensor, options) => {
    const result = await copyTo(tensor, options);
    tensor.delete();
    return result;
  };
}
function registerCopyFunctions() {
  const hostMemoryDests = /* @__PURE__ */ new Map([
    [
      TensorBufferType.HOST_MEMORY,
      {
        copyTo: copyHostMemoryToHostMemory,
        moveTo: makeMoveTo(copyHostMemoryToHostMemory)
      }
    ],
    [
      TensorBufferType.WEB_GPU_BUFFER_PACKED,
      {
        copyTo: cpuTensorToGpuTensor,
        moveTo: makeMoveTo(cpuTensorToGpuTensor)
      }
    ]
  ]);
  Tensor.copyFunctions.set(TensorBufferType.HOST_MEMORY, hostMemoryDests);
  const webGpuDests = /* @__PURE__ */ new Map([
    [
      TensorBufferType.HOST_MEMORY,
      {
        copyTo: gpuTensorToCpuTensor,
        moveTo: makeMoveTo(gpuTensorToCpuTensor)
      }
    ]
  ]);
  Tensor.copyFunctions.set(TensorBufferType.WEB_GPU_BUFFER_PACKED, webGpuDests);
}

// src/index.ts
registerCopyFunctions();
export {
  AuthoredModel,
  CompiledModel,
  Environment,
  LiteRt,
  LiteRtNotLoadedError,
  Tensor,
  TensorBufferType,
  abs,
  add,
  argMax,
  author,
  avgPool2d,
  batchMatMul,
  ceil,
  concat,
  concatenation,
  conv2d,
  cos,
  cumsum,
  depthToSpace,
  depthwiseConv2d,
  div,
  dynamicUpdateSlice,
  elu,
  embeddingLookup,
  equal,
  exp,
  expandDims,
  floor,
  floorDiv,
  floorMod,
  fullyConnected,
  gather,
  gatherNd,
  gelu,
  getDefaultEnvironment,
  getGlobalLiteRt,
  getGlobalLiteRtPromise,
  getWebGpuDevice,
  greater,
  greaterEqual,
  hardSwish,
  isWebGPUSupported,
  leakyRelu,
  less,
  lessEqual,
  loadAndCompile,
  loadLiteRt,
  loadModelAndWeights,
  log,
  logSoftmax,
  logicalAnd,
  logicalNot,
  logicalOr,
  logistic,
  maxPool2d,
  maximum,
  mean,
  minimum,
  mul,
  neg,
  nonMaxSuppression,
  notEqual,
  oneHot,
  pRelu,
  pack,
  pad,
  pow,
  reduceMax,
  relu,
  relu6,
  reshape,
  resizeBilinear,
  resizeNearestNeighbor,
  reverse,
  round,
  rsqrt,
  select,
  setWebGpuDevice,
  sin,
  slice,
  softmax,
  spaceToDepth,
  split,
  sqrt,
  squeeze,
  sub,
  sum,
  supportsFeature,
  tanh,
  tile,
  topK,
  transpose,
  transposeConv2d,
  unloadLiteRt,
  unpack
};
//# sourceMappingURL=index.js.map