// apps/rebalancer/fork/replay/env.ts
for (const key of ["BASE_RPC_URL", "ARBITRUM_RPC_URL", "PLASMA_RPC_URL", "MONAD_RPC_URL"]) {
  process.env[key] = "http://127.0.0.1:9";
}

// scripts/tangem/simulate.ts
var import_fs = require("fs");
var import_path = require("path");

// libs/library/src/allocation/signal.ts
var HOUR = 3600;
var INTRA_CHAIN_SIGNAL_WINDOW = { windowSeconds: 12 * HOUR, stepSeconds: HOUR };
var CROSS_CHAIN_SIGNAL_WINDOW = { windowSeconds: 7 * 24 * HOUR, stepSeconds: 12 * HOUR };
var WEIGHT_SCALE = 1e18;
function ewma(samples, halfLifeSeconds) {
  let weighted = 0n;
  let weights = 0n;
  for (const { ageSeconds, rate } of samples) {
    const weight = BigInt(Math.round(WEIGHT_SCALE * 2 ** (-ageSeconds / halfLifeSeconds)));
    weighted += weight * rate;
    weights += weight;
  }
  return weights === 0n ? 0n : weighted / weights;
}
function rateSignal(spot, history, halfLifeSeconds) {
  if (history === "unavailable" || history.every(({ rate }) => rate === 0n))
    return 0n;
  const average = ewma([{ ageSeconds: 0, rate: spot }, ...history], halfLifeSeconds);
  return average < spot ? average : spot;
}

// libs/library/src/ray.ts
var rayDecimals = 27;

// libs/library/src/allocation/valuation.ts
var RAY = 10 ** rayDecimals;
function curveModel(curve) {
  const alpha = curve.alpha ?? 0;
  const held = Number(curve.held);
  const spot = Number(curve.spot) / RAY;
  const signal = Number(curve.signal < curve.spot ? curve.signal : curve.spot) / RAY;
  const restUnits = (curve.marketSize ?? 0n) - curve.held;
  const rest = alpha === 0 ? 1 : Number(restUnits > 1n ? restUnits : 1n);
  const lift = ((rest + held) / rest) ** alpha;
  return {
    held,
    rest,
    alpha,
    spot0: spot * lift,
    signal0: signal * lift,
    turn: alpha > 1 ? 2 * rest / (alpha - 1) : Infinity
  };
}
function curveMarginal(model, r0, x) {
  const at = Math.min(x, model.turn);
  const { rest, alpha } = model;
  return r0 * (rest / (rest + at)) ** alpha * (1 - alpha * at / (rest + at));
}
function modelMarginal(model, amount) {
  const spot = curveMarginal(model, model.spot0, Math.min(amount, model.held));
  if (amount <= model.held)
    return spot;
  return Math.min(spot, curveMarginal(model, model.signal0, amount));
}
function revenue(model, r0, x) {
  return x * r0 * (model.rest / (model.rest + x)) ** model.alpha;
}
function allocationYield(curve, amount) {
  const model = curveModel(curve);
  const x = Number(amount);
  if (x <= model.held)
    return revenue(model, model.spot0, x);
  return revenue(model, model.spot0, model.held) + revenue(model, model.signal0, x) - revenue(model, model.signal0, model.held);
}
function allocationGain(curves, target, baseline) {
  return curves.reduce(
    (gain, curve, i) => gain + allocationYield(curve, target[i]) - allocationYield(curve, baseline[i]),
    0
  );
}

// libs/library/src/allocation/segment-greedy.ts
function solveSegmentGreedy(providers, maxAllocationPercent) {
  const cap = Math.max(1, Math.min(100, Math.floor(maxAllocationPercent)));
  const segments = providers.flatMap(({ spot, signal, heldPercent }, index) => {
    const held = Math.min(cap, Math.max(0, Math.floor(heldPercent)));
    return [
      { index, held: true, rate: spot, size: held },
      { index, held: false, rate: signal < spot ? signal : spot, size: cap - held }
    ];
  });
  segments.sort((a, b2) => {
    if (a.rate !== b2.rate)
      return b2.rate > a.rate ? 1 : -1;
    if (a.held !== b2.held)
      return a.held ? -1 : 1;
    return a.index - b2.index;
  });
  const distribution = providers.map(() => 0);
  let remaining = 100;
  for (const { index, size } of segments) {
    if (remaining <= 0)
      break;
    const share2 = Math.min(size, remaining);
    distribution[index] += share2;
    remaining -= share2;
  }
  if (remaining > 0) {
    distribution[segments.find(({ size }) => size > 0).index] += remaining;
  }
  return distribution;
}

// libs/library/src/allocation/water-filling.ts
var MAX_BISECTIONS = 200;
function solveWaterFilling(providers, entry, total) {
  if (providers[entry] === void 0)
    throw new RangeError(`Entry provider ${entry} is not one of the providers`);
  if (total <= 0n)
    return { amounts: providers.map(() => 0n), lambda: Infinity };
  const models = providers.map(curveModel);
  const caps = providers.map(({ cap }, i) => i === entry || cap > total ? total : cap < 0n ? 0n : cap);
  const fill = (lambda) => models.map((model, i) => amountAt(model, caps[i], lambda));
  const sum2 = (amounts2) => amounts2.reduce((acc, amount) => acc + amount, 0n);
  const top = Math.max(...models.map((model) => modelMarginal(model, 1)));
  const bottom = Math.min(...models.map((model, i) => modelMarginal(model, Number(caps[i]))));
  let hi = top + Math.abs(top) + 1;
  let lo = bottom - Math.abs(bottom) - 1;
  for (let step = 0; step < MAX_BISECTIONS; step++) {
    const mid = (lo + hi) / 2;
    if (mid <= lo || mid >= hi)
      break;
    const amounts2 = fill(mid);
    const placed = sum2(amounts2);
    if (placed === total)
      return { amounts: amounts2, lambda: mid };
    if (placed > total)
      lo = mid;
    else
      hi = mid;
  }
  const amounts = fill(hi);
  const ceiling = fill(lo);
  let remaining = total - sum2(amounts);
  for (const i of [entry, ...[...providers.keys()].filter((index) => index !== entry)]) {
    if (remaining === 0n)
      break;
    const room = ceiling[i] - amounts[i];
    const take = room < remaining ? room : remaining;
    if (take > 0n) {
      amounts[i] += take;
      remaining -= take;
    }
  }
  return { amounts, lambda: lo };
}
function amountAt(model, cap, lambda) {
  if (cap === 0n || modelMarginal(model, 1) < lambda)
    return 0n;
  if (modelMarginal(model, Number(cap)) >= lambda)
    return cap;
  let lo = 1n;
  let hi = cap;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (modelMarginal(model, Number(mid)) >= lambda)
      lo = mid;
    else
      hi = mid;
  }
  return lo;
}

// node_modules/ethers/lib.esm/_version.js
var version = "6.11.1";

// node_modules/ethers/lib.esm/utils/properties.js
function checkType(value, type, name) {
  const types = type.split("|").map((t) => t.trim());
  for (let i = 0; i < types.length; i++) {
    switch (type) {
      case "any":
        return;
      case "bigint":
      case "boolean":
      case "number":
      case "string":
        if (typeof value === type) {
          return;
        }
    }
  }
  const error = new Error(`invalid value for type ${type}`);
  error.code = "INVALID_ARGUMENT";
  error.argument = `value.${name}`;
  error.value = value;
  throw error;
}
async function resolveProperties(value) {
  const keys = Object.keys(value);
  const results = await Promise.all(keys.map((k) => Promise.resolve(value[k])));
  return results.reduce((accum, v, index) => {
    accum[keys[index]] = v;
    return accum;
  }, {});
}
function defineProperties(target, values, types) {
  for (let key in values) {
    let value = values[key];
    const type = types ? types[key] : null;
    if (type) {
      checkType(value, type, key);
    }
    Object.defineProperty(target, key, { enumerable: true, value, writable: false });
  }
}

// node_modules/ethers/lib.esm/utils/errors.js
function stringify(value) {
  if (value == null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "[ " + value.map(stringify).join(", ") + " ]";
  }
  if (value instanceof Uint8Array) {
    const HEX = "0123456789abcdef";
    let result = "0x";
    for (let i = 0; i < value.length; i++) {
      result += HEX[value[i] >> 4];
      result += HEX[value[i] & 15];
    }
    return result;
  }
  if (typeof value === "object" && typeof value.toJSON === "function") {
    return stringify(value.toJSON());
  }
  switch (typeof value) {
    case "boolean":
    case "symbol":
      return value.toString();
    case "bigint":
      return BigInt(value).toString();
    case "number":
      return value.toString();
    case "string":
      return JSON.stringify(value);
    case "object": {
      const keys = Object.keys(value);
      keys.sort();
      return "{ " + keys.map((k) => `${stringify(k)}: ${stringify(value[k])}`).join(", ") + " }";
    }
  }
  return `[ COULD NOT SERIALIZE ]`;
}
function isError(error, code) {
  return error && error.code === code;
}
function isCallException(error) {
  return isError(error, "CALL_EXCEPTION");
}
function makeError(message, code, info) {
  let shortMessage = message;
  {
    const details = [];
    if (info) {
      if ("message" in info || "code" in info || "name" in info) {
        throw new Error(`value will overwrite populated values: ${stringify(info)}`);
      }
      for (const key in info) {
        if (key === "shortMessage") {
          continue;
        }
        const value = info[key];
        details.push(key + "=" + stringify(value));
      }
    }
    details.push(`code=${code}`);
    details.push(`version=${version}`);
    if (details.length) {
      message += " (" + details.join(", ") + ")";
    }
  }
  let error;
  switch (code) {
    case "INVALID_ARGUMENT":
      error = new TypeError(message);
      break;
    case "NUMERIC_FAULT":
    case "BUFFER_OVERRUN":
      error = new RangeError(message);
      break;
    default:
      error = new Error(message);
  }
  defineProperties(error, { code });
  if (info) {
    Object.assign(error, info);
  }
  if (error.shortMessage == null) {
    defineProperties(error, { shortMessage });
  }
  return error;
}
function assert(check, message, code, info) {
  if (!check) {
    throw makeError(message, code, info);
  }
}
function assertArgument(check, message, name, value) {
  assert(check, message, "INVALID_ARGUMENT", { argument: name, value });
}
function assertArgumentCount(count, expectedCount, message) {
  if (message == null) {
    message = "";
  }
  if (message) {
    message = ": " + message;
  }
  assert(count >= expectedCount, "missing arguemnt" + message, "MISSING_ARGUMENT", {
    count,
    expectedCount
  });
  assert(count <= expectedCount, "too many arguments" + message, "UNEXPECTED_ARGUMENT", {
    count,
    expectedCount
  });
}
var _normalizeForms = ["NFD", "NFC", "NFKD", "NFKC"].reduce((accum, form) => {
  try {
    if ("test".normalize(form) !== "test") {
      throw new Error("bad");
    }
    ;
    if (form === "NFD") {
      const check = String.fromCharCode(233).normalize("NFD");
      const expected = String.fromCharCode(101, 769);
      if (check !== expected) {
        throw new Error("broken");
      }
    }
    accum.push(form);
  } catch (error) {
  }
  return accum;
}, []);
function assertNormalize(form) {
  assert(_normalizeForms.indexOf(form) >= 0, "platform missing String.prototype.normalize", "UNSUPPORTED_OPERATION", {
    operation: "String.prototype.normalize",
    info: { form }
  });
}
function assertPrivate(givenGuard, guard, className) {
  if (className == null) {
    className = "";
  }
  if (givenGuard !== guard) {
    let method = className, operation = "new";
    if (className) {
      method += ".";
      operation += " " + className;
    }
    assert(false, `private constructor; use ${method}from* methods`, "UNSUPPORTED_OPERATION", {
      operation
    });
  }
}

// node_modules/ethers/lib.esm/utils/data.js
function _getBytes(value, name, copy) {
  if (value instanceof Uint8Array) {
    if (copy) {
      return new Uint8Array(value);
    }
    return value;
  }
  if (typeof value === "string" && value.match(/^0x([0-9a-f][0-9a-f])*$/i)) {
    const result = new Uint8Array((value.length - 2) / 2);
    let offset = 2;
    for (let i = 0; i < result.length; i++) {
      result[i] = parseInt(value.substring(offset, offset + 2), 16);
      offset += 2;
    }
    return result;
  }
  assertArgument(false, "invalid BytesLike value", name || "value", value);
}
function getBytes(value, name) {
  return _getBytes(value, name, false);
}
function getBytesCopy(value, name) {
  return _getBytes(value, name, true);
}
function isHexString(value, length) {
  if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
    return false;
  }
  if (typeof length === "number" && value.length !== 2 + 2 * length) {
    return false;
  }
  if (length === true && value.length % 2 !== 0) {
    return false;
  }
  return true;
}
var HexCharacters = "0123456789abcdef";
function hexlify(data) {
  const bytes2 = getBytes(data);
  let result = "0x";
  for (let i = 0; i < bytes2.length; i++) {
    const v = bytes2[i];
    result += HexCharacters[(v & 240) >> 4] + HexCharacters[v & 15];
  }
  return result;
}
function concat(datas) {
  return "0x" + datas.map((d) => hexlify(d).substring(2)).join("");
}
function dataSlice(data, start, end) {
  const bytes2 = getBytes(data);
  if (end != null && end > bytes2.length) {
    assert(false, "cannot slice beyond data bounds", "BUFFER_OVERRUN", {
      buffer: bytes2,
      length: bytes2.length,
      offset: end
    });
  }
  return hexlify(bytes2.slice(start == null ? 0 : start, end == null ? bytes2.length : end));
}
function zeroPad(data, length, left) {
  const bytes2 = getBytes(data);
  assert(length >= bytes2.length, "padding exceeds data length", "BUFFER_OVERRUN", {
    buffer: new Uint8Array(bytes2),
    length,
    offset: length + 1
  });
  const result = new Uint8Array(length);
  result.fill(0);
  if (left) {
    result.set(bytes2, length - bytes2.length);
  } else {
    result.set(bytes2, 0);
  }
  return hexlify(result);
}
function zeroPadValue(data, length) {
  return zeroPad(data, length, true);
}
function zeroPadBytes(data, length) {
  return zeroPad(data, length, false);
}

// node_modules/ethers/lib.esm/utils/maths.js
var BN_0 = BigInt(0);
var BN_1 = BigInt(1);
var maxValue = 9007199254740991;
function fromTwos(_value, _width) {
  const value = getUint(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  assert(value >> width === BN_0, "overflow", "NUMERIC_FAULT", {
    operation: "fromTwos",
    fault: "overflow",
    value: _value
  });
  if (value >> width - BN_1) {
    const mask2 = (BN_1 << width) - BN_1;
    return -((~value & mask2) + BN_1);
  }
  return value;
}
function toTwos(_value, _width) {
  let value = getBigInt(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  const limit = BN_1 << width - BN_1;
  if (value < BN_0) {
    value = -value;
    assert(value <= limit, "too low", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
    const mask2 = (BN_1 << width) - BN_1;
    return (~value & mask2) + BN_1;
  } else {
    assert(value < limit, "too high", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
  }
  return value;
}
function mask(_value, _bits) {
  const value = getUint(_value, "value");
  const bits = BigInt(getNumber(_bits, "bits"));
  return value & (BN_1 << bits) - BN_1;
}
function getBigInt(value, name) {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return BigInt(value);
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        if (value[0] === "-" && value[1] !== "-") {
          return -BigInt(value.substring(1));
        }
        return BigInt(value);
      } catch (e) {
        assertArgument(false, `invalid BigNumberish string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid BigNumberish value", name || "value", value);
}
function getUint(value, name) {
  const result = getBigInt(value, name);
  assert(result >= BN_0, "unsigned value cannot be negative", "NUMERIC_FAULT", {
    fault: "overflow",
    operation: "getUint",
    value
  });
  return result;
}
var Nibbles = "0123456789abcdef";
function toBigInt(value) {
  if (value instanceof Uint8Array) {
    let result = "0x0";
    for (const v of value) {
      result += Nibbles[v >> 4];
      result += Nibbles[v & 15];
    }
    return BigInt(result);
  }
  return getBigInt(value);
}
function getNumber(value, name) {
  switch (typeof value) {
    case "bigint":
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return Number(value);
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return value;
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        return getNumber(BigInt(value), name);
      } catch (e) {
        assertArgument(false, `invalid numeric string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid numeric value", name || "value", value);
}
function toNumber(value) {
  return getNumber(toBigInt(value));
}
function toBeHex(_value, _width) {
  const value = getUint(_value, "value");
  let result = value.toString(16);
  if (_width == null) {
    if (result.length % 2) {
      result = "0" + result;
    }
  } else {
    const width = getNumber(_width, "width");
    assert(width * 2 >= result.length, `value exceeds width (${width} bytes)`, "NUMERIC_FAULT", {
      operation: "toBeHex",
      fault: "overflow",
      value: _value
    });
    while (result.length < width * 2) {
      result = "0" + result;
    }
  }
  return "0x" + result;
}
function toBeArray(_value) {
  const value = getUint(_value, "value");
  if (value === BN_0) {
    return new Uint8Array([]);
  }
  let hex = value.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < result.length; i++) {
    const offset = i * 2;
    result[i] = parseInt(hex.substring(offset, offset + 2), 16);
  }
  return result;
}

// node_modules/ethers/lib.esm/utils/events.js
var EventPayload = class {
  /**
   *  The event filter.
   */
  filter;
  /**
   *  The **EventEmitterable**.
   */
  emitter;
  #listener;
  /**
   *  Create a new **EventPayload** for %%emitter%% with
   *  the %%listener%% and for %%filter%%.
   */
  constructor(emitter, listener, filter) {
    this.#listener = listener;
    defineProperties(this, { emitter, filter });
  }
  /**
   *  Unregister the triggered listener for future events.
   */
  async removeListener() {
    if (this.#listener == null) {
      return;
    }
    await this.emitter.off(this.filter, this.#listener);
  }
};

// node_modules/ethers/lib.esm/utils/utf8.js
function errorFunc(reason, offset, bytes2, output2, badCodepoint) {
  assertArgument(false, `invalid codepoint at offset ${offset}; ${reason}`, "bytes", bytes2);
}
function ignoreFunc(reason, offset, bytes2, output2, badCodepoint) {
  if (reason === "BAD_PREFIX" || reason === "UNEXPECTED_CONTINUE") {
    let i = 0;
    for (let o = offset + 1; o < bytes2.length; o++) {
      if (bytes2[o] >> 6 !== 2) {
        break;
      }
      i++;
    }
    return i;
  }
  if (reason === "OVERRUN") {
    return bytes2.length - offset - 1;
  }
  return 0;
}
function replaceFunc(reason, offset, bytes2, output2, badCodepoint) {
  if (reason === "OVERLONG") {
    assertArgument(typeof badCodepoint === "number", "invalid bad code point for replacement", "badCodepoint", badCodepoint);
    output2.push(badCodepoint);
    return 0;
  }
  output2.push(65533);
  return ignoreFunc(reason, offset, bytes2, output2, badCodepoint);
}
var Utf8ErrorFuncs = Object.freeze({
  error: errorFunc,
  ignore: ignoreFunc,
  replace: replaceFunc
});
function getUtf8CodePoints(_bytes, onError) {
  if (onError == null) {
    onError = Utf8ErrorFuncs.error;
  }
  const bytes2 = getBytes(_bytes, "bytes");
  const result = [];
  let i = 0;
  while (i < bytes2.length) {
    const c = bytes2[i++];
    if (c >> 7 === 0) {
      result.push(c);
      continue;
    }
    let extraLength = null;
    let overlongMask = null;
    if ((c & 224) === 192) {
      extraLength = 1;
      overlongMask = 127;
    } else if ((c & 240) === 224) {
      extraLength = 2;
      overlongMask = 2047;
    } else if ((c & 248) === 240) {
      extraLength = 3;
      overlongMask = 65535;
    } else {
      if ((c & 192) === 128) {
        i += onError("UNEXPECTED_CONTINUE", i - 1, bytes2, result);
      } else {
        i += onError("BAD_PREFIX", i - 1, bytes2, result);
      }
      continue;
    }
    if (i - 1 + extraLength >= bytes2.length) {
      i += onError("OVERRUN", i - 1, bytes2, result);
      continue;
    }
    let res = c & (1 << 8 - extraLength - 1) - 1;
    for (let j = 0; j < extraLength; j++) {
      let nextChar = bytes2[i];
      if ((nextChar & 192) != 128) {
        i += onError("MISSING_CONTINUE", i, bytes2, result);
        res = null;
        break;
      }
      ;
      res = res << 6 | nextChar & 63;
      i++;
    }
    if (res === null) {
      continue;
    }
    if (res > 1114111) {
      i += onError("OUT_OF_RANGE", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    if (res >= 55296 && res <= 57343) {
      i += onError("UTF16_SURROGATE", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    if (res <= overlongMask) {
      i += onError("OVERLONG", i - 1 - extraLength, bytes2, result, res);
      continue;
    }
    result.push(res);
  }
  return result;
}
function toUtf8Bytes(str, form) {
  assertArgument(typeof str === "string", "invalid string value", "str", str);
  if (form != null) {
    assertNormalize(form);
    str = str.normalize(form);
  }
  let result = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      result.push(c);
    } else if (c < 2048) {
      result.push(c >> 6 | 192);
      result.push(c & 63 | 128);
    } else if ((c & 64512) == 55296) {
      i++;
      const c2 = str.charCodeAt(i);
      assertArgument(i < str.length && (c2 & 64512) === 56320, "invalid surrogate pair", "str", str);
      const pair = 65536 + ((c & 1023) << 10) + (c2 & 1023);
      result.push(pair >> 18 | 240);
      result.push(pair >> 12 & 63 | 128);
      result.push(pair >> 6 & 63 | 128);
      result.push(pair & 63 | 128);
    } else {
      result.push(c >> 12 | 224);
      result.push(c >> 6 & 63 | 128);
      result.push(c & 63 | 128);
    }
  }
  return new Uint8Array(result);
}
function _toUtf8String(codePoints) {
  return codePoints.map((codePoint) => {
    if (codePoint <= 65535) {
      return String.fromCharCode(codePoint);
    }
    codePoint -= 65536;
    return String.fromCharCode((codePoint >> 10 & 1023) + 55296, (codePoint & 1023) + 56320);
  }).join("");
}
function toUtf8String(bytes2, onError) {
  return _toUtf8String(getUtf8CodePoints(bytes2, onError));
}

// node_modules/ethers/lib.esm/utils/rlp-encode.js
function arrayifyInteger(value) {
  const result = [];
  while (value) {
    result.unshift(value & 255);
    value >>= 8;
  }
  return result;
}
function _encode(object) {
  if (Array.isArray(object)) {
    let payload = [];
    object.forEach(function(child) {
      payload = payload.concat(_encode(child));
    });
    if (payload.length <= 55) {
      payload.unshift(192 + payload.length);
      return payload;
    }
    const length2 = arrayifyInteger(payload.length);
    length2.unshift(247 + length2.length);
    return length2.concat(payload);
  }
  const data = Array.prototype.slice.call(getBytes(object, "object"));
  if (data.length === 1 && data[0] <= 127) {
    return data;
  } else if (data.length <= 55) {
    data.unshift(128 + data.length);
    return data;
  }
  const length = arrayifyInteger(data.length);
  length.unshift(183 + length.length);
  return length.concat(data);
}
var nibbles = "0123456789abcdef";
function encodeRlp(object) {
  let result = "0x";
  for (const v of _encode(object)) {
    result += nibbles[v >> 4];
    result += nibbles[v & 15];
  }
  return result;
}

// node_modules/ethers/lib.esm/abi/coders/abstract-coder.js
var WordSize = 32;
var Padding = new Uint8Array(WordSize);
var passProperties = ["then"];
var _guard = {};
function throwError(name, error) {
  const wrapped = new Error(`deferred error during ABI decoding triggered accessing ${name}`);
  wrapped.error = error;
  throw wrapped;
}
var Result = class extends Array {
  #names;
  /**
   *  @private
   */
  constructor(...args) {
    const guard = args[0];
    let items = args[1];
    let names = (args[2] || []).slice();
    let wrap = true;
    if (guard !== _guard) {
      items = args;
      names = [];
      wrap = false;
    }
    super(items.length);
    items.forEach((item, index) => {
      this[index] = item;
    });
    const nameCounts = names.reduce((accum, name) => {
      if (typeof name === "string") {
        accum.set(name, (accum.get(name) || 0) + 1);
      }
      return accum;
    }, /* @__PURE__ */ new Map());
    this.#names = Object.freeze(items.map((item, index) => {
      const name = names[index];
      if (name != null && nameCounts.get(name) === 1) {
        return name;
      }
      return null;
    }));
    if (!wrap) {
      return;
    }
    Object.freeze(this);
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string") {
          if (prop.match(/^[0-9]+$/)) {
            const index = getNumber(prop, "%index");
            if (index < 0 || index >= this.length) {
              throw new RangeError("out of result range");
            }
            const item = target[index];
            if (item instanceof Error) {
              throwError(`index ${index}`, item);
            }
            return item;
          }
          if (passProperties.indexOf(prop) >= 0) {
            return Reflect.get(target, prop, receiver);
          }
          const value = target[prop];
          if (value instanceof Function) {
            return function(...args2) {
              return value.apply(this === receiver ? target : this, args2);
            };
          } else if (!(prop in target)) {
            return target.getValue.apply(this === receiver ? target : this, [prop]);
          }
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }
  /**
   *  Returns the Result as a normal Array.
   *
   *  This will throw if there are any outstanding deferred
   *  errors.
   */
  toArray() {
    const result = [];
    this.forEach((item, index) => {
      if (item instanceof Error) {
        throwError(`index ${index}`, item);
      }
      result.push(item);
    });
    return result;
  }
  /**
   *  Returns the Result as an Object with each name-value pair.
   *
   *  This will throw if any value is unnamed, or if there are
   *  any outstanding deferred errors.
   */
  toObject() {
    return this.#names.reduce((accum, name, index) => {
      assert(name != null, "value at index ${ index } unnamed", "UNSUPPORTED_OPERATION", {
        operation: "toObject()"
      });
      if (!(name in accum)) {
        accum[name] = this.getValue(name);
      }
      return accum;
    }, {});
  }
  /**
   *  @_ignore
   */
  slice(start, end) {
    if (start == null) {
      start = 0;
    }
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end == null) {
      end = this.length;
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    const result = [], names = [];
    for (let i = start; i < end; i++) {
      result.push(this[i]);
      names.push(this.#names[i]);
    }
    return new Result(_guard, result, names);
  }
  /**
   *  @_ignore
   */
  filter(callback, thisArg) {
    const result = [], names = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      if (callback.call(thisArg, item, i, this)) {
        result.push(item);
        names.push(this.#names[i]);
      }
    }
    return new Result(_guard, result, names);
  }
  /**
   *  @_ignore
   */
  map(callback, thisArg) {
    const result = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      result.push(callback.call(thisArg, item, i, this));
    }
    return result;
  }
  /**
   *  Returns the value for %%name%%.
   *
   *  Since it is possible to have a key whose name conflicts with
   *  a method on a [[Result]] or its superclass Array, or any
   *  JavaScript keyword, this ensures all named values are still
   *  accessible by name.
   */
  getValue(name) {
    const index = this.#names.indexOf(name);
    if (index === -1) {
      return void 0;
    }
    const value = this[index];
    if (value instanceof Error) {
      throwError(`property ${JSON.stringify(name)}`, value.error);
    }
    return value;
  }
  /**
   *  Creates a new [[Result]] for %%items%% with each entry
   *  also accessible by its corresponding name in %%keys%%.
   */
  static fromItems(items, keys) {
    return new Result(_guard, items, keys);
  }
};
function getValue(value) {
  let bytes2 = toBeArray(value);
  assert(bytes2.length <= WordSize, "value out-of-bounds", "BUFFER_OVERRUN", { buffer: bytes2, length: WordSize, offset: bytes2.length });
  if (bytes2.length !== WordSize) {
    bytes2 = getBytesCopy(concat([Padding.slice(bytes2.length % WordSize), bytes2]));
  }
  return bytes2;
}
var Coder = class {
  // The coder name:
  //   - address, uint256, tuple, array, etc.
  name;
  // The fully expanded type, including composite types:
  //   - address, uint256, tuple(address,bytes), uint256[3][4][],  etc.
  type;
  // The localName bound in the signature, in this example it is "baz":
  //   - tuple(address foo, uint bar) baz
  localName;
  // Whether this type is dynamic:
  //  - Dynamic: bytes, string, address[], tuple(boolean[]), etc.
  //  - Not Dynamic: address, uint256, boolean[3], tuple(address, uint8)
  dynamic;
  constructor(name, type, localName, dynamic) {
    defineProperties(this, { name, type, localName, dynamic }, {
      name: "string",
      type: "string",
      localName: "string",
      dynamic: "boolean"
    });
  }
  _throwError(message, value) {
    assertArgument(false, message, this.localName, value);
  }
};
var Writer = class {
  // An array of WordSize lengthed objects to concatenation
  #data;
  #dataLength;
  constructor() {
    this.#data = [];
    this.#dataLength = 0;
  }
  get data() {
    return concat(this.#data);
  }
  get length() {
    return this.#dataLength;
  }
  #writeData(data) {
    this.#data.push(data);
    this.#dataLength += data.length;
    return data.length;
  }
  appendWriter(writer) {
    return this.#writeData(getBytesCopy(writer.data));
  }
  // Arrayish item; pad on the right to *nearest* WordSize
  writeBytes(value) {
    let bytes2 = getBytesCopy(value);
    const paddingOffset = bytes2.length % WordSize;
    if (paddingOffset) {
      bytes2 = getBytesCopy(concat([bytes2, Padding.slice(paddingOffset)]));
    }
    return this.#writeData(bytes2);
  }
  // Numeric item; pad on the left *to* WordSize
  writeValue(value) {
    return this.#writeData(getValue(value));
  }
  // Inserts a numeric place-holder, returning a callback that can
  // be used to asjust the value later
  writeUpdatableValue() {
    const offset = this.#data.length;
    this.#data.push(Padding);
    this.#dataLength += WordSize;
    return (value) => {
      this.#data[offset] = getValue(value);
    };
  }
};
var Reader = class {
  // Allows incomplete unpadded data to be read; otherwise an error
  // is raised if attempting to overrun the buffer. This is required
  // to deal with an old Solidity bug, in which event data for
  // external (not public thoguh) was tightly packed.
  allowLoose;
  #data;
  #offset;
  #bytesRead;
  #parent;
  #maxInflation;
  constructor(data, allowLoose, maxInflation) {
    defineProperties(this, { allowLoose: !!allowLoose });
    this.#data = getBytesCopy(data);
    this.#bytesRead = 0;
    this.#parent = null;
    this.#maxInflation = maxInflation != null ? maxInflation : 1024;
    this.#offset = 0;
  }
  get data() {
    return hexlify(this.#data);
  }
  get dataLength() {
    return this.#data.length;
  }
  get consumed() {
    return this.#offset;
  }
  get bytes() {
    return new Uint8Array(this.#data);
  }
  #incrementBytesRead(count) {
    if (this.#parent) {
      return this.#parent.#incrementBytesRead(count);
    }
    this.#bytesRead += count;
    assert(this.#maxInflation < 1 || this.#bytesRead <= this.#maxInflation * this.dataLength, `compressed ABI data exceeds inflation ratio of ${this.#maxInflation} ( see: https://github.com/ethers-io/ethers.js/issues/4537 )`, "BUFFER_OVERRUN", {
      buffer: getBytesCopy(this.#data),
      offset: this.#offset,
      length: count,
      info: {
        bytesRead: this.#bytesRead,
        dataLength: this.dataLength
      }
    });
  }
  #peekBytes(offset, length, loose) {
    let alignedLength = Math.ceil(length / WordSize) * WordSize;
    if (this.#offset + alignedLength > this.#data.length) {
      if (this.allowLoose && loose && this.#offset + length <= this.#data.length) {
        alignedLength = length;
      } else {
        assert(false, "data out-of-bounds", "BUFFER_OVERRUN", {
          buffer: getBytesCopy(this.#data),
          length: this.#data.length,
          offset: this.#offset + alignedLength
        });
      }
    }
    return this.#data.slice(this.#offset, this.#offset + alignedLength);
  }
  // Create a sub-reader with the same underlying data, but offset
  subReader(offset) {
    const reader = new Reader(this.#data.slice(this.#offset + offset), this.allowLoose, this.#maxInflation);
    reader.#parent = this;
    return reader;
  }
  // Read bytes
  readBytes(length, loose) {
    let bytes2 = this.#peekBytes(0, length, !!loose);
    this.#incrementBytesRead(length);
    this.#offset += bytes2.length;
    return bytes2.slice(0, length);
  }
  // Read a numeric values
  readValue() {
    return toBigInt(this.readBytes(WordSize));
  }
  readIndex() {
    return toNumber(this.readBytes(WordSize));
  }
};

// node_modules/ethers/node_modules/@noble/hashes/esm/_assert.js
function number(n2) {
  if (!Number.isSafeInteger(n2) || n2 < 0)
    throw new Error(`Wrong positive integer: ${n2}`);
}
function bytes(b2, ...lengths) {
  if (!(b2 instanceof Uint8Array))
    throw new Error("Expected Uint8Array");
  if (lengths.length > 0 && !lengths.includes(b2.length))
    throw new Error(`Expected Uint8Array of length ${lengths}, not of length=${b2.length}`);
}
function exists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function output(out, instance) {
  bytes(out);
  const min2 = instance.outputLen;
  if (out.length < min2) {
    throw new Error(`digestInto() expects output buffer of length at least ${min2}`);
  }
}

// node_modules/ethers/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n2, le = false) {
  if (le)
    return { h: Number(n2 & U32_MASK64), l: Number(n2 >> _32n & U32_MASK64) };
  return { h: Number(n2 >> _32n & U32_MASK64) | 0, l: Number(n2 & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/ethers/node_modules/@noble/hashes/esm/utils.js
var u8a = (a) => a instanceof Uint8Array;
var u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
if (!isLE)
  throw new Error("Non little-endian hardware is not supported");
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error(`utf8ToBytes expected string, got ${typeof str}`);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  if (!u8a(data))
    throw new Error(`expected Uint8Array, got ${typeof data}`);
  return data;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
var toStr = {}.toString;
function wrapConstructor(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/ethers/node_modules/@noble/hashes/esm/sha3.js
var [SHA3_PI, SHA3_ROTL, _SHA3_IOTA] = [[], [], []];
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _7n = /* @__PURE__ */ BigInt(7);
var _256n = /* @__PURE__ */ BigInt(256);
var _0x71n = /* @__PURE__ */ BigInt(113);
for (let round2 = 0, R = _1n, x = 1, y = 0; round2 < 24; round2++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round2 + 1) * (round2 + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n)
      t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var [SHA3_IOTA_H, SHA3_IOTA_L] = /* @__PURE__ */ split(_SHA3_IOTA, true);
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round2 = 24 - rounds; round2 < 24; round2++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI2 = SHA3_PI[t];
      curH = s[PI2];
      curL = s[PI2 + 1];
      s[PI2] = Th;
      s[PI2 + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round2];
    s[1] ^= SHA3_IOTA_L[round2];
  }
  B.fill(0);
}
var Keccak = class extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    number(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  keccak() {
    keccakP(this.state32, this.rounds);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    exists(this);
    const { blockLen, state } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    exists(this, false);
    bytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes2) {
    number(bytes2);
    return this.xofInto(new Uint8Array(bytes2));
  }
  digestInto(out) {
    output(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => wrapConstructor(() => new Keccak(blockLen, suffix, outputLen));
var sha3_224 = /* @__PURE__ */ gen(6, 144, 224 / 8);
var sha3_256 = /* @__PURE__ */ gen(6, 136, 256 / 8);
var sha3_384 = /* @__PURE__ */ gen(6, 104, 384 / 8);
var sha3_512 = /* @__PURE__ */ gen(6, 72, 512 / 8);
var keccak_224 = /* @__PURE__ */ gen(1, 144, 224 / 8);
var keccak_256 = /* @__PURE__ */ gen(1, 136, 256 / 8);
var keccak_384 = /* @__PURE__ */ gen(1, 104, 384 / 8);
var keccak_512 = /* @__PURE__ */ gen(1, 72, 512 / 8);
var genShake = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake128 = /* @__PURE__ */ genShake(31, 168, 128 / 8);
var shake256 = /* @__PURE__ */ genShake(31, 136, 256 / 8);

// node_modules/ethers/lib.esm/crypto/keccak.js
var locked = false;
var _keccak256 = function(data) {
  return keccak_256(data);
};
var __keccak256 = _keccak256;
function keccak256(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__keccak256(data));
}
keccak256._ = _keccak256;
keccak256.lock = function() {
  locked = true;
};
keccak256.register = function(func) {
  if (locked) {
    throw new TypeError("keccak256 is locked");
  }
  __keccak256 = func;
};
Object.freeze(keccak256);

// node_modules/ethers/lib.esm/address/address.js
var BN_02 = BigInt(0);
var BN_36 = BigInt(36);
function getChecksumAddress(address) {
  address = address.toLowerCase();
  const chars = address.substring(2).split("");
  const expanded = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    expanded[i] = chars[i].charCodeAt(0);
  }
  const hashed = getBytes(keccak256(expanded));
  for (let i = 0; i < 40; i += 2) {
    if (hashed[i >> 1] >> 4 >= 8) {
      chars[i] = chars[i].toUpperCase();
    }
    if ((hashed[i >> 1] & 15) >= 8) {
      chars[i + 1] = chars[i + 1].toUpperCase();
    }
  }
  return "0x" + chars.join("");
}
var ibanLookup = {};
for (let i = 0; i < 10; i++) {
  ibanLookup[String(i)] = String(i);
}
for (let i = 0; i < 26; i++) {
  ibanLookup[String.fromCharCode(65 + i)] = String(10 + i);
}
var safeDigits = 15;
function ibanChecksum(address) {
  address = address.toUpperCase();
  address = address.substring(4) + address.substring(0, 2) + "00";
  let expanded = address.split("").map((c) => {
    return ibanLookup[c];
  }).join("");
  while (expanded.length >= safeDigits) {
    let block = expanded.substring(0, safeDigits);
    expanded = parseInt(block, 10) % 97 + expanded.substring(block.length);
  }
  let checksum = String(98 - parseInt(expanded, 10) % 97);
  while (checksum.length < 2) {
    checksum = "0" + checksum;
  }
  return checksum;
}
var Base36 = function() {
  ;
  const result = {};
  for (let i = 0; i < 36; i++) {
    const key = "0123456789abcdefghijklmnopqrstuvwxyz"[i];
    result[key] = BigInt(i);
  }
  return result;
}();
function fromBase36(value) {
  value = value.toLowerCase();
  let result = BN_02;
  for (let i = 0; i < value.length; i++) {
    result = result * BN_36 + Base36[value[i]];
  }
  return result;
}
function getAddress(address) {
  assertArgument(typeof address === "string", "invalid address", "address", address);
  if (address.match(/^(0x)?[0-9a-fA-F]{40}$/)) {
    if (!address.startsWith("0x")) {
      address = "0x" + address;
    }
    const result = getChecksumAddress(address);
    assertArgument(!address.match(/([A-F].*[a-f])|([a-f].*[A-F])/) || result === address, "bad address checksum", "address", address);
    return result;
  }
  if (address.match(/^XE[0-9]{2}[0-9A-Za-z]{30,31}$/)) {
    assertArgument(address.substring(2, 4) === ibanChecksum(address), "bad icap checksum", "address", address);
    let result = fromBase36(address.substring(4)).toString(16);
    while (result.length < 40) {
      result = "0" + result;
    }
    return getChecksumAddress("0x" + result);
  }
  assertArgument(false, "invalid address", "address", address);
}

// node_modules/ethers/lib.esm/address/contract-address.js
function getCreateAddress(tx) {
  const from = getAddress(tx.from);
  const nonce = getBigInt(tx.nonce, "tx.nonce");
  let nonceHex = nonce.toString(16);
  if (nonceHex === "0") {
    nonceHex = "0x";
  } else if (nonceHex.length % 2) {
    nonceHex = "0x0" + nonceHex;
  } else {
    nonceHex = "0x" + nonceHex;
  }
  return getAddress(dataSlice(keccak256(encodeRlp([from, nonceHex])), 12));
}

// node_modules/ethers/lib.esm/address/checks.js
function isAddressable(value) {
  return value && typeof value.getAddress === "function";
}
async function checkAddress(target, promise) {
  const result = await promise;
  if (result == null || result === "0x0000000000000000000000000000000000000000") {
    assert(typeof target !== "string", "unconfigured name", "UNCONFIGURED_NAME", { value: target });
    assertArgument(false, "invalid AddressLike value; did not resolve to a value address", "target", target);
  }
  return getAddress(result);
}
function resolveAddress(target, resolver) {
  if (typeof target === "string") {
    if (target.match(/^0x[0-9a-f]{40}$/i)) {
      return getAddress(target);
    }
    assert(resolver != null, "ENS resolution requires a provider", "UNSUPPORTED_OPERATION", { operation: "resolveName" });
    return checkAddress(target, resolver.resolveName(target));
  } else if (isAddressable(target)) {
    return checkAddress(target, target.getAddress());
  } else if (target && typeof target.then === "function") {
    return checkAddress(target, target);
  }
  assertArgument(false, "unsupported addressable value", "target", target);
}

// node_modules/ethers/lib.esm/abi/typed.js
var _gaurd = {};
function n(value, width) {
  let signed = false;
  if (width < 0) {
    signed = true;
    width *= -1;
  }
  return new Typed(_gaurd, `${signed ? "" : "u"}int${width}`, value, { signed, width });
}
function b(value, size) {
  return new Typed(_gaurd, `bytes${size ? size : ""}`, value, { size });
}
var _typedSymbol = Symbol.for("_ethers_typed");
var Typed = class {
  /**
   *  The type, as a Solidity-compatible type.
   */
  type;
  /**
   *  The actual value.
   */
  value;
  #options;
  /**
   *  @_ignore:
   */
  _typedSymbol;
  /**
   *  @_ignore:
   */
  constructor(gaurd, type, value, options) {
    if (options == null) {
      options = null;
    }
    assertPrivate(_gaurd, gaurd, "Typed");
    defineProperties(this, { _typedSymbol, type, value });
    this.#options = options;
    this.format();
  }
  /**
   *  Format the type as a Human-Readable type.
   */
  format() {
    if (this.type === "array") {
      throw new Error("");
    } else if (this.type === "dynamicArray") {
      throw new Error("");
    } else if (this.type === "tuple") {
      return `tuple(${this.value.map((v) => v.format()).join(",")})`;
    }
    return this.type;
  }
  /**
   *  The default value returned by this type.
   */
  defaultValue() {
    return 0;
  }
  /**
   *  The minimum value for numeric types.
   */
  minValue() {
    return 0;
  }
  /**
   *  The maximum value for numeric types.
   */
  maxValue() {
    return 0;
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedBigInt]].
   */
  isBigInt() {
    return !!this.type.match(/^u?int[0-9]+$/);
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedData]].
   */
  isData() {
    return this.type.startsWith("bytes");
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedString]].
   */
  isString() {
    return this.type === "string";
  }
  /**
   *  Returns the tuple name, if this is a tuple. Throws otherwise.
   */
  get tupleName() {
    if (this.type !== "tuple") {
      throw TypeError("not a tuple");
    }
    return this.#options;
  }
  // Returns the length of this type as an array
  // - `null` indicates the length is unforced, it could be dynamic
  // - `-1` indicates the length is dynamic
  // - any other value indicates it is a static array and is its length
  /**
   *  Returns the length of the array type or ``-1`` if it is dynamic.
   *
   *  Throws if the type is not an array.
   */
  get arrayLength() {
    if (this.type !== "array") {
      throw TypeError("not an array");
    }
    if (this.#options === true) {
      return -1;
    }
    if (this.#options === false) {
      return this.value.length;
    }
    return null;
  }
  /**
   *  Returns a new **Typed** of %%type%% with the %%value%%.
   */
  static from(type, value) {
    return new Typed(_gaurd, type, value);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static uint8(v) {
    return n(v, 8);
  }
  /**
   *  Return a new ``uint16`` type for %%v%%.
   */
  static uint16(v) {
    return n(v, 16);
  }
  /**
   *  Return a new ``uint24`` type for %%v%%.
   */
  static uint24(v) {
    return n(v, 24);
  }
  /**
   *  Return a new ``uint32`` type for %%v%%.
   */
  static uint32(v) {
    return n(v, 32);
  }
  /**
   *  Return a new ``uint40`` type for %%v%%.
   */
  static uint40(v) {
    return n(v, 40);
  }
  /**
   *  Return a new ``uint48`` type for %%v%%.
   */
  static uint48(v) {
    return n(v, 48);
  }
  /**
   *  Return a new ``uint56`` type for %%v%%.
   */
  static uint56(v) {
    return n(v, 56);
  }
  /**
   *  Return a new ``uint64`` type for %%v%%.
   */
  static uint64(v) {
    return n(v, 64);
  }
  /**
   *  Return a new ``uint72`` type for %%v%%.
   */
  static uint72(v) {
    return n(v, 72);
  }
  /**
   *  Return a new ``uint80`` type for %%v%%.
   */
  static uint80(v) {
    return n(v, 80);
  }
  /**
   *  Return a new ``uint88`` type for %%v%%.
   */
  static uint88(v) {
    return n(v, 88);
  }
  /**
   *  Return a new ``uint96`` type for %%v%%.
   */
  static uint96(v) {
    return n(v, 96);
  }
  /**
   *  Return a new ``uint104`` type for %%v%%.
   */
  static uint104(v) {
    return n(v, 104);
  }
  /**
   *  Return a new ``uint112`` type for %%v%%.
   */
  static uint112(v) {
    return n(v, 112);
  }
  /**
   *  Return a new ``uint120`` type for %%v%%.
   */
  static uint120(v) {
    return n(v, 120);
  }
  /**
   *  Return a new ``uint128`` type for %%v%%.
   */
  static uint128(v) {
    return n(v, 128);
  }
  /**
   *  Return a new ``uint136`` type for %%v%%.
   */
  static uint136(v) {
    return n(v, 136);
  }
  /**
   *  Return a new ``uint144`` type for %%v%%.
   */
  static uint144(v) {
    return n(v, 144);
  }
  /**
   *  Return a new ``uint152`` type for %%v%%.
   */
  static uint152(v) {
    return n(v, 152);
  }
  /**
   *  Return a new ``uint160`` type for %%v%%.
   */
  static uint160(v) {
    return n(v, 160);
  }
  /**
   *  Return a new ``uint168`` type for %%v%%.
   */
  static uint168(v) {
    return n(v, 168);
  }
  /**
   *  Return a new ``uint176`` type for %%v%%.
   */
  static uint176(v) {
    return n(v, 176);
  }
  /**
   *  Return a new ``uint184`` type for %%v%%.
   */
  static uint184(v) {
    return n(v, 184);
  }
  /**
   *  Return a new ``uint192`` type for %%v%%.
   */
  static uint192(v) {
    return n(v, 192);
  }
  /**
   *  Return a new ``uint200`` type for %%v%%.
   */
  static uint200(v) {
    return n(v, 200);
  }
  /**
   *  Return a new ``uint208`` type for %%v%%.
   */
  static uint208(v) {
    return n(v, 208);
  }
  /**
   *  Return a new ``uint216`` type for %%v%%.
   */
  static uint216(v) {
    return n(v, 216);
  }
  /**
   *  Return a new ``uint224`` type for %%v%%.
   */
  static uint224(v) {
    return n(v, 224);
  }
  /**
   *  Return a new ``uint232`` type for %%v%%.
   */
  static uint232(v) {
    return n(v, 232);
  }
  /**
   *  Return a new ``uint240`` type for %%v%%.
   */
  static uint240(v) {
    return n(v, 240);
  }
  /**
   *  Return a new ``uint248`` type for %%v%%.
   */
  static uint248(v) {
    return n(v, 248);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint256(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``int8`` type for %%v%%.
   */
  static int8(v) {
    return n(v, -8);
  }
  /**
   *  Return a new ``int16`` type for %%v%%.
   */
  static int16(v) {
    return n(v, -16);
  }
  /**
   *  Return a new ``int24`` type for %%v%%.
   */
  static int24(v) {
    return n(v, -24);
  }
  /**
   *  Return a new ``int32`` type for %%v%%.
   */
  static int32(v) {
    return n(v, -32);
  }
  /**
   *  Return a new ``int40`` type for %%v%%.
   */
  static int40(v) {
    return n(v, -40);
  }
  /**
   *  Return a new ``int48`` type for %%v%%.
   */
  static int48(v) {
    return n(v, -48);
  }
  /**
   *  Return a new ``int56`` type for %%v%%.
   */
  static int56(v) {
    return n(v, -56);
  }
  /**
   *  Return a new ``int64`` type for %%v%%.
   */
  static int64(v) {
    return n(v, -64);
  }
  /**
   *  Return a new ``int72`` type for %%v%%.
   */
  static int72(v) {
    return n(v, -72);
  }
  /**
   *  Return a new ``int80`` type for %%v%%.
   */
  static int80(v) {
    return n(v, -80);
  }
  /**
   *  Return a new ``int88`` type for %%v%%.
   */
  static int88(v) {
    return n(v, -88);
  }
  /**
   *  Return a new ``int96`` type for %%v%%.
   */
  static int96(v) {
    return n(v, -96);
  }
  /**
   *  Return a new ``int104`` type for %%v%%.
   */
  static int104(v) {
    return n(v, -104);
  }
  /**
   *  Return a new ``int112`` type for %%v%%.
   */
  static int112(v) {
    return n(v, -112);
  }
  /**
   *  Return a new ``int120`` type for %%v%%.
   */
  static int120(v) {
    return n(v, -120);
  }
  /**
   *  Return a new ``int128`` type for %%v%%.
   */
  static int128(v) {
    return n(v, -128);
  }
  /**
   *  Return a new ``int136`` type for %%v%%.
   */
  static int136(v) {
    return n(v, -136);
  }
  /**
   *  Return a new ``int144`` type for %%v%%.
   */
  static int144(v) {
    return n(v, -144);
  }
  /**
   *  Return a new ``int52`` type for %%v%%.
   */
  static int152(v) {
    return n(v, -152);
  }
  /**
   *  Return a new ``int160`` type for %%v%%.
   */
  static int160(v) {
    return n(v, -160);
  }
  /**
   *  Return a new ``int168`` type for %%v%%.
   */
  static int168(v) {
    return n(v, -168);
  }
  /**
   *  Return a new ``int176`` type for %%v%%.
   */
  static int176(v) {
    return n(v, -176);
  }
  /**
   *  Return a new ``int184`` type for %%v%%.
   */
  static int184(v) {
    return n(v, -184);
  }
  /**
   *  Return a new ``int92`` type for %%v%%.
   */
  static int192(v) {
    return n(v, -192);
  }
  /**
   *  Return a new ``int200`` type for %%v%%.
   */
  static int200(v) {
    return n(v, -200);
  }
  /**
   *  Return a new ``int208`` type for %%v%%.
   */
  static int208(v) {
    return n(v, -208);
  }
  /**
   *  Return a new ``int216`` type for %%v%%.
   */
  static int216(v) {
    return n(v, -216);
  }
  /**
   *  Return a new ``int224`` type for %%v%%.
   */
  static int224(v) {
    return n(v, -224);
  }
  /**
   *  Return a new ``int232`` type for %%v%%.
   */
  static int232(v) {
    return n(v, -232);
  }
  /**
   *  Return a new ``int240`` type for %%v%%.
   */
  static int240(v) {
    return n(v, -240);
  }
  /**
   *  Return a new ``int248`` type for %%v%%.
   */
  static int248(v) {
    return n(v, -248);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int256(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``bytes1`` type for %%v%%.
   */
  static bytes1(v) {
    return b(v, 1);
  }
  /**
   *  Return a new ``bytes2`` type for %%v%%.
   */
  static bytes2(v) {
    return b(v, 2);
  }
  /**
   *  Return a new ``bytes3`` type for %%v%%.
   */
  static bytes3(v) {
    return b(v, 3);
  }
  /**
   *  Return a new ``bytes4`` type for %%v%%.
   */
  static bytes4(v) {
    return b(v, 4);
  }
  /**
   *  Return a new ``bytes5`` type for %%v%%.
   */
  static bytes5(v) {
    return b(v, 5);
  }
  /**
   *  Return a new ``bytes6`` type for %%v%%.
   */
  static bytes6(v) {
    return b(v, 6);
  }
  /**
   *  Return a new ``bytes7`` type for %%v%%.
   */
  static bytes7(v) {
    return b(v, 7);
  }
  /**
   *  Return a new ``bytes8`` type for %%v%%.
   */
  static bytes8(v) {
    return b(v, 8);
  }
  /**
   *  Return a new ``bytes9`` type for %%v%%.
   */
  static bytes9(v) {
    return b(v, 9);
  }
  /**
   *  Return a new ``bytes10`` type for %%v%%.
   */
  static bytes10(v) {
    return b(v, 10);
  }
  /**
   *  Return a new ``bytes11`` type for %%v%%.
   */
  static bytes11(v) {
    return b(v, 11);
  }
  /**
   *  Return a new ``bytes12`` type for %%v%%.
   */
  static bytes12(v) {
    return b(v, 12);
  }
  /**
   *  Return a new ``bytes13`` type for %%v%%.
   */
  static bytes13(v) {
    return b(v, 13);
  }
  /**
   *  Return a new ``bytes14`` type for %%v%%.
   */
  static bytes14(v) {
    return b(v, 14);
  }
  /**
   *  Return a new ``bytes15`` type for %%v%%.
   */
  static bytes15(v) {
    return b(v, 15);
  }
  /**
   *  Return a new ``bytes16`` type for %%v%%.
   */
  static bytes16(v) {
    return b(v, 16);
  }
  /**
   *  Return a new ``bytes17`` type for %%v%%.
   */
  static bytes17(v) {
    return b(v, 17);
  }
  /**
   *  Return a new ``bytes18`` type for %%v%%.
   */
  static bytes18(v) {
    return b(v, 18);
  }
  /**
   *  Return a new ``bytes19`` type for %%v%%.
   */
  static bytes19(v) {
    return b(v, 19);
  }
  /**
   *  Return a new ``bytes20`` type for %%v%%.
   */
  static bytes20(v) {
    return b(v, 20);
  }
  /**
   *  Return a new ``bytes21`` type for %%v%%.
   */
  static bytes21(v) {
    return b(v, 21);
  }
  /**
   *  Return a new ``bytes22`` type for %%v%%.
   */
  static bytes22(v) {
    return b(v, 22);
  }
  /**
   *  Return a new ``bytes23`` type for %%v%%.
   */
  static bytes23(v) {
    return b(v, 23);
  }
  /**
   *  Return a new ``bytes24`` type for %%v%%.
   */
  static bytes24(v) {
    return b(v, 24);
  }
  /**
   *  Return a new ``bytes25`` type for %%v%%.
   */
  static bytes25(v) {
    return b(v, 25);
  }
  /**
   *  Return a new ``bytes26`` type for %%v%%.
   */
  static bytes26(v) {
    return b(v, 26);
  }
  /**
   *  Return a new ``bytes27`` type for %%v%%.
   */
  static bytes27(v) {
    return b(v, 27);
  }
  /**
   *  Return a new ``bytes28`` type for %%v%%.
   */
  static bytes28(v) {
    return b(v, 28);
  }
  /**
   *  Return a new ``bytes29`` type for %%v%%.
   */
  static bytes29(v) {
    return b(v, 29);
  }
  /**
   *  Return a new ``bytes30`` type for %%v%%.
   */
  static bytes30(v) {
    return b(v, 30);
  }
  /**
   *  Return a new ``bytes31`` type for %%v%%.
   */
  static bytes31(v) {
    return b(v, 31);
  }
  /**
   *  Return a new ``bytes32`` type for %%v%%.
   */
  static bytes32(v) {
    return b(v, 32);
  }
  /**
   *  Return a new ``address`` type for %%v%%.
   */
  static address(v) {
    return new Typed(_gaurd, "address", v);
  }
  /**
   *  Return a new ``bool`` type for %%v%%.
   */
  static bool(v) {
    return new Typed(_gaurd, "bool", !!v);
  }
  /**
   *  Return a new ``bytes`` type for %%v%%.
   */
  static bytes(v) {
    return new Typed(_gaurd, "bytes", v);
  }
  /**
   *  Return a new ``string`` type for %%v%%.
   */
  static string(v) {
    return new Typed(_gaurd, "string", v);
  }
  /**
   *  Return a new ``array`` type for %%v%%, allowing %%dynamic%% length.
   */
  static array(v, dynamic) {
    throw new Error("not implemented yet");
    return new Typed(_gaurd, "array", v, dynamic);
  }
  /**
   *  Return a new ``tuple`` type for %%v%%, with the optional %%name%%.
   */
  static tuple(v, name) {
    throw new Error("not implemented yet");
    return new Typed(_gaurd, "tuple", v, name);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static overrides(v) {
    return new Typed(_gaurd, "overrides", Object.assign({}, v));
  }
  /**
   *  Returns true only if %%value%% is a [[Typed]] instance.
   */
  static isTyped(value) {
    return value && typeof value === "object" && "_typedSymbol" in value && value._typedSymbol === _typedSymbol;
  }
  /**
   *  If the value is a [[Typed]] instance, validates the underlying value
   *  and returns it, otherwise returns value directly.
   *
   *  This is useful for functions that with to accept either a [[Typed]]
   *  object or values.
   */
  static dereference(value, type) {
    if (Typed.isTyped(value)) {
      if (value.type !== type) {
        throw new Error(`invalid type: expecetd ${type}, got ${value.type}`);
      }
      return value.value;
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/address.js
var AddressCoder = class extends Coder {
  constructor(localName) {
    super("address", "address", localName, false);
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000";
  }
  encode(writer, _value) {
    let value = Typed.dereference(_value, "string");
    try {
      value = getAddress(value);
    } catch (error) {
      return this._throwError(error.message, _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    return getAddress(toBeHex(reader.readValue(), 20));
  }
};

// node_modules/ethers/lib.esm/abi/coders/anonymous.js
var AnonymousCoder = class extends Coder {
  coder;
  constructor(coder) {
    super(coder.name, coder.type, "_", coder.dynamic);
    this.coder = coder;
  }
  defaultValue() {
    return this.coder.defaultValue();
  }
  encode(writer, value) {
    return this.coder.encode(writer, value);
  }
  decode(reader) {
    return this.coder.decode(reader);
  }
};

// node_modules/ethers/lib.esm/abi/coders/array.js
function pack(writer, coders, values) {
  let arrayValues = [];
  if (Array.isArray(values)) {
    arrayValues = values;
  } else if (values && typeof values === "object") {
    let unique = {};
    arrayValues = coders.map((coder) => {
      const name = coder.localName;
      assert(name, "cannot encode object for signature with missing names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      assert(!unique[name], "cannot encode object for signature with duplicate names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      unique[name] = true;
      return values[name];
    });
  } else {
    assertArgument(false, "invalid tuple value", "tuple", values);
  }
  assertArgument(coders.length === arrayValues.length, "types/value length mismatch", "tuple", values);
  let staticWriter = new Writer();
  let dynamicWriter = new Writer();
  let updateFuncs = [];
  coders.forEach((coder, index) => {
    let value = arrayValues[index];
    if (coder.dynamic) {
      let dynamicOffset = dynamicWriter.length;
      coder.encode(dynamicWriter, value);
      let updateFunc = staticWriter.writeUpdatableValue();
      updateFuncs.push((baseOffset) => {
        updateFunc(baseOffset + dynamicOffset);
      });
    } else {
      coder.encode(staticWriter, value);
    }
  });
  updateFuncs.forEach((func) => {
    func(staticWriter.length);
  });
  let length = writer.appendWriter(staticWriter);
  length += writer.appendWriter(dynamicWriter);
  return length;
}
function unpack(reader, coders) {
  let values = [];
  let keys = [];
  let baseReader = reader.subReader(0);
  coders.forEach((coder) => {
    let value = null;
    if (coder.dynamic) {
      let offset = reader.readIndex();
      let offsetReader = baseReader.subReader(offset);
      try {
        value = coder.decode(offsetReader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    } else {
      try {
        value = coder.decode(reader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    }
    if (value == void 0) {
      throw new Error("investigate");
    }
    values.push(value);
    keys.push(coder.localName || null);
  });
  return Result.fromItems(values, keys);
}
var ArrayCoder = class extends Coder {
  coder;
  length;
  constructor(coder, length, localName) {
    const type = coder.type + "[" + (length >= 0 ? length : "") + "]";
    const dynamic = length === -1 || coder.dynamic;
    super("array", type, localName, dynamic);
    defineProperties(this, { coder, length });
  }
  defaultValue() {
    const defaultChild = this.coder.defaultValue();
    const result = [];
    for (let i = 0; i < this.length; i++) {
      result.push(defaultChild);
    }
    return result;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "array");
    if (!Array.isArray(value)) {
      this._throwError("expected array value", value);
    }
    let count = this.length;
    if (count === -1) {
      count = value.length;
      writer.writeValue(value.length);
    }
    assertArgumentCount(value.length, count, "coder array" + (this.localName ? " " + this.localName : ""));
    let coders = [];
    for (let i = 0; i < value.length; i++) {
      coders.push(this.coder);
    }
    return pack(writer, coders, value);
  }
  decode(reader) {
    let count = this.length;
    if (count === -1) {
      count = reader.readIndex();
      assert(count * WordSize <= reader.dataLength, "insufficient data length", "BUFFER_OVERRUN", { buffer: reader.bytes, offset: count * WordSize, length: reader.dataLength });
    }
    let coders = [];
    for (let i = 0; i < count; i++) {
      coders.push(new AnonymousCoder(this.coder));
    }
    return unpack(reader, coders);
  }
};

// node_modules/ethers/lib.esm/abi/coders/boolean.js
var BooleanCoder = class extends Coder {
  constructor(localName) {
    super("bool", "bool", localName, false);
  }
  defaultValue() {
    return false;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "bool");
    return writer.writeValue(value ? 1 : 0);
  }
  decode(reader) {
    return !!reader.readValue();
  }
};

// node_modules/ethers/lib.esm/abi/coders/bytes.js
var DynamicBytesCoder = class extends Coder {
  constructor(type, localName) {
    super(type, type, localName, true);
  }
  defaultValue() {
    return "0x";
  }
  encode(writer, value) {
    value = getBytesCopy(value);
    let length = writer.writeValue(value.length);
    length += writer.writeBytes(value);
    return length;
  }
  decode(reader) {
    return reader.readBytes(reader.readIndex(), true);
  }
};
var BytesCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("bytes", localName);
  }
  decode(reader) {
    return hexlify(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/fixed-bytes.js
var FixedBytesCoder = class extends Coder {
  size;
  constructor(size, localName) {
    let name = "bytes" + String(size);
    super(name, name, localName, false);
    defineProperties(this, { size }, { size: "number" });
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000000000000000000000000000".substring(0, 2 + this.size * 2);
  }
  encode(writer, _value) {
    let data = getBytesCopy(Typed.dereference(_value, this.type));
    if (data.length !== this.size) {
      this._throwError("incorrect data length", _value);
    }
    return writer.writeBytes(data);
  }
  decode(reader) {
    return hexlify(reader.readBytes(this.size));
  }
};

// node_modules/ethers/lib.esm/abi/coders/null.js
var Empty = new Uint8Array([]);
var NullCoder = class extends Coder {
  constructor(localName) {
    super("null", "", localName, false);
  }
  defaultValue() {
    return null;
  }
  encode(writer, value) {
    if (value != null) {
      this._throwError("not null", value);
    }
    return writer.writeBytes(Empty);
  }
  decode(reader) {
    reader.readBytes(0);
    return null;
  }
};

// node_modules/ethers/lib.esm/abi/coders/number.js
var BN_03 = BigInt(0);
var BN_12 = BigInt(1);
var BN_MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var NumberCoder = class extends Coder {
  size;
  signed;
  constructor(size, signed, localName) {
    const name = (signed ? "int" : "uint") + size * 8;
    super(name, name, localName, false);
    defineProperties(this, { size, signed }, { size: "number", signed: "boolean" });
  }
  defaultValue() {
    return 0;
  }
  encode(writer, _value) {
    let value = getBigInt(Typed.dereference(_value, this.type));
    let maxUintValue = mask(BN_MAX_UINT256, WordSize * 8);
    if (this.signed) {
      let bounds = mask(maxUintValue, this.size * 8 - 1);
      if (value > bounds || value < -(bounds + BN_12)) {
        this._throwError("value out-of-bounds", _value);
      }
      value = toTwos(value, 8 * WordSize);
    } else if (value < BN_03 || value > mask(maxUintValue, this.size * 8)) {
      this._throwError("value out-of-bounds", _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    let value = mask(reader.readValue(), this.size * 8);
    if (this.signed) {
      value = fromTwos(value, this.size * 8);
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/string.js
var StringCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("string", localName);
  }
  defaultValue() {
    return "";
  }
  encode(writer, _value) {
    return super.encode(writer, toUtf8Bytes(Typed.dereference(_value, "string")));
  }
  decode(reader) {
    return toUtf8String(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/tuple.js
var TupleCoder = class extends Coder {
  coders;
  constructor(coders, localName) {
    let dynamic = false;
    const types = [];
    coders.forEach((coder) => {
      if (coder.dynamic) {
        dynamic = true;
      }
      types.push(coder.type);
    });
    const type = "tuple(" + types.join(",") + ")";
    super("tuple", type, localName, dynamic);
    defineProperties(this, { coders: Object.freeze(coders.slice()) });
  }
  defaultValue() {
    const values = [];
    this.coders.forEach((coder) => {
      values.push(coder.defaultValue());
    });
    const uniqueNames = this.coders.reduce((accum, coder) => {
      const name = coder.localName;
      if (name) {
        if (!accum[name]) {
          accum[name] = 0;
        }
        accum[name]++;
      }
      return accum;
    }, {});
    this.coders.forEach((coder, index) => {
      let name = coder.localName;
      if (!name || uniqueNames[name] !== 1) {
        return;
      }
      if (name === "length") {
        name = "_length";
      }
      if (values[name] != null) {
        return;
      }
      values[name] = values[index];
    });
    return Object.freeze(values);
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "tuple");
    return pack(writer, this.coders, value);
  }
  decode(reader) {
    return unpack(reader, this.coders);
  }
};

// node_modules/ethers/lib.esm/hash/id.js
function id(value) {
  return keccak256(toUtf8Bytes(value));
}

// node_modules/ethers/lib.esm/transaction/accesslist.js
function accessSetify(addr, storageKeys) {
  return {
    address: getAddress(addr),
    storageKeys: storageKeys.map((storageKey, index) => {
      assertArgument(isHexString(storageKey, 32), "invalid slot", `storageKeys[${index}]`, storageKey);
      return storageKey.toLowerCase();
    })
  };
}
function accessListify(value) {
  if (Array.isArray(value)) {
    return value.map((set, index) => {
      if (Array.isArray(set)) {
        assertArgument(set.length === 2, "invalid slot set", `value[${index}]`, set);
        return accessSetify(set[0], set[1]);
      }
      assertArgument(set != null && typeof set === "object", "invalid address-slot set", "value", value);
      return accessSetify(set.address, set.storageKeys);
    });
  }
  assertArgument(value != null && typeof value === "object", "invalid access list", "value", value);
  const result = Object.keys(value).map((addr) => {
    const storageKeys = value[addr].reduce((accum, storageKey) => {
      accum[storageKey] = true;
      return accum;
    }, {});
    return accessSetify(addr, Object.keys(storageKeys).sort());
  });
  result.sort((a, b2) => a.address.localeCompare(b2.address));
  return result;
}

// node_modules/ethers/lib.esm/abi/fragments.js
function setify(items) {
  const result = /* @__PURE__ */ new Set();
  items.forEach((k) => result.add(k));
  return Object.freeze(result);
}
var _kwVisibDeploy = "external public payable override";
var KwVisibDeploy = setify(_kwVisibDeploy.split(" "));
var _kwVisib = "constant external internal payable private public pure view override";
var KwVisib = setify(_kwVisib.split(" "));
var _kwTypes = "constructor error event fallback function receive struct";
var KwTypes = setify(_kwTypes.split(" "));
var _kwModifiers = "calldata memory storage payable indexed";
var KwModifiers = setify(_kwModifiers.split(" "));
var _kwOther = "tuple returns";
var _keywords = [_kwTypes, _kwModifiers, _kwOther, _kwVisib].join(" ");
var Keywords = setify(_keywords.split(" "));
var SimpleTokens = {
  "(": "OPEN_PAREN",
  ")": "CLOSE_PAREN",
  "[": "OPEN_BRACKET",
  "]": "CLOSE_BRACKET",
  ",": "COMMA",
  "@": "AT"
};
var regexWhitespacePrefix = new RegExp("^(\\s*)");
var regexNumberPrefix = new RegExp("^([0-9]+)");
var regexIdPrefix = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)");
var regexId = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)$");
var regexType = new RegExp("^(address|bool|bytes([0-9]*)|string|u?int([0-9]*))$");
var TokenString = class {
  #offset;
  #tokens;
  get offset() {
    return this.#offset;
  }
  get length() {
    return this.#tokens.length - this.#offset;
  }
  constructor(tokens) {
    this.#offset = 0;
    this.#tokens = tokens.slice();
  }
  clone() {
    return new TokenString(this.#tokens);
  }
  reset() {
    this.#offset = 0;
  }
  #subTokenString(from = 0, to = 0) {
    return new TokenString(this.#tokens.slice(from, to).map((t) => {
      return Object.freeze(Object.assign({}, t, {
        match: t.match - from,
        linkBack: t.linkBack - from,
        linkNext: t.linkNext - from
      }));
    }));
  }
  // Pops and returns the value of the next token, if it is a keyword in allowed; throws if out of tokens
  popKeyword(allowed) {
    const top = this.peek();
    if (top.type !== "KEYWORD" || !allowed.has(top.text)) {
      throw new Error(`expected keyword ${top.text}`);
    }
    return this.pop().text;
  }
  // Pops and returns the value of the next token if it is `type`; throws if out of tokens
  popType(type) {
    if (this.peek().type !== type) {
      const top = this.peek();
      throw new Error(`expected ${type}; got ${top.type} ${JSON.stringify(top.text)}`);
    }
    return this.pop().text;
  }
  // Pops and returns a "(" TOKENS ")"
  popParen() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result = this.#subTokenString(this.#offset + 1, top.match + 1);
    this.#offset = top.match + 1;
    return result;
  }
  // Pops and returns the items within "(" ITEM1 "," ITEM2 "," ... ")"
  popParams() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result = [];
    while (this.#offset < top.match - 1) {
      const link = this.peek().linkNext;
      result.push(this.#subTokenString(this.#offset + 1, link));
      this.#offset = link;
    }
    this.#offset = top.match + 1;
    return result;
  }
  // Returns the top Token, throwing if out of tokens
  peek() {
    if (this.#offset >= this.#tokens.length) {
      throw new Error("out-of-bounds");
    }
    return this.#tokens[this.#offset];
  }
  // Returns the next value, if it is a keyword in `allowed`
  peekKeyword(allowed) {
    const top = this.peekType("KEYWORD");
    return top != null && allowed.has(top) ? top : null;
  }
  // Returns the value of the next token if it is `type`
  peekType(type) {
    if (this.length === 0) {
      return null;
    }
    const top = this.peek();
    return top.type === type ? top.text : null;
  }
  // Returns the next token; throws if out of tokens
  pop() {
    const result = this.peek();
    this.#offset++;
    return result;
  }
  toString() {
    const tokens = [];
    for (let i = this.#offset; i < this.#tokens.length; i++) {
      const token = this.#tokens[i];
      tokens.push(`${token.type}:${token.text}`);
    }
    return `<TokenString ${tokens.join(" ")}>`;
  }
};
function lex(text) {
  const tokens = [];
  const throwError2 = (message) => {
    const token = offset < text.length ? JSON.stringify(text[offset]) : "$EOI";
    throw new Error(`invalid token ${token} at ${offset}: ${message}`);
  };
  let brackets = [];
  let commas = [];
  let offset = 0;
  while (offset < text.length) {
    let cur = text.substring(offset);
    let match = cur.match(regexWhitespacePrefix);
    if (match) {
      offset += match[1].length;
      cur = text.substring(offset);
    }
    const token = { depth: brackets.length, linkBack: -1, linkNext: -1, match: -1, type: "", text: "", offset, value: -1 };
    tokens.push(token);
    let type = SimpleTokens[cur[0]] || "";
    if (type) {
      token.type = type;
      token.text = cur[0];
      offset++;
      if (type === "OPEN_PAREN") {
        brackets.push(tokens.length - 1);
        commas.push(tokens.length - 1);
      } else if (type == "CLOSE_PAREN") {
        if (brackets.length === 0) {
          throwError2("no matching open bracket");
        }
        token.match = brackets.pop();
        tokens[token.match].match = tokens.length - 1;
        token.depth--;
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
      } else if (type === "COMMA") {
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
        commas.push(tokens.length - 1);
      } else if (type === "OPEN_BRACKET") {
        token.type = "BRACKET";
      } else if (type === "CLOSE_BRACKET") {
        let suffix = tokens.pop().text;
        if (tokens.length > 0 && tokens[tokens.length - 1].type === "NUMBER") {
          const value = tokens.pop().text;
          suffix = value + suffix;
          tokens[tokens.length - 1].value = getNumber(value);
        }
        if (tokens.length === 0 || tokens[tokens.length - 1].type !== "BRACKET") {
          throw new Error("missing opening bracket");
        }
        tokens[tokens.length - 1].text += suffix;
      }
      continue;
    }
    match = cur.match(regexIdPrefix);
    if (match) {
      token.text = match[1];
      offset += token.text.length;
      if (Keywords.has(token.text)) {
        token.type = "KEYWORD";
        continue;
      }
      if (token.text.match(regexType)) {
        token.type = "TYPE";
        continue;
      }
      token.type = "ID";
      continue;
    }
    match = cur.match(regexNumberPrefix);
    if (match) {
      token.text = match[1];
      token.type = "NUMBER";
      offset += token.text.length;
      continue;
    }
    throw new Error(`unexpected token ${JSON.stringify(cur[0])} at position ${offset}`);
  }
  return new TokenString(tokens.map((t) => Object.freeze(t)));
}
function allowSingle(set, allowed) {
  let included = [];
  for (const key in allowed.keys()) {
    if (set.has(key)) {
      included.push(key);
    }
  }
  if (included.length > 1) {
    throw new Error(`conflicting types: ${included.join(", ")}`);
  }
}
function consumeName(type, tokens) {
  if (tokens.peekKeyword(KwTypes)) {
    const keyword = tokens.pop().text;
    if (keyword !== type) {
      throw new Error(`expected ${type}, got ${keyword}`);
    }
  }
  return tokens.popType("ID");
}
function consumeKeywords(tokens, allowed) {
  const keywords = /* @__PURE__ */ new Set();
  while (true) {
    const keyword = tokens.peekType("KEYWORD");
    if (keyword == null || allowed && !allowed.has(keyword)) {
      break;
    }
    tokens.pop();
    if (keywords.has(keyword)) {
      throw new Error(`duplicate keywords: ${JSON.stringify(keyword)}`);
    }
    keywords.add(keyword);
  }
  return Object.freeze(keywords);
}
function consumeMutability(tokens) {
  let modifiers = consumeKeywords(tokens, KwVisib);
  allowSingle(modifiers, setify("constant payable nonpayable".split(" ")));
  allowSingle(modifiers, setify("pure view payable nonpayable".split(" ")));
  if (modifiers.has("view")) {
    return "view";
  }
  if (modifiers.has("pure")) {
    return "pure";
  }
  if (modifiers.has("payable")) {
    return "payable";
  }
  if (modifiers.has("nonpayable")) {
    return "nonpayable";
  }
  if (modifiers.has("constant")) {
    return "view";
  }
  return "nonpayable";
}
function consumeParams(tokens, allowIndexed) {
  return tokens.popParams().map((t) => ParamType.from(t, allowIndexed));
}
function consumeGas(tokens) {
  if (tokens.peekType("AT")) {
    tokens.pop();
    if (tokens.peekType("NUMBER")) {
      return getBigInt(tokens.pop().text);
    }
    throw new Error("invalid gas");
  }
  return null;
}
function consumeEoi(tokens) {
  if (tokens.length) {
    throw new Error(`unexpected tokens at offset ${tokens.offset}: ${tokens.toString()}`);
  }
}
var regexArrayType = new RegExp(/^(.*)\[([0-9]*)\]$/);
function verifyBasicType(type) {
  const match = type.match(regexType);
  assertArgument(match, "invalid type", "type", type);
  if (type === "uint") {
    return "uint256";
  }
  if (type === "int") {
    return "int256";
  }
  if (match[2]) {
    const length = parseInt(match[2]);
    assertArgument(length !== 0 && length <= 32, "invalid bytes length", "type", type);
  } else if (match[3]) {
    const size = parseInt(match[3]);
    assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid numeric width", "type", type);
  }
  return type;
}
var _guard2 = {};
var internal = Symbol.for("_ethers_internal");
var ParamTypeInternal = "_ParamTypeInternal";
var ErrorFragmentInternal = "_ErrorInternal";
var EventFragmentInternal = "_EventInternal";
var ConstructorFragmentInternal = "_ConstructorInternal";
var FallbackFragmentInternal = "_FallbackInternal";
var FunctionFragmentInternal = "_FunctionInternal";
var StructFragmentInternal = "_StructInternal";
var ParamType = class {
  /**
   *  The local name of the parameter (or ``""`` if unbound)
   */
  name;
  /**
   *  The fully qualified type (e.g. ``"address"``, ``"tuple(address)"``,
   *  ``"uint256[3][]"``)
   */
  type;
  /**
   *  The base type (e.g. ``"address"``, ``"tuple"``, ``"array"``)
   */
  baseType;
  /**
   *  True if the parameters is indexed.
   *
   *  For non-indexable types this is ``null``.
   */
  indexed;
  /**
   *  The components for the tuple.
   *
   *  For non-tuple types this is ``null``.
   */
  components;
  /**
   *  The array length, or ``-1`` for dynamic-lengthed arrays.
   *
   *  For non-array types this is ``null``.
   */
  arrayLength;
  /**
   *  The type of each child in the array.
   *
   *  For non-array types this is ``null``.
   */
  arrayChildren;
  /**
   *  @private
   */
  constructor(guard, name, type, baseType, indexed, components, arrayLength, arrayChildren) {
    assertPrivate(guard, _guard2, "ParamType");
    Object.defineProperty(this, internal, { value: ParamTypeInternal });
    if (components) {
      components = Object.freeze(components.slice());
    }
    if (baseType === "array") {
      if (arrayLength == null || arrayChildren == null) {
        throw new Error("");
      }
    } else if (arrayLength != null || arrayChildren != null) {
      throw new Error("");
    }
    if (baseType === "tuple") {
      if (components == null) {
        throw new Error("");
      }
    } else if (components != null) {
      throw new Error("");
    }
    defineProperties(this, {
      name,
      type,
      baseType,
      indexed,
      components,
      arrayLength,
      arrayChildren
    });
  }
  /**
   *  Return a string representation of this type.
   *
   *  For example,
   *
   *  ``sighash" => "(uint256,address)"``
   *
   *  ``"minimal" => "tuple(uint256,address) indexed"``
   *
   *  ``"full" => "tuple(uint256 foo, address bar) indexed baz"``
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      const name = this.name || "";
      if (this.isArray()) {
        const result3 = JSON.parse(this.arrayChildren.format("json"));
        result3.name = name;
        result3.type += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
        return JSON.stringify(result3);
      }
      const result2 = {
        type: this.baseType === "tuple" ? "tuple" : this.type,
        name
      };
      if (typeof this.indexed === "boolean") {
        result2.indexed = this.indexed;
      }
      if (this.isTuple()) {
        result2.components = this.components.map((c) => JSON.parse(c.format(format)));
      }
      return JSON.stringify(result2);
    }
    let result = "";
    if (this.isArray()) {
      result += this.arrayChildren.format(format);
      result += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
    } else {
      if (this.isTuple()) {
        result += "(" + this.components.map((comp) => comp.format(format)).join(format === "full" ? ", " : ",") + ")";
      } else {
        result += this.type;
      }
    }
    if (format !== "sighash") {
      if (this.indexed === true) {
        result += " indexed";
      }
      if (format === "full" && this.name) {
        result += " " + this.name;
      }
    }
    return result;
  }
  /**
   *  Returns true if %%this%% is an Array type.
   *
   *  This provides a type gaurd ensuring that [[arrayChildren]]
   *  and [[arrayLength]] are non-null.
   */
  isArray() {
    return this.baseType === "array";
  }
  /**
   *  Returns true if %%this%% is a Tuple type.
   *
   *  This provides a type gaurd ensuring that [[components]]
   *  is non-null.
   */
  isTuple() {
    return this.baseType === "tuple";
  }
  /**
   *  Returns true if %%this%% is an Indexable type.
   *
   *  This provides a type gaurd ensuring that [[indexed]]
   *  is non-null.
   */
  isIndexable() {
    return this.indexed != null;
  }
  /**
   *  Walks the **ParamType** with %%value%%, calling %%process%%
   *  on each type, destructing the %%value%% recursively.
   */
  walk(value, process2) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v) => _this.arrayChildren.walk(v, process2));
    }
    if (this.isTuple()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid tuple value");
      }
      if (value.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v, i) => _this.components[i].walk(v, process2));
    }
    return process2(this.type, value);
  }
  #walkAsync(promises, value, process2, setValue) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const childType = this.arrayChildren;
      const result2 = value.slice();
      result2.forEach((value2, index) => {
        childType.#walkAsync(promises, value2, process2, (value3) => {
          result2[index] = value3;
        });
      });
      setValue(result2);
      return;
    }
    if (this.isTuple()) {
      const components = this.components;
      let result2;
      if (Array.isArray(value)) {
        result2 = value.slice();
      } else {
        if (value == null || typeof value !== "object") {
          throw new Error("invalid tuple value");
        }
        result2 = components.map((param) => {
          if (!param.name) {
            throw new Error("cannot use object value with unnamed components");
          }
          if (!(param.name in value)) {
            throw new Error(`missing value for component ${param.name}`);
          }
          return value[param.name];
        });
      }
      if (result2.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      result2.forEach((value2, index) => {
        components[index].#walkAsync(promises, value2, process2, (value3) => {
          result2[index] = value3;
        });
      });
      setValue(result2);
      return;
    }
    const result = process2(this.type, value);
    if (result.then) {
      promises.push(async function() {
        setValue(await result);
      }());
    } else {
      setValue(result);
    }
  }
  /**
   *  Walks the **ParamType** with %%value%%, asynchronously calling
   *  %%process%% on each type, destructing the %%value%% recursively.
   *
   *  This can be used to resolve ENS naes by walking and resolving each
   *  ``"address"`` type.
   */
  async walkAsync(value, process2) {
    const promises = [];
    const result = [value];
    this.#walkAsync(promises, value, process2, (value2) => {
      result[0] = value2;
    });
    if (promises.length) {
      await Promise.all(promises);
    }
    return result[0];
  }
  /**
   *  Creates a new **ParamType** for %%obj%%.
   *
   *  If %%allowIndexed%% then the ``indexed`` keyword is permitted,
   *  otherwise the ``indexed`` keyword will throw an error.
   */
  static from(obj, allowIndexed) {
    if (ParamType.isParamType(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return ParamType.from(lex(obj), allowIndexed);
      } catch (error) {
        assertArgument(false, "invalid param type", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      let type2 = "", baseType = "";
      let comps = null;
      if (consumeKeywords(obj, setify(["tuple"])).has("tuple") || obj.peekType("OPEN_PAREN")) {
        baseType = "tuple";
        comps = obj.popParams().map((t) => ParamType.from(t));
        type2 = `tuple(${comps.map((c) => c.format()).join(",")})`;
      } else {
        type2 = verifyBasicType(obj.popType("TYPE"));
        baseType = type2;
      }
      let arrayChildren = null;
      let arrayLength = null;
      while (obj.length && obj.peekType("BRACKET")) {
        const bracket = obj.pop();
        arrayChildren = new ParamType(_guard2, "", type2, baseType, null, comps, arrayLength, arrayChildren);
        arrayLength = bracket.value;
        type2 += bracket.text;
        baseType = "array";
        comps = null;
      }
      let indexed2 = null;
      const keywords = consumeKeywords(obj, KwModifiers);
      if (keywords.has("indexed")) {
        if (!allowIndexed) {
          throw new Error("");
        }
        indexed2 = true;
      }
      const name2 = obj.peekType("ID") ? obj.pop().text : "";
      if (obj.length) {
        throw new Error("leftover tokens");
      }
      return new ParamType(_guard2, name2, type2, baseType, indexed2, comps, arrayLength, arrayChildren);
    }
    const name = obj.name;
    assertArgument(!name || typeof name === "string" && name.match(regexId), "invalid name", "obj.name", name);
    let indexed = obj.indexed;
    if (indexed != null) {
      assertArgument(allowIndexed, "parameter cannot be indexed", "obj.indexed", obj.indexed);
      indexed = !!indexed;
    }
    let type = obj.type;
    let arrayMatch = type.match(regexArrayType);
    if (arrayMatch) {
      const arrayLength = parseInt(arrayMatch[2] || "-1");
      const arrayChildren = ParamType.from({
        type: arrayMatch[1],
        components: obj.components
      });
      return new ParamType(_guard2, name || "", type, "array", indexed, null, arrayLength, arrayChildren);
    }
    if (type === "tuple" || type.startsWith(
      "tuple("
      /* fix: ) */
    ) || type.startsWith(
      "("
      /* fix: ) */
    )) {
      const comps = obj.components != null ? obj.components.map((c) => ParamType.from(c)) : null;
      const tuple = new ParamType(_guard2, name || "", type, "tuple", indexed, comps, null, null);
      return tuple;
    }
    type = verifyBasicType(obj.type);
    return new ParamType(_guard2, name || "", type, type, indexed, null, null, null);
  }
  /**
   *  Returns true if %%value%% is a **ParamType**.
   */
  static isParamType(value) {
    return value && value[internal] === ParamTypeInternal;
  }
};
var Fragment = class {
  /**
   *  The type of the fragment.
   */
  type;
  /**
   *  The inputs for the fragment.
   */
  inputs;
  /**
   *  @private
   */
  constructor(guard, type, inputs) {
    assertPrivate(guard, _guard2, "Fragment");
    inputs = Object.freeze(inputs.slice());
    defineProperties(this, { type, inputs });
  }
  /**
   *  Creates a new **Fragment** for %%obj%%, wich can be any supported
   *  ABI frgament type.
   */
  static from(obj) {
    if (typeof obj === "string") {
      try {
        Fragment.from(JSON.parse(obj));
      } catch (e) {
      }
      return Fragment.from(lex(obj));
    }
    if (obj instanceof TokenString) {
      const type = obj.peekKeyword(KwTypes);
      switch (type) {
        case "constructor":
          return ConstructorFragment.from(obj);
        case "error":
          return ErrorFragment.from(obj);
        case "event":
          return EventFragment.from(obj);
        case "fallback":
        case "receive":
          return FallbackFragment.from(obj);
        case "function":
          return FunctionFragment.from(obj);
        case "struct":
          return StructFragment.from(obj);
      }
    } else if (typeof obj === "object") {
      switch (obj.type) {
        case "constructor":
          return ConstructorFragment.from(obj);
        case "error":
          return ErrorFragment.from(obj);
        case "event":
          return EventFragment.from(obj);
        case "fallback":
        case "receive":
          return FallbackFragment.from(obj);
        case "function":
          return FunctionFragment.from(obj);
        case "struct":
          return StructFragment.from(obj);
      }
      assert(false, `unsupported type: ${obj.type}`, "UNSUPPORTED_OPERATION", {
        operation: "Fragment.from"
      });
    }
    assertArgument(false, "unsupported frgament object", "obj", obj);
  }
  /**
   *  Returns true if %%value%% is a [[ConstructorFragment]].
   */
  static isConstructor(value) {
    return ConstructorFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is an [[ErrorFragment]].
   */
  static isError(value) {
    return ErrorFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is an [[EventFragment]].
   */
  static isEvent(value) {
    return EventFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is a [[FunctionFragment]].
   */
  static isFunction(value) {
    return FunctionFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is a [[StructFragment]].
   */
  static isStruct(value) {
    return StructFragment.isFragment(value);
  }
};
var NamedFragment = class extends Fragment {
  /**
   *  The name of the fragment.
   */
  name;
  /**
   *  @private
   */
  constructor(guard, type, name, inputs) {
    super(guard, type, inputs);
    assertArgument(typeof name === "string" && name.match(regexId), "invalid identifier", "name", name);
    inputs = Object.freeze(inputs.slice());
    defineProperties(this, { name });
  }
};
function joinParams(format, params) {
  return "(" + params.map((p) => p.format(format)).join(format === "full" ? ", " : ",") + ")";
}
var ErrorFragment = class extends NamedFragment {
  /**
   *  @private
   */
  constructor(guard, name, inputs) {
    super(guard, "error", name, inputs);
    Object.defineProperty(this, internal, { value: ErrorFragmentInternal });
  }
  /**
   *  The Custom Error selector.
   */
  get selector() {
    return id(this.format("sighash")).substring(0, 10);
  }
  /**
   *  Returns a string representation of this fragment as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "error",
        name: this.name,
        inputs: this.inputs.map((input) => JSON.parse(input.format(format)))
      });
    }
    const result = [];
    if (format !== "sighash") {
      result.push("error");
    }
    result.push(this.name + joinParams(format, this.inputs));
    return result.join(" ");
  }
  /**
   *  Returns a new **ErrorFragment** for %%obj%%.
   */
  static from(obj) {
    if (ErrorFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      return ErrorFragment.from(lex(obj));
    } else if (obj instanceof TokenString) {
      const name = consumeName("error", obj);
      const inputs = consumeParams(obj);
      consumeEoi(obj);
      return new ErrorFragment(_guard2, name, inputs);
    }
    return new ErrorFragment(_guard2, obj.name, obj.inputs ? obj.inputs.map(ParamType.from) : []);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is an
   *  **ErrorFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === ErrorFragmentInternal;
  }
};
var EventFragment = class extends NamedFragment {
  /**
   *  Whether this event is anonymous.
   */
  anonymous;
  /**
   *  @private
   */
  constructor(guard, name, inputs, anonymous) {
    super(guard, "event", name, inputs);
    Object.defineProperty(this, internal, { value: EventFragmentInternal });
    defineProperties(this, { anonymous });
  }
  /**
   *  The Event topic hash.
   */
  get topicHash() {
    return id(this.format("sighash"));
  }
  /**
   *  Returns a string representation of this event as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "event",
        anonymous: this.anonymous,
        name: this.name,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format)))
      });
    }
    const result = [];
    if (format !== "sighash") {
      result.push("event");
    }
    result.push(this.name + joinParams(format, this.inputs));
    if (format !== "sighash" && this.anonymous) {
      result.push("anonymous");
    }
    return result.join(" ");
  }
  /**
   *  Return the topic hash for an event with %%name%% and %%params%%.
   */
  static getTopicHash(name, params) {
    params = (params || []).map((p) => ParamType.from(p));
    const fragment = new EventFragment(_guard2, name, params, false);
    return fragment.topicHash;
  }
  /**
   *  Returns a new **EventFragment** for %%obj%%.
   */
  static from(obj) {
    if (EventFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return EventFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid event fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("event", obj);
      const inputs = consumeParams(obj, true);
      const anonymous = !!consumeKeywords(obj, setify(["anonymous"])).has("anonymous");
      consumeEoi(obj);
      return new EventFragment(_guard2, name, inputs, anonymous);
    }
    return new EventFragment(_guard2, obj.name, obj.inputs ? obj.inputs.map((p) => ParamType.from(p, true)) : [], !!obj.anonymous);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is an
   *  **EventFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === EventFragmentInternal;
  }
};
var ConstructorFragment = class extends Fragment {
  /**
   *  Whether the constructor can receive an endowment.
   */
  payable;
  /**
   *  The recommended gas limit for deployment or ``null``.
   */
  gas;
  /**
   *  @private
   */
  constructor(guard, type, inputs, payable, gas) {
    super(guard, type, inputs);
    Object.defineProperty(this, internal, { value: ConstructorFragmentInternal });
    defineProperties(this, { payable, gas });
  }
  /**
   *  Returns a string representation of this constructor as %%format%%.
   */
  format(format) {
    assert(format != null && format !== "sighash", "cannot format a constructor for sighash", "UNSUPPORTED_OPERATION", { operation: "format(sighash)" });
    if (format === "json") {
      return JSON.stringify({
        type: "constructor",
        stateMutability: this.payable ? "payable" : "undefined",
        payable: this.payable,
        gas: this.gas != null ? this.gas : void 0,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format)))
      });
    }
    const result = [`constructor${joinParams(format, this.inputs)}`];
    if (this.payable) {
      result.push("payable");
    }
    if (this.gas != null) {
      result.push(`@${this.gas.toString()}`);
    }
    return result.join(" ");
  }
  /**
   *  Returns a new **ConstructorFragment** for %%obj%%.
   */
  static from(obj) {
    if (ConstructorFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return ConstructorFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid constuctor fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      consumeKeywords(obj, setify(["constructor"]));
      const inputs = consumeParams(obj);
      const payable = !!consumeKeywords(obj, KwVisibDeploy).has("payable");
      const gas = consumeGas(obj);
      consumeEoi(obj);
      return new ConstructorFragment(_guard2, "constructor", inputs, payable, gas);
    }
    return new ConstructorFragment(_guard2, "constructor", obj.inputs ? obj.inputs.map(ParamType.from) : [], !!obj.payable, obj.gas != null ? obj.gas : null);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **ConstructorFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === ConstructorFragmentInternal;
  }
};
var FallbackFragment = class extends Fragment {
  /**
   *  If the function can be sent value during invocation.
   */
  payable;
  constructor(guard, inputs, payable) {
    super(guard, "fallback", inputs);
    Object.defineProperty(this, internal, { value: FallbackFragmentInternal });
    defineProperties(this, { payable });
  }
  /**
   *  Returns a string representation of this fallback as %%format%%.
   */
  format(format) {
    const type = this.inputs.length === 0 ? "receive" : "fallback";
    if (format === "json") {
      const stateMutability = this.payable ? "payable" : "nonpayable";
      return JSON.stringify({ type, stateMutability });
    }
    return `${type}()${this.payable ? " payable" : ""}`;
  }
  /**
   *  Returns a new **FallbackFragment** for %%obj%%.
   */
  static from(obj) {
    if (FallbackFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return FallbackFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid fallback fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const errorObj = obj.toString();
      const topIsValid = obj.peekKeyword(setify(["fallback", "receive"]));
      assertArgument(topIsValid, "type must be fallback or receive", "obj", errorObj);
      const type = obj.popKeyword(setify(["fallback", "receive"]));
      if (type === "receive") {
        const inputs2 = consumeParams(obj);
        assertArgument(inputs2.length === 0, `receive cannot have arguments`, "obj.inputs", inputs2);
        consumeKeywords(obj, setify(["payable"]));
        consumeEoi(obj);
        return new FallbackFragment(_guard2, [], true);
      }
      let inputs = consumeParams(obj);
      if (inputs.length) {
        assertArgument(inputs.length === 1 && inputs[0].type === "bytes", "invalid fallback inputs", "obj.inputs", inputs.map((i) => i.format("minimal")).join(", "));
      } else {
        inputs = [ParamType.from("bytes")];
      }
      const mutability = consumeMutability(obj);
      assertArgument(mutability === "nonpayable" || mutability === "payable", "fallback cannot be constants", "obj.stateMutability", mutability);
      if (consumeKeywords(obj, setify(["returns"])).has("returns")) {
        const outputs = consumeParams(obj);
        assertArgument(outputs.length === 1 && outputs[0].type === "bytes", "invalid fallback outputs", "obj.outputs", outputs.map((i) => i.format("minimal")).join(", "));
      }
      consumeEoi(obj);
      return new FallbackFragment(_guard2, inputs, mutability === "payable");
    }
    if (obj.type === "receive") {
      return new FallbackFragment(_guard2, [], true);
    }
    if (obj.type === "fallback") {
      const inputs = [ParamType.from("bytes")];
      const payable = obj.stateMutability === "payable";
      return new FallbackFragment(_guard2, inputs, payable);
    }
    assertArgument(false, "invalid fallback description", "obj", obj);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **FallbackFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === FallbackFragmentInternal;
  }
};
var FunctionFragment = class extends NamedFragment {
  /**
   *  If the function is constant (e.g. ``pure`` or ``view`` functions).
   */
  constant;
  /**
   *  The returned types for the result of calling this function.
   */
  outputs;
  /**
   *  The state mutability (e.g. ``payable``, ``nonpayable``, ``view``
   *  or ``pure``)
   */
  stateMutability;
  /**
   *  If the function can be sent value during invocation.
   */
  payable;
  /**
   *  The recommended gas limit to send when calling this function.
   */
  gas;
  /**
   *  @private
   */
  constructor(guard, name, stateMutability, inputs, outputs, gas) {
    super(guard, "function", name, inputs);
    Object.defineProperty(this, internal, { value: FunctionFragmentInternal });
    outputs = Object.freeze(outputs.slice());
    const constant = stateMutability === "view" || stateMutability === "pure";
    const payable = stateMutability === "payable";
    defineProperties(this, { constant, gas, outputs, payable, stateMutability });
  }
  /**
   *  The Function selector.
   */
  get selector() {
    return id(this.format("sighash")).substring(0, 10);
  }
  /**
   *  Returns a string representation of this function as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "function",
        name: this.name,
        constant: this.constant,
        stateMutability: this.stateMutability !== "nonpayable" ? this.stateMutability : void 0,
        payable: this.payable,
        gas: this.gas != null ? this.gas : void 0,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format))),
        outputs: this.outputs.map((o) => JSON.parse(o.format(format)))
      });
    }
    const result = [];
    if (format !== "sighash") {
      result.push("function");
    }
    result.push(this.name + joinParams(format, this.inputs));
    if (format !== "sighash") {
      if (this.stateMutability !== "nonpayable") {
        result.push(this.stateMutability);
      }
      if (this.outputs && this.outputs.length) {
        result.push("returns");
        result.push(joinParams(format, this.outputs));
      }
      if (this.gas != null) {
        result.push(`@${this.gas.toString()}`);
      }
    }
    return result.join(" ");
  }
  /**
   *  Return the selector for a function with %%name%% and %%params%%.
   */
  static getSelector(name, params) {
    params = (params || []).map((p) => ParamType.from(p));
    const fragment = new FunctionFragment(_guard2, name, "view", params, [], null);
    return fragment.selector;
  }
  /**
   *  Returns a new **FunctionFragment** for %%obj%%.
   */
  static from(obj) {
    if (FunctionFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return FunctionFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid function fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("function", obj);
      const inputs = consumeParams(obj);
      const mutability = consumeMutability(obj);
      let outputs = [];
      if (consumeKeywords(obj, setify(["returns"])).has("returns")) {
        outputs = consumeParams(obj);
      }
      const gas = consumeGas(obj);
      consumeEoi(obj);
      return new FunctionFragment(_guard2, name, mutability, inputs, outputs, gas);
    }
    let stateMutability = obj.stateMutability;
    if (stateMutability == null) {
      stateMutability = "payable";
      if (typeof obj.constant === "boolean") {
        stateMutability = "view";
        if (!obj.constant) {
          stateMutability = "payable";
          if (typeof obj.payable === "boolean" && !obj.payable) {
            stateMutability = "nonpayable";
          }
        }
      } else if (typeof obj.payable === "boolean" && !obj.payable) {
        stateMutability = "nonpayable";
      }
    }
    return new FunctionFragment(_guard2, obj.name, stateMutability, obj.inputs ? obj.inputs.map(ParamType.from) : [], obj.outputs ? obj.outputs.map(ParamType.from) : [], obj.gas != null ? obj.gas : null);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **FunctionFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === FunctionFragmentInternal;
  }
};
var StructFragment = class extends NamedFragment {
  /**
   *  @private
   */
  constructor(guard, name, inputs) {
    super(guard, "struct", name, inputs);
    Object.defineProperty(this, internal, { value: StructFragmentInternal });
  }
  /**
   *  Returns a string representation of this struct as %%format%%.
   */
  format() {
    throw new Error("@TODO");
  }
  /**
   *  Returns a new **StructFragment** for %%obj%%.
   */
  static from(obj) {
    if (typeof obj === "string") {
      try {
        return StructFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid struct fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("struct", obj);
      const inputs = consumeParams(obj);
      consumeEoi(obj);
      return new StructFragment(_guard2, name, inputs);
    }
    return new StructFragment(_guard2, obj.name, obj.inputs ? obj.inputs.map(ParamType.from) : []);
  }
  // @TODO: fix this return type
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **StructFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === StructFragmentInternal;
  }
};

// node_modules/ethers/lib.esm/abi/abi-coder.js
var PanicReasons = /* @__PURE__ */ new Map();
PanicReasons.set(0, "GENERIC_PANIC");
PanicReasons.set(1, "ASSERT_FALSE");
PanicReasons.set(17, "OVERFLOW");
PanicReasons.set(18, "DIVIDE_BY_ZERO");
PanicReasons.set(33, "ENUM_RANGE_ERROR");
PanicReasons.set(34, "BAD_STORAGE_DATA");
PanicReasons.set(49, "STACK_UNDERFLOW");
PanicReasons.set(50, "ARRAY_RANGE_ERROR");
PanicReasons.set(65, "OUT_OF_MEMORY");
PanicReasons.set(81, "UNINITIALIZED_FUNCTION_CALL");
var paramTypeBytes = new RegExp(/^bytes([0-9]*)$/);
var paramTypeNumber = new RegExp(/^(u?int)([0-9]*)$/);
var defaultCoder = null;
var defaultMaxInflation = 1024;
function getBuiltinCallException(action, tx, data, abiCoder) {
  let message = "missing revert data";
  let reason = null;
  const invocation = null;
  let revert = null;
  if (data) {
    message = "execution reverted";
    const bytes2 = getBytes(data);
    data = hexlify(data);
    if (bytes2.length === 0) {
      message += " (no data present; likely require(false) occurred";
      reason = "require(false)";
    } else if (bytes2.length % 32 !== 4) {
      message += " (could not decode reason; invalid data length)";
    } else if (hexlify(bytes2.slice(0, 4)) === "0x08c379a0") {
      try {
        reason = abiCoder.decode(["string"], bytes2.slice(4))[0];
        revert = {
          signature: "Error(string)",
          name: "Error",
          args: [reason]
        };
        message += `: ${JSON.stringify(reason)}`;
      } catch (error) {
        message += " (could not decode reason; invalid string data)";
      }
    } else if (hexlify(bytes2.slice(0, 4)) === "0x4e487b71") {
      try {
        const code = Number(abiCoder.decode(["uint256"], bytes2.slice(4))[0]);
        revert = {
          signature: "Panic(uint256)",
          name: "Panic",
          args: [code]
        };
        reason = `Panic due to ${PanicReasons.get(code) || "UNKNOWN"}(${code})`;
        message += `: ${reason}`;
      } catch (error) {
        message += " (could not decode panic code)";
      }
    } else {
      message += " (unknown custom error)";
    }
  }
  const transaction = {
    to: tx.to ? getAddress(tx.to) : null,
    data: tx.data || "0x"
  };
  if (tx.from) {
    transaction.from = getAddress(tx.from);
  }
  return makeError(message, "CALL_EXCEPTION", {
    action,
    data,
    reason,
    transaction,
    invocation,
    revert
  });
}
var AbiCoder = class {
  #getCoder(param) {
    if (param.isArray()) {
      return new ArrayCoder(this.#getCoder(param.arrayChildren), param.arrayLength, param.name);
    }
    if (param.isTuple()) {
      return new TupleCoder(param.components.map((c) => this.#getCoder(c)), param.name);
    }
    switch (param.baseType) {
      case "address":
        return new AddressCoder(param.name);
      case "bool":
        return new BooleanCoder(param.name);
      case "string":
        return new StringCoder(param.name);
      case "bytes":
        return new BytesCoder(param.name);
      case "":
        return new NullCoder(param.name);
    }
    let match = param.type.match(paramTypeNumber);
    if (match) {
      let size = parseInt(match[2] || "256");
      assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid " + match[1] + " bit length", "param", param);
      return new NumberCoder(size / 8, match[1] === "int", param.name);
    }
    match = param.type.match(paramTypeBytes);
    if (match) {
      let size = parseInt(match[1]);
      assertArgument(size !== 0 && size <= 32, "invalid bytes length", "param", param);
      return new FixedBytesCoder(size, param.name);
    }
    assertArgument(false, "invalid type", "type", param.type);
  }
  /**
   *  Get the default values for the given %%types%%.
   *
   *  For example, a ``uint`` is by default ``0`` and ``bool``
   *  is by default ``false``.
   */
  getDefaultValue(types) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.defaultValue();
  }
  /**
   *  Encode the %%values%% as the %%types%% into ABI data.
   *
   *  @returns DataHexstring
   */
  encode(types, values) {
    assertArgumentCount(values.length, types.length, "types/values length mismatch");
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    const writer = new Writer();
    coder.encode(writer, values);
    return writer.data;
  }
  /**
   *  Decode the ABI %%data%% as the %%types%% into values.
   *
   *  If %%loose%% decoding is enabled, then strict padding is
   *  not enforced. Some older versions of Solidity incorrectly
   *  padded event data emitted from ``external`` functions.
   */
  decode(types, data, loose) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.decode(new Reader(data, loose, defaultMaxInflation));
  }
  static _setDefaultMaxInflation(value) {
    assertArgument(typeof value === "number" && Number.isInteger(value), "invalid defaultMaxInflation factor", "value", value);
    defaultMaxInflation = value;
  }
  /**
   *  Returns the shared singleton instance of a default [[AbiCoder]].
   *
   *  On the first call, the instance is created internally.
   */
  static defaultAbiCoder() {
    if (defaultCoder == null) {
      defaultCoder = new AbiCoder();
    }
    return defaultCoder;
  }
  /**
   *  Returns an ethers-compatible [[CallExceptionError]] Error for the given
   *  result %%data%% for the [[CallExceptionAction]] %%action%% against
   *  the Transaction %%tx%%.
   */
  static getBuiltinCallException(action, tx, data) {
    return getBuiltinCallException(action, tx, data, AbiCoder.defaultAbiCoder());
  }
};

// node_modules/ethers/lib.esm/abi/interface.js
var LogDescription = class {
  /**
   *  The matching fragment for the ``topic0``.
   */
  fragment;
  /**
   *  The name of the Event.
   */
  name;
  /**
   *  The full Event signature.
   */
  signature;
  /**
   *  The topic hash for the Event.
   */
  topic;
  /**
   *  The arguments passed into the Event with ``emit``.
   */
  args;
  /**
   *  @_ignore:
   */
  constructor(fragment, topic, args) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      signature,
      topic,
      args
    });
  }
};
var TransactionDescription = class {
  /**
   *  The matching fragment from the transaction ``data``.
   */
  fragment;
  /**
   *  The name of the Function from the transaction ``data``.
   */
  name;
  /**
   *  The arguments passed to the Function from the transaction ``data``.
   */
  args;
  /**
   *  The full Function signature from the transaction ``data``.
   */
  signature;
  /**
   *  The selector for the Function from the transaction ``data``.
   */
  selector;
  /**
   *  The ``value`` (in wei) from the transaction.
   */
  value;
  /**
   *  @_ignore:
   */
  constructor(fragment, selector, args, value) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      args,
      signature,
      selector,
      value
    });
  }
};
var ErrorDescription = class {
  /**
   *  The matching fragment.
   */
  fragment;
  /**
   *  The name of the Error.
   */
  name;
  /**
   *  The arguments passed to the Error with ``revert``.
   */
  args;
  /**
   *  The full Error signature.
   */
  signature;
  /**
   *  The selector for the Error.
   */
  selector;
  /**
   *  @_ignore:
   */
  constructor(fragment, selector, args) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      args,
      signature,
      selector
    });
  }
};
var Indexed = class {
  /**
   *  The ``keccak256`` of the value logged.
   */
  hash;
  /**
   *  @_ignore:
   */
  _isIndexed;
  /**
   *  Returns ``true`` if %%value%% is an **Indexed**.
   *
   *  This provides a Type Guard for property access.
   */
  static isIndexed(value) {
    return !!(value && value._isIndexed);
  }
  /**
   *  @_ignore:
   */
  constructor(hash) {
    defineProperties(this, { hash, _isIndexed: true });
  }
};
var PanicReasons2 = {
  "0": "generic panic",
  "1": "assert(false)",
  "17": "arithmetic overflow",
  "18": "division or modulo by zero",
  "33": "enum overflow",
  "34": "invalid encoded storage byte array accessed",
  "49": "out-of-bounds array access; popping on an empty array",
  "50": "out-of-bounds access of an array or bytesN",
  "65": "out of memory",
  "81": "uninitialized function"
};
var BuiltinErrors = {
  "0x08c379a0": {
    signature: "Error(string)",
    name: "Error",
    inputs: ["string"],
    reason: (message) => {
      return `reverted with reason string ${JSON.stringify(message)}`;
    }
  },
  "0x4e487b71": {
    signature: "Panic(uint256)",
    name: "Panic",
    inputs: ["uint256"],
    reason: (code) => {
      let reason = "unknown panic code";
      if (code >= 0 && code <= 255 && PanicReasons2[code.toString()]) {
        reason = PanicReasons2[code.toString()];
      }
      return `reverted with panic code 0x${code.toString(16)} (${reason})`;
    }
  }
};
var Interface = class {
  /**
   *  All the Contract ABI members (i.e. methods, events, errors, etc).
   */
  fragments;
  /**
   *  The Contract constructor.
   */
  deploy;
  /**
   *  The Fallback method, if any.
   */
  fallback;
  /**
   *  If receiving ether is supported.
   */
  receive;
  #errors;
  #events;
  #functions;
  //    #structs: Map<string, StructFragment>;
  #abiCoder;
  /**
   *  Create a new Interface for the %%fragments%%.
   */
  constructor(fragments) {
    let abi = [];
    if (typeof fragments === "string") {
      abi = JSON.parse(fragments);
    } else {
      abi = fragments;
    }
    this.#functions = /* @__PURE__ */ new Map();
    this.#errors = /* @__PURE__ */ new Map();
    this.#events = /* @__PURE__ */ new Map();
    const frags = [];
    for (const a of abi) {
      try {
        frags.push(Fragment.from(a));
      } catch (error) {
        console.log(`[Warning] Invalid Fragment ${JSON.stringify(a)}:`, error.message);
      }
    }
    defineProperties(this, {
      fragments: Object.freeze(frags)
    });
    let fallback = null;
    let receive = false;
    this.#abiCoder = this.getAbiCoder();
    this.fragments.forEach((fragment, index) => {
      let bucket;
      switch (fragment.type) {
        case "constructor":
          if (this.deploy) {
            console.log("duplicate definition - constructor");
            return;
          }
          defineProperties(this, { deploy: fragment });
          return;
        case "fallback":
          if (fragment.inputs.length === 0) {
            receive = true;
          } else {
            assertArgument(!fallback || fragment.payable !== fallback.payable, "conflicting fallback fragments", `fragments[${index}]`, fragment);
            fallback = fragment;
            receive = fallback.payable;
          }
          return;
        case "function":
          bucket = this.#functions;
          break;
        case "event":
          bucket = this.#events;
          break;
        case "error":
          bucket = this.#errors;
          break;
        default:
          return;
      }
      const signature = fragment.format();
      if (bucket.has(signature)) {
        return;
      }
      bucket.set(signature, fragment);
    });
    if (!this.deploy) {
      defineProperties(this, {
        deploy: ConstructorFragment.from("constructor()")
      });
    }
    defineProperties(this, { fallback, receive });
  }
  /**
   *  Returns the entire Human-Readable ABI, as an array of
   *  signatures, optionally as %%minimal%% strings, which
   *  removes parameter names and unneceesary spaces.
   */
  format(minimal) {
    const format = minimal ? "minimal" : "full";
    const abi = this.fragments.map((f) => f.format(format));
    return abi;
  }
  /**
   *  Return the JSON-encoded ABI. This is the format Solidiy
   *  returns.
   */
  formatJson() {
    const abi = this.fragments.map((f) => f.format("json"));
    return JSON.stringify(abi.map((j) => JSON.parse(j)));
  }
  /**
   *  The ABI coder that will be used to encode and decode binary
   *  data.
   */
  getAbiCoder() {
    return AbiCoder.defaultAbiCoder();
  }
  // Find a function definition by any means necessary (unless it is ambiguous)
  #getFunction(key, values, forceUnique) {
    if (isHexString(key)) {
      const selector = key.toLowerCase();
      for (const fragment of this.#functions.values()) {
        if (selector === fragment.selector) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#functions) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (values) {
        const lastValue = values.length > 0 ? values[values.length - 1] : null;
        let valueLength = values.length;
        let allowOptions = true;
        if (Typed.isTyped(lastValue) && lastValue.type === "overrides") {
          allowOptions = false;
          valueLength--;
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs.length;
          if (inputs !== valueLength && (!allowOptions || inputs !== valueLength - 1)) {
            matching.splice(i, 1);
          }
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs;
          for (let j = 0; j < values.length; j++) {
            if (!Typed.isTyped(values[j])) {
              continue;
            }
            if (j >= inputs.length) {
              if (values[j].type === "overrides") {
                continue;
              }
              matching.splice(i, 1);
              break;
            }
            if (values[j].type !== inputs[j].baseType) {
              matching.splice(i, 1);
              break;
            }
          }
        }
      }
      if (matching.length === 1 && values && values.length !== matching[0].inputs.length) {
        const lastArg = values[values.length - 1];
        if (lastArg == null || Array.isArray(lastArg) || typeof lastArg !== "object") {
          matching.splice(0, 1);
        }
      }
      if (matching.length === 0) {
        return null;
      }
      if (matching.length > 1 && forceUnique) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous function description (i.e. matches ${matchStr})`, "key", key);
      }
      return matching[0];
    }
    const result = this.#functions.get(FunctionFragment.from(key).format());
    if (result) {
      return result;
    }
    return null;
  }
  /**
   *  Get the function name for %%key%%, which may be a function selector,
   *  function name or function signature that belongs to the ABI.
   */
  getFunctionName(key) {
    const fragment = this.#getFunction(key, null, false);
    assertArgument(fragment, "no matching function", "key", key);
    return fragment.name;
  }
  /**
   *  Returns true if %%key%% (a function selector, function name or
   *  function signature) is present in the ABI.
   *
   *  In the case of a function name, the name may be ambiguous, so
   *  accessing the [[FunctionFragment]] may require refinement.
   */
  hasFunction(key) {
    return !!this.#getFunction(key, null, false);
  }
  /**
   *  Get the [[FunctionFragment]] for %%key%%, which may be a function
   *  selector, function name or function signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple functions match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single function in
   *  the ABI, this will throw.
   */
  getFunction(key, values) {
    return this.#getFunction(key, values || null, true);
  }
  /**
   *  Iterate over all functions, calling %%callback%%, sorted by their name.
   */
  forEachFunction(callback) {
    const names = Array.from(this.#functions.keys());
    names.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      callback(this.#functions.get(name), i);
    }
  }
  // Find an event definition by any means necessary (unless it is ambiguous)
  #getEvent(key, values, forceUnique) {
    if (isHexString(key)) {
      const eventTopic = key.toLowerCase();
      for (const fragment of this.#events.values()) {
        if (eventTopic === fragment.topicHash) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#events) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (values) {
        for (let i = matching.length - 1; i >= 0; i--) {
          if (matching[i].inputs.length < values.length) {
            matching.splice(i, 1);
          }
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs;
          for (let j = 0; j < values.length; j++) {
            if (!Typed.isTyped(values[j])) {
              continue;
            }
            if (values[j].type !== inputs[j].baseType) {
              matching.splice(i, 1);
              break;
            }
          }
        }
      }
      if (matching.length === 0) {
        return null;
      }
      if (matching.length > 1 && forceUnique) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous event description (i.e. matches ${matchStr})`, "key", key);
      }
      return matching[0];
    }
    const result = this.#events.get(EventFragment.from(key).format());
    if (result) {
      return result;
    }
    return null;
  }
  /**
   *  Get the event name for %%key%%, which may be a topic hash,
   *  event name or event signature that belongs to the ABI.
   */
  getEventName(key) {
    const fragment = this.#getEvent(key, null, false);
    assertArgument(fragment, "no matching event", "key", key);
    return fragment.name;
  }
  /**
   *  Returns true if %%key%% (an event topic hash, event name or
   *  event signature) is present in the ABI.
   *
   *  In the case of an event name, the name may be ambiguous, so
   *  accessing the [[EventFragment]] may require refinement.
   */
  hasEvent(key) {
    return !!this.#getEvent(key, null, false);
  }
  /**
   *  Get the [[EventFragment]] for %%key%%, which may be a topic hash,
   *  event name or event signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple events match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single event in
   *  the ABI, this will throw.
   */
  getEvent(key, values) {
    return this.#getEvent(key, values || null, true);
  }
  /**
   *  Iterate over all events, calling %%callback%%, sorted by their name.
   */
  forEachEvent(callback) {
    const names = Array.from(this.#events.keys());
    names.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      callback(this.#events.get(name), i);
    }
  }
  /**
   *  Get the [[ErrorFragment]] for %%key%%, which may be an error
   *  selector, error name or error signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple errors match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single error in
   *  the ABI, this will throw.
   */
  getError(key, values) {
    if (isHexString(key)) {
      const selector = key.toLowerCase();
      if (BuiltinErrors[selector]) {
        return ErrorFragment.from(BuiltinErrors[selector].signature);
      }
      for (const fragment of this.#errors.values()) {
        if (selector === fragment.selector) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#errors) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (matching.length === 0) {
        if (key === "Error") {
          return ErrorFragment.from("error Error(string)");
        }
        if (key === "Panic") {
          return ErrorFragment.from("error Panic(uint256)");
        }
        return null;
      } else if (matching.length > 1) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous error description (i.e. ${matchStr})`, "name", key);
      }
      return matching[0];
    }
    key = ErrorFragment.from(key).format();
    if (key === "Error(string)") {
      return ErrorFragment.from("error Error(string)");
    }
    if (key === "Panic(uint256)") {
      return ErrorFragment.from("error Panic(uint256)");
    }
    const result = this.#errors.get(key);
    if (result) {
      return result;
    }
    return null;
  }
  /**
   *  Iterate over all errors, calling %%callback%%, sorted by their name.
   */
  forEachError(callback) {
    const names = Array.from(this.#errors.keys());
    names.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      callback(this.#errors.get(name), i);
    }
  }
  // Get the 4-byte selector used by Solidity to identify a function
  /*
  getSelector(fragment: ErrorFragment | FunctionFragment): string {
      if (typeof(fragment) === "string") {
          const matches: Array<Fragment> = [ ];
  
          try { matches.push(this.getFunction(fragment)); } catch (error) { }
          try { matches.push(this.getError(<string>fragment)); } catch (_) { }
  
          if (matches.length === 0) {
              logger.throwArgumentError("unknown fragment", "key", fragment);
          } else if (matches.length > 1) {
              logger.throwArgumentError("ambiguous fragment matches function and error", "key", fragment);
          }
  
          fragment = matches[0];
      }
  
      return dataSlice(id(fragment.format()), 0, 4);
  }
      */
  // Get the 32-byte topic hash used by Solidity to identify an event
  /*
  getEventTopic(fragment: EventFragment): string {
      //if (typeof(fragment) === "string") { fragment = this.getEvent(eventFragment); }
      return id(fragment.format());
  }
  */
  _decodeParams(params, data) {
    return this.#abiCoder.decode(params, data);
  }
  _encodeParams(params, values) {
    return this.#abiCoder.encode(params, values);
  }
  /**
   *  Encodes a ``tx.data`` object for deploying the Contract with
   *  the %%values%% as the constructor arguments.
   */
  encodeDeploy(values) {
    return this._encodeParams(this.deploy.inputs, values || []);
  }
  /**
   *  Decodes the result %%data%% (e.g. from an ``eth_call``) for the
   *  specified error (see [[getError]] for valid values for
   *  %%key%%).
   *
   *  Most developers should prefer the [[parseCallResult]] method instead,
   *  which will automatically detect a ``CALL_EXCEPTION`` and throw the
   *  corresponding error.
   */
  decodeErrorResult(fragment, data) {
    if (typeof fragment === "string") {
      const f = this.getError(fragment);
      assertArgument(f, "unknown error", "fragment", fragment);
      fragment = f;
    }
    assertArgument(dataSlice(data, 0, 4) === fragment.selector, `data signature does not match error ${fragment.name}.`, "data", data);
    return this._decodeParams(fragment.inputs, dataSlice(data, 4));
  }
  /**
   *  Encodes the transaction revert data for a call result that
   *  reverted from the the Contract with the sepcified %%error%%
   *  (see [[getError]] for valid values for %%fragment%%) with the %%values%%.
   *
   *  This is generally not used by most developers, unless trying to mock
   *  a result from a Contract.
   */
  encodeErrorResult(fragment, values) {
    if (typeof fragment === "string") {
      const f = this.getError(fragment);
      assertArgument(f, "unknown error", "fragment", fragment);
      fragment = f;
    }
    return concat([
      fragment.selector,
      this._encodeParams(fragment.inputs, values || [])
    ]);
  }
  /**
   *  Decodes the %%data%% from a transaction ``tx.data`` for
   *  the function specified (see [[getFunction]] for valid values
   *  for %%fragment%%).
   *
   *  Most developers should prefer the [[parseTransaction]] method
   *  instead, which will automatically detect the fragment.
   */
  decodeFunctionData(fragment, data) {
    if (typeof fragment === "string") {
      const f = this.getFunction(fragment);
      assertArgument(f, "unknown function", "fragment", fragment);
      fragment = f;
    }
    assertArgument(dataSlice(data, 0, 4) === fragment.selector, `data signature does not match function ${fragment.name}.`, "data", data);
    return this._decodeParams(fragment.inputs, dataSlice(data, 4));
  }
  /**
   *  Encodes the ``tx.data`` for a transaction that calls the function
   *  specified (see [[getFunction]] for valid values for %%fragment%%) with
   *  the %%values%%.
   */
  encodeFunctionData(fragment, values) {
    if (typeof fragment === "string") {
      const f = this.getFunction(fragment);
      assertArgument(f, "unknown function", "fragment", fragment);
      fragment = f;
    }
    return concat([
      fragment.selector,
      this._encodeParams(fragment.inputs, values || [])
    ]);
  }
  /**
   *  Decodes the result %%data%% (e.g. from an ``eth_call``) for the
   *  specified function (see [[getFunction]] for valid values for
   *  %%key%%).
   *
   *  Most developers should prefer the [[parseCallResult]] method instead,
   *  which will automatically detect a ``CALL_EXCEPTION`` and throw the
   *  corresponding error.
   */
  decodeFunctionResult(fragment, data) {
    if (typeof fragment === "string") {
      const f = this.getFunction(fragment);
      assertArgument(f, "unknown function", "fragment", fragment);
      fragment = f;
    }
    let message = "invalid length for result data";
    const bytes2 = getBytesCopy(data);
    if (bytes2.length % 32 === 0) {
      try {
        return this.#abiCoder.decode(fragment.outputs, bytes2);
      } catch (error) {
        message = "could not decode result data";
      }
    }
    assert(false, message, "BAD_DATA", {
      value: hexlify(bytes2),
      info: { method: fragment.name, signature: fragment.format() }
    });
  }
  makeError(_data, tx) {
    const data = getBytes(_data, "data");
    const error = AbiCoder.getBuiltinCallException("call", tx, data);
    const customPrefix = "execution reverted (unknown custom error)";
    if (error.message.startsWith(customPrefix)) {
      const selector = hexlify(data.slice(0, 4));
      const ef = this.getError(selector);
      if (ef) {
        try {
          const args = this.#abiCoder.decode(ef.inputs, data.slice(4));
          error.revert = {
            name: ef.name,
            signature: ef.format(),
            args
          };
          error.reason = error.revert.signature;
          error.message = `execution reverted: ${error.reason}`;
        } catch (e) {
          error.message = `execution reverted (coult not decode custom error)`;
        }
      }
    }
    const parsed = this.parseTransaction(tx);
    if (parsed) {
      error.invocation = {
        method: parsed.name,
        signature: parsed.signature,
        args: parsed.args
      };
    }
    return error;
  }
  /**
   *  Encodes the result data (e.g. from an ``eth_call``) for the
   *  specified function (see [[getFunction]] for valid values
   *  for %%fragment%%) with %%values%%.
   *
   *  This is generally not used by most developers, unless trying to mock
   *  a result from a Contract.
   */
  encodeFunctionResult(fragment, values) {
    if (typeof fragment === "string") {
      const f = this.getFunction(fragment);
      assertArgument(f, "unknown function", "fragment", fragment);
      fragment = f;
    }
    return hexlify(this.#abiCoder.encode(fragment.outputs, values || []));
  }
  /*
      spelunk(inputs: Array<ParamType>, values: ReadonlyArray<any>, processfunc: (type: string, value: any) => Promise<any>): Promise<Array<any>> {
          const promises: Array<Promise<>> = [ ];
          const process = function(type: ParamType, value: any): any {
              if (type.baseType === "array") {
                  return descend(type.child
              }
              if (type. === "address") {
              }
          };
  
          const descend = function (inputs: Array<ParamType>, values: ReadonlyArray<any>) {
              if (inputs.length !== values.length) { throw new Error("length mismatch"); }
              
          };
  
          const result: Array<any> = [ ];
          values.forEach((value, index) => {
              if (value == null) {
                  topics.push(null);
              } else if (param.baseType === "array" || param.baseType === "tuple") {
                  logger.throwArgumentError("filtering with tuples or arrays not supported", ("contract." + param.name), value);
              } else if (Array.isArray(value)) {
                  topics.push(value.map((value) => encodeTopic(param, value)));
              } else {
                  topics.push(encodeTopic(param, value));
              }
          });
      }
  */
  // Create the filter for the event with search criteria (e.g. for eth_filterLog)
  encodeFilterTopics(fragment, values) {
    if (typeof fragment === "string") {
      const f = this.getEvent(fragment);
      assertArgument(f, "unknown event", "eventFragment", fragment);
      fragment = f;
    }
    assert(values.length <= fragment.inputs.length, `too many arguments for ${fragment.format()}`, "UNEXPECTED_ARGUMENT", { count: values.length, expectedCount: fragment.inputs.length });
    const topics = [];
    if (!fragment.anonymous) {
      topics.push(fragment.topicHash);
    }
    const encodeTopic = (param, value) => {
      if (param.type === "string") {
        return id(value);
      } else if (param.type === "bytes") {
        return keccak256(hexlify(value));
      }
      if (param.type === "bool" && typeof value === "boolean") {
        value = value ? "0x01" : "0x00";
      } else if (param.type.match(/^u?int/)) {
        value = toBeHex(value);
      } else if (param.type.match(/^bytes/)) {
        value = zeroPadBytes(value, 32);
      } else if (param.type === "address") {
        this.#abiCoder.encode(["address"], [value]);
      }
      return zeroPadValue(hexlify(value), 32);
    };
    values.forEach((value, index) => {
      const param = fragment.inputs[index];
      if (!param.indexed) {
        assertArgument(value == null, "cannot filter non-indexed parameters; must be null", "contract." + param.name, value);
        return;
      }
      if (value == null) {
        topics.push(null);
      } else if (param.baseType === "array" || param.baseType === "tuple") {
        assertArgument(false, "filtering with tuples or arrays not supported", "contract." + param.name, value);
      } else if (Array.isArray(value)) {
        topics.push(value.map((value2) => encodeTopic(param, value2)));
      } else {
        topics.push(encodeTopic(param, value));
      }
    });
    while (topics.length && topics[topics.length - 1] === null) {
      topics.pop();
    }
    return topics;
  }
  encodeEventLog(fragment, values) {
    if (typeof fragment === "string") {
      const f = this.getEvent(fragment);
      assertArgument(f, "unknown event", "eventFragment", fragment);
      fragment = f;
    }
    const topics = [];
    const dataTypes = [];
    const dataValues = [];
    if (!fragment.anonymous) {
      topics.push(fragment.topicHash);
    }
    assertArgument(values.length === fragment.inputs.length, "event arguments/values mismatch", "values", values);
    fragment.inputs.forEach((param, index) => {
      const value = values[index];
      if (param.indexed) {
        if (param.type === "string") {
          topics.push(id(value));
        } else if (param.type === "bytes") {
          topics.push(keccak256(value));
        } else if (param.baseType === "tuple" || param.baseType === "array") {
          throw new Error("not implemented");
        } else {
          topics.push(this.#abiCoder.encode([param.type], [value]));
        }
      } else {
        dataTypes.push(param);
        dataValues.push(value);
      }
    });
    return {
      data: this.#abiCoder.encode(dataTypes, dataValues),
      topics
    };
  }
  // Decode a filter for the event and the search criteria
  decodeEventLog(fragment, data, topics) {
    if (typeof fragment === "string") {
      const f = this.getEvent(fragment);
      assertArgument(f, "unknown event", "eventFragment", fragment);
      fragment = f;
    }
    if (topics != null && !fragment.anonymous) {
      const eventTopic = fragment.topicHash;
      assertArgument(isHexString(topics[0], 32) && topics[0].toLowerCase() === eventTopic, "fragment/topic mismatch", "topics[0]", topics[0]);
      topics = topics.slice(1);
    }
    const indexed = [];
    const nonIndexed = [];
    const dynamic = [];
    fragment.inputs.forEach((param, index) => {
      if (param.indexed) {
        if (param.type === "string" || param.type === "bytes" || param.baseType === "tuple" || param.baseType === "array") {
          indexed.push(ParamType.from({ type: "bytes32", name: param.name }));
          dynamic.push(true);
        } else {
          indexed.push(param);
          dynamic.push(false);
        }
      } else {
        nonIndexed.push(param);
        dynamic.push(false);
      }
    });
    const resultIndexed = topics != null ? this.#abiCoder.decode(indexed, concat(topics)) : null;
    const resultNonIndexed = this.#abiCoder.decode(nonIndexed, data, true);
    const values = [];
    const keys = [];
    let nonIndexedIndex = 0, indexedIndex = 0;
    fragment.inputs.forEach((param, index) => {
      let value = null;
      if (param.indexed) {
        if (resultIndexed == null) {
          value = new Indexed(null);
        } else if (dynamic[index]) {
          value = new Indexed(resultIndexed[indexedIndex++]);
        } else {
          try {
            value = resultIndexed[indexedIndex++];
          } catch (error) {
            value = error;
          }
        }
      } else {
        try {
          value = resultNonIndexed[nonIndexedIndex++];
        } catch (error) {
          value = error;
        }
      }
      values.push(value);
      keys.push(param.name || null);
    });
    return Result.fromItems(values, keys);
  }
  /**
   *  Parses a transaction, finding the matching function and extracts
   *  the parameter values along with other useful function details.
   *
   *  If the matching function cannot be found, return null.
   */
  parseTransaction(tx) {
    const data = getBytes(tx.data, "tx.data");
    const value = getBigInt(tx.value != null ? tx.value : 0, "tx.value");
    const fragment = this.getFunction(hexlify(data.slice(0, 4)));
    if (!fragment) {
      return null;
    }
    const args = this.#abiCoder.decode(fragment.inputs, data.slice(4));
    return new TransactionDescription(fragment, fragment.selector, args, value);
  }
  parseCallResult(data) {
    throw new Error("@TODO");
  }
  /**
   *  Parses a receipt log, finding the matching event and extracts
   *  the parameter values along with other useful event details.
   *
   *  If the matching event cannot be found, returns null.
   */
  parseLog(log3) {
    const fragment = this.getEvent(log3.topics[0]);
    if (!fragment || fragment.anonymous) {
      return null;
    }
    return new LogDescription(fragment, fragment.topicHash, this.decodeEventLog(fragment, log3.data, log3.topics));
  }
  /**
   *  Parses a revert data, finding the matching error and extracts
   *  the parameter values along with other useful error details.
   *
   *  If the matching error cannot be found, returns null.
   */
  parseError(data) {
    const hexData = hexlify(data);
    const fragment = this.getError(dataSlice(hexData, 0, 4));
    if (!fragment) {
      return null;
    }
    const args = this.#abiCoder.decode(fragment.inputs, dataSlice(hexData, 4));
    return new ErrorDescription(fragment, fragment.selector, args);
  }
  /**
   *  Creates a new [[Interface]] from the ABI %%value%%.
   *
   *  The %%value%% may be provided as an existing [[Interface]] object,
   *  a JSON-encoded ABI or any Human-Readable ABI format.
   */
  static from(value) {
    if (value instanceof Interface) {
      return value;
    }
    if (typeof value === "string") {
      return new Interface(JSON.parse(value));
    }
    if (typeof value.format === "function") {
      return new Interface(value.format("json"));
    }
    return new Interface(value);
  }
};

// node_modules/ethers/lib.esm/providers/provider.js
var BN_04 = BigInt(0);
function getValue2(value) {
  if (value == null) {
    return null;
  }
  return value;
}
function toJson(value) {
  if (value == null) {
    return null;
  }
  return value.toString();
}
function copyRequest(req) {
  const result = {};
  if (req.to) {
    result.to = req.to;
  }
  if (req.from) {
    result.from = req.from;
  }
  if (req.data) {
    result.data = hexlify(req.data);
  }
  const bigIntKeys = "chainId,gasLimit,gasPrice,maxFeePerGas,maxPriorityFeePerGas,value".split(/,/);
  for (const key of bigIntKeys) {
    if (!(key in req) || req[key] == null) {
      continue;
    }
    result[key] = getBigInt(req[key], `request.${key}`);
  }
  const numberKeys = "type,nonce".split(/,/);
  for (const key of numberKeys) {
    if (!(key in req) || req[key] == null) {
      continue;
    }
    result[key] = getNumber(req[key], `request.${key}`);
  }
  if (req.accessList) {
    result.accessList = accessListify(req.accessList);
  }
  if ("blockTag" in req) {
    result.blockTag = req.blockTag;
  }
  if ("enableCcipRead" in req) {
    result.enableCcipRead = !!req.enableCcipRead;
  }
  if ("customData" in req) {
    result.customData = req.customData;
  }
  return result;
}
var Block = class {
  /**
   *  The provider connected to the block used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The block number, sometimes called the block height. This is a
   *  sequential number that is one higher than the parent block.
   */
  number;
  /**
   *  The block hash.
   *
   *  This hash includes all properties, so can be safely used to identify
   *  an exact set of block properties.
   */
  hash;
  /**
   *  The timestamp for this block, which is the number of seconds since
   *  epoch that this block was included.
   */
  timestamp;
  /**
   *  The block hash of the parent block.
   */
  parentHash;
  /**
   *  The hash tree root of the parent beacon block for the given
   *  execution block. See [[link-eip-4788]].
   */
  parentBeaconBlockRoot;
  /**
   *  The nonce.
   *
   *  On legacy networks, this is the random number inserted which
   *  permitted the difficulty target to be reached.
   */
  nonce;
  /**
   *  The difficulty target.
   *
   *  On legacy networks, this is the proof-of-work target required
   *  for a block to meet the protocol rules to be included.
   *
   *  On modern networks, this is a random number arrived at using
   *  randao.  @TODO: Find links?
   */
  difficulty;
  /**
   *  The total gas limit for this block.
   */
  gasLimit;
  /**
   *  The total gas used in this block.
   */
  gasUsed;
  /**
   *  The root hash for the global state after applying changes
   *  in this block.
   */
  stateRoot;
  /**
   *  The hash of the transaction receipts trie.
   */
  receiptsRoot;
  /**
   *  The total amount of blob gas consumed by the transactions
   *  within the block. See [[link-eip-4844]].
   */
  blobGasUsed;
  /**
   *  The running total of blob gas consumed in excess of the
   *  target, prior to the block. See [[link-eip-4844]].
   */
  excessBlobGas;
  /**
   *  The miner coinbase address, wihch receives any subsidies for
   *  including this block.
   */
  miner;
  /**
   *  Any extra data the validator wished to include.
   */
  extraData;
  /**
   *  The base fee per gas that all transactions in this block were
   *  charged.
   *
   *  This adjusts after each block, depending on how congested the network
   *  is.
   */
  baseFeePerGas;
  #transactions;
  /**
   *  Create a new **Block** object.
   *
   *  This should generally not be necessary as the unless implementing a
   *  low-level library.
   */
  constructor(block, provider) {
    this.#transactions = block.transactions.map((tx) => {
      if (typeof tx !== "string") {
        return new TransactionResponse(tx, provider);
      }
      return tx;
    });
    defineProperties(this, {
      provider,
      hash: getValue2(block.hash),
      number: block.number,
      timestamp: block.timestamp,
      parentHash: block.parentHash,
      parentBeaconBlockRoot: block.parentBeaconBlockRoot,
      nonce: block.nonce,
      difficulty: block.difficulty,
      gasLimit: block.gasLimit,
      gasUsed: block.gasUsed,
      blobGasUsed: block.blobGasUsed,
      excessBlobGas: block.excessBlobGas,
      miner: block.miner,
      extraData: block.extraData,
      baseFeePerGas: getValue2(block.baseFeePerGas),
      stateRoot: block.stateRoot,
      receiptsRoot: block.receiptsRoot
    });
  }
  /**
   *  Returns the list of transaction hashes, in the order
   *  they were executed within the block.
   */
  get transactions() {
    return this.#transactions.map((tx) => {
      if (typeof tx === "string") {
        return tx;
      }
      return tx.hash;
    });
  }
  /**
   *  Returns the complete transactions, in the order they
   *  were executed within the block.
   *
   *  This is only available for blocks which prefetched
   *  transactions, by passing ``true`` to %%prefetchTxs%%
   *  into [[Provider-getBlock]].
   */
  get prefetchedTransactions() {
    const txs = this.#transactions.slice();
    if (txs.length === 0) {
      return [];
    }
    assert(typeof txs[0] === "object", "transactions were not prefetched with block request", "UNSUPPORTED_OPERATION", {
      operation: "transactionResponses()"
    });
    return txs;
  }
  /**
   *  Returns a JSON-friendly value.
   */
  toJSON() {
    const { baseFeePerGas, difficulty, extraData, gasLimit, gasUsed, hash, miner, nonce, number: number2, parentHash, parentBeaconBlockRoot, stateRoot, receiptsRoot, timestamp, transactions } = this;
    return {
      _type: "Block",
      baseFeePerGas: toJson(baseFeePerGas),
      difficulty: toJson(difficulty),
      extraData,
      gasLimit: toJson(gasLimit),
      gasUsed: toJson(gasUsed),
      blobGasUsed: toJson(this.blobGasUsed),
      excessBlobGas: toJson(this.excessBlobGas),
      hash,
      miner,
      nonce,
      number: number2,
      parentHash,
      timestamp,
      parentBeaconBlockRoot,
      stateRoot,
      receiptsRoot,
      transactions
    };
  }
  [Symbol.iterator]() {
    let index = 0;
    const txs = this.transactions;
    return {
      next: () => {
        if (index < this.length) {
          return {
            value: txs[index++],
            done: false
          };
        }
        return { value: void 0, done: true };
      }
    };
  }
  /**
   *  The number of transactions in this block.
   */
  get length() {
    return this.#transactions.length;
  }
  /**
   *  The [[link-js-date]] this block was included at.
   */
  get date() {
    if (this.timestamp == null) {
      return null;
    }
    return new Date(this.timestamp * 1e3);
  }
  /**
   *  Get the transaction at %%indexe%% within this block.
   */
  async getTransaction(indexOrHash) {
    let tx = void 0;
    if (typeof indexOrHash === "number") {
      tx = this.#transactions[indexOrHash];
    } else {
      const hash = indexOrHash.toLowerCase();
      for (const v of this.#transactions) {
        if (typeof v === "string") {
          if (v !== hash) {
            continue;
          }
          tx = v;
          break;
        } else {
          if (v.hash === hash) {
            continue;
          }
          tx = v;
          break;
        }
      }
    }
    if (tx == null) {
      throw new Error("no such tx");
    }
    if (typeof tx === "string") {
      return await this.provider.getTransaction(tx);
    } else {
      return tx;
    }
  }
  /**
   *  If a **Block** was fetched with a request to include the transactions
   *  this will allow synchronous access to those transactions.
   *
   *  If the transactions were not prefetched, this will throw.
   */
  getPrefetchedTransaction(indexOrHash) {
    const txs = this.prefetchedTransactions;
    if (typeof indexOrHash === "number") {
      return txs[indexOrHash];
    }
    indexOrHash = indexOrHash.toLowerCase();
    for (const tx of txs) {
      if (tx.hash === indexOrHash) {
        return tx;
      }
    }
    assertArgument(false, "no matching transaction", "indexOrHash", indexOrHash);
  }
  /**
   *  Returns true if this block been mined. This provides a type guard
   *  for all properties on a [[MinedBlock]].
   */
  isMined() {
    return !!this.hash;
  }
  /**
   *  Returns true if this block is an [[link-eip-2930]] block.
   */
  isLondon() {
    return !!this.baseFeePerGas;
  }
  /**
   *  @_ignore:
   */
  orphanedEvent() {
    if (!this.isMined()) {
      throw new Error("");
    }
    return createOrphanedBlockFilter(this);
  }
};
var Log = class {
  /**
   *  The provider connected to the log used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The transaction hash of the transaction this log occurred in. Use the
   *  [[Log-getTransaction]] to get the [[TransactionResponse]].
   */
  transactionHash;
  /**
   *  The block hash of the block this log occurred in. Use the
   *  [[Log-getBlock]] to get the [[Block]].
   */
  blockHash;
  /**
   *  The block number of the block this log occurred in. It is preferred
   *  to use the [[Block-hash]] when fetching the related [[Block]],
   *  since in the case of an orphaned block, the block at that height may
   *  have changed.
   */
  blockNumber;
  /**
   *  If the **Log** represents a block that was removed due to an orphaned
   *  block, this will be true.
   *
   *  This can only happen within an orphan event listener.
   */
  removed;
  /**
   *  The address of the contract that emitted this log.
   */
  address;
  /**
   *  The data included in this log when it was emitted.
   */
  data;
  /**
   *  The indexed topics included in this log when it was emitted.
   *
   *  All topics are included in the bloom filters, so they can be
   *  efficiently filtered using the [[Provider-getLogs]] method.
   */
  topics;
  /**
   *  The index within the block this log occurred at. This is generally
   *  not useful to developers, but can be used with the various roots
   *  to proof inclusion within a block.
   */
  index;
  /**
   *  The index within the transaction of this log.
   */
  transactionIndex;
  /**
   *  @_ignore:
   */
  constructor(log3, provider) {
    this.provider = provider;
    const topics = Object.freeze(log3.topics.slice());
    defineProperties(this, {
      transactionHash: log3.transactionHash,
      blockHash: log3.blockHash,
      blockNumber: log3.blockNumber,
      removed: log3.removed,
      address: log3.address,
      data: log3.data,
      topics,
      index: log3.index,
      transactionIndex: log3.transactionIndex
    });
  }
  /**
   *  Returns a JSON-compatible object.
   */
  toJSON() {
    const { address, blockHash, blockNumber, data, index, removed, topics, transactionHash, transactionIndex } = this;
    return {
      _type: "log",
      address,
      blockHash,
      blockNumber,
      data,
      index,
      removed,
      topics,
      transactionHash,
      transactionIndex
    };
  }
  /**
   *  Returns the block that this log occurred in.
   */
  async getBlock() {
    const block = await this.provider.getBlock(this.blockHash);
    assert(!!block, "failed to find transaction", "UNKNOWN_ERROR", {});
    return block;
  }
  /**
   *  Returns the transaction that this log occurred in.
   */
  async getTransaction() {
    const tx = await this.provider.getTransaction(this.transactionHash);
    assert(!!tx, "failed to find transaction", "UNKNOWN_ERROR", {});
    return tx;
  }
  /**
   *  Returns the transaction receipt fot the transaction that this
   *  log occurred in.
   */
  async getTransactionReceipt() {
    const receipt = await this.provider.getTransactionReceipt(this.transactionHash);
    assert(!!receipt, "failed to find transaction receipt", "UNKNOWN_ERROR", {});
    return receipt;
  }
  /**
   *  @_ignore:
   */
  removedEvent() {
    return createRemovedLogFilter(this);
  }
};
var TransactionReceipt = class {
  /**
   *  The provider connected to the log used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The address the transaction was sent to.
   */
  to;
  /**
   *  The sender of the transaction.
   */
  from;
  /**
   *  The address of the contract if the transaction was directly
   *  responsible for deploying one.
   *
   *  This is non-null **only** if the ``to`` is empty and the ``data``
   *  was successfully executed as initcode.
   */
  contractAddress;
  /**
   *  The transaction hash.
   */
  hash;
  /**
   *  The index of this transaction within the block transactions.
   */
  index;
  /**
   *  The block hash of the [[Block]] this transaction was included in.
   */
  blockHash;
  /**
   *  The block number of the [[Block]] this transaction was included in.
   */
  blockNumber;
  /**
   *  The bloom filter bytes that represent all logs that occurred within
   *  this transaction. This is generally not useful for most developers,
   *  but can be used to validate the included logs.
   */
  logsBloom;
  /**
   *  The actual amount of gas used by this transaction.
   *
   *  When creating a transaction, the amount of gas that will be used can
   *  only be approximated, but the sender must pay the gas fee for the
   *  entire gas limit. After the transaction, the difference is refunded.
   */
  gasUsed;
  /**
   *  The gas used for BLObs. See [[link-eip-4844]].
   */
  blobGasUsed;
  /**
   *  The amount of gas used by all transactions within the block for this
   *  and all transactions with a lower ``index``.
   *
   *  This is generally not useful for developers but can be used to
   *  validate certain aspects of execution.
   */
  cumulativeGasUsed;
  /**
   *  The actual gas price used during execution.
   *
   *  Due to the complexity of [[link-eip-1559]] this value can only
   *  be caluclated after the transaction has been mined, snce the base
   *  fee is protocol-enforced.
   */
  gasPrice;
  /**
   *  The price paid per BLOB in gas. See [[link-eip-4844]].
   */
  blobGasPrice;
  /**
   *  The [[link-eip-2718]] transaction type.
   */
  type;
  //readonly byzantium!: boolean;
  /**
   *  The status of this transaction, indicating success (i.e. ``1``) or
   *  a revert (i.e. ``0``).
   *
   *  This is available in post-byzantium blocks, but some backends may
   *  backfill this value.
   */
  status;
  /**
   *  The root hash of this transaction.
   *
   *  This is no present and was only included in pre-byzantium blocks, but
   *  could be used to validate certain parts of the receipt.
   */
  root;
  #logs;
  /**
   *  @_ignore:
   */
  constructor(tx, provider) {
    this.#logs = Object.freeze(tx.logs.map((log3) => {
      return new Log(log3, provider);
    }));
    let gasPrice = BN_04;
    if (tx.effectiveGasPrice != null) {
      gasPrice = tx.effectiveGasPrice;
    } else if (tx.gasPrice != null) {
      gasPrice = tx.gasPrice;
    }
    defineProperties(this, {
      provider,
      to: tx.to,
      from: tx.from,
      contractAddress: tx.contractAddress,
      hash: tx.hash,
      index: tx.index,
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      logsBloom: tx.logsBloom,
      gasUsed: tx.gasUsed,
      cumulativeGasUsed: tx.cumulativeGasUsed,
      blobGasUsed: tx.blobGasUsed,
      gasPrice,
      blobGasPrice: tx.blobGasPrice,
      type: tx.type,
      //byzantium: tx.byzantium,
      status: tx.status,
      root: tx.root
    });
  }
  /**
   *  The logs for this transaction.
   */
  get logs() {
    return this.#logs;
  }
  /**
   *  Returns a JSON-compatible representation.
   */
  toJSON() {
    const {
      to,
      from,
      contractAddress,
      hash,
      index,
      blockHash,
      blockNumber,
      logsBloom,
      logs,
      //byzantium, 
      status,
      root
    } = this;
    return {
      _type: "TransactionReceipt",
      blockHash,
      blockNumber,
      //byzantium, 
      contractAddress,
      cumulativeGasUsed: toJson(this.cumulativeGasUsed),
      from,
      gasPrice: toJson(this.gasPrice),
      blobGasUsed: toJson(this.blobGasUsed),
      blobGasPrice: toJson(this.blobGasPrice),
      gasUsed: toJson(this.gasUsed),
      hash,
      index,
      logs,
      logsBloom,
      root,
      status,
      to
    };
  }
  /**
   *  @_ignore:
   */
  get length() {
    return this.logs.length;
  }
  [Symbol.iterator]() {
    let index = 0;
    return {
      next: () => {
        if (index < this.length) {
          return { value: this.logs[index++], done: false };
        }
        return { value: void 0, done: true };
      }
    };
  }
  /**
   *  The total fee for this transaction, in wei.
   */
  get fee() {
    return this.gasUsed * this.gasPrice;
  }
  /**
   *  Resolves to the block this transaction occurred in.
   */
  async getBlock() {
    const block = await this.provider.getBlock(this.blockHash);
    if (block == null) {
      throw new Error("TODO");
    }
    return block;
  }
  /**
   *  Resolves to the transaction this transaction occurred in.
   */
  async getTransaction() {
    const tx = await this.provider.getTransaction(this.hash);
    if (tx == null) {
      throw new Error("TODO");
    }
    return tx;
  }
  /**
   *  Resolves to the return value of the execution of this transaction.
   *
   *  Support for this feature is limited, as it requires an archive node
   *  with the ``debug_`` or ``trace_`` API enabled.
   */
  async getResult() {
    return await this.provider.getTransactionResult(this.hash);
  }
  /**
   *  Resolves to the number of confirmations this transaction has.
   */
  async confirmations() {
    return await this.provider.getBlockNumber() - this.blockNumber + 1;
  }
  /**
   *  @_ignore:
   */
  removedEvent() {
    return createRemovedTransactionFilter(this);
  }
  /**
   *  @_ignore:
   */
  reorderedEvent(other) {
    assert(!other || other.isMined(), "unmined 'other' transction cannot be orphaned", "UNSUPPORTED_OPERATION", { operation: "reorderedEvent(other)" });
    return createReorderedTransactionFilter(this, other);
  }
};
var TransactionResponse = class {
  /**
   *  The provider this is connected to, which will influence how its
   *  methods will resolve its async inspection methods.
   */
  provider;
  /**
   *  The block number of the block that this transaction was included in.
   *
   *  This is ``null`` for pending transactions.
   */
  blockNumber;
  /**
   *  The blockHash of the block that this transaction was included in.
   *
   *  This is ``null`` for pending transactions.
   */
  blockHash;
  /**
   *  The index within the block that this transaction resides at.
   */
  index;
  /**
   *  The transaction hash.
   */
  hash;
  /**
   *  The [[link-eip-2718]] transaction envelope type. This is
   *  ``0`` for legacy transactions types.
   */
  type;
  /**
   *  The receiver of this transaction.
   *
   *  If ``null``, then the transaction is an initcode transaction.
   *  This means the result of executing the [[data]] will be deployed
   *  as a new contract on chain (assuming it does not revert) and the
   *  address may be computed using [[getCreateAddress]].
   */
  to;
  /**
   *  The sender of this transaction. It is implicitly computed
   *  from the transaction pre-image hash (as the digest) and the
   *  [[signature]] using ecrecover.
   */
  from;
  /**
   *  The nonce, which is used to prevent replay attacks and offer
   *  a method to ensure transactions from a given sender are explicitly
   *  ordered.
   *
   *  When sending a transaction, this must be equal to the number of
   *  transactions ever sent by [[from]].
   */
  nonce;
  /**
   *  The maximum units of gas this transaction can consume. If execution
   *  exceeds this, the entries transaction is reverted and the sender
   *  is charged for the full amount, despite not state changes being made.
   */
  gasLimit;
  /**
   *  The gas price can have various values, depending on the network.
   *
   *  In modern networks, for transactions that are included this is
   *  the //effective gas price// (the fee per gas that was actually
   *  charged), while for transactions that have not been included yet
   *  is the [[maxFeePerGas]].
   *
   *  For legacy transactions, or transactions on legacy networks, this
   *  is the fee that will be charged per unit of gas the transaction
   *  consumes.
   */
  gasPrice;
  /**
   *  The maximum priority fee (per unit of gas) to allow a
   *  validator to charge the sender. This is inclusive of the
   *  [[maxFeeFeePerGas]].
   */
  maxPriorityFeePerGas;
  /**
   *  The maximum fee (per unit of gas) to allow this transaction
   *  to charge the sender.
   */
  maxFeePerGas;
  /**
   *  The [[link-eip-4844]] max fee per BLOb gas.
   */
  maxFeePerBlobGas;
  /**
   *  The data.
   */
  data;
  /**
   *  The value, in wei. Use [[formatEther]] to format this value
   *  as ether.
   */
  value;
  /**
   *  The chain ID.
   */
  chainId;
  /**
   *  The signature.
   */
  signature;
  /**
   *  The [[link-eip-2930]] access list for transaction types that
   *  support it, otherwise ``null``.
   */
  accessList;
  /**
   *  The [[link-eip-4844]] BLOb versioned hashes.
   */
  blobVersionedHashes;
  #startBlock;
  /**
   *  @_ignore:
   */
  constructor(tx, provider) {
    this.provider = provider;
    this.blockNumber = tx.blockNumber != null ? tx.blockNumber : null;
    this.blockHash = tx.blockHash != null ? tx.blockHash : null;
    this.hash = tx.hash;
    this.index = tx.index;
    this.type = tx.type;
    this.from = tx.from;
    this.to = tx.to || null;
    this.gasLimit = tx.gasLimit;
    this.nonce = tx.nonce;
    this.data = tx.data;
    this.value = tx.value;
    this.gasPrice = tx.gasPrice;
    this.maxPriorityFeePerGas = tx.maxPriorityFeePerGas != null ? tx.maxPriorityFeePerGas : null;
    this.maxFeePerGas = tx.maxFeePerGas != null ? tx.maxFeePerGas : null;
    this.maxFeePerBlobGas = tx.maxFeePerBlobGas != null ? tx.maxFeePerBlobGas : null;
    this.chainId = tx.chainId;
    this.signature = tx.signature;
    this.accessList = tx.accessList != null ? tx.accessList : null;
    this.blobVersionedHashes = tx.blobVersionedHashes != null ? tx.blobVersionedHashes : null;
    this.#startBlock = -1;
  }
  /**
   *  Returns a JSON-compatible representation of this transaction.
   */
  toJSON() {
    const { blockNumber, blockHash, index, hash, type, to, from, nonce, data, signature, accessList, blobVersionedHashes } = this;
    return {
      _type: "TransactionResponse",
      accessList,
      blockNumber,
      blockHash,
      blobVersionedHashes,
      chainId: toJson(this.chainId),
      data,
      from,
      gasLimit: toJson(this.gasLimit),
      gasPrice: toJson(this.gasPrice),
      hash,
      maxFeePerGas: toJson(this.maxFeePerGas),
      maxPriorityFeePerGas: toJson(this.maxPriorityFeePerGas),
      maxFeePerBlobGas: toJson(this.maxFeePerBlobGas),
      nonce,
      signature,
      to,
      index,
      type,
      value: toJson(this.value)
    };
  }
  /**
   *  Resolves to the Block that this transaction was included in.
   *
   *  This will return null if the transaction has not been included yet.
   */
  async getBlock() {
    let blockNumber = this.blockNumber;
    if (blockNumber == null) {
      const tx = await this.getTransaction();
      if (tx) {
        blockNumber = tx.blockNumber;
      }
    }
    if (blockNumber == null) {
      return null;
    }
    const block = this.provider.getBlock(blockNumber);
    if (block == null) {
      throw new Error("TODO");
    }
    return block;
  }
  /**
   *  Resolves to this transaction being re-requested from the
   *  provider. This can be used if you have an unmined transaction
   *  and wish to get an up-to-date populated instance.
   */
  async getTransaction() {
    return this.provider.getTransaction(this.hash);
  }
  /**
   *  Resolve to the number of confirmations this transaction has.
   */
  async confirmations() {
    if (this.blockNumber == null) {
      const { tx, blockNumber: blockNumber2 } = await resolveProperties({
        tx: this.getTransaction(),
        blockNumber: this.provider.getBlockNumber()
      });
      if (tx == null || tx.blockNumber == null) {
        return 0;
      }
      return blockNumber2 - tx.blockNumber + 1;
    }
    const blockNumber = await this.provider.getBlockNumber();
    return blockNumber - this.blockNumber + 1;
  }
  /**
   *  Resolves once this transaction has been mined and has
   *  %%confirms%% blocks including it (default: ``1``) with an
   *  optional %%timeout%%.
   *
   *  This can resolve to ``null`` only if %%confirms%% is ``0``
   *  and the transaction has not been mined, otherwise this will
   *  wait until enough confirmations have completed.
   */
  async wait(_confirms, _timeout) {
    const confirms = _confirms == null ? 1 : _confirms;
    const timeout = _timeout == null ? 0 : _timeout;
    let startBlock = this.#startBlock;
    let nextScan = -1;
    let stopScanning = startBlock === -1 ? true : false;
    const checkReplacement = async () => {
      if (stopScanning) {
        return null;
      }
      const { blockNumber, nonce } = await resolveProperties({
        blockNumber: this.provider.getBlockNumber(),
        nonce: this.provider.getTransactionCount(this.from)
      });
      if (nonce < this.nonce) {
        startBlock = blockNumber;
        return;
      }
      if (stopScanning) {
        return null;
      }
      const mined = await this.getTransaction();
      if (mined && mined.blockNumber != null) {
        return;
      }
      if (nextScan === -1) {
        nextScan = startBlock - 3;
        if (nextScan < this.#startBlock) {
          nextScan = this.#startBlock;
        }
      }
      while (nextScan <= blockNumber) {
        if (stopScanning) {
          return null;
        }
        const block = await this.provider.getBlock(nextScan, true);
        if (block == null) {
          return;
        }
        for (const hash of block) {
          if (hash === this.hash) {
            return;
          }
        }
        for (let i = 0; i < block.length; i++) {
          const tx = await block.getTransaction(i);
          if (tx.from === this.from && tx.nonce === this.nonce) {
            if (stopScanning) {
              return null;
            }
            const receipt2 = await this.provider.getTransactionReceipt(tx.hash);
            if (receipt2 == null) {
              return;
            }
            if (blockNumber - receipt2.blockNumber + 1 < confirms) {
              return;
            }
            let reason = "replaced";
            if (tx.data === this.data && tx.to === this.to && tx.value === this.value) {
              reason = "repriced";
            } else if (tx.data === "0x" && tx.from === tx.to && tx.value === BN_04) {
              reason = "cancelled";
            }
            assert(false, "transaction was replaced", "TRANSACTION_REPLACED", {
              cancelled: reason === "replaced" || reason === "cancelled",
              reason,
              replacement: tx.replaceableTransaction(startBlock),
              hash: tx.hash,
              receipt: receipt2
            });
          }
        }
        nextScan++;
      }
      return;
    };
    const checkReceipt = (receipt2) => {
      if (receipt2 == null || receipt2.status !== 0) {
        return receipt2;
      }
      assert(false, "transaction execution reverted", "CALL_EXCEPTION", {
        action: "sendTransaction",
        data: null,
        reason: null,
        invocation: null,
        revert: null,
        transaction: {
          to: receipt2.to,
          from: receipt2.from,
          data: ""
          // @TODO: in v7, split out sendTransaction properties
        },
        receipt: receipt2
      });
    };
    const receipt = await this.provider.getTransactionReceipt(this.hash);
    if (confirms === 0) {
      return checkReceipt(receipt);
    }
    if (receipt) {
      if (await receipt.confirmations() >= confirms) {
        return checkReceipt(receipt);
      }
    } else {
      await checkReplacement();
      if (confirms === 0) {
        return null;
      }
    }
    const waiter = new Promise((resolve, reject) => {
      const cancellers = [];
      const cancel = () => {
        cancellers.forEach((c) => c());
      };
      cancellers.push(() => {
        stopScanning = true;
      });
      if (timeout > 0) {
        const timer = setTimeout(() => {
          cancel();
          reject(makeError("wait for transaction timeout", "TIMEOUT"));
        }, timeout);
        cancellers.push(() => {
          clearTimeout(timer);
        });
      }
      const txListener = async (receipt2) => {
        if (await receipt2.confirmations() >= confirms) {
          cancel();
          try {
            resolve(checkReceipt(receipt2));
          } catch (error) {
            reject(error);
          }
        }
      };
      cancellers.push(() => {
        this.provider.off(this.hash, txListener);
      });
      this.provider.on(this.hash, txListener);
      if (startBlock >= 0) {
        const replaceListener = async () => {
          try {
            await checkReplacement();
          } catch (error) {
            if (isError(error, "TRANSACTION_REPLACED")) {
              cancel();
              reject(error);
              return;
            }
          }
          if (!stopScanning) {
            this.provider.once("block", replaceListener);
          }
        };
        cancellers.push(() => {
          this.provider.off("block", replaceListener);
        });
        this.provider.once("block", replaceListener);
      }
    });
    return await waiter;
  }
  /**
   *  Returns ``true`` if this transaction has been included.
   *
   *  This is effective only as of the time the TransactionResponse
   *  was instantiated. To get up-to-date information, use
   *  [[getTransaction]].
   *
   *  This provides a Type Guard that this transaction will have
   *  non-null property values for properties that are null for
   *  unmined transactions.
   */
  isMined() {
    return this.blockHash != null;
  }
  /**
   *  Returns true if the transaction is a legacy (i.e. ``type == 0``)
   *  transaction.
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isLegacy() {
    return this.type === 0;
  }
  /**
   *  Returns true if the transaction is a Berlin (i.e. ``type == 1``)
   *  transaction. See [[link-eip-2070]].
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isBerlin() {
    return this.type === 1;
  }
  /**
   *  Returns true if the transaction is a London (i.e. ``type == 2``)
   *  transaction. See [[link-eip-1559]].
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isLondon() {
    return this.type === 2;
  }
  /**
   *  Returns true if hte transaction is a Cancun (i.e. ``type == 3``)
   *  transaction. See [[link-eip-4844]].
   */
  isCancun() {
    return this.type === 3;
  }
  /**
   *  Returns a filter which can be used to listen for orphan events
   *  that evict this transaction.
   */
  removedEvent() {
    assert(this.isMined(), "unmined transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    return createRemovedTransactionFilter(this);
  }
  /**
   *  Returns a filter which can be used to listen for orphan events
   *  that re-order this event against %%other%%.
   */
  reorderedEvent(other) {
    assert(this.isMined(), "unmined transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    assert(!other || other.isMined(), "unmined 'other' transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    return createReorderedTransactionFilter(this, other);
  }
  /**
   *  Returns a new TransactionResponse instance which has the ability to
   *  detect (and throw an error) if the transaction is replaced, which
   *  will begin scanning at %%startBlock%%.
   *
   *  This should generally not be used by developers and is intended
   *  primarily for internal use. Setting an incorrect %%startBlock%% can
   *  have devastating performance consequences if used incorrectly.
   */
  replaceableTransaction(startBlock) {
    assertArgument(Number.isInteger(startBlock) && startBlock >= 0, "invalid startBlock", "startBlock", startBlock);
    const tx = new TransactionResponse(this, this.provider);
    tx.#startBlock = startBlock;
    return tx;
  }
};
function createOrphanedBlockFilter(block) {
  return { orphan: "drop-block", hash: block.hash, number: block.number };
}
function createReorderedTransactionFilter(tx, other) {
  return { orphan: "reorder-transaction", tx, other };
}
function createRemovedTransactionFilter(tx) {
  return { orphan: "drop-transaction", tx };
}
function createRemovedLogFilter(log3) {
  return { orphan: "drop-log", log: {
    transactionHash: log3.transactionHash,
    blockHash: log3.blockHash,
    blockNumber: log3.blockNumber,
    address: log3.address,
    data: log3.data,
    topics: Object.freeze(log3.topics.slice()),
    index: log3.index
  } };
}

// node_modules/ethers/lib.esm/contract/wrappers.js
var EventLog = class extends Log {
  /**
   *  The Contract Interface.
   */
  interface;
  /**
   *  The matching event.
   */
  fragment;
  /**
   *  The parsed arguments passed to the event by ``emit``.
   */
  args;
  /**
   * @_ignore:
   */
  constructor(log3, iface, fragment) {
    super(log3, log3.provider);
    const args = iface.decodeEventLog(fragment, log3.data, log3.topics);
    defineProperties(this, { args, fragment, interface: iface });
  }
  /**
   *  The name of the event.
   */
  get eventName() {
    return this.fragment.name;
  }
  /**
   *  The signature of the event.
   */
  get eventSignature() {
    return this.fragment.format();
  }
};
var UndecodedEventLog = class extends Log {
  /**
   *  The error encounted when trying to decode the log.
   */
  error;
  /**
   * @_ignore:
   */
  constructor(log3, error) {
    super(log3, log3.provider);
    defineProperties(this, { error });
  }
};
var ContractTransactionReceipt = class extends TransactionReceipt {
  #iface;
  /**
   *  @_ignore:
   */
  constructor(iface, provider, tx) {
    super(tx, provider);
    this.#iface = iface;
  }
  /**
   *  The parsed logs for any [[Log]] which has a matching event in the
   *  Contract ABI.
   */
  get logs() {
    return super.logs.map((log3) => {
      const fragment = log3.topics.length ? this.#iface.getEvent(log3.topics[0]) : null;
      if (fragment) {
        try {
          return new EventLog(log3, this.#iface, fragment);
        } catch (error) {
          return new UndecodedEventLog(log3, error);
        }
      }
      return log3;
    });
  }
};
var ContractTransactionResponse = class extends TransactionResponse {
  #iface;
  /**
   *  @_ignore:
   */
  constructor(iface, provider, tx) {
    super(tx, provider);
    this.#iface = iface;
  }
  /**
   *  Resolves once this transaction has been mined and has
   *  %%confirms%% blocks including it (default: ``1``) with an
   *  optional %%timeout%%.
   *
   *  This can resolve to ``null`` only if %%confirms%% is ``0``
   *  and the transaction has not been mined, otherwise this will
   *  wait until enough confirmations have completed.
   */
  async wait(confirms, timeout) {
    const receipt = await super.wait(confirms, timeout);
    if (receipt == null) {
      return null;
    }
    return new ContractTransactionReceipt(this.#iface, this.provider, receipt);
  }
};
var ContractUnknownEventPayload = class extends EventPayload {
  /**
   *  The log with no matching events.
   */
  log;
  /**
   *  @_event:
   */
  constructor(contract, listener, filter, log3) {
    super(contract, listener, filter);
    defineProperties(this, { log: log3 });
  }
  /**
   *  Resolves to the block the event occured in.
   */
  async getBlock() {
    return await this.log.getBlock();
  }
  /**
   *  Resolves to the transaction the event occured in.
   */
  async getTransaction() {
    return await this.log.getTransaction();
  }
  /**
   *  Resolves to the transaction receipt the event occured in.
   */
  async getTransactionReceipt() {
    return await this.log.getTransactionReceipt();
  }
};
var ContractEventPayload = class extends ContractUnknownEventPayload {
  /**
   *  @_ignore:
   */
  constructor(contract, listener, filter, fragment, _log) {
    super(contract, listener, filter, new EventLog(_log, contract.interface, fragment));
    const args = contract.interface.decodeEventLog(fragment, this.log.data, this.log.topics);
    defineProperties(this, { args, fragment });
  }
  /**
   *  The event name.
   */
  get eventName() {
    return this.fragment.name;
  }
  /**
   *  The event signature.
   */
  get eventSignature() {
    return this.fragment.format();
  }
};

// node_modules/ethers/lib.esm/contract/contract.js
var BN_05 = BigInt(0);
function canCall(value) {
  return value && typeof value.call === "function";
}
function canEstimate(value) {
  return value && typeof value.estimateGas === "function";
}
function canResolve(value) {
  return value && typeof value.resolveName === "function";
}
function canSend(value) {
  return value && typeof value.sendTransaction === "function";
}
function getResolver(value) {
  if (value != null) {
    if (canResolve(value)) {
      return value;
    }
    if (value.provider) {
      return value.provider;
    }
  }
  return void 0;
}
var PreparedTopicFilter = class {
  #filter;
  fragment;
  constructor(contract, fragment, args) {
    defineProperties(this, { fragment });
    if (fragment.inputs.length < args.length) {
      throw new Error("too many arguments");
    }
    const runner = getRunner(contract.runner, "resolveName");
    const resolver = canResolve(runner) ? runner : null;
    this.#filter = async function() {
      const resolvedArgs = await Promise.all(fragment.inputs.map((param, index) => {
        const arg = args[index];
        if (arg == null) {
          return null;
        }
        return param.walkAsync(args[index], (type, value) => {
          if (type === "address") {
            if (Array.isArray(value)) {
              return Promise.all(value.map((v) => resolveAddress(v, resolver)));
            }
            return resolveAddress(value, resolver);
          }
          return value;
        });
      }));
      return contract.interface.encodeFilterTopics(fragment, resolvedArgs);
    }();
  }
  getTopicFilter() {
    return this.#filter;
  }
};
function getRunner(value, feature) {
  if (value == null) {
    return null;
  }
  if (typeof value[feature] === "function") {
    return value;
  }
  if (value.provider && typeof value.provider[feature] === "function") {
    return value.provider;
  }
  return null;
}
function getProvider(value) {
  if (value == null) {
    return null;
  }
  return value.provider || null;
}
async function copyOverrides(arg, allowed) {
  const _overrides = Typed.dereference(arg, "overrides");
  assertArgument(typeof _overrides === "object", "invalid overrides parameter", "overrides", arg);
  const overrides = copyRequest(_overrides);
  assertArgument(overrides.to == null || (allowed || []).indexOf("to") >= 0, "cannot override to", "overrides.to", overrides.to);
  assertArgument(overrides.data == null || (allowed || []).indexOf("data") >= 0, "cannot override data", "overrides.data", overrides.data);
  if (overrides.from) {
    overrides.from = overrides.from;
  }
  return overrides;
}
async function resolveArgs(_runner, inputs, args) {
  const runner = getRunner(_runner, "resolveName");
  const resolver = canResolve(runner) ? runner : null;
  return await Promise.all(inputs.map((param, index) => {
    return param.walkAsync(args[index], (type, value) => {
      value = Typed.dereference(value, type);
      if (type === "address") {
        return resolveAddress(value, resolver);
      }
      return value;
    });
  }));
}
function buildWrappedFallback(contract) {
  const populateTransaction = async function(overrides) {
    const tx = await copyOverrides(overrides, ["data"]);
    tx.to = await contract.getAddress();
    if (tx.from) {
      tx.from = await resolveAddress(tx.from, getResolver(contract.runner));
    }
    const iface = contract.interface;
    const noValue = getBigInt(tx.value || BN_05, "overrides.value") === BN_05;
    const noData = (tx.data || "0x") === "0x";
    if (iface.fallback && !iface.fallback.payable && iface.receive && !noData && !noValue) {
      assertArgument(false, "cannot send data to receive or send value to non-payable fallback", "overrides", overrides);
    }
    assertArgument(iface.fallback || noData, "cannot send data to receive-only contract", "overrides.data", tx.data);
    const payable = iface.receive || iface.fallback && iface.fallback.payable;
    assertArgument(payable || noValue, "cannot send value to non-payable fallback", "overrides.value", tx.value);
    assertArgument(iface.fallback || noData, "cannot send data to receive-only contract", "overrides.data", tx.data);
    return tx;
  };
  const staticCall = async function(overrides) {
    const runner = getRunner(contract.runner, "call");
    assert(canCall(runner), "contract runner does not support calling", "UNSUPPORTED_OPERATION", { operation: "call" });
    const tx = await populateTransaction(overrides);
    try {
      return await runner.call(tx);
    } catch (error) {
      if (isCallException(error) && error.data) {
        throw contract.interface.makeError(error.data, tx);
      }
      throw error;
    }
  };
  const send = async function(overrides) {
    const runner = contract.runner;
    assert(canSend(runner), "contract runner does not support sending transactions", "UNSUPPORTED_OPERATION", { operation: "sendTransaction" });
    const tx = await runner.sendTransaction(await populateTransaction(overrides));
    const provider = getProvider(contract.runner);
    return new ContractTransactionResponse(contract.interface, provider, tx);
  };
  const estimateGas = async function(overrides) {
    const runner = getRunner(contract.runner, "estimateGas");
    assert(canEstimate(runner), "contract runner does not support gas estimation", "UNSUPPORTED_OPERATION", { operation: "estimateGas" });
    return await runner.estimateGas(await populateTransaction(overrides));
  };
  const method = async (overrides) => {
    return await send(overrides);
  };
  defineProperties(method, {
    _contract: contract,
    estimateGas,
    populateTransaction,
    send,
    staticCall
  });
  return method;
}
function buildWrappedMethod(contract, key) {
  const getFragment = function(...args) {
    const fragment = contract.interface.getFunction(key, args);
    assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
      operation: "fragment",
      info: { key, args }
    });
    return fragment;
  };
  const populateTransaction = async function(...args) {
    const fragment = getFragment(...args);
    let overrides = {};
    if (fragment.inputs.length + 1 === args.length) {
      overrides = await copyOverrides(args.pop());
      if (overrides.from) {
        overrides.from = await resolveAddress(overrides.from, getResolver(contract.runner));
      }
    }
    if (fragment.inputs.length !== args.length) {
      throw new Error("internal error: fragment inputs doesn't match arguments; should not happen");
    }
    const resolvedArgs = await resolveArgs(contract.runner, fragment.inputs, args);
    return Object.assign({}, overrides, await resolveProperties({
      to: contract.getAddress(),
      data: contract.interface.encodeFunctionData(fragment, resolvedArgs)
    }));
  };
  const staticCall = async function(...args) {
    const result = await staticCallResult(...args);
    if (result.length === 1) {
      return result[0];
    }
    return result;
  };
  const send = async function(...args) {
    const runner = contract.runner;
    assert(canSend(runner), "contract runner does not support sending transactions", "UNSUPPORTED_OPERATION", { operation: "sendTransaction" });
    const tx = await runner.sendTransaction(await populateTransaction(...args));
    const provider = getProvider(contract.runner);
    return new ContractTransactionResponse(contract.interface, provider, tx);
  };
  const estimateGas = async function(...args) {
    const runner = getRunner(contract.runner, "estimateGas");
    assert(canEstimate(runner), "contract runner does not support gas estimation", "UNSUPPORTED_OPERATION", { operation: "estimateGas" });
    return await runner.estimateGas(await populateTransaction(...args));
  };
  const staticCallResult = async function(...args) {
    const runner = getRunner(contract.runner, "call");
    assert(canCall(runner), "contract runner does not support calling", "UNSUPPORTED_OPERATION", { operation: "call" });
    const tx = await populateTransaction(...args);
    let result = "0x";
    try {
      result = await runner.call(tx);
    } catch (error) {
      if (isCallException(error) && error.data) {
        throw contract.interface.makeError(error.data, tx);
      }
      throw error;
    }
    const fragment = getFragment(...args);
    return contract.interface.decodeFunctionResult(fragment, result);
  };
  const method = async (...args) => {
    const fragment = getFragment(...args);
    if (fragment.constant) {
      return await staticCall(...args);
    }
    return await send(...args);
  };
  defineProperties(method, {
    name: contract.interface.getFunctionName(key),
    _contract: contract,
    _key: key,
    getFragment,
    estimateGas,
    populateTransaction,
    send,
    staticCall,
    staticCallResult
  });
  Object.defineProperty(method, "fragment", {
    configurable: false,
    enumerable: true,
    get: () => {
      const fragment = contract.interface.getFunction(key);
      assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
        operation: "fragment",
        info: { key }
      });
      return fragment;
    }
  });
  return method;
}
function buildWrappedEvent(contract, key) {
  const getFragment = function(...args) {
    const fragment = contract.interface.getEvent(key, args);
    assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
      operation: "fragment",
      info: { key, args }
    });
    return fragment;
  };
  const method = function(...args) {
    return new PreparedTopicFilter(contract, getFragment(...args), args);
  };
  defineProperties(method, {
    name: contract.interface.getEventName(key),
    _contract: contract,
    _key: key,
    getFragment
  });
  Object.defineProperty(method, "fragment", {
    configurable: false,
    enumerable: true,
    get: () => {
      const fragment = contract.interface.getEvent(key);
      assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
        operation: "fragment",
        info: { key }
      });
      return fragment;
    }
  });
  return method;
}
var internal2 = Symbol.for("_ethersInternal_contract");
var internalValues = /* @__PURE__ */ new WeakMap();
function setInternal(contract, values) {
  internalValues.set(contract[internal2], values);
}
function getInternal(contract) {
  return internalValues.get(contract[internal2]);
}
function isDeferred(value) {
  return value && typeof value === "object" && "getTopicFilter" in value && typeof value.getTopicFilter === "function" && value.fragment;
}
async function getSubInfo(contract, event) {
  let topics;
  let fragment = null;
  if (Array.isArray(event)) {
    const topicHashify = function(name) {
      if (isHexString(name, 32)) {
        return name;
      }
      const fragment2 = contract.interface.getEvent(name);
      assertArgument(fragment2, "unknown fragment", "name", name);
      return fragment2.topicHash;
    };
    topics = event.map((e) => {
      if (e == null) {
        return null;
      }
      if (Array.isArray(e)) {
        return e.map(topicHashify);
      }
      return topicHashify(e);
    });
  } else if (event === "*") {
    topics = [null];
  } else if (typeof event === "string") {
    if (isHexString(event, 32)) {
      topics = [event];
    } else {
      fragment = contract.interface.getEvent(event);
      assertArgument(fragment, "unknown fragment", "event", event);
      topics = [fragment.topicHash];
    }
  } else if (isDeferred(event)) {
    topics = await event.getTopicFilter();
  } else if ("fragment" in event) {
    fragment = event.fragment;
    topics = [fragment.topicHash];
  } else {
    assertArgument(false, "unknown event name", "event", event);
  }
  topics = topics.map((t) => {
    if (t == null) {
      return null;
    }
    if (Array.isArray(t)) {
      const items = Array.from(new Set(t.map((t2) => t2.toLowerCase())).values());
      if (items.length === 1) {
        return items[0];
      }
      items.sort();
      return items;
    }
    return t.toLowerCase();
  });
  const tag2 = topics.map((t) => {
    if (t == null) {
      return "null";
    }
    if (Array.isArray(t)) {
      return t.join("|");
    }
    return t;
  }).join("&");
  return { fragment, tag: tag2, topics };
}
async function hasSub(contract, event) {
  const { subs } = getInternal(contract);
  return subs.get((await getSubInfo(contract, event)).tag) || null;
}
async function getSub(contract, operation, event) {
  const provider = getProvider(contract.runner);
  assert(provider, "contract runner does not support subscribing", "UNSUPPORTED_OPERATION", { operation });
  const { fragment, tag: tag2, topics } = await getSubInfo(contract, event);
  const { addr, subs } = getInternal(contract);
  let sub2 = subs.get(tag2);
  if (!sub2) {
    const address = addr ? addr : contract;
    const filter = { address, topics };
    const listener = (log3) => {
      let foundFragment = fragment;
      if (foundFragment == null) {
        try {
          foundFragment = contract.interface.getEvent(log3.topics[0]);
        } catch (error) {
        }
      }
      if (foundFragment) {
        const _foundFragment = foundFragment;
        const args = fragment ? contract.interface.decodeEventLog(fragment, log3.data, log3.topics) : [];
        emit(contract, event, args, (listener2) => {
          return new ContractEventPayload(contract, listener2, event, _foundFragment, log3);
        });
      } else {
        emit(contract, event, [], (listener2) => {
          return new ContractUnknownEventPayload(contract, listener2, event, log3);
        });
      }
    };
    let starting = [];
    const start = () => {
      if (starting.length) {
        return;
      }
      starting.push(provider.on(filter, listener));
    };
    const stop = async () => {
      if (starting.length == 0) {
        return;
      }
      let started = starting;
      starting = [];
      await Promise.all(started);
      provider.off(filter, listener);
    };
    sub2 = { tag: tag2, listeners: [], start, stop };
    subs.set(tag2, sub2);
  }
  return sub2;
}
var lastEmit = Promise.resolve();
async function _emit(contract, event, args, payloadFunc) {
  await lastEmit;
  const sub2 = await hasSub(contract, event);
  if (!sub2) {
    return false;
  }
  const count = sub2.listeners.length;
  sub2.listeners = sub2.listeners.filter(({ listener, once }) => {
    const passArgs = Array.from(args);
    if (payloadFunc) {
      passArgs.push(payloadFunc(once ? null : listener));
    }
    try {
      listener.call(contract, ...passArgs);
    } catch (error) {
    }
    return !once;
  });
  if (sub2.listeners.length === 0) {
    sub2.stop();
    getInternal(contract).subs.delete(sub2.tag);
  }
  return count > 0;
}
async function emit(contract, event, args, payloadFunc) {
  try {
    await lastEmit;
  } catch (error) {
  }
  const resultPromise = _emit(contract, event, args, payloadFunc);
  lastEmit = resultPromise;
  return await resultPromise;
}
var passProperties2 = ["then"];
var BaseContract = class {
  /**
   *  The target to connect to.
   *
   *  This can be an address, ENS name or any [[Addressable]], such as
   *  another contract. To get the resovled address, use the ``getAddress``
   *  method.
   */
  target;
  /**
   *  The contract Interface.
   */
  interface;
  /**
   *  The connected runner. This is generally a [[Provider]] or a
   *  [[Signer]], which dictates what operations are supported.
   *
   *  For example, a **Contract** connected to a [[Provider]] may
   *  only execute read-only operations.
   */
  runner;
  /**
   *  All the Events available on this contract.
   */
  filters;
  /**
   *  @_ignore:
   */
  [internal2];
  /**
   *  The fallback or receive function if any.
   */
  fallback;
  /**
   *  Creates a new contract connected to %%target%% with the %%abi%% and
   *  optionally connected to a %%runner%% to perform operations on behalf
   *  of.
   */
  constructor(target, abi, runner, _deployTx) {
    assertArgument(typeof target === "string" || isAddressable(target), "invalid value for Contract target", "target", target);
    if (runner == null) {
      runner = null;
    }
    const iface = Interface.from(abi);
    defineProperties(this, { target, runner, interface: iface });
    Object.defineProperty(this, internal2, { value: {} });
    let addrPromise;
    let addr = null;
    let deployTx = null;
    if (_deployTx) {
      const provider = getProvider(runner);
      deployTx = new ContractTransactionResponse(this.interface, provider, _deployTx);
    }
    let subs = /* @__PURE__ */ new Map();
    if (typeof target === "string") {
      if (isHexString(target)) {
        addr = target;
        addrPromise = Promise.resolve(target);
      } else {
        const resolver = getRunner(runner, "resolveName");
        if (!canResolve(resolver)) {
          throw makeError("contract runner does not support name resolution", "UNSUPPORTED_OPERATION", {
            operation: "resolveName"
          });
        }
        addrPromise = resolver.resolveName(target).then((addr2) => {
          if (addr2 == null) {
            throw makeError("an ENS name used for a contract target must be correctly configured", "UNCONFIGURED_NAME", {
              value: target
            });
          }
          getInternal(this).addr = addr2;
          return addr2;
        });
      }
    } else {
      addrPromise = target.getAddress().then((addr2) => {
        if (addr2 == null) {
          throw new Error("TODO");
        }
        getInternal(this).addr = addr2;
        return addr2;
      });
    }
    setInternal(this, { addrPromise, addr, deployTx, subs });
    const filters = new Proxy({}, {
      get: (target2, prop, receiver) => {
        if (typeof prop === "symbol" || passProperties2.indexOf(prop) >= 0) {
          return Reflect.get(target2, prop, receiver);
        }
        try {
          return this.getEvent(prop);
        } catch (error) {
          if (!isError(error, "INVALID_ARGUMENT") || error.argument !== "key") {
            throw error;
          }
        }
        return void 0;
      },
      has: (target2, prop) => {
        if (passProperties2.indexOf(prop) >= 0) {
          return Reflect.has(target2, prop);
        }
        return Reflect.has(target2, prop) || this.interface.hasEvent(String(prop));
      }
    });
    defineProperties(this, { filters });
    defineProperties(this, {
      fallback: iface.receive || iface.fallback ? buildWrappedFallback(this) : null
    });
    return new Proxy(this, {
      get: (target2, prop, receiver) => {
        if (typeof prop === "symbol" || prop in target2 || passProperties2.indexOf(prop) >= 0) {
          return Reflect.get(target2, prop, receiver);
        }
        try {
          return target2.getFunction(prop);
        } catch (error) {
          if (!isError(error, "INVALID_ARGUMENT") || error.argument !== "key") {
            throw error;
          }
        }
        return void 0;
      },
      has: (target2, prop) => {
        if (typeof prop === "symbol" || prop in target2 || passProperties2.indexOf(prop) >= 0) {
          return Reflect.has(target2, prop);
        }
        return target2.interface.hasFunction(prop);
      }
    });
  }
  /**
   *  Return a new Contract instance with the same target and ABI, but
   *  a different %%runner%%.
   */
  connect(runner) {
    return new BaseContract(this.target, this.interface, runner);
  }
  /**
   *  Return a new Contract instance with the same ABI and runner, but
   *  a different %%target%%.
   */
  attach(target) {
    return new BaseContract(target, this.interface, this.runner);
  }
  /**
   *  Return the resolved address of this Contract.
   */
  async getAddress() {
    return await getInternal(this).addrPromise;
  }
  /**
   *  Return the deployed bytecode or null if no bytecode is found.
   */
  async getDeployedCode() {
    const provider = getProvider(this.runner);
    assert(provider, "runner does not support .provider", "UNSUPPORTED_OPERATION", { operation: "getDeployedCode" });
    const code = await provider.getCode(await this.getAddress());
    if (code === "0x") {
      return null;
    }
    return code;
  }
  /**
   *  Resolve to this Contract once the bytecode has been deployed, or
   *  resolve immediately if already deployed.
   */
  async waitForDeployment() {
    const deployTx = this.deploymentTransaction();
    if (deployTx) {
      await deployTx.wait();
      return this;
    }
    const code = await this.getDeployedCode();
    if (code != null) {
      return this;
    }
    const provider = getProvider(this.runner);
    assert(provider != null, "contract runner does not support .provider", "UNSUPPORTED_OPERATION", { operation: "waitForDeployment" });
    return new Promise((resolve, reject) => {
      const checkCode = async () => {
        try {
          const code2 = await this.getDeployedCode();
          if (code2 != null) {
            return resolve(this);
          }
          provider.once("block", checkCode);
        } catch (error) {
          reject(error);
        }
      };
      checkCode();
    });
  }
  /**
   *  Return the transaction used to deploy this contract.
   *
   *  This is only available if this instance was returned from a
   *  [[ContractFactory]].
   */
  deploymentTransaction() {
    return getInternal(this).deployTx;
  }
  /**
   *  Return the function for a given name. This is useful when a contract
   *  method name conflicts with a JavaScript name such as ``prototype`` or
   *  when using a Contract programatically.
   */
  getFunction(key) {
    if (typeof key !== "string") {
      key = key.format();
    }
    const func = buildWrappedMethod(this, key);
    return func;
  }
  /**
   *  Return the event for a given name. This is useful when a contract
   *  event name conflicts with a JavaScript name such as ``prototype`` or
   *  when using a Contract programatically.
   */
  getEvent(key) {
    if (typeof key !== "string") {
      key = key.format();
    }
    return buildWrappedEvent(this, key);
  }
  /**
   *  @_ignore:
   */
  async queryTransaction(hash) {
    throw new Error("@TODO");
  }
  /*
      // @TODO: this is a non-backwards compatible change, but will be added
      //        in v7 and in a potential SmartContract class in an upcoming
      //        v6 release
      async getTransactionReceipt(hash: string): Promise<null | ContractTransactionReceipt> {
          const provider = getProvider(this.runner);
          assert(provider, "contract runner does not have a provider",
              "UNSUPPORTED_OPERATION", { operation: "queryTransaction" });
  
          const receipt = await provider.getTransactionReceipt(hash);
          if (receipt == null) { return null; }
  
          return new ContractTransactionReceipt(this.interface, provider, receipt);
      }
      */
  /**
   *  Provide historic access to event data for %%event%% in the range
   *  %%fromBlock%% (default: ``0``) to %%toBlock%% (default: ``"latest"``)
   *  inclusive.
   */
  async queryFilter(event, fromBlock, toBlock) {
    if (fromBlock == null) {
      fromBlock = 0;
    }
    if (toBlock == null) {
      toBlock = "latest";
    }
    const { addr, addrPromise } = getInternal(this);
    const address = addr ? addr : await addrPromise;
    const { fragment, topics } = await getSubInfo(this, event);
    const filter = { address, topics, fromBlock, toBlock };
    const provider = getProvider(this.runner);
    assert(provider, "contract runner does not have a provider", "UNSUPPORTED_OPERATION", { operation: "queryFilter" });
    return (await provider.getLogs(filter)).map((log3) => {
      let foundFragment = fragment;
      if (foundFragment == null) {
        try {
          foundFragment = this.interface.getEvent(log3.topics[0]);
        } catch (error) {
        }
      }
      if (foundFragment) {
        try {
          return new EventLog(log3, this.interface, foundFragment);
        } catch (error) {
          return new UndecodedEventLog(log3, error);
        }
      }
      return new Log(log3, provider);
    });
  }
  /**
   *  Add an event %%listener%% for the %%event%%.
   */
  async on(event, listener) {
    const sub2 = await getSub(this, "on", event);
    sub2.listeners.push({ listener, once: false });
    sub2.start();
    return this;
  }
  /**
   *  Add an event %%listener%% for the %%event%%, but remove the listener
   *  after it is fired once.
   */
  async once(event, listener) {
    const sub2 = await getSub(this, "once", event);
    sub2.listeners.push({ listener, once: true });
    sub2.start();
    return this;
  }
  /**
   *  Emit an %%event%% calling all listeners with %%args%%.
   *
   *  Resolves to ``true`` if any listeners were called.
   */
  async emit(event, ...args) {
    return await emit(this, event, args, null);
  }
  /**
   *  Resolves to the number of listeners of %%event%% or the total number
   *  of listeners if unspecified.
   */
  async listenerCount(event) {
    if (event) {
      const sub2 = await hasSub(this, event);
      if (!sub2) {
        return 0;
      }
      return sub2.listeners.length;
    }
    const { subs } = getInternal(this);
    let total = 0;
    for (const { listeners } of subs.values()) {
      total += listeners.length;
    }
    return total;
  }
  /**
   *  Resolves to the listeners subscribed to %%event%% or all listeners
   *  if unspecified.
   */
  async listeners(event) {
    if (event) {
      const sub2 = await hasSub(this, event);
      if (!sub2) {
        return [];
      }
      return sub2.listeners.map(({ listener }) => listener);
    }
    const { subs } = getInternal(this);
    let result = [];
    for (const { listeners } of subs.values()) {
      result = result.concat(listeners.map(({ listener }) => listener));
    }
    return result;
  }
  /**
   *  Remove the %%listener%% from the listeners for %%event%% or remove
   *  all listeners if unspecified.
   */
  async off(event, listener) {
    const sub2 = await hasSub(this, event);
    if (!sub2) {
      return this;
    }
    if (listener) {
      const index = sub2.listeners.map(({ listener: listener2 }) => listener2).indexOf(listener);
      if (index >= 0) {
        sub2.listeners.splice(index, 1);
      }
    }
    if (listener == null || sub2.listeners.length === 0) {
      sub2.stop();
      getInternal(this).subs.delete(sub2.tag);
    }
    return this;
  }
  /**
   *  Remove all the listeners for %%event%% or remove all listeners if
   *  unspecified.
   */
  async removeAllListeners(event) {
    if (event) {
      const sub2 = await hasSub(this, event);
      if (!sub2) {
        return this;
      }
      sub2.stop();
      getInternal(this).subs.delete(sub2.tag);
    } else {
      const { subs } = getInternal(this);
      for (const { tag: tag2, stop } of subs.values()) {
        stop();
        subs.delete(tag2);
      }
    }
    return this;
  }
  /**
   *  Alias for [on].
   */
  async addListener(event, listener) {
    return await this.on(event, listener);
  }
  /**
   *  Alias for [off].
   */
  async removeListener(event, listener) {
    return await this.off(event, listener);
  }
  /**
   *  Create a new Class for the %%abi%%.
   */
  static buildClass(abi) {
    class CustomContract extends BaseContract {
      constructor(address, runner = null) {
        super(address, abi, runner);
      }
    }
    return CustomContract;
  }
  /**
   *  Create a new BaseContract with a specified Interface.
   */
  static from(target, abi, runner) {
    if (runner == null) {
      runner = null;
    }
    const contract = new this(target, abi, runner);
    return contract;
  }
};
function _ContractBase() {
  return BaseContract;
}
var Contract = class extends _ContractBase() {
};

// node_modules/ethers/lib.esm/contract/factory.js
var ContractFactory = class {
  /**
   *  The Contract Interface.
   */
  interface;
  /**
   *  The Contract deployment bytecode. Often called the initcode.
   */
  bytecode;
  /**
   *  The ContractRunner to deploy the Contract as.
   */
  runner;
  /**
   *  Create a new **ContractFactory** with %%abi%% and %%bytecode%%,
   *  optionally connected to %%runner%%.
   *
   *  The %%bytecode%% may be the ``bytecode`` property within the
   *  standard Solidity JSON output.
   */
  constructor(abi, bytecode, runner) {
    const iface = Interface.from(abi);
    if (bytecode instanceof Uint8Array) {
      bytecode = hexlify(getBytes(bytecode));
    } else {
      if (typeof bytecode === "object") {
        bytecode = bytecode.object;
      }
      if (!bytecode.startsWith("0x")) {
        bytecode = "0x" + bytecode;
      }
      bytecode = hexlify(getBytes(bytecode));
    }
    defineProperties(this, {
      bytecode,
      interface: iface,
      runner: runner || null
    });
  }
  attach(target) {
    return new BaseContract(target, this.interface, this.runner);
  }
  /**
   *  Resolves to the transaction to deploy the contract, passing %%args%%
   *  into the constructor.
   */
  async getDeployTransaction(...args) {
    let overrides = {};
    const fragment = this.interface.deploy;
    if (fragment.inputs.length + 1 === args.length) {
      overrides = await copyOverrides(args.pop());
    }
    if (fragment.inputs.length !== args.length) {
      throw new Error("incorrect number of arguments to constructor");
    }
    const resolvedArgs = await resolveArgs(this.runner, fragment.inputs, args);
    const data = concat([this.bytecode, this.interface.encodeDeploy(resolvedArgs)]);
    return Object.assign({}, overrides, { data });
  }
  /**
   *  Resolves to the Contract deployed by passing %%args%% into the
   *  constructor.
   *
   *  This will resolve to the Contract before it has been deployed to the
   *  network, so the [[BaseContract-waitForDeployment]] should be used before
   *  sending any transactions to it.
   */
  async deploy(...args) {
    const tx = await this.getDeployTransaction(...args);
    assert(this.runner && typeof this.runner.sendTransaction === "function", "factory runner does not support sending transactions", "UNSUPPORTED_OPERATION", {
      operation: "sendTransaction"
    });
    const sentTx = await this.runner.sendTransaction(tx);
    const address = getCreateAddress(sentTx);
    return new BaseContract(address, this.interface, this.runner, sentTx);
  }
  /**
   *  Return a new **ContractFactory** with the same ABI and bytecode,
   *  but connected to %%runner%%.
   */
  connect(runner) {
    return new ContractFactory(this.interface, this.bytecode, runner);
  }
  /**
   *  Create a new **ContractFactory** from the standard Solidity JSON output.
   */
  static fromSolidity(output2, runner) {
    assertArgument(output2 != null, "bad compiler output", "output", output2);
    if (typeof output2 === "string") {
      output2 = JSON.parse(output2);
    }
    const abi = output2.abi;
    let bytecode = "";
    if (output2.bytecode) {
      bytecode = output2.bytecode;
    } else if (output2.evm && output2.evm.bytecode) {
      bytecode = output2.evm.bytecode;
    }
    return new this(abi, bytecode, runner);
  }
};

// libs/typechain/src/factories/AaveV3Provider__factory.ts
var _abi = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositRate",
    outputs: [
      {
        internalType: "uint256",
        name: "rate",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getIdentifier",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "getSource",
    outputs: [
      {
        internalType: "address",
        name: "source",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode = "0x6080604052348015600f57600080fd5b506109c38061001f6000396000f3fe608060405234801561001057600080fd5b50600436106100615760003560e01c8062f714ce146100665780630ae112a41461008e5780634c8f411d146100af5780636e553f65146100c257806373f64d44146100d5578063aa23e03d14610100575b600080fd5b61007961007436600461063a565b610132565b60405190151581526020015b60405180910390f35b6100a161009c36600461066a565b610234565b604051908152602001610085565b6100a16100bd366004610698565b610399565b6100796100d036600461063a565b610497565b6100e86100e33660046106bc565b61058e565b6040516001600160a01b039091168152602001610085565b604080518082018252601081526f20b0bb32afab19afa83937bb34b232b960811b602082015290516100859190610707565b60008061013d6105a0565b9050806001600160a01b03166369328dec846001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa15801561018c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101b09190610765565b6040516001600160e01b031960e084901b1681526001600160a01b0391821660048201526024810188905290861660448201526064016020604051808303816000875af1158015610205573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102299190610782565b506001949350505050565b60008061023f6105a0565b90506000816001600160a01b03166335ea6a75856001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa158015610290573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102b49190610765565b6040516001600160e01b031960e084901b1681526001600160a01b0390911660048201526024016101e060405180830381865afa1580156102f9573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061031d9190610861565b6101008101516040516370a0823160e01b81526001600160a01b0388811660048301529293509116906370a0823190602401602060405180830381865afa15801561036c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103909190610782565b95945050505050565b6000806103a46105a0565b90506000816001600160a01b03166335ea6a75856001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156103f5573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906104199190610765565b6040516001600160e01b031960e084901b1681526001600160a01b0390911660048201526024016101e060405180830381865afa15801561045e573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906104829190610861565b604001516001600160801b0316949350505050565b6000806104a26105a0565b9050806001600160a01b031663617ba037846001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156104f1573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906105159190610765565b6040516001600160e01b031960e084901b1681526001600160a01b03918216600482015260248101889052908616604482015260006064820152608401600060405180830381600087803b15801561056c57600080fd5b505af1158015610580573d6000803e3d6000fd5b506001979650505050505050565b60006105986105a0565b949350505050565b60008073a97684ead0e402dc232d5a977953df7ecbab3cdb9050806001600160a01b031663026b1d5f6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156105f8573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061061c9190610765565b91505090565b6001600160a01b038116811461063757600080fd5b50565b6000806040838503121561064d57600080fd5b82359150602083013561065f81610622565b809150509250929050565b6000806040838503121561067d57600080fd5b823561068881610622565b9150602083013561065f81610622565b6000602082840312156106aa57600080fd5b81356106b581610622565b9392505050565b6000806000606084860312156106d157600080fd5b83356106dc81610622565b925060208401356106ec81610622565b915060408401356106fc81610622565b809150509250925092565b602081526000825180602084015260005b818110156107355760208186018101516040868401015201610718565b506000604082850101526040601f19601f83011684010191505092915050565b805161076081610622565b919050565b60006020828403121561077757600080fd5b81516106b581610622565b60006020828403121561079457600080fd5b5051919050565b6040516101e0810167ffffffffffffffff811182821017156107cd57634e487b7160e01b600052604160045260246000fd5b60405290565b6000602082840312156107e557600080fd5b6040516020810167ffffffffffffffff8111828210171561081657634e487b7160e01b600052604160045260246000fd5b6040529151825250919050565b80516001600160801b038116811461076057600080fd5b805164ffffffffff8116811461076057600080fd5b805161ffff8116811461076057600080fd5b60006101e082840312801561087557600080fd5b5061087e61079b565b61088884846107d3565b815261089660208401610823565b60208201526108a760408401610823565b60408201526108b860608401610823565b60608201526108c960808401610823565b60808201526108da60a08401610823565b60a08201526108eb60c0840161083a565b60c08201526108fc60e0840161084f565b60e082015261090e6101008401610755565b6101008201526109216101208401610755565b6101208201526109346101408401610755565b6101408201526109476101608401610755565b61016082015261095a6101808401610823565b61018082015261096d6101a08401610823565b6101a08201526109806101c08401610823565b6101c0820152939250505056fea26469706673582212205056ffb78b74ace5169910a234db127e2573e40c77cd8c25aac2f1983267eaeb64736f6c63430008210033";
var isSuperArgs = (xs) => xs.length > 1;
var AaveV3Provider__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi);
  }
  static connect(address, runner) {
    return new Contract(address, _abi, runner);
  }
};
AaveV3Provider__factory.bytecode = _bytecode;
AaveV3Provider__factory.abi = _abi;

// libs/typechain/src/factories/CctpV2Adapter__factory.ts
var _abi2 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "asset_",
        type: "address"
      },
      {
        internalType: "address",
        name: "agent_",
        type: "address"
      },
      {
        internalType: "address",
        name: "governance_",
        type: "address"
      },
      {
        internalType: "address",
        name: "tokenMessenger_",
        type: "address"
      },
      {
        internalType: "address",
        name: "messageTransmitter_",
        type: "address"
      },
      {
        internalType: "uint32",
        name: "minFinalityThreshold_",
        type: "uint32"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "InvalidConfig",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidMessage",
    type: "error"
  },
  {
    inputs: [],
    name: "NativeFeeNotAccepted",
    type: "error"
  },
  {
    inputs: [],
    name: "ReceiveFailed",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    inputs: [],
    name: "Unauthorized",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownRemote",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previous",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "next",
        type: "address"
      }
    ],
    name: "GovernanceTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "domain",
        type: "uint32"
      },
      {
        indexed: false,
        internalType: "address",
        name: "remoteAdapter",
        type: "address"
      }
    ],
    name: "RemoteSet",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "uint32",
        name: "destinationDomain",
        type: "uint32"
      },
      {
        indexed: false,
        internalType: "address",
        name: "dstAgent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "maxFee",
        type: "uint256"
      }
    ],
    name: "Sent",
    type: "event"
  },
  {
    inputs: [],
    name: "agent",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint32",
        name: "domain",
        type: "uint32"
      }
    ],
    name: "chainIdOfDomain",
    outputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "payload",
        type: "bytes"
      }
    ],
    name: "finalize",
    outputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        internalType: "uint64",
        name: "srcChainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "srcAgent",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "governance",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "messageTransmitter",
    outputs: [
      {
        internalType: "contract IMessageTransmitterV2",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "minFinalityThreshold",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      }
    ],
    name: "remotes",
    outputs: [
      {
        internalType: "uint32",
        name: "domain",
        type: "uint32"
      },
      {
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        internalType: "bool",
        name: "set",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint64",
        name: "dstChainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "dstAgent",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "minReceive",
        type: "uint256"
      }
    ],
    name: "send",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        internalType: "uint32",
        name: "domain",
        type: "uint32"
      },
      {
        internalType: "address",
        name: "remoteAdapter",
        type: "address"
      }
    ],
    name: "setRemote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "tokenMessenger",
    outputs: [
      {
        internalType: "contract ITokenMessengerV2",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "next",
        type: "address"
      }
    ],
    name: "transferGovernance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode2 = "0x61012060405234801561001157600080fd5b5060405161141138038061141183398101604081905261003091610105565b6001600160a01b038616158061004d57506001600160a01b038516155b8061005f57506001600160a01b038416155b8061007257506001600160a01b0383163b155b8061008557506001600160a01b0382163b155b156100a3576040516306b7c75960e31b815260040160405180910390fd5b6001600160a01b0395861660805293851660a052600080546001600160a01b03191693861693909317909255831660c05290911660e05263ffffffff1661010052610186565b80516001600160a01b038116811461010057600080fd5b919050565b60008060008060008060c0878903121561011e57600080fd5b610127876100e9565b9550610135602088016100e9565b9450610143604088016100e9565b9350610151606088016100e9565b925061015f608088016100e9565b915060a087015163ffffffff8116811461017857600080fd5b809150509295509295509295565b60805160a05160c05160e051610100516111f361021e6000396000818161011101526105600152600081816102ac0152610a66015260008181610238015281816104b0015281816104e5015261063901526000818161034c015281816103790152818161082601526109a90152600081816101ec015281816104590152818161048e0152818161052a015261061501526111f36000f3fe6080604052600436106100a75760003560e01c806357b9fced1161006457806357b9fced1461025a5780635aa6e6751461027a5780637b04c1811461029a578063a0345fca146102ce578063d38bfff41461031a578063f5ff5c761461033a57600080fd5b806306ac9fbf146100ac57806316a0f250146100ff57806318d581d914610148578063292e31ee1461015d57806338d52e0f146101da5780634611783014610226575b600080fd5b3480156100b857600080fd5b506100e26100c7366004610df7565b6002602052600090815260409020546001600160401b031681565b6040516001600160401b0390911681526020015b60405180910390f35b34801561010b57600080fd5b506101337f000000000000000000000000000000000000000000000000000000000000000081565b60405163ffffffff90911681526020016100f6565b61015b610156366004610e47565b61036e565b005b34801561016957600080fd5b506101ae610178366004610e95565b60016020526000908152604090205463ffffffff81169064010000000081046001600160a01b031690600160c01b900460ff1683565b6040805163ffffffff90941684526001600160a01b0390921660208401521515908201526060016100f6565b3480156101e657600080fd5b5061020e7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020016100f6565b34801561023257600080fd5b5061020e7f000000000000000000000000000000000000000000000000000000000000000081565b34801561026657600080fd5b5061015b610275366004610eb0565b6106bf565b34801561028657600080fd5b5060005461020e906001600160a01b031681565b3480156102a657600080fd5b5061020e7f000000000000000000000000000000000000000000000000000000000000000081565b3480156102da57600080fd5b506102ee6102e9366004610ef3565b610817565b604080519384526001600160401b0390921660208401526001600160a01b0316908201526060016100f6565b34801561032657600080fd5b5061015b610335366004610f65565b610b0a565b34801561034657600080fd5b5061020e7f000000000000000000000000000000000000000000000000000000000000000081565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146103b6576040516282b42960e81b815260040160405180910390fd5b34156103d4576040516281055160e21b815260040160405180910390fd5b6001600160401b0383166000908152600160209081526040918290208251606081018452905463ffffffff8116825264010000000081046001600160a01b031692820192909252600160c01b90910460ff1615159181018290529061044c57604051632f0418e960e01b815260040160405180910390fd5b6104816001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016333088610bba565b6104d56001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000167f000000000000000000000000000000000000000000000000000000000000000087610c27565b60006104e18387610f96565b90507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031663779b432d878460000151610528886001600160a01b031690565b7f000000000000000000000000000000000000000000000000000000000000000061055d88602001516001600160a01b031690565b877f00000000000000000000000000000000000000000000000000000000000000008f336040516020016105a49291909182526001600160a01b0316602082015260400190565b6040516020818303038152906040526040518963ffffffff1660e01b81526004016105d6989796959493929190610fef565b600060405180830381600087803b1580156105f057600080fd5b505af1158015610604573d6000803e3d6000fd5b5061065f9250506001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001690507f00000000000000000000000000000000000000000000000000000000000000006000610c27565b8151604080516001600160a01b03871681526020810189905290810183905263ffffffff9091169088907fd9c0108ffe69201a6fd2891c4de37a4933ef8bd36a6073fc602b054a6f04af509060600160405180910390a350505050505050565b6000546001600160a01b031633146106e9576040516282b42960e81b815260040160405180910390fd5b6001600160401b0383161580610707575046836001600160401b0316145b8061071957506001600160a01b038116155b15610737576040516306b7c75960e31b815260040160405180910390fd5b6040805160608101825263ffffffff8481168083526001600160a01b03858116602080860182815260018789018181526001600160401b038d1660008181529285528a832099518a54945192511515600160c01b0260ff60c01b1993909816640100000000026001600160c01b03199095169916989098179290921791909116939093179095558282526002855290859020805467ffffffffffffffff191684179055845191825292810192909252917ff9b62495240e854b07462e35c571ff4a729c383fd2bb896ec0b5a085abb65507910160405180910390a2505050565b60008080336001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001614610863576040516282b42960e81b815260040160405180910390fd5b600080610872868801886110f3565b9092509050604061088560e4609461115a565b61088f919061115a565b8251146108af57604051636eca2e4b60e01b815260040160405180910390fd5b60006108bc836004610cb7565b60e01c6000818152600260209081526040808320546001600160401b031680845260018352928190208151606081018352905463ffffffff8116825264010000000081046001600160a01b031693820193909352600160c01b90920460ff1615159082015290965090915085158061093657508060400151155b8061095157508163ffffffff16816000015163ffffffff1614155b1561096f57604051632f0418e960e01b815260040160405180910390fd5b600061098e610989866109846024609461115a565b610cb7565b610cef565b905060006109a5610989876109846064609461115a565b90507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316826001600160a01b03161415806109fe575082602001516001600160a01b0316816001600160a01b031614155b15610a1c57604051636eca2e4b60e01b815260040160405180910390fd5b610a2c8661098460e4609461115a565b9850610a4c61098987610a4160e4609461115a565b61098490602061115a565b604051630afd9fa560e31b81529097506001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016906357ecfd2890610a9d908990899060040161116d565b6020604051808303816000875af1158015610abc573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610ae0919061119b565b610afd5760405163071cffe760e51b815260040160405180910390fd5b5050505050509250925092565b6000546001600160a01b03163314610b34576040516282b42960e81b815260040160405180910390fd5b806001600160a01b03163b600003610b5f576040516306b7c75960e31b815260040160405180910390fd5b600080546040516001600160a01b03808516939216917f5f56bee8cffbe9a78652a74a60705edede02af10b0bbb888ca44b79a0d42ce8091a3600080546001600160a01b0319166001600160a01b0392909216919091179055565b6040516001600160a01b038481166024830152838116604483015260648201839052610c219186918216906323b872dd906084015b604051602081830303815290604052915060e01b6020820180516001600160e01b038381831617835250505050610d18565b50505050565b604080516001600160a01b038416602482015260448082018490528251808303909101815260649091019091526020810180516001600160e01b031663095ea7b360e01b179052610c788482610d8d565b610c21576040516001600160a01b03848116602483015260006044830152610cad91869182169063095ea7b390606401610bef565b610c218482610d18565b8151600090610cc783602061115a565b1115610ce657604051636eca2e4b60e01b815260040160405180910390fd5b50016020015190565b600060a082901c15610d1457604051636eca2e4b60e01b815260040160405180910390fd5b5090565b600080602060008451602086016000885af180610d3b576040513d6000823e3d81fd5b50506000513d91508115610d53578060011415610d60565b6001600160a01b0384163b155b15610c2157604051635274afe760e01b81526001600160a01b038516600482015260240160405180910390fd5b6000806000806020600086516020880160008a5af192503d91506000519050828015610dd257508115610dc35780600114610dd2565b6000866001600160a01b03163b115b93505050505b92915050565b803563ffffffff81168114610df257600080fd5b919050565b600060208284031215610e0957600080fd5b610e1282610dde565b9392505050565b80356001600160401b0381168114610df257600080fd5b80356001600160a01b0381168114610df257600080fd5b600080600080600060a08688031215610e5f57600080fd5b8535945060208601359350610e7660408701610e19565b9250610e8460608701610e30565b949793965091946080013592915050565b600060208284031215610ea757600080fd5b610e1282610e19565b600080600060608486031215610ec557600080fd5b610ece84610e19565b9250610edc60208501610dde565b9150610eea60408501610e30565b90509250925092565b60008060208385031215610f0657600080fd5b82356001600160401b03811115610f1c57600080fd5b8301601f81018513610f2d57600080fd5b80356001600160401b03811115610f4357600080fd5b856020828401011115610f5557600080fd5b6020919091019590945092505050565b600060208284031215610f7757600080fd5b610e1282610e30565b634e487b7160e01b600052601160045260246000fd5b81810381811115610dd857610dd8610f80565b6000815180845260005b81811015610fcf57602081850181015186830182015201610fb3565b506000602082860101526020601f19601f83011685010191505092915050565b88815263ffffffff8816602082015286604082015260018060a01b03861660608201528460808201528360a082015263ffffffff831660c082015261010060e08201526000611042610100830184610fa9565b9a9950505050505050505050565b634e487b7160e01b600052604160045260246000fd5b600082601f83011261107757600080fd5b81356001600160401b0381111561109057611090611050565b604051601f8201601f19908116603f011681016001600160401b03811182821017156110be576110be611050565b6040528181528382016020018510156110d657600080fd5b816020850160208301376000918101602001919091529392505050565b6000806040838503121561110657600080fd5b82356001600160401b0381111561111c57600080fd5b61112885828601611066565b92505060208301356001600160401b0381111561114457600080fd5b61115085828601611066565b9150509250929050565b80820180821115610dd857610dd8610f80565b6040815260006111806040830185610fa9565b82810360208401526111928185610fa9565b95945050505050565b6000602082840312156111ad57600080fd5b81518015158114610e1257600080fdfea2646970667358221220798dd8570981d93071cb15e4f1526b7f146f05bdd4434f95ebee2bd54db9a24564736f6c63430008210033";
var isSuperArgs2 = (xs) => xs.length > 1;
var CctpV2Adapter__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs2(args)) {
      super(...args);
    } else {
      super(_abi2, _bytecode2, args[0]);
    }
  }
  getDeployTransaction(asset_, agent_, governance_, tokenMessenger_, messageTransmitter_, minFinalityThreshold_, overrides) {
    return super.getDeployTransaction(
      asset_,
      agent_,
      governance_,
      tokenMessenger_,
      messageTransmitter_,
      minFinalityThreshold_,
      overrides || {}
    );
  }
  deploy(asset_, agent_, governance_, tokenMessenger_, messageTransmitter_, minFinalityThreshold_, overrides) {
    return super.deploy(
      asset_,
      agent_,
      governance_,
      tokenMessenger_,
      messageTransmitter_,
      minFinalityThreshold_,
      overrides || {}
    );
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi2);
  }
  static connect(address, runner) {
    return new Contract(address, _abi2, runner);
  }
};
CctpV2Adapter__factory.bytecode = _bytecode2;
CctpV2Adapter__factory.abi = _abi2;

// libs/typechain/src/factories/ChainAgent__factory.ts
var _abi3 = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "AlreadyReceived",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "DomainPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "InsufficientIdle",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidConfig",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInput",
    type: "error"
  },
  {
    inputs: [],
    name: "LimitExceeded",
    type: "error"
  },
  {
    inputs: [],
    name: "NotHub",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error"
  },
  {
    inputs: [],
    name: "RouteDisabled",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "bits",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "SafeCastOverflowedUintDowncast",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    inputs: [],
    name: "SendsHalted",
    type: "error"
  },
  {
    inputs: [],
    name: "SlippageExceeded",
    type: "error"
  },
  {
    inputs: [],
    name: "StrategyNotEmpty",
    type: "error"
  },
  {
    inputs: [],
    name: "Unauthorized",
    type: "error"
  },
  {
    inputs: [],
    name: "UnexpectedTokenAmount",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownAdapter",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownPeer",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownTransfer",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "AdapterUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "strategy",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Allocated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "srcChainId",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "srcAgent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "BridgeIn",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "rebalanceId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "dstChainId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "address",
        name: "dstAgent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "minReceive",
        type: "uint256"
      }
    ],
    name: "BridgeOut",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "strategy",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Deallocated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "paused",
        type: "bool"
      },
      {
        indexed: true,
        internalType: "address",
        name: "by",
        type: "address"
      }
    ],
    name: "PauseSet",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "PeerUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "vault",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "ReturnedToVault",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "dstChainId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "address",
        name: "dstAgent",
        type: "address"
      }
    ],
    name: "RouteAdded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "enabled",
        type: "bool"
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "maxFeeBps",
        type: "uint16"
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "maxPerTransfer",
        type: "uint128"
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "capacity",
        type: "uint128"
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "refillPerSecond",
        type: "uint128"
      }
    ],
    name: "RouteConfigured",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "strategy",
        type: "address"
      }
    ],
    name: "StrategyUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "totalWrittenDown",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "reason",
        type: "bytes32"
      }
    ],
    name: "WrittenDown",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_ALLOCATE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_BRIDGE_OUT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GUARDIAN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        internalType: "uint64",
        name: "dstChainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "dstAgent",
        type: "address"
      },
      {
        internalType: "uint16",
        name: "maxFeeBps",
        type: "uint16"
      },
      {
        internalType: "uint128",
        name: "maxPerTransfer",
        type: "uint128"
      },
      {
        internalType: "uint128",
        name: "capacity",
        type: "uint128"
      },
      {
        internalType: "uint128",
        name: "refillPerSecond",
        type: "uint128"
      }
    ],
    name: "addRoute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "allocate",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "minReceive",
        type: "uint256"
      },
      {
        internalType: "bytes32",
        name: "rebalanceId",
        type: "bytes32"
      }
    ],
    name: "bridgeOut",
    outputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      },
      {
        internalType: "bool",
        name: "enabled",
        type: "bool"
      },
      {
        internalType: "uint16",
        name: "maxFeeBps",
        type: "uint16"
      },
      {
        internalType: "uint128",
        name: "maxPerTransfer",
        type: "uint128"
      },
      {
        internalType: "uint128",
        name: "capacity",
        type: "uint128"
      },
      {
        internalType: "uint128",
        name: "refillPerSecond",
        type: "uint128"
      }
    ],
    name: "configureRoute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "deallocate",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "minAssets",
        type: "uint256"
      }
    ],
    name: "deallocateShares",
    outputs: [
      {
        internalType: "uint256",
        name: "received",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      }
    ],
    name: "disableRoute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      }
    ],
    name: "getReceived",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "srcChainId",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "receivedAt",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "amount",
            type: "uint128"
          }
        ],
        internalType: "struct ChainAgent.Received",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "routeId",
        type: "bytes32"
      }
    ],
    name: "getRoute",
    outputs: [
      {
        components: [
          {
            internalType: "address",
            name: "adapter",
            type: "address"
          },
          {
            internalType: "uint64",
            name: "dstChainId",
            type: "uint64"
          },
          {
            internalType: "address",
            name: "dstAgent",
            type: "address"
          },
          {
            internalType: "uint16",
            name: "maxFeeBps",
            type: "uint16"
          },
          {
            internalType: "bool",
            name: "enabled",
            type: "bool"
          },
          {
            internalType: "uint128",
            name: "maxPerTransfer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ChainAgent.Route",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      }
    ],
    name: "getSent",
    outputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "routeId",
            type: "bytes32"
          },
          {
            internalType: "uint64",
            name: "dstChainId",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "sentAt",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "amount",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minReceive",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "writtenDown",
            type: "uint128"
          }
        ],
        internalType: "struct ChainAgent.Sent",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTimelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "idle",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "asset_",
        type: "address"
      },
      {
        internalType: "address",
        name: "admin_",
        type: "address"
      },
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      },
      {
        internalType: "address",
        name: "strategy_",
        type: "address"
      },
      {
        internalType: "address",
        name: "vault_",
        type: "address"
      },
      {
        internalType: "address",
        name: "accountant_",
        type: "address"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "adapter",
        type: "address"
      }
    ],
    name: "isAdapter",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "agent",
        type: "address"
      }
    ],
    name: "isPeer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "nonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        internalType: "bytes",
        name: "payload",
        type: "bytes"
      }
    ],
    name: "receiveBridge",
    outputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "returnToVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "adapter",
        type: "address"
      },
      {
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "setAdapter",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "setPeer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "strategy_",
        type: "address"
      }
    ],
    name: "setStrategy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "strategy",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "strategyShares",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "vault",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "transferId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "bytes32",
        name: "reason",
        type: "bytes32"
      }
    ],
    name: "writeDown",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode3 = "0x6080604052348015600f57600080fd5b506016601a565b60ca565b7ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00805468010000000000000000900460ff161560695760405163f92ee8a960e01b815260040160405180910390fd5b80546001600160401b039081161460c75780546001600160401b0319166001600160401b0390811782556040519081527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b50565b613c90806100d96000396000f3fe6080604052600436106102255760003560e01c80637fc938b911610123578063aa7c15fa116100ab578063d547741f1161006f578063d547741f146106f1578063e920760014610711578063edf07f151461073e578063fbfa77cf1461075e578063fd4913991461077357600080fd5b8063aa7c15fa1461065c578063abb647d71461067c578063affed0e01461069c578063bdacb303146106b1578063cc2a9a5b146106d157600080fd5b806391639719116100f257806391639719146105d257806391d14854146105f25780639ae0466614610612578063a0aa6e1714610632578063a8c62e761461064757600080fd5b80637fc938b91461055d57806385c30aff1461057257806387fdfce01461059257806390ca796b146105b257600080fd5b806338d52e0f116101b15780636221a54b116101755780636221a54b1461045a57806368c18beb1461046f5780636f6c441f1461048f57806375b238fc146104af5780637b9742b5146104c457600080fd5b806338d52e0f1461035d5780634cb770661461038a57806350ed6d0a146103b1578063591bebf2146103d15780635ac86ab71461042a57600080fd5b80632fb0b77e116101f85780632fb0b77e146102c8578063301c7e5d146102e85780633192164f14610308578063332f64651461031d57806333a100ca1461033d57600080fd5b806307bd02651461022a5780630e14f3d11461025f57806324ea54f4146102725780632f2ff15d146102a6575b600080fd5b34801561023657600080fd5b5061024c600080516020613c1b83398151915281565b6040519081526020015b60405180910390f35b61024c61026d366004613525565b6107a8565b34801561027e57600080fd5b5061024c7f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a504181565b3480156102b257600080fd5b506102c66102c136600461356c565b610de3565b005b3480156102d457600080fd5b506102c66102e336600461359c565b610dfd565b3480156102f457600080fd5b506102c66103033660046135b5565b610f3e565b34801561031457600080fd5b5061024c610fdb565b34801561032957600080fd5b506102c66103383660046135e6565b611055565b34801561034957600080fd5b506102c6610358366004613614565b611133565b34801561036957600080fd5b506103726112e9565b6040516001600160a01b039091168152602001610256565b34801561039657600080fd5b5061039f600181565b60405160ff9091168152602001610256565b3480156103bd57600080fd5b506102c66103cc366004613631565b611302565b3480156103dd57600080fd5b506103f16103ec36600461359c565b611464565b6040805182516001600160401b03908116825260208085015190911690820152918101516001600160801b031690820152606001610256565b34801561043657600080fd5b5061044a6104453660046135b5565b6114de565b6040519015158152602001610256565b34801561046657600080fd5b506103726114fc565b34801561047b57600080fd5b5061044a61048a366004613614565b611518565b34801561049b57600080fd5b5061024c6104aa36600461359c565b611547565b3480156104bb57600080fd5b5061024c600081565b3480156104d057600080fd5b506104e46104df36600461359c565b61176a565b6040516102569190600060c082019050825182526001600160401b0360208401511660208301526001600160401b0360408401511660408301526001600160801b0360608401511660608301526001600160801b0360808401511660808301526001600160801b0360a08401511660a083015292915050565b34801561056957600080fd5b5061024c61181f565b34801561057e57600080fd5b506102c661058d36600461369b565b61185a565b34801561059e57600080fd5b506102c66105ad366004613731565b611cca565b3480156105be57600080fd5b5061024c6105cd36600461359c565b611dce565b3480156105de57600080fd5b5061044a6105ed36600461377c565b612079565b3480156105fe57600080fd5b5061044a61060d36600461356c565b6120c0565b34801561061e57600080fd5b506102c661062d3660046137aa565b61210a565b34801561063e57600080fd5b5061039f600081565b34801561065357600080fd5b50610372612276565b34801561066857600080fd5b5061024c610677366004613819565b612292565b34801561068857600080fd5b506102c661069736600461359c565b6124ab565b3480156106a857600080fd5b5061024c612598565b3480156106bd57600080fd5b506102c66106cc366004613614565b6125ab565b3480156106dd57600080fd5b506102c66106ec36600461383b565b6125f0565b3480156106fd57600080fd5b506102c661070c36600461356c565b612899565b34801561071d57600080fd5b5061073161072c36600461359c565b6128ae565b60405161025691906138bd565b34801561074a57600080fd5b506102c66107593660046135b5565b6129c5565b34801561076a57600080fd5b50610372612ab1565b34801561077f57600080fd5b5061079361078e3660046139c0565b612acd565b60408051928352602083019190915201610256565b60006107b2612e37565b600080516020613c1b8339815191526107ca81612e6f565b60016107d5816114de565b156107fd57604051635a28696f60e01b815260ff821660048201526024015b60405180910390fd5b6000610807612e95565b60008981526007820160205260409020600181015491925090600160b01b900460ff16610847576040516317d0b6db60e01b815260040160405180910390fd5b60038201546001600160a01b0316158015906108e057506003820154815460405163f1c7340960e01b8152600160a01b9091046001600160401b031660048201526001600160a01b039091169063f1c7340990602401602060405180830381865afa1580156108ba573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906108de9190613a45565b155b156108fe57604051635de3924160e11b815260040160405180910390fd5b87158061090a57508787115b156109285760405163b4fa3fb360e01b815260040160405180910390fd5b60028101546001600160801b031688111561095657604051631930e3c960e11b815260040160405180910390fd5b60018101546109829061097690600160a01b900461ffff16612710613a78565b89906127106001612eb9565b8710156109a257604051631930e3c960e11b815260040160405180910390fd5b6109ac8189612f06565b81546040516370a0823160e01b81523060048201526001600160a01b039091169081906370a0823190602401602060405180830381865afa1580156109f5573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610a199190613a8b565b891115610a3c57604051600162265bff60e21b0319815260040160405180910390fd5b46308460060160008154610a4f90613aa4565b9182905550604051610a80939291906020019283526001600160a01b03919091166020830152604082015260600190565b6040516020818303038152906040528051906020012095506040518060c001604052808b81526020018360000160149054906101000a90046001600160401b03166001600160401b03168152602001426001600160401b03168152602001610ae78b612ffc565b6001600160801b03168152602001610afe8a612ffc565b6001600160801b03908116825260006020928301819052898152600a87018352604080822085518155938501516001850180548784015160608901518716600160801b9081026001600160401b03928316600160401b026001600160801b03199094169290951691909117919091178616929092179055608086015160a0909601518416029490921693909317600290920191909155516370a0823160e01b81523060048201526001600160a01b038316906370a0823190602401602060405180830381865afa158015610bd6573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610bfa9190613a8b565b8354909150610c16906001600160a01b0384811691168c613034565b825460018401546040516318d581d960e01b8152600481018a9052602481018d90526001600160401b03600160a01b84041660448201526001600160a01b039182166064820152608481018c90529116906318d581d990349060a4016000604051808303818588803b158015610c8b57600080fd5b505af1158015610c9f573d6000803e3d6000fd5b50508554610cbf93506001600160a01b0386811693501690506000613034565b6040516370a0823160e01b81523060048201528a906001600160a01b038416906370a0823190602401602060405180830381865afa158015610d05573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610d299190613a8b565b610d339083613a78565b14610d515760405163f998456560e01b815260040160405180910390fd5b8254600184015460408051600160a01b9093046001600160401b031683526001600160a01b03909116602083015281018b9052606081018a90528b90899089907f96f24e4a882cd85e81c1396ebc88524d146aa151168f477ad5908ce703e4b8989060800160405180910390a4505050505050610ddb6001600080516020613c3b83398151915255565b949350505050565b6000610dee81612e6f565b610df88383613102565b505050565b610e05612e37565b600080516020613c1b833981519152610e1d81612e6f565b6000610e27612e95565b60028101549091506001600160a01b031680610e56576040516313bd2e8360e31b815260040160405180910390fd5b8154610e6c906001600160a01b03168286613034565b6040516322baaeeb60e11b8152600481018590526001600160a01b038216906345755dd690602401600060405180830381600087803b158015610eae57600080fd5b505af1158015610ec2573d6000803e3d6000fd5b50508354610ede92506001600160a01b03169050826000613034565b806001600160a01b03167f08685093d2be21fe8c2c664253a6225e6b3985412787e7ae4892df047b6b830b85604051610f1991815260200190565b60405180910390a2505050610f3b6001600080516020613c3b83398151915255565b50565b6000610f4981612e6f565b600260ff831610610f6d5760405163b4fa3fb360e01b815260040160405180910390fd5b600160ff83161b19610f7d612e95565b60050180549091169055610f8e3390565b6001600160a01b03168260ff167f615fb22808961d3e8e5865548acfb2bf1cc63eb065267701d4318f95c154c7126000604051610fcf911515815260200190565b60405180910390a35050565b6000610fe5612e95565b546040516370a0823160e01b81523060048201526001600160a01b03909116906370a08231906024015b602060405180830381865afa15801561102c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906110509190613a8b565b905090565b61105d612e95565b600401546001600160a01b0316336001600160a01b031614611091576040516282b42960e81b815260040160405180910390fd5b816001600160a01b03163b6000036110bc576040516306b7c75960e31b815260040160405180910390fd5b806110c5612e95565b6001600160a01b0384166000818152600992909201602052604091829020805493151560ff1990941693909317909255517f3a7f7534305abc5e1ba799866aacf71fe69ed2d7944e4fd33455e36f95cd9cd59061112790841515815260200190565b60405180910390a25050565b61113b612e95565b600401546001600160a01b0316336001600160a01b03161461116f576040516282b42960e81b815260040160405180910390fd5b6000611179612e95565b60018101546040516370a0823160e01b81523060048201529192506001600160a01b0316906370a0823190602401602060405180830381865afa1580156111c4573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906111e89190613a8b565b156112065760405163f8c6df3160e01b815260040160405180910390fd5b8054604080516338d52e0f60e01b815290516001600160a01b03928316928516916338d52e0f9160048083019260209291908290030181865afa158015611251573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906112759190613abd565b6001600160a01b03161461129c576040516306b7c75960e31b815260040160405180910390fd5b6001810180546001600160a01b0319166001600160a01b0384169081179091556040517f4da9c22c924692646a21cf1f423781ae3285198dc22e8a6912835d3272b90b3c90600090a25050565b60006112f3612e95565b546001600160a01b0316919050565b600061130d81612e6f565b6000611317612e95565b6000868152600a91909101602052604081206001810154909250600160401b90046001600160401b031690036113605760405163c892d01f60e01b815260040160405180910390fd5b83158061136b575082155b806113a05750600181015460028201546001600160801b03600160801b9283900481169261139e92889291900416613ada565b115b156113be5760405163b4fa3fb360e01b815260040160405180910390fd5b6113c784612ffc565b6002820180546010906113eb908490600160801b90046001600160801b0316613aed565b82546101009290920a6001600160801b03818102199093169183160217909155600283015460408051888152600160801b90920490921660208201529081018590528691507f086d2be34cb3b95037408149630df8f3ee02ffd8fdfeced61d17105d724e647b9060600160405180910390a25050505050565b6040805160608101825260008082526020820181905291810191909152611489612e95565b6000928352600b016020908152604092839020835160608101855290546001600160401b038082168352600160401b82041692820192909252600160801b9091046001600160801b0316928101929092525090565b6000600160ff83161b6114ef612e95565b6005015416151592915050565b6000611506612e95565b600401546001600160a01b0316919050565b6000611522612e95565b6001600160a01b03909216600090815260099290920160205250604090205460ff1690565b6000611551612e37565b600080516020613c1b83398151915261156981612e6f565b6000611573612e95565b600181015481546040516370a0823160e01b81523060048201529293506001600160a01b0391821692600092909116906370a0823190602401602060405180830381865afa1580156115c9573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906115ed9190613a8b565b604051632d182be560e21b815260048101889052306024820181905260448201529091506001600160a01b0383169063b460af94906064016020604051808303816000875af1158015611644573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906116689190613a8b565b83546040516370a0823160e01b815230600482015291965060009183916001600160a01b0316906370a0823190602401602060405180830381865afa1580156116b5573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906116d99190613a8b565b6116e39190613a78565b90508681146117055760405163f998456560e01b815260040160405180910390fd5b60408051828152602081018890526001600160a01b038516917f931c6bc7a1a0f8481f36670fac9821728b3288a15385b293eada3cb081e75245910160405180910390a250505050506117656001600080516020613c3b83398151915255565b919050565b6040805160c081018252600080825260208201819052918101829052606081018290526080810182905260a08101919091526117a4612e95565b6000928352600a016020908152604092839020835160c0810185528154815260018201546001600160401b0380821694830194909452600160401b8104909316948101949094526001600160801b03600160801b92839004811660608601526002909101548082166080860152919091041660a08301525090565b6000611829612e95565b600101546040516370a0823160e01b81523060048201526001600160a01b03909116906370a082319060240161100f565b611862612e95565b600401546001600160a01b0316336001600160a01b031614611896576040516282b42960e81b815260040160405180910390fd5b60006118a0612e95565b90508815806118c7575060008981526007820160205260409020546001600160a01b031615155b806118da57506001600160a01b0388163b155b8061195b57508054604080516338d52e0f60e01b815290516001600160a01b03928316928b16916338d52e0f9160048083019260209291908290030181865afa15801561192b573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061194f9190613abd565b6001600160a01b031614155b8061196d57506001600160401b038716155b80611980575046876001600160401b0316145b8061199257506001600160a01b038616155b806119a357506127108561ffff1610155b156119c1576040516306b7c75960e31b815260040160405180910390fd5b604051806101400160405280896001600160a01b03168152602001886001600160401b03168152602001876001600160a01b031681526020018661ffff168152602001600115158152602001856001600160801b03168152602001846001600160801b03168152602001836001600160801b03168152602001846001600160801b03168152602001426001600160401b03168152508160070160008b815260200190815260200160002060008201518160000160006101000a8154816001600160a01b0302191690836001600160a01b0316021790555060208201518160000160146101000a8154816001600160401b0302191690836001600160401b0316021790555060408201518160010160006101000a8154816001600160a01b0302191690836001600160a01b0316021790555060608201518160010160146101000a81548161ffff021916908361ffff16021790555060808201518160010160166101000a81548160ff02191690831515021790555060a08201518160020160006101000a8154816001600160801b0302191690836001600160801b0316021790555060c08201518160020160106101000a8154816001600160801b0302191690836001600160801b0316021790555060e08201518160030160006101000a8154816001600160801b0302191690836001600160801b031602179055506101008201518160030160106101000a8154816001600160801b0302191690836001600160801b031602179055506101208201518160040160006101000a8154816001600160401b0302191690836001600160401b03160217905550905050887f86b55424f9fd593f54a7c61ce660c18e2fe5b06ae7380b5e929690c98f038a1e898989604051611c76939291906001600160a01b0393841681526001600160401b03929092166020830152909116604082015260600190565b60405180910390a2887f9d722261cf80e162934ef950331bbf683a6d24a45d154deaa5142e5e6b403062600187878787604051611cb7959493929190613b0c565b60405180910390a2505050505050505050565b611cd2612e95565b600401546001600160a01b0316336001600160a01b031614611d06576040516282b42960e81b815260040160405180910390fd5b6001600160401b0383161580611d2357506001600160a01b038216155b15611d41576040516306b7c75960e31b815260040160405180910390fd5b80611d4a612e95565b6001600160401b0385166000818152600892909201602090815260408084206001600160a01b038816808652925292839020805494151560ff199095169490941790935590517fbc9ee32e50c78bc2de972bd5ddbf69f1e9ec15378bcf09774fa792557132884890611dc190851515815260200190565b60405180910390a3505050565b6000611dd8612e37565b600080516020613c1b833981519152611df081612e6f565b6000611dfb816114de565b15611e1e57604051635a28696f60e01b815260ff821660048201526024016107f4565b6000611e28612e95565b60038101549091506001600160a01b031615801590611ebb57508060030160009054906101000a90046001600160a01b03166001600160a01b031663054f7d9c6040518163ffffffff1660e01b8152600401602060405180830381865afa158015611e97573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611ebb9190613a45565b15611ed957604051635de3924160e11b815260040160405180910390fd5b841580611f4f575080546040516370a0823160e01b81523060048201526001600160a01b03909116906370a0823190602401602060405180830381865afa158015611f28573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611f4c9190613a8b565b85115b15611f7057604051600162265bff60e21b0319815260040160405180910390fd5b600181015481546001600160a01b0391821691611f8f91168288613034565b604051636e553f6560e01b8152600481018790523060248201526001600160a01b03821690636e553f65906044016020604051808303816000875af1158015611fdc573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906120009190613a8b565b825490955061201a906001600160a01b0316826000613034565b60408051878152602081018790526001600160a01b038316917f9af9811abc6f1b9cf2234f8ed76daa9a577d4ffbbe0af66ec4b748cde6f4c39f910160405180910390a2505050506117656001600080516020613c3b83398151915255565b6000612083612e95565b6001600160401b0384166000908152600891909101602090815260408083206001600160a01b038616845290915290205460ff1690505b92915050565b60009182527f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300602090815260408084206001600160a01b0393909316845291905290205460ff1690565b612112612e95565b600401546001600160a01b0316336001600160a01b031614612146576040516282b42960e81b815260040160405180910390fd5b6000612150612e95565b60008881526007919091016020526040902080549091506001600160a01b0316158061218257506127108561ffff1610155b156121a0576040516306b7c75960e31b815260040160405180910390fd5b60018101805462ffffff60a01b1916600160b01b8815150261ffff60a01b191617600160a01b61ffff8816021790556001600160801b03848116600160801b8583168181029290921760028501556003840180546001600160801b031916868516179081905504909116111561222d576003810180546001600160801b03808616600160801b0291161790555b867f9d722261cf80e162934ef950331bbf683a6d24a45d154deaa5142e5e6b4030628787878787604051612265959493929190613b0c565b60405180910390a250505050505050565b6000612280612e95565b600101546001600160a01b0316919050565b600061229c612e37565b600080516020613c1b8339815191526122b481612e6f565b60006122be612e95565b600181015481546040516370a0823160e01b81523060048201529293506001600160a01b0391821692600092909116906370a0823190602401602060405180830381865afa158015612314573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906123389190613a8b565b604051635d043b2960e11b815260048101899052306024820181905260448201529091506001600160a01b0383169063ba087652906064016020604051808303816000875af115801561238f573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906123b39190613a8b565b5082546040516370a0823160e01b815230600482015282916001600160a01b0316906370a0823190602401602060405180830381865afa1580156123fb573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061241f9190613a8b565b6124299190613a78565b94508585101561244c57604051638199f5f360e01b815260040160405180910390fd5b60408051868152602081018990526001600160a01b038416917f931c6bc7a1a0f8481f36670fac9821728b3288a15385b293eada3cb081e75245910160405180910390a2505050506120ba6001600080516020613c3b83398151915255565b6124d57f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a5041336120c0565b1580156124ea57506124e86000336120c0565b155b15612507576040516282b42960e81b815260040160405180910390fd5b6000612511612e95565b6000838152600791909101602052604080822060018101805460ff60b01b19169081905560028201546003830154935192955086947f9d722261cf80e162934ef950331bbf683a6d24a45d154deaa5142e5e6b40306294611127949193600160a01b900461ffff16926001600160801b0380821693600160801b9092048116921690613b0c565b60006125a2612e95565b60060154905090565b6125b3612e95565b600401546001600160a01b0316336001600160a01b0316146125e7576040516282b42960e81b815260040160405180910390fd5b610f3b816131a8565b60006125fa613225565b805490915060ff600160401b82041615906001600160401b03166000811580156126215750825b90506000826001600160401b0316600114801561263d5750303b155b90508115801561264b575080155b156126695760405163f92ee8a960e01b815260040160405180910390fd5b845467ffffffffffffffff19166001178555831561269357845460ff60401b1916600160401b1785555b6001600160a01b038b1615806126b057506001600160a01b038a16155b806126c257506001600160a01b038816155b156126e0576040516306b7c75960e31b815260040160405180910390fd5b6001600160a01b0387811615908716151461270e576040516306b7c75960e31b815260040160405180910390fd5b8a6001600160a01b0316886001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa158015612756573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061277a9190613abd565b6001600160a01b0316146127a1576040516306b7c75960e31b815260040160405180910390fd5b6127a961324e565b6127b28a613260565b60006127bc612e95565b80546001600160a01b03808f166001600160a01b03199283161783556001830180548d83169084161790556002830180548c8316908416179055600383018054918b169190921617905590506128118a6131a8565b6040516001600160a01b038a16907f4da9c22c924692646a21cf1f423781ae3285198dc22e8a6912835d3272b90b3c90600090a250831561288c57845460ff60401b19168555604051600181527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b5050505050505050505050565b60006128a481612e6f565b610df88383613271565b6040805161014081018252600080825260208201819052918101829052606081018290526080810182905260a0810182905260c0810182905260e081018290526101008101829052610120810191909152612907612e95565b6000928352600701602090815260409283902083516101408101855281546001600160a01b038082168352600160a01b918290046001600160401b0390811695840195909552600184015490811696830196909652850461ffff166060820152600160b01b90940460ff161515608085015260028101546001600160801b0380821660a0870152600160801b91829004811660c0870152600383015480821660e0880152919091041661010085015260040154166101208301525090565b6129ef7f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a5041336120c0565b158015612a045750612a026000336120c0565b155b15612a21576040516282b42960e81b815260040160405180910390fd5b600260ff821610612a455760405163b4fa3fb360e01b815260040160405180910390fd5b600160ff82161b612a54612e95565b60050180549091179055612a653390565b6001600160a01b03168160ff167f615fb22808961d3e8e5865548acfb2bf1cc63eb065267701d4318f95c154c7126001604051612aa6911515815260200190565b60405180910390a350565b6000612abb612e95565b600201546001600160a01b0316919050565b600080612ad8612e37565b6000612ae2612e95565b6001600160a01b038716600090815260098201602052604090205490915060ff16612b2057604051632721954560e01b815260040160405180910390fd5b80546040516370a0823160e01b81523060048201526001600160a01b039091169060009082906370a0823190602401602060405180830381865afa158015612b6c573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190612b909190613a8b565b9050600080896001600160a01b031663a0345fca8a8a6040518363ffffffff1660e01b8152600401612bc3929190613b40565b6060604051808303816000875af1158015612be2573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190612c069190613b6f565b6040516370a0823160e01b8152306004820152929950909350915083906001600160a01b038616906370a0823190602401602060405180830381865afa158015612c54573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190612c789190613a8b565b612c829190613a78565b6001600160401b038316600090815260088701602090815260408083206001600160a01b038616845290915290205490965060ff16612cd45760405163304cf9b960e11b815260040160405180910390fd5b6000878152600b86016020526040902054600160401b90046001600160401b031615612d1357604051633904daf160e21b815260040160405180910390fd5b85600003612d345760405163f998456560e01b815260040160405180910390fd5b6040518060600160405280836001600160401b03168152602001426001600160401b03168152602001612d6688612ffc565b6001600160801b039081169091526000898152600b880160209081526040918290208451815492860151958401518516600160801b026001600160401b03968716600160401b026001600160801b0319909416918716919091179290921790931617909155516001600160a01b0383169184169089907fdc25c6a36d5419cb3296844e25610ba143ad14250f267fe9f1093e799f7ad2d490612e0b908b815260200190565b60405180910390a45050505050612e2f6001600080516020613c3b83398151915255565b935093915050565b600080516020613c3b833981519152805460011901612e6957604051633ee5aeb560e01b815260040160405180910390fd5b60029055565b612e7981336120c0565b610f3b576040516282b42960e81b815260040160405180910390fd5b7fa350913476bf4a8b1933612e57508cbb9cd46ba40a6a18a9a187f312701be30090565b6000612ee8612ec7836132f8565b8015612ee3575060008480612ede57612ede613ba7565b868809115b151590565b612ef3868686613325565b612efd9190613ada565b95945050505050565b600382015460048301546000916001600160801b031690612f30906001600160401b031642613a78565b612f3a9190613bbd565b6003840154612f599190600160801b90046001600160801b0316613ada565b6002840154909150600160801b90046001600160801b0316811115612f8f57506002820154600160801b90046001600160801b03165b80821115612fb057604051631930e3c960e11b815260040160405180910390fd5b612fba8282613a78565b6003840180546001600160801b03928316600160801b029216919091179055505060040180546001600160401b03421667ffffffffffffffff19909116179055565b60006001600160801b03821115613030576040516306dfcc6560e41b815260806004820152602481018390526044016107f4565b5090565b604080516001600160a01b038416602482015260448082018490528251808303909101815260649091019091526020810180516001600160e01b031663095ea7b360e01b17905261308584826133db565b6130e857604080516001600160a01b038516602482015260006044808301919091528251808303909101815260649091019091526020810180516001600160e01b031663095ea7b360e01b1790526130de90859061342a565b6130e8848261342a565b50505050565b6001600080516020613c3b83398151915255565b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb30061312d83836120c0565b610df8576000838152602082815260408083206001600160a01b03861684529091529020805460ff191660011790556131633390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a4505050565b6001600160a01b0381166131cf576040516306b7c75960e31b815260040160405180910390fd5b806131d8612e95565b60040180546001600160a01b0319166001600160a01b03928316179055604051908216907fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a250565b6000807ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a006120ba565b61325661349b565b61325e6134c0565b565b61326861349b565b610f3b816134c8565b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb30061329c83836120c0565b15610df8576000838152602082815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a4505050565b6000600282600381111561330e5761330e613bd4565b6133189190613bea565b60ff166001149050919050565b600080600061333486866134db565b91509150816000036133595783818161334f5761334f613ba7565b04925050506133d4565b8184116133705761337060038515026011186134f9565b6000848688096000868103871696879004966002600389028118808a02820302808a02820302808a02820302808a02820302808a02820302808a02909103029181900381900460010185841190960395909502919093039390930492909217029150505b9392505050565b6000806000806020600086516020880160008a5af192503d91506000519050828015613420575081156134115780600114613420565b6000866001600160a01b03163b115b9695505050505050565b600080602060008451602086016000885af18061344d576040513d6000823e3d81fd5b50506000513d91508115613465578060011415613472565b6001600160a01b0384163b155b156130e857604051635274afe760e01b81526001600160a01b03851660048201526024016107f4565b6134a361350b565b61325e57604051631afcd79f60e31b815260040160405180910390fd5b6130ee61349b565b6134d061349b565b610f3b600082613102565b60008060001983850993909202808410938190039390930393915050565b634e487b71600052806020526024601cfd5b6000613515613225565b54600160401b900460ff16919050565b6000806000806080858703121561353b57600080fd5b5050823594602084013594506040840135936060013592509050565b6001600160a01b0381168114610f3b57600080fd5b6000806040838503121561357f57600080fd5b82359150602083013561359181613557565b809150509250929050565b6000602082840312156135ae57600080fd5b5035919050565b6000602082840312156135c757600080fd5b813560ff811681146133d457600080fd5b8015158114610f3b57600080fd5b600080604083850312156135f957600080fd5b823561360481613557565b91506020830135613591816135d8565b60006020828403121561362657600080fd5b81356133d481613557565b60008060006060848603121561364657600080fd5b505081359360208301359350604090920135919050565b6001600160401b0381168114610f3b57600080fd5b803561ffff8116811461176557600080fd5b80356001600160801b038116811461176557600080fd5b600080600080600080600080610100898b0312156136b857600080fd5b8835975060208901356136ca81613557565b965060408901356136da8161365d565b955060608901356136ea81613557565b94506136f860808a01613672565b935061370660a08a01613684565b925061371460c08a01613684565b915061372260e08a01613684565b90509295985092959890939650565b60008060006060848603121561374657600080fd5b83356137518161365d565b9250602084013561376181613557565b91506040840135613771816135d8565b809150509250925092565b6000806040838503121561378f57600080fd5b823561379a8161365d565b9150602083013561359181613557565b60008060008060008060c087890312156137c357600080fd5b8635955060208701356137d5816135d8565b94506137e360408801613672565b93506137f160608801613684565b92506137ff60808801613684565b915061380d60a08801613684565b90509295509295509295565b6000806040838503121561382c57600080fd5b50508035926020909101359150565b60008060008060008060c0878903121561385457600080fd5b863561385f81613557565b9550602087013561386f81613557565b9450604087013561387f81613557565b9350606087013561388f81613557565b9250608087013561389f81613557565b915060a08701356138af81613557565b809150509295509295509295565b81516001600160a01b03168152610140810160208301516138e960208401826001600160401b03169052565b50604083015161390460408401826001600160a01b03169052565b50606083015161391a606084018261ffff169052565b50608083015161392e608084018215159052565b5060a083015161394960a08401826001600160801b03169052565b5060c083015161396460c08401826001600160801b03169052565b5060e083015161397f60e08401826001600160801b03169052565b5061010083015161399c6101008401826001600160801b03169052565b506101208301516139b96101208401826001600160401b03169052565b5092915050565b6000806000604084860312156139d557600080fd5b83356139e081613557565b925060208401356001600160401b038111156139fb57600080fd5b8401601f81018613613a0c57600080fd5b80356001600160401b03811115613a2257600080fd5b866020828401011115613a3457600080fd5b939660209190910195509293505050565b600060208284031215613a5757600080fd5b81516133d4816135d8565b634e487b7160e01b600052601160045260246000fd5b818103818111156120ba576120ba613a62565b600060208284031215613a9d57600080fd5b5051919050565b600060018201613ab657613ab6613a62565b5060010190565b600060208284031215613acf57600080fd5b81516133d481613557565b808201808211156120ba576120ba613a62565b6001600160801b0381811683821601908111156120ba576120ba613a62565b941515855261ffff9390931660208501526001600160801b0391821660408501528116606084015216608082015260a00190565b60208152816020820152818360408301376000818301604090810191909152601f909201601f19160101919050565b600080600060608486031215613b8457600080fd5b835192506020840151613b968161365d565b604085015190925061377181613557565b634e487b7160e01b600052601260045260246000fd5b80820281158282048414176120ba576120ba613a62565b634e487b7160e01b600052602160045260246000fd5b600060ff831680613c0b57634e487b7160e01b600052601260045260246000fd5b8060ff8416069150509291505056fed8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e639b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220bf69ee8094da40eff4bc0cd72e91941b5f3d0b8ce381dcfd50e98d76d700243b64736f6c63430008210033";
var isSuperArgs3 = (xs) => xs.length > 1;
var ChainAgent__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs3(args)) {
      super(...args);
    } else {
      super(_abi3, _bytecode3, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi3);
  }
  static connect(address, runner) {
    return new Contract(address, _abi3, runner);
  }
};
ChainAgent__factory.bytecode = _bytecode3;
ChainAgent__factory.abi = _abi3;

// libs/typechain/src/factories/CompoundV3Provider__factory.ts
var _abi4 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "providerManager_",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "AddressZero",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositRate",
    outputs: [
      {
        internalType: "uint256",
        name: "rate",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getIdentifier",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [],
    name: "getProviderManager",
    outputs: [
      {
        internalType: "contract IProviderManager",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "asset",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "getSource",
    outputs: [
      {
        internalType: "address",
        name: "source",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode4 = "0x60a060405234801561001057600080fd5b5060405161090938038061090983398101604081905261002f91610067565b6001600160a01b03811661005657604051639fabe1c160e01b815260040160405180910390fd5b6001600160a01b0316608052610097565b60006020828403121561007957600080fd5b81516001600160a01b038116811461009057600080fd5b9392505050565b6080516108496100c06000396000818161011d0152818161043201526104f901526108496000f3fe608060405234801561001057600080fd5b506004361061007c5760003560e01c80636e553f651161005b5780636e553f65146100dd57806373f64d44146100f057806381d1f4d41461011b578063aa23e03d1461014157600080fd5b8062f714ce146100815780630ae112a4146100a95780634c8f411d146100ca575b600080fd5b61009461008f36600461060d565b610156565b60405190151581526020015b60405180910390f35b6100bc6100b736600461063d565b61023f565b6040519081526020016100a0565b6100bc6100d836600461066b565b6102c1565b6100946100eb36600461060d565b6103d3565b6101036100fe366004610688565b61042e565b6040516001600160a01b0390911681526020016100a0565b7f0000000000000000000000000000000000000000000000000000000000000000610103565b6101496104c6565b6040516100a09190610719565b600080610162836104f4565b9050806001600160a01b031663f3fef3a3846001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156101b1573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101d5919061072c565b6040516001600160e01b031960e084901b1681526001600160a01b03909116600482015260248101879052604401600060405180830381600087803b15801561021d57600080fd5b505af1158015610231573d6000803e3d6000fd5b506001979650505050505050565b60008061024b836104f4565b6040516370a0823160e01b81526001600160a01b038681166004830152919250908216906370a0823190602401602060405180830381865afa158015610295573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102b99190610749565b949350505050565b6000806102cd836104f4565b90506000816001600160a01b0316637eb711316040518163ffffffff1660e01b8152600401602060405180830381865afa15801561030f573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103339190610749565b60405163d955759d60e01b8152600481018290529091506000906001600160a01b0384169063d955759d90602401602060405180830381865afa15801561037e573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103a29190610762565b6103b090633b9aca006107a2565b67ffffffffffffffff1690506103ca816301e133806107cc565b95945050505050565b6000806103df836104f4565b9050806001600160a01b031663f2b9fdb8846001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156101b1573d6000803e3d6000fd5b60007f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031663c41adf506104676104c6565b866040518363ffffffff1660e01b81526004016104859291906107e9565b602060405180830381865afa1580156104a2573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102b9919061072c565b60408051808201909152601481527321b7b6b837bab7322fab19afa83937bb34b232b960611b602082015290565b6000807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031663c41adf5061052e6104c6565b856001600160a01b03166338d52e0f6040518163ffffffff1660e01b8152600401602060405180830381865afa15801561056c573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610590919061072c565b6040518363ffffffff1660e01b81526004016105ad9291906107e9565b602060405180830381865afa1580156105ca573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906105ee919061072c565b9392505050565b6001600160a01b038116811461060a57600080fd5b50565b6000806040838503121561062057600080fd5b823591506020830135610632816105f5565b809150509250929050565b6000806040838503121561065057600080fd5b823561065b816105f5565b91506020830135610632816105f5565b60006020828403121561067d57600080fd5b81356105ee816105f5565b60008060006060848603121561069d57600080fd5b83356106a8816105f5565b925060208401356106b8816105f5565b915060408401356106c8816105f5565b809150509250925092565b6000815180845260005b818110156106f9576020818501810151868301820152016106dd565b506000602082860101526020601f19601f83011685010191505092915050565b6020815260006105ee60208301846106d3565b60006020828403121561073e57600080fd5b81516105ee816105f5565b60006020828403121561075b57600080fd5b5051919050565b60006020828403121561077457600080fd5b815167ffffffffffffffff811681146105ee57600080fd5b634e487b7160e01b600052601160045260246000fd5b67ffffffffffffffff81811683821602908116908181146107c5576107c561078c565b5092915050565b80820281158282048414176107e3576107e361078c565b92915050565b6040815260006107fc60408301856106d3565b905060018060a01b0383166020830152939250505056fea2646970667358221220cd5bae79ecf1cf0b56eca16682c3b3fac5019ce61d55d869735c1f1242b8340764736f6c63430008210033";
var isSuperArgs4 = (xs) => xs.length > 1;
var CompoundV3Provider__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs4(args)) {
      super(...args);
    } else {
      super(_abi4, _bytecode4, args[0]);
    }
  }
  getDeployTransaction(providerManager_, overrides) {
    return super.getDeployTransaction(providerManager_, overrides || {});
  }
  deploy(providerManager_, overrides) {
    return super.deploy(providerManager_, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi4);
  }
  static connect(address, runner) {
    return new Contract(address, _abi4, runner);
  }
};
CompoundV3Provider__factory.bytecode = _bytecode4;
CompoundV3Provider__factory.abi = _abi4;

// libs/typechain/src/factories/EpochVault__factory.ts
var _abi5 = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "DomainPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "ECDSAInvalidSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "length",
        type: "uint256"
      }
    ],
    name: "ECDSAInvalidSignatureLength",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "ECDSAInvalidSignatureS",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "allowance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientAllowance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientBalance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "approver",
        type: "address"
      }
    ],
    name: "ERC20InvalidApprover",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "ERC20InvalidReceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSpender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      }
    ],
    name: "ERC2612ExpiredSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "signer",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "ERC2612InvalidSigner",
    type: "error"
  },
  {
    inputs: [],
    name: "EpochNotClosable",
    type: "error"
  },
  {
    inputs: [],
    name: "InsufficientFreeCash",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "currentNonce",
        type: "uint256"
      }
    ],
    name: "InvalidAccountNonce",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidConfig",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInput",
    type: "error"
  },
  {
    inputs: [],
    name: "LimitExceeded",
    type: "error"
  },
  {
    inputs: [],
    name: "NotAccountant",
    type: "error"
  },
  {
    inputs: [],
    name: "NotHubAgent",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "NotRequestOwner",
    type: "error"
  },
  {
    inputs: [],
    name: "NothingToClear",
    type: "error"
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error"
  },
  {
    inputs: [],
    name: "RequestNotCancellable",
    type: "error"
  },
  {
    inputs: [],
    name: "RequestNotClaimable",
    type: "error"
  },
  {
    inputs: [],
    name: "SlippageExceeded",
    type: "error"
  },
  {
    inputs: [],
    name: "TickNotUsable",
    type: "error"
  },
  {
    inputs: [],
    name: "Unauthorized",
    type: "error"
  },
  {
    inputs: [],
    name: "UnexpectedTokenAmount",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "DepositClaimed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "DepositRequested",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "rateOffer",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "sharesMinted",
        type: "uint256"
      }
    ],
    name: "DepositsCleared",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "EIP712DomainChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "closedAt",
        type: "uint64"
      }
    ],
    name: "EpochClosed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "minTicks",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxClearingDelay",
            type: "uint64"
          }
        ],
        indexed: false,
        internalType: "struct IEpochVault.EpochConfig",
        name: "config",
        type: "tuple"
      }
    ],
    name: "EpochConfigUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "EpochFunded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "openTickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "openRateBid",
        type: "uint256"
      }
    ],
    name: "EpochOpened",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "FeeSharesMinted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "agent",
        type: "address"
      }
    ],
    name: "HubAgentUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "InstantRedeemed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "minDeposit",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxEpochDeposits",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minimumBuffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minBufferRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInstantWithdrawal",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "dailyInstantLimit",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "instantFee",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "instantMaxTickAge",
            type: "uint64"
          }
        ],
        indexed: false,
        internalType: "struct IEpochVault.Limits",
        name: "limits",
        type: "tuple"
      }
    ],
    name: "LimitsUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "paused",
        type: "bool"
      },
      {
        indexed: true,
        internalType: "address",
        name: "by",
        type: "address"
      }
    ],
    name: "PauseSet",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "PushedToAgent",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "RedeemClaimed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "RedeemDustReleased",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "RedeemRequested",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "epoch",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "priceRedeem",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsOwed",
        type: "uint256"
      }
    ],
    name: "RedeemsCleared",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    name: "RequestCancelled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "ReturnedFromAgent",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_ALLOCATE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_DEPOSIT_CLEARING",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_DEPOSIT_REQUEST",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_INSTANT_EXIT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_REDEEM_CLEARING",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_REDEEM_REQUEST",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GUARDIAN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "accountant",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "accounting",
    outputs: [
      {
        internalType: "uint256",
        name: "cash",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "pendingDeposits",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "liabilities",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "reserved",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "escrowRedeemShares",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "unclaimedDepositShares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    name: "cancel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "index",
        type: "uint256"
      }
    ],
    name: "checkpointAt",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "blockNumber",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "cash",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "pendingDeposits",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "liabilities",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "totalSupply",
            type: "uint128"
          }
        ],
        internalType: "struct IEpochVaultAccounting.Checkpoint",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "checkpointCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    name: "claim",
    outputs: [
      {
        internalType: "uint256",
        name: "amountOut",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "clearDeposits",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "clearRedeems",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "closeEpoch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "currentEpoch",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "cursors",
    outputs: [
      {
        internalType: "uint64",
        name: "nextDepositClear",
        type: "uint64"
      },
      {
        internalType: "uint64",
        name: "nextRedeemClear",
        type: "uint64"
      },
      {
        internalType: "uint64",
        name: "nextFund",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {
        internalType: "bytes1",
        name: "fields",
        type: "bytes1"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "version",
        type: "string"
      },
      {
        internalType: "uint256",
        name: "chainId",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "verifyingContract",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "extensions",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "epochConfig",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "minTicks",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxClearingDelay",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.EpochConfig",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "freeCash",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "fund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "epochId",
        type: "uint64"
      }
    ],
    name: "getEpoch",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "openedAt",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "closedAt",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "openTickId",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "depositTickId",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "redeemTickId",
            type: "uint64"
          },
          {
            internalType: "bool",
            name: "depositsCleared",
            type: "bool"
          },
          {
            internalType: "bool",
            name: "redeemsCleared",
            type: "bool"
          },
          {
            internalType: "bool",
            name: "funded",
            type: "bool"
          },
          {
            internalType: "uint128",
            name: "openRateBid",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "depositAssets",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "redeemShares",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "rateOffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "priceRedeem",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "sharesMinted",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "assetsOwed",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "redeemSharesClaimed",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "assetsPaid",
            type: "uint128"
          }
        ],
        internalType: "struct IEpochVault.Epoch",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    name: "getRequest",
    outputs: [
      {
        components: [
          {
            internalType: "address",
            name: "owner",
            type: "address"
          },
          {
            internalType: "address",
            name: "receiver",
            type: "address"
          },
          {
            internalType: "uint64",
            name: "epoch",
            type: "uint64"
          },
          {
            internalType: "enum IEpochVault.RequestKind",
            name: "kind",
            type: "uint8"
          },
          {
            internalType: "enum IEpochVault.RequestStatus",
            name: "status",
            type: "uint8"
          },
          {
            internalType: "uint128",
            name: "amount",
            type: "uint128"
          }
        ],
        internalType: "struct IEpochVault.Request",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTimelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "hubAgent",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "asset_",
        type: "address"
      },
      {
        internalType: "string",
        name: "name_",
        type: "string"
      },
      {
        internalType: "string",
        name: "symbol_",
        type: "string"
      },
      {
        internalType: "address",
        name: "admin_",
        type: "address"
      },
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      },
      {
        internalType: "address",
        name: "accountant_",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "seedAssets_",
        type: "uint256"
      },
      {
        components: [
          {
            internalType: "uint64",
            name: "minDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "minTicks",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxClearingDelay",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.EpochConfig",
        name: "epochConfig_",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "minDeposit",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxEpochDeposits",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minimumBuffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minBufferRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInstantWithdrawal",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "dailyInstantLimit",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "instantFee",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "instantMaxTickAge",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.Limits",
        name: "limits_",
        type: "tuple"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "minAssets",
        type: "uint256"
      }
    ],
    name: "instantRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "limits",
    outputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "minDeposit",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxEpochDeposits",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minimumBuffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minBufferRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInstantWithdrawal",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "dailyInstantLimit",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "instantFee",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "instantMaxTickAge",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.Limits",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "minimumBuffer",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "mintFeeShares",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      },
      {
        internalType: "uint8",
        name: "v",
        type: "uint8"
      },
      {
        internalType: "bytes32",
        name: "r",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "pushToAgent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "requestDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "requestRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "requestId",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "returnFunds",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxDuration",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "minTicks",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxClearingDelay",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.EpochConfig",
        name: "c",
        type: "tuple"
      }
    ],
    name: "setEpochConfig",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "agent",
        type: "address"
      }
    ],
    name: "setHubAgent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "minDeposit",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxEpochDeposits",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minimumBuffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "minBufferRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInstantWithdrawal",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "dailyInstantLimit",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "instantFee",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "instantMaxTickAge",
            type: "uint64"
          }
        ],
        internalType: "struct IEpochVault.Limits",
        name: "l",
        type: "tuple"
      }
    ],
    name: "setLimits",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "domain",
        type: "uint8"
      }
    ],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode5 = "0x6080604052348015600f57600080fd5b506016601a565b60ca565b7ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00805468010000000000000000900460ff161560695760405163f92ee8a960e01b815260040160405180910390fd5b80546001600160401b039081161460c75780546001600160401b0319166001600160401b0390811782556040519081527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b50565b6141f0806100d96000396000f3fe608060405234801561001057600080fd5b50600436106103a45760003560e01c80637d41c86e116101e9578063b60d42881161010f578063d547741f116100ad578063edf07f151161007c578063edf07f15146107cc578063f57e2f88146107df578063fba0cbd7146107f2578063ff9536db1461080557600080fd5b8063d547741f1461078b578063d80318af1461079e578063d8b71409146107b1578063dd62ed3e146107b957600080fd5b8063c58343ef116100e9578063c58343ef14610748578063cd12745814610768578063cdd5f2c814610770578063d505accf1461077857600080fd5b8063b60d428814610718578063b7bbb79e14610720578063bdacb3031461073557600080fd5b806391d1485411610187578063a1d2949611610156578063a1d29496146106ed578063a9059cbb146106f5578063b25f71c714610708578063b2dfd3291461071057600080fd5b806391d148541461069557806395d89b41146106a85780639624e83e146106b0578063a0aa6e17146106e557600080fd5b8063860aefcf116101c3578063860aefcf1461065257806388fdac5c146106675780638e15fc871461067a5780639017e64e1461068257600080fd5b80637d41c86e146106115780637ecebe001461062457806384b0196e1461063757600080fd5b80633644e515116102ce5780634fb3ccc51161026c57806370a082311161023b57806370a08231146105ce57806372099946146105e157806375b238fc146105e957806376671808146105f157600080fd5b80634fb3ccc5146105a35780635ac86ab7146105ab5780636221a54b146105be5780636c9cb82f146105c657600080fd5b80633e7fa1e0116102a85780633e7fa1e01461053857806340e58ee51461056a57806345755dd61461057d5780634a3a418d1461059057600080fd5b80633644e515146104fd578063379607f51461050557806338d52e0f1461051857600080fd5b806318160ddd1161034657806329344f081161031557806329344f08146104bc5780632f2ff15d146104cf578063301c7e5d146104e2578063313ce567146104f557600080fd5b806318160ddd146104725780631f618cd21461047a57806323b872dd1461048257806324ea54f41461049557600080fd5b80630905bbe1116103825780630905bbe114610400578063095ea7b314610415578063119ac19a1461043857806312a02c821461045257600080fd5b80630405ee9f146103a957806306fdde03146103c457806307bd0265146103d9575b600080fd5b6103b1610887565b6040519081526020015b60405180910390f35b6103cc61090c565b6040516103bb91906133d5565b6103b17fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6381565b61041361040e36600461363a565b6109b5565b005b610428610423366004613713565b610eb3565b60405190151581526020016103bb565b610440600481565b60405160ff90911681526020016103bb565b61046561046036600461373f565b610ecd565b6040516103bb919061375c565b6103b1611082565b6103b16110ac565b610428610490366004613921565b6110bf565b6103b17f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a504181565b6103b16104ca366004613962565b6110e5565b6104136104dd366004613962565b6111df565b6104136104f03660046139a1565b6111f9565b610440611296565b6103b16112b0565b6103b16105133660046139be565b6112ba565b610520611389565b6040516001600160a01b0390911681526020016103bb565b6105406113a2565b604080516001600160401b03948516815292841660208401529216918101919091526060016103bb565b6104136105783660046139be565b6113e1565b61041361058b3660046139be565b6114b7565b61041361059e366004613713565b61155e565b61052061166a565b6104286105b93660046139a1565b611686565b6105206116a4565b6103b16116c0565b6103b16105dc3660046139d7565b611703565b610440600081565b6103b1600081565b6105f9611736565b6040516001600160401b0390911681526020016103bb565b6103b161061f3660046139f4565b611752565b6103b16106323660046139d7565b61189a565b61063f6118a5565b6040516103bb9796959493929190613a36565b61065a611951565b6040516103bb9190613b87565b610413610675366004613b96565b611a20565b610413611acf565b6104136106903660046139be565b611c82565b6104286106a3366004613962565b611d75565b6103cc611dbf565b6106b8611dfe565b604080519687526020870195909552938501929092526060840152608083015260a082015260c0016103bb565b610440600581565b610440600381565b610428610703366004613713565b611e44565b610440600181565b610440600281565b610413611e52565b610728611ecf565b6040516103bb9190613bfc565b6104136107433660046139d7565b611f49565b61075b6107563660046139be565b611f8e565b6040516103bb9190613c20565b6105206120ad565b6104136120c9565b610413610786366004613ca4565b612112565b610413610799366004613962565b61226b565b6103b16107ac366004613d15565b612280565b6104136124af565b6103b16107c7366004613d5d565b61257b565b6104136107da3660046139a1565b6125c5565b6104136107ed366004613d8b565b6126b1565b6104136108003660046139d7565b61272d565b6108186108133660046139be565b6127e6565b6040516103bb9190600060a0820190506001600160401b0383511682526001600160801b0360208401511660208301526001600160801b0360408401511660408301526001600160801b0360608401511660608301526001600160801b03608084015116608083015292915050565b60006108916128a1565b60405163600b46e960e11b8152600481019190915273__$465055f7dc2d46d38389f51f23e455a5ea$__9063c0168dd2906024015b602060405180830381865af41580156108e3573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906109079190613d9e565b905090565b6060600060008051602061417b8339815191525b905080600301805461093190613db7565b80601f016020809104026020016040519081016040528092919081815260200182805461095d90613db7565b80156109aa5780601f1061097f576101008083540402835291602001916109aa565b820191906000526020600020905b81548152906001019060200180831161098d57829003601f168201915b505050505091505090565b60006109bf6128c5565b805490915060ff600160401b82041615906001600160401b03166000811580156109e65750825b90506000826001600160401b03166001148015610a025750303b155b905081158015610a10575080155b15610a2e5760405163f92ee8a960e01b815260040160405180910390fd5b845467ffffffffffffffff191660011785558315610a5857845460ff60401b1916600160401b1785555b6001600160a01b038e161580610a7557506001600160a01b038b16155b80610a8757506001600160a01b038916155b80610a90575087155b15610aae576040516306b7c75960e31b815260040160405180910390fd5b610ab88d8d6128ee565b610ac18d612904565b610ac961292f565b610ad28b61293f565b6000610adc6128a1565b90508e8160000160006101000a8154816001600160a01b0302191690836001600160a01b031602179055508e6001600160a01b031663313ce5676040518163ffffffff1660e01b8152600401602060405180830381865afa158015610b45573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610b699190613df1565b815460ff60a01b1916600160a01b60ff92909216919091021781556001810180546001600160a01b0319166001600160a01b038c16179055610baa8b612950565b6040516317d6c84360e11b815273__$465055f7dc2d46d38389f51f23e455a5ea$__90632fad908690610be39084908c90600401613e0e565b60006040518083038186803b158015610bfb57600080fd5b505af4158015610c0f573d6000803e3d6000fd5b505060405163390263d960e11b815273__$465055f7dc2d46d38389f51f23e455a5ea$__9250637204c7b29150610c4c9084908b90600401613e22565b60006040518083038186803b158015610c6457600080fd5b505af4158015610c78573d6000803e3d6000fd5b5050505060a08701516015820180546001600160801b039092166001600160c01b031990921691909117600160801b426001600160401b0316021790556001600f82015573__$465055f7dc2d46d38389f51f23e455a5ea$__637bd7cc1d82336040516001600160e01b031960e085901b16815260048101929092526001600160a01b03166024820152604481018c905260640160006040518083038186803b158015610d2457600080fd5b505af4158015610d38573d6000803e3d6000fd5b5050505060058101899055610d4d308a6129cd565b600c810180546001600160401b031678010000000000000001000000000000000100000000000000001790556040516360e475cf60e01b8152600481018290526001602482015273__$465055f7dc2d46d38389f51f23e455a5ea$__906360e475cf9060440160006040518083038186803b158015610dcb57600080fd5b505af4158015610ddf573d6000803e3d6000fd5b505050508073__$465055f7dc2d46d38389f51f23e455a5ea$__639d5132549091610e08611082565b6040516001600160e01b031960e085901b1681526004810192909252602482015260440160006040518083038186803b158015610e4457600080fd5b505af4158015610e58573d6000803e3d6000fd5b50505050508315610ea357845460ff60401b19168555604051600181527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b5050505050505050505050505050565b600033610ec1818585612a03565b60019150505b92915050565b6040805161022081018252600080825260208201819052918101829052606081018290526080810182905260a0810182905260c0810182905260e08101829052610100810182905261012081018290526101408101829052610160810182905261018081018290526101a081018290526101c081018290526101e08101829052610200810191909152610f5e6128a1565b6001600160401b039283166000908152600e91909101602090815260409182902082516102208101845281548087168252600160401b808204881694830194909452600160801b808204881695830195909552600160c01b9004861660608201526001820154958616608082015260ff9286048316151560a0820152690100000000000000000086048316151560c0820152600160501b8604909216151560e08301526001600160801b03600160581b9095048516610100830152600281015480861661012084015283900485166101408301526003810154808616610160840152839004851661018083015260048101548086166101a084015283900485166101c0830152600501548085166101e0830152919091049092166102008301525090565b60006109077f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace025490565b60006110b66128a1565b600b0154919050565b6000336110cd858285612a10565b6110d8858585612a77565b60019150505b9392505050565b60006110ef612ad6565b60006110fa81611686565b1561112257604051635a28696f60e01b815260ff821660048201526024015b60405180910390fd5b61112a6128a1565b73__$465055f7dc2d46d38389f51f23e455a5ea$__90637cedd42790338688611151611082565b6040516001600160e01b031960e088901b16815260048101959095526001600160a01b0393841660248601529290911660448401526064830152608482015260a401602060405180830381865af41580156111b0573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906111d49190613d9e565b915050610ec7612b20565b60006111ea81612b46565b6111f48383612b6c565b505050565b600061120481612b46565b600660ff8316106112285760405163b4fa3fb360e01b815260040160405180910390fd5b600160ff83161b196112386128a1565b600401805490911690556112493390565b6001600160a01b03168260ff167f615fb22808961d3e8e5865548acfb2bf1cc63eb065267701d4318f95c154c712600060405161128a911515815260200190565b60405180910390a35050565b60006112a06128a1565b54600160a01b900460ff16919050565b6000610907612c12565b60006112c4612ad6565b6000806112cf6128a1565b73__$465055f7dc2d46d38389f51f23e455a5ea$__63a5c99e2e9091866112f4611082565b6040516001600160e01b031960e086901b168152600481019390935260248301919091526044820152606401606060405180830381865af415801561133d573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906113619190613e37565b9094509092509050801561137a5761137a308385612a77565b5050611384612b20565b919050565b60006113936128a1565b546001600160a01b0316919050565b6000806000806113b06128a1565b600c01546001600160401b03600160401b8204811696600160801b830482169650600160c01b909204169350915050565b6113e9612ad6565b6000806113f46128a1565b73__$465055f7dc2d46d38389f51f23e455a5ea$__9063b1e907b190338661141a611082565b6040516001600160e01b031960e087901b16815260048101949094526001600160a01b039092166024840152604483015260648201526084016040805180830381865af415801561146f573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906114939190613e74565b91509150806000146114aa576114aa308383612a77565b50506114b4612b20565b50565b6114bf612ad6565b6114c76128a1565b73__$465055f7dc2d46d38389f51f23e455a5ea$__90638b427f2e9033846114ed611082565b6040516001600160e01b031960e087901b16815260048101949094526001600160a01b0390921660248401526044830152606482015260840160006040518083038186803b15801561153e57600080fd5b505af4158015611552573d6000803e3d6000fd5b505050506114b4612b20565b60006115686128a1565b60018101549091506001600160a01b0316336001600160a01b0316146115a1576040516320dd208b60e11b815260040160405180910390fd5b6115ab83836129cd565b73__$465055f7dc2d46d38389f51f23e455a5ea$__639d513254826115ce611082565b6040516001600160e01b031960e085901b1681526004810192909252602482015260440160006040518083038186803b15801561160a57600080fd5b505af415801561161e573d6000803e3d6000fd5b50505050826001600160a01b03167f43ae70922dea8d45f4431151bd50d376d591767389df9923fe90db2242e5fc2f8360405161165d91815260200190565b60405180910390a2505050565b60006116746128a1565b600101546001600160a01b0316919050565b6000600160ff83161b6116976128a1565b6004015416151592915050565b60006116ae6128a1565b600301546001600160a01b0316919050565b60006116ca6128a1565b604051634b99360f60e11b8152600481019190915273__$465055f7dc2d46d38389f51f23e455a5ea$__906397326c1e906024016108c6565b60008060008051602061417b8339815191525b6001600160a01b0390931660009081526020939093525050604090205490565b60006117406128a1565b600c01546001600160401b0316919050565b600061175c612ad6565b600161176781611686565b1561178a57604051635a28696f60e01b815260ff82166004820152602401611119565b84158061179e57506001600160a01b038416155b806117b057506001600160a01b038316155b156117ce5760405163b4fa3fb360e01b815260040160405180910390fd5b336001600160a01b038416146117e9576117e9833387612a10565b6117f4833087612a77565b6117fc6128a1565b6040516327d756bb60e11b815260048101919091526001600160a01b038085166024830152851660448201526064810186905273__$465055f7dc2d46d38389f51f23e455a5ea$__90634faead7690608401602060405180830381865af415801561186b573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061188f9190613d9e565b9150506110de612b20565b6000610ec782612c1c565b6000606080828080838160008051602061419b83398151915280549091501580156118d257506001810154155b6119165760405162461bcd60e51b81526020600482015260156024820152741152540dcc4c8e88155b9a5b9a5d1a585b1a5e9959605a1b6044820152606401611119565b61191e612c45565b611926612c84565b60408051600080825260208201909252600f60f81b9c939b5091995046985030975095509350915050565b6040805161010081018252600080825260208201819052918101829052606081018290526080810182905260a0810182905260c0810182905260e081019190915261199a6128a1565b604080516101008101825260118301546001600160801b038082168352600160801b91829004811660208401526012850154808216948401949094529281900483166060830152601384015480841660808401520490911660a08201526014909101546001600160401b0380821660c0840152600160401b9091041660e0820152919050565b611a286128a1565b600301546001600160a01b0316336001600160a01b031614611a5c576040516282b42960e81b815260040160405180910390fd5b611a646128a1565b60405163390263d960e11b815273__$465055f7dc2d46d38389f51f23e455a5ea$__91637204c7b291611a9c91908590600401613ea2565b60006040518083038186803b158015611ab457600080fd5b505af4158015611ac8573d6000803e3d6000fd5b5050505050565b611ad7612ad6565b6002611ae281611686565b15611b0557604051635a28696f60e01b815260ff82166004820152602401611119565b6000611b0f6128a1565b60405163e1158f1960e01b81526004810182905290915060009073__$465055f7dc2d46d38389f51f23e455a5ea$__9063e1158f1990602401602060405180830381865af4158015611b65573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611b899190613d9e565b90508015611b9b57611b9b30826129cd565b73__$465055f7dc2d46d38389f51f23e455a5ea$__639d51325483611bbe611082565b6040516001600160e01b031960e085901b1681526004810192909252602482015260440160006040518083038186803b158015611bfa57600080fd5b505af4158015611c0e573d6000803e3d6000fd5b5050604051632f53598d60e21b81526004810185905273__$465055f7dc2d46d38389f51f23e455a5ea$__925063bd4d6634915060240160006040518083038186803b158015611c5d57600080fd5b505af4158015611c71573d6000803e3d6000fd5b50505050505050611c80612b20565b565b611c8a612ad6565b7fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63611cb481612b46565b6005611cbf81611686565b15611ce257604051635a28696f60e01b815260ff82166004820152602401611119565b611cea6128a1565b73__$465055f7dc2d46d38389f51f23e455a5ea$__631d9ff304909185611d0f611082565b6040516001600160e01b031960e086901b16815260048101939093526024830191909152604482015260640160006040518083038186803b158015611d5357600080fd5b505af4158015611d67573d6000803e3d6000fd5b5050505050506114b4612b20565b60009182527f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300602090815260408084206001600160a01b0393909316845291905290205460ff1690565b7f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace04805460609160008051602061417b8339815191529161093190613db7565b6000806000806000806000611e116128a1565b60058101546006820154600783015460088401546009850154600a90950154939c929b5090995097509195509350915050565b600033610ec1818585612a77565b611e5a612ad6565b611e626128a1565b604051632f53598d60e21b8152600481019190915273__$465055f7dc2d46d38389f51f23e455a5ea$__9063bd4d6634906024015b60006040518083038186803b158015611eaf57600080fd5b505af4158015611ec3573d6000803e3d6000fd5b50505050611c80612b20565b604080516080810182526000808252602082018190529181018290526060810191909152611efb6128a1565b60408051608081018252600d92909201546001600160401b038082168452600160401b820481166020850152600160801b8204811692840192909252600160c01b9004166060820152919050565b611f516128a1565b600301546001600160a01b0316336001600160a01b031614611f85576040516282b42960e81b815260040160405180910390fd5b6114b481612950565b611fc76040805160c081018252600080825260208201819052918101829052906060820190815260200160008152600060209091015290565b611fcf6128a1565b60008381526010919091016020908152604091829020825160c08101845281546001600160a01b03908116825260018084015491821694830194909452600160a01b81046001600160401b0316948201949094529290916060840191600160e01b900460ff169081111561204557612045613c0a565b600181111561205657612056613c0a565b815260200160018201601d9054906101000a900460ff16600381111561207e5761207e613c0a565b600381111561208f5761208f613c0a565b8152600291909101546001600160801b031660209091015292915050565b60006120b76128a1565b600201546001600160a01b0316919050565b6120d1612ad6565b6120d96128a1565b6040516391bd931560e01b8152600481019190915273__$465055f7dc2d46d38389f51f23e455a5ea$__906391bd931590602401611e97565b834211156121365760405163313c898160e11b815260048101859052602401611119565b60007f6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c98888886121a28c6001600160a01b031660009081527f5ab42ced628888259c08ac98db1eb0cf702fc1501344311d8b100cd1bfe4bb006020526040902080546001810190915590565b6040805160208101969096526001600160a01b0394851690860152929091166060840152608083015260a082015260c0810186905260e00160405160208183030381529060405280519060200120905060006121fd82612c9c565b9050600061220d82878787612cc9565b9050896001600160a01b0316816001600160a01b031614612254576040516325c0072360e11b81526001600160a01b0380831660048301528b166024820152604401611119565b61225f8a8a8a612a03565b50505050505050505050565b600061227681612b46565b6111f48383612cf7565b600061228a612ad6565b600461229581611686565b156122b857604051635a28696f60e01b815260ff82166004820152602401611119565b8515806122cc57506001600160a01b038516155b806122de57506001600160a01b038416155b156122fc5760405163b4fa3fb360e01b815260040160405180910390fd5b336001600160a01b0385161461231757612317843388612a10565b6123218487612d7e565b600061232b6128a1565b6040516334b1150b60e21b815260048101829052602481018990526001600160a01b03881660448201526064810186905290915060009073__$465055f7dc2d46d38389f51f23e455a5ea$__9063d2c4542c906084016040805180830381865af415801561239d573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906123c19190613f89565b9450905073__$465055f7dc2d46d38389f51f23e455a5ea$__639d513254836123e8611082565b6040516001600160e01b031960e085901b1681526004810192909252602482015260440160006040518083038186803b15801561242457600080fd5b505af4158015612438573d6000803e3d6000fd5b50505050806001600160401b0316876001600160a01b0316876001600160a01b03167ff61f135ac36f5c1bcbb3af449e310998805313b552c22fb54e97d1fc1620e9c88b88604051612494929190918252602082015260400190565b60405180910390a45050506124a7612b20565b949350505050565b6124b7612ad6565b60036124c281611686565b156124e557604051635a28696f60e01b815260ff82166004820152602401611119565b60006124ef6128a1565b604051630efebb5160e11b81526004810182905290915060009073__$465055f7dc2d46d38389f51f23e455a5ea$__90631dfd76a290602401602060405180830381865af4158015612545573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906125699190613d9e565b90508015611b9b57611b9b3082612d7e565b6001600160a01b0391821660009081527f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace016020908152604080832093909416825291909152205490565b6125ef7f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a504133611d75565b1580156126045750612602600033611d75565b155b15612621576040516282b42960e81b815260040160405180910390fd5b600660ff8216106126455760405163b4fa3fb360e01b815260040160405180910390fd5b600160ff82161b6126546128a1565b600401805490911790556126653390565b6001600160a01b03168160ff167f615fb22808961d3e8e5865548acfb2bf1cc63eb065267701d4318f95c154c71260016040516126a6911515815260200190565b60405180910390a350565b6126b96128a1565b600301546001600160a01b0316336001600160a01b0316146126ed576040516282b42960e81b815260040160405180910390fd5b6126f56128a1565b6040516317d6c84360e11b815273__$465055f7dc2d46d38389f51f23e455a5ea$__91632fad908691611a9c91908590600401613fa7565b6127356128a1565b600301546001600160a01b0316336001600160a01b031614612769576040516282b42960e81b815260040160405180910390fd5b6001600160a01b038116612790576040516306b7c75960e31b815260040160405180910390fd5b806127996128a1565b60020180546001600160a01b0319166001600160a01b03928316179055604051908216907fb7eb7a18d33108463561210485f852e7dfe473045df87fe6f06caf8f6b11e62890600090a250565b6040805160a0810182526000808252602082018190529181018290526060810182905260808101919091526128196128a1565b600b01828154811061282d5761282d61402a565b60009182526020918290206040805160a081018252600390930290910180546001600160401b03811684526001600160801b03600160401b909104811694840194909452600181015480851692840192909252600160801b9091048316606083015260020154909116608082015292915050565b7f7b80b62495198692ae2748b2cdafbaec6bff4d8db0d1e8fb8ff543cac4ce2f0090565b6000807ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00610ec7565b6128f6612db4565b6129008282612dd9565b5050565b61290c612db4565b6114b481604051806040016040528060018152602001603160f81b815250612e2a565b612937612db4565b611c80612e8b565b612947612db4565b6114b481612e93565b6001600160a01b038116612977576040516306b7c75960e31b815260040160405180910390fd5b806129806128a1565b60030180546001600160a01b0319166001600160a01b03928316179055604051908216907fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a250565b6001600160a01b0382166129f75760405163ec442f0560e01b815260006004820152602401611119565b61290060008383612ea6565b6111f48383836001612fe4565b6000612a1c848461257b565b9050600019811015612a715781811015612a6257604051637dc7a0d960e11b81526001600160a01b03841660048201526024810182905260448101839052606401611119565b612a7184848484036000612fe4565b50505050565b6001600160a01b038316612aa157604051634b637e8f60e11b815260006004820152602401611119565b6001600160a01b038216612acb5760405163ec442f0560e01b815260006004820152602401611119565b6111f4838383612ea6565b7f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00805460011901612b1a57604051633ee5aeb560e01b815260040160405180910390fd5b60029055565b60017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f0055565b612b508133611d75565b6114b4576040516282b42960e81b815260040160405180910390fd5b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300612b978383611d75565b6111f4576000838152602082815260408083206001600160a01b03861684529091529020805460ff19166001179055612bcd3390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a4505050565b60006109076130cb565b6000807f5ab42ced628888259c08ac98db1eb0cf702fc1501344311d8b100cd1bfe4bb00611716565b7fa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d102805460609160008051602061419b8339815191529161093190613db7565b6060600060008051602061419b833981519152610920565b6000610ec7612ca9612c12565b8360405161190160f01b8152600281019290925260228201526042902090565b600080600080612cdb8888888861313f565b925092509250612ceb828261320e565b50909695505050505050565b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300612d228383611d75565b156111f4576000838152602082815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a4505050565b6001600160a01b038216612da857604051634b637e8f60e11b815260006004820152602401611119565b61290082600083612ea6565b612dbc6132c7565b611c8057604051631afcd79f60e31b815260040160405180910390fd5b612de1612db4565b60008051602061417b8339815191527f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace03612e1b848261409b565b5060048101612a71838261409b565b612e32612db4565b60008051602061419b8339815191527fa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d102612e6c848261409b565b5060038101612e7b838261409b565b5060008082556001909101555050565b612b20612db4565b612e9b612db4565b6114b4600082612b6c565b60008051602061417b8339815191526001600160a01b038416612ee25781816002016000828254612ed79190614159565b90915550612f549050565b6001600160a01b03841660009081526020829052604090205482811015612f355760405163391434e360e21b81526001600160a01b03861660048201526024810182905260448101849052606401611119565b6001600160a01b03851660009081526020839052604090209083900390555b6001600160a01b038316612f72576002810180548390039055612f91565b6001600160a01b03831660009081526020829052604090208054830190555b826001600160a01b0316846001600160a01b03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef84604051612fd691815260200190565b60405180910390a350505050565b60008051602061417b8339815191526001600160a01b03851661301d5760405163e602df0560e01b815260006004820152602401611119565b6001600160a01b03841661304757604051634a1406b160e11b815260006004820152602401611119565b6001600160a01b03808616600090815260018301602090815260408083209388168352929052208390558115611ac857836001600160a01b0316856001600160a01b03167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925856040516130bc91815260200190565b60405180910390a35050505050565b60007f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f6130f66132e1565b6130fe61334b565b60408051602081019490945283019190915260608201524660808201523060a082015260c00160405160208183030381529060405280519060200120905090565b600080807f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a084111561317a5750600091506003905082613204565b604080516000808252602082018084528a905260ff891692820192909252606081018790526080810186905260019060a0016020604051602081039080840390855afa1580156131ce573d6000803e3d6000fd5b5050604051601f1901519150506001600160a01b0381166131fa57506000925060019150829050613204565b9250600091508190505b9450945094915050565b600082600381111561322257613222613c0a565b0361322b575050565b600182600381111561323f5761323f613c0a565b0361325d5760405163f645eedf60e01b815260040160405180910390fd5b600282600381111561327157613271613c0a565b036132925760405163fce698f760e01b815260048101829052602401611119565b60038260038111156132a6576132a6613c0a565b03612900576040516335e2f38360e21b815260048101829052602401611119565b60006132d16128c5565b54600160401b900460ff16919050565b600060008051602061419b833981519152816132fb612c45565b80519091501561331357805160209091012092915050565b81548015613322579392505050565b7fc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470935050505090565b600060008051602061419b83398151915281613365612c84565b80519091501561337d57805160209091012092915050565b60018201548015613322579392505050565b6000815180845260005b818110156133b557602081850181015186830182015201613399565b506000602082860101526020601f19601f83011685010191505092915050565b6020815260006110de602083018461338f565b6001600160a01b03811681146114b457600080fd5b8035611384816133e8565b634e487b7160e01b600052604160045260246000fd5b60405161010081016001600160401b038111828210171561344157613441613408565b60405290565b600082601f83011261345857600080fd5b81356001600160401b0381111561347157613471613408565b604051601f8201601f19908116603f011681016001600160401b038111828210171561349f5761349f613408565b6040528181528382016020018510156134b757600080fd5b816020850160208301376000918101602001919091529392505050565b6001600160401b03811681146114b457600080fd5b8035611384816134d4565b60006080828403121561350657600080fd5b604051608081016001600160401b038111828210171561352857613528613408565b6040529050808235613539816134d4565b81526020830135613549816134d4565b6020820152604083013561355c816134d4565b6040820152606083013561356f816134d4565b6060919091015292915050565b80356001600160801b038116811461138457600080fd5b600061010082840312156135a657600080fd5b6135ae61341e565b90506135b98261357c565b81526135c76020830161357c565b60208201526135d86040830161357c565b60408201526135e96060830161357c565b60608201526135fa6080830161357c565b608082015261360b60a0830161357c565b60a082015260c082013561361e816134d4565b60c082015261362f60e083016134e9565b60e082015292915050565b60008060008060008060008060006102608a8c03121561365957600080fd5b8935613664816133e8565b985060208a01356001600160401b0381111561367f57600080fd5b61368b8c828d01613447565b98505060408a01356001600160401b038111156136a757600080fd5b6136b38c828d01613447565b9750506136c260608b016133fd565b95506136d060808b016133fd565b94506136de60a08b016133fd565b935060c08a013592506136f48b60e08c016134f4565b91506137048b6101608c01613593565b90509295985092959850929598565b6000806040838503121561372657600080fd5b8235613731816133e8565b946020939093013593505050565b60006020828403121561375157600080fd5b81356110de816134d4565b81516001600160401b031681526102208101602083015161378860208401826001600160401b03169052565b5060408301516137a360408401826001600160401b03169052565b5060608301516137be60608401826001600160401b03169052565b5060808301516137d960808401826001600160401b03169052565b5060a08301516137ed60a084018215159052565b5060c083015161380160c084018215159052565b5060e083015161381560e084018215159052565b506101008301516138326101008401826001600160801b03169052565b5061012083015161384f6101208401826001600160801b03169052565b5061014083015161386c6101408401826001600160801b03169052565b506101608301516138896101608401826001600160801b03169052565b506101808301516138a66101808401826001600160801b03169052565b506101a08301516138c36101a08401826001600160801b03169052565b506101c08301516138e06101c08401826001600160801b03169052565b506101e08301516138fd6101e08401826001600160801b03169052565b5061020083015161391a6102008401826001600160801b03169052565b5092915050565b60008060006060848603121561393657600080fd5b8335613941816133e8565b92506020840135613951816133e8565b929592945050506040919091013590565b6000806040838503121561397557600080fd5b823591506020830135613987816133e8565b809150509250929050565b60ff811681146114b457600080fd5b6000602082840312156139b357600080fd5b81356110de81613992565b6000602082840312156139d057600080fd5b5035919050565b6000602082840312156139e957600080fd5b81356110de816133e8565b600080600060608486031215613a0957600080fd5b833592506020840135613a1b816133e8565b91506040840135613a2b816133e8565b809150509250925092565b60ff60f81b8816815260e060208201526000613a5560e083018961338f565b8281036040840152613a67818961338f565b606084018890526001600160a01b038716608085015260a0840186905283810360c08501528451808252602080870193509091019060005b81811015613abd578351835260209384019390920191600101613a9f565b50909b9a5050505050505050505050565b6001600160801b0381511682526001600160801b0360208201511660208301526001600160801b0360408201511660408301526060810151613b1b60608401826001600160801b03169052565b506080810151613b3660808401826001600160801b03169052565b5060a0810151613b5160a08401826001600160801b03169052565b5060c0810151613b6c60c08401826001600160401b03169052565b5060e08101516111f460e08401826001600160401b03169052565b6101008101610ec78284613ace565b6000610100828403128015613baa57600080fd5b509092915050565b6001600160401b0381511682526001600160401b0360208201511660208301526001600160401b0360408201511660408301526001600160401b0360608201511660608301525050565b60808101610ec78284613bb2565b634e487b7160e01b600052602160045260246000fd5b81516001600160a01b039081168252602080840151909116908201526040808301516001600160401b031690820152606082015160c082019060028110613c6957613c69613c0a565b6060830152608083015160048110613c8357613c83613c0a565b8060808401525060a083015161391a60a08401826001600160801b03169052565b600080600080600080600060e0888a031215613cbf57600080fd5b8735613cca816133e8565b96506020880135613cda816133e8565b955060408801359450606088013593506080880135613cf881613992565b9699959850939692959460a0840135945060c09093013592915050565b60008060008060808587031215613d2b57600080fd5b843593506020850135613d3d816133e8565b92506040850135613d4d816133e8565b9396929550929360600135925050565b60008060408385031215613d7057600080fd5b8235613d7b816133e8565b91506020830135613987816133e8565b60006080828403128015613baa57600080fd5b600060208284031215613db057600080fd5b5051919050565b600181811c90821680613dcb57607f821691505b602082108103613deb57634e487b7160e01b600052602260045260246000fd5b50919050565b600060208284031215613e0357600080fd5b81516110de81613992565b82815260a081016110de6020830184613bb2565b82815261012081016110de6020830184613ace565b600080600060608486031215613e4c57600080fd5b8351613e57816133e8565b6020850151604086015191945092508015158114613a2b57600080fd5b60008060408385031215613e8757600080fd5b8251613e92816133e8565b6020939093015192949293505050565b82815261012081016001600160801b03613ebb8461357c565b1660208301526001600160801b03613ed56020850161357c565b1660408301526001600160801b03613eef6040850161357c565b166060830152613f016060840161357c565b6001600160801b038116608084015250613f1d6080840161357c565b6001600160801b03811660a084015250613f3960a0840161357c565b6001600160801b03811660c084015250613f5560c084016134e9565b6001600160401b03811660e084015250613f7160e084016134e9565b6001600160401b038116610100840152509392505050565b60008060408385031215613f9c57600080fd5b8251613e92816134d4565b82815260a081018235613fb9816134d4565b6001600160401b0381166020840152506020830135613fd7816134d4565b6001600160401b0381166040840152506040830135613ff5816134d4565b6001600160401b0381166060840152506060830135614013816134d4565b6001600160401b0381166080840152509392505050565b634e487b7160e01b600052603260045260246000fd5b601f8211156111f457828211156111f457806000526020600020601f840160051c602085101561406e575060005b90810190601f840160051c0360005b818110156140935760008382015560010161407d565b505050505050565b81516001600160401b038111156140b4576140b4613408565b6140c8816140c28454613db7565b84614040565b6020601f8211600181146140fc57600083156140e45750848201515b600019600385901b1c1916600184901b178455611ac8565b600084815260208120601f198516915b8281101561412c578785015182556020948501946001909201910161410c565b508482101561414a5786840151600019600387901b60f8161c191681555b50505050600190811b01905550565b80820180821115610ec757634e487b7160e01b600052601160045260246000fdfe52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00a16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d100a2646970667358221220558ea5d61ce9b355fbcee9888295947452f0413559f730cb7a414feaf1f9e58064736f6c63430008210033";
var isSuperArgs5 = (xs) => {
  return typeof xs[0] === "string" || Array.isArray(xs[0]) || "_isInterface" in xs[0];
};
var _EpochVault__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs5(args)) {
      super(...args);
    } else {
      const [linkLibraryAddresses, signer] = args;
      super(
        _abi5,
        _EpochVault__factory.linkBytecode(linkLibraryAddresses),
        signer
      );
    }
  }
  static linkBytecode(linkLibraryAddresses) {
    let linkedBytecode = _bytecode5;
    linkedBytecode = linkedBytecode.replace(
      new RegExp("__\\$465055f7dc2d46d38389f51f23e455a5ea\\$__", "g"),
      linkLibraryAddresses["contracts/tick/EpochVaultLogic.sol:EpochVaultLogic"].replace(/^0x/, "").toLowerCase()
    );
    return linkedBytecode;
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi5);
  }
  static connect(address, runner) {
    return new Contract(address, _abi5, runner);
  }
};
var EpochVault__factory = _EpochVault__factory;
EpochVault__factory.bytecode = _bytecode5;
EpochVault__factory.abi = _abi5;

// libs/typechain/src/factories/IERC20__factory.ts
var _abi6 = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var IERC20__factory = class {
  static createInterface() {
    return new Interface(_abi6);
  }
  static connect(address, runner) {
    return new Contract(address, _abi6, runner);
  }
};
IERC20__factory.abi = _abi6;

// libs/typechain/src/factories/IProvider__factory.ts
var _abi7 = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "getDepositRate",
    outputs: [
      {
        internalType: "uint256",
        name: "rate",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getIdentifier",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "keyOne",
        type: "address"
      },
      {
        internalType: "address",
        name: "keyTwo",
        type: "address"
      },
      {
        internalType: "address",
        name: "keyThree",
        type: "address"
      }
    ],
    name: "getSource",
    outputs: [
      {
        internalType: "address",
        name: "source",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var IProvider__factory = class {
  static createInterface() {
    return new Interface(_abi7);
  }
  static connect(address, runner) {
    return new Contract(address, _abi7, runner);
  }
};
IProvider__factory.abi = _abi7;

// libs/typechain/src/factories/IProviderManager__factory.ts
var _abi8 = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        indexed: true,
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "assetTwo",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "market",
        type: "address"
      }
    ],
    name: "MarketUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        indexed: true,
        internalType: "address",
        name: "asset",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "yieldToken",
        type: "address"
      }
    ],
    name: "YieldTokenUpdated",
    type: "event"
  },
  {
    inputs: [],
    name: "getIdentifiers",
    outputs: [
      {
        internalType: "string[]",
        name: "",
        type: "string[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        internalType: "address",
        name: "assetTwo",
        type: "address"
      }
    ],
    name: "getMarket",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "asset",
        type: "address"
      }
    ],
    name: "getYieldToken",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        internalType: "address",
        name: "assetTwo",
        type: "address"
      },
      {
        internalType: "address",
        name: "market",
        type: "address"
      }
    ],
    name: "setMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "asset",
        type: "address"
      },
      {
        internalType: "address",
        name: "yieldToken",
        type: "address"
      }
    ],
    name: "setYieldToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var IProviderManager__factory = class {
  static createInterface() {
    return new Interface(_abi8);
  }
  static connect(address, runner) {
    return new Contract(address, _abi8, runner);
  }
};
IProviderManager__factory.abi = _abi8;

// libs/typechain/src/factories/IVault__factory.ts
var _abi9 = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider",
        name: "activeProvider",
        type: "address"
      }
    ],
    name: "ActiveProviderUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Deposit",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "rewardsDistributor",
        type: "address"
      }
    ],
    name: "DistributorUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      }
    ],
    name: "FeeCharged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "minAmount",
        type: "uint256"
      }
    ],
    name: "MinAmountUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "ProvidersUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsFrom",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsTo",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      }
    ],
    name: "RebalanceExecuted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "RewardsTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "setupAddress",
        type: "address"
      }
    ],
    name: "SetupCompleted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "TreasuryUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Withdraw",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "withdrawFeePercent",
        type: "uint256"
      }
    ],
    name: "WithdrawFeePercentUpdated",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "assetTokenAddress",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "convertToAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "convertToShares",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "maxDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "maxAssets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "maxMint",
    outputs: [
      {
        internalType: "uint256",
        name: "maxShares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "maxShares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "maxAssets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "mint",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewMint",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "contract IProvider",
        name: "from",
        type: "address"
      },
      {
        internalType: "contract IProvider",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      },
      {
        internalType: "bool",
        name: "activateToProvider",
        type: "bool"
      }
    ],
    name: "rebalance",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "redeem",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "setupVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "totalManagedAssets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var IVault__factory = class {
  static createInterface() {
    return new Interface(_abi9);
  }
  static connect(address, runner) {
    return new Contract(address, _abi9, runner);
  }
};
IVault__factory.abi = _abi9;

// libs/typechain/src/factories/InterestLocker__factory.ts
var _abi10 = [
  {
    inputs: [
      {
        internalType: "address[]",
        name: "initialTokens",
        type: "address[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "InterestLocker__AddressZero",
    type: "error"
  },
  {
    inputs: [],
    name: "InterestLocker__InvalidDuration",
    type: "error"
  },
  {
    inputs: [],
    name: "InterestLocker__InvalidTokenAmount",
    type: "error"
  },
  {
    inputs: [],
    name: "InterestLocker__NotAuthorized",
    type: "error"
  },
  {
    inputs: [],
    name: "InterestLocker__TokenNotSupported",
    type: "error"
  },
  {
    inputs: [],
    name: "InterestLocker__TooSoonToUnlock",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferStarted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address[]",
        name: "tokens",
        type: "address[]"
      }
    ],
    name: "TokensChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "duration",
        type: "uint256"
      }
    ],
    name: "TokensLocked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "TokensUnlocked",
    type: "event"
  },
  {
    inputs: [],
    name: "MIN_DURATION",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      }
    ],
    name: "getBeneficiary",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTokens",
    outputs: [
      {
        internalType: "address[]",
        name: "",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "getTotalLocked",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    name: "lockInfo",
    outputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "duration",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "unlockTime",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "duration",
        type: "uint256"
      }
    ],
    name: "lockTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "nextLockId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address[]",
        name: "tokens",
        type: "address[]"
      }
    ],
    name: "setTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      }
    ],
    name: "unlockTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode6 = "0x60806040523480156200001157600080fd5b50604051620012ee380380620012ee83398101604081905262000034916200022d565b6200003f3362000051565b6200004a816200006f565b5062000367565b600180546001600160a01b03191690556200006c8162000129565b50565b60005b8151811015620000d55760006001600160a01b03168282815181106200009c576200009c620002ff565b60200260200101516001600160a01b031603620000cc5760405163eaec6dcd60e01b815260040160405180910390fd5b60010162000072565b508051620000eb90600390602084019062000179565b507ff815e975aedb10150caccee1a3689966cc454580b1d633e4c2748baf919287f860036040516200011e919062000315565b60405180910390a150565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b828054828255906000526020600020908101928215620001d1579160200282015b82811115620001d157825182546001600160a01b0319166001600160a01b039091161782556020909201916001909101906200019a565b50620001df929150620001e3565b5090565b5b80821115620001df5760008155600101620001e4565b634e487b7160e01b600052604160045260246000fd5b80516001600160a01b03811681146200022857600080fd5b919050565b600060208083850312156200024157600080fd5b82516001600160401b03808211156200025957600080fd5b818501915085601f8301126200026e57600080fd5b815181811115620002835762000283620001fa565b8060051b604051601f19603f83011681018181108582111715620002ab57620002ab620001fa565b604052918252848201925083810185019188831115620002ca57600080fd5b938501935b82851015620002f357620002e38562000210565b84529385019392850192620002cf565b98975050505050505050565b634e487b7160e01b600052603260045260246000fd5b6020808252825482820181905260008481528281209092916040850190845b818110156200035b5783546001600160a01b03168352600193840193928501920162000334565b50909695505050505050565b610f7780620003776000396000f3fe608060405234801561001057600080fd5b50600436106100ba5760003560e01c806305c77a3c146100bf578063302df083146100fb5780635b1a4c241461013c578063625adaf2146101a55780636518a0b3146101ba578063715018a6146101c357806379ba5097146101cb5780637c405325146101d35780638da5cb5b146101e6578063a25983e5146101ee578063aa6ca80814610201578063b6a6d17714610216578063e30c397814610220578063f2fde38b14610228575b600080fd5b6100e86100cd366004610c62565b6001600160a01b031660009081526006602052604090205490565b6040519081526020015b60405180910390f35b610124610109366004610c84565b6000908152600560205260409020546001600160a01b031690565b6040516001600160a01b0390911681526020016100f2565b61017b61014a366004610c84565b60046020526000908152604090208054600182015460028301546003909301546001600160a01b0390921692909184565b604080516001600160a01b03909516855260208501939093529183015260608201526080016100f2565b6101b86101b3366004610cb3565b61023b565b005b6100e860025481565b6101b861024f565b6101b8610263565b6101b86101e1366004610c84565b6102e3565b610124610461565b6101b86101fc366004610d77565b610470565b610209610613565b6040516100f29190610daa565b6100e862278d0081565b610124610675565b6101b8610236366004610c62565b610684565b6102436106ea565b61024c81610749565b50565b6102576106ea565b61026160006107f9565b565b338061026d610675565b6001600160a01b0316146102da5760405162461bcd60e51b815260206004820152602960248201527f4f776e61626c6532537465703a2063616c6c6572206973206e6f7420746865206044820152683732bb9037bbb732b960b91b60648201526084015b60405180910390fd5b61024c816107f9565b6000818152600460209081526040808320815160808101835281546001600160a01b03908116825260018301548286015260028301548285015260039092015460608201528585526005909352922054909116338114610356576040516323035d7b60e21b815260040160405180910390fd5b81516020830151606084015142101561038257604051630eaff1b760e11b815260040160405180910390fd5b600085815260046020908152604080832080546001600160a01b031990811682556001820185905560028201859055600390910184905560058352818420805490911690556001600160a01b03851683526006909152812080548392906103ea908490610e0d565b9091555061040490506001600160a01b0383168483610812565b816001600160a01b0316836001600160a01b03167f19193c14e304bcaafa1323889b15c70abcee51dc8cce9b0a4f21040ed456a4af8784604051610452929190918252602082015260400190565b60405180910390a35050505050565b6000546001600160a01b031690565b8160000361049157604051630e559a2160e41b815260040160405180910390fd5b61049a8361087a565b6104b757604051631f1ea91760e31b815260040160405180910390fd5b62278d008110156104db57604051637ce12a0360e01b815260040160405180910390fd5b60006040518060800160405280856001600160a01b03168152602001848152602001838152602001834261050f9190610e26565b9052600280546000818152600460209081526040808320865181546001600160a01b039182166001600160a01b031991821617835584890151600184015583890151978301979097556060880151600390920191909155600583528184208054909616331790955593891682526006905291822080549394509092869290610598908490610e26565b9091555050600280549060006105ad83610e39565b909155506105c890506001600160a01b0386163330876108d9565b60408051828152602081018690529081018490526001600160a01b0386169033907fdd17148ffeb69e95dbd8fee5b9a79df1fad7408e496cd1cdec4adf522527e90d90606001610452565b6060600380548060200260200160405190810160405280929190818152602001828054801561066b57602002820191906000526020600020905b81546001600160a01b0316815260019091019060200180831161064d575b5050505050905090565b6001546001600160a01b031690565b61068c6106ea565b600180546001600160a01b0319166001600160a01b0383169081179091556106b2610461565b6001600160a01b03167f38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e2270060405160405180910390a350565b336106f3610461565b6001600160a01b0316146102615760405162461bcd60e51b815260206004820181905260248201527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e657260448201526064016102d1565b60005b81518110156107a95760006001600160a01b031682828151811061077257610772610e52565b60200260200101516001600160a01b0316036107a15760405163eaec6dcd60e01b815260040160405180910390fd5b60010161074c565b5080516107bd906003906020840190610bcc565b507ff815e975aedb10150caccee1a3689966cc454580b1d633e4c2748baf919287f860036040516107ee9190610e68565b60405180910390a150565b600180546001600160a01b031916905561024c81610917565b6040516001600160a01b03831660248201526044810182905261087590849063a9059cbb60e01b906064015b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b031990931692909217909152610967565b505050565b600354600090815b818110156108d257836001600160a01b0316600382815481106108a7576108a7610e52565b6000918252602090912001546001600160a01b0316036108ca57600192506108d2565b600101610882565b5050919050565b6040516001600160a01b03808516602483015283166044820152606481018290526109119085906323b872dd60e01b9060840161083e565b50505050565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b60006109bc826040518060400160405280602081526020017f5361666545524332303a206c6f772d6c6576656c2063616c6c206661696c6564815250856001600160a01b0316610a3c9092919063ffffffff16565b90508051600014806109dd5750808060200190518101906109dd9190610eac565b6108755760405162461bcd60e51b815260206004820152602a60248201527f5361666545524332303a204552433230206f7065726174696f6e20646964206e6044820152691bdd081cdd58d8d9595960b21b60648201526084016102d1565b6060610a4b8484600085610a53565b949350505050565b606082471015610ab45760405162461bcd60e51b815260206004820152602660248201527f416464726573733a20696e73756666696369656e742062616c616e636520666f6044820152651c8818d85b1b60d21b60648201526084016102d1565b600080866001600160a01b03168587604051610ad09190610ef2565b60006040518083038185875af1925050503d8060008114610b0d576040519150601f19603f3d011682016040523d82523d6000602084013e610b12565b606091505b5091509150610b2387838387610b2e565b979650505050505050565b60608315610b9d578251600003610b96576001600160a01b0385163b610b965760405162461bcd60e51b815260206004820152601d60248201527f416464726573733a2063616c6c20746f206e6f6e2d636f6e747261637400000060448201526064016102d1565b5081610a4b565b610a4b8383815115610bb25781518083602001fd5b8060405162461bcd60e51b81526004016102d19190610f0e565b828054828255906000526020600020908101928215610c21579160200282015b82811115610c2157825182546001600160a01b0319166001600160a01b03909116178255602090920191600190910190610bec565b50610c2d929150610c31565b5090565b5b80821115610c2d5760008155600101610c32565b80356001600160a01b0381168114610c5d57600080fd5b919050565b600060208284031215610c7457600080fd5b610c7d82610c46565b9392505050565b600060208284031215610c9657600080fd5b5035919050565b634e487b7160e01b600052604160045260246000fd5b60006020808385031215610cc657600080fd5b82356001600160401b0380821115610cdd57600080fd5b818501915085601f830112610cf157600080fd5b813581811115610d0357610d03610c9d565b8060051b604051601f19603f83011681018181108582111715610d2857610d28610c9d565b604052918252848201925083810185019188831115610d4657600080fd5b938501935b82851015610d6b57610d5c85610c46565b84529385019392850192610d4b565b98975050505050505050565b600080600060608486031215610d8c57600080fd5b610d9584610c46565b95602085013595506040909401359392505050565b6020808252825182820181905260009190848201906040850190845b81811015610deb5783516001600160a01b031683529284019291840191600101610dc6565b50909695505050505050565b634e487b7160e01b600052601160045260246000fd5b81810381811115610e2057610e20610df7565b92915050565b80820180821115610e2057610e20610df7565b600060018201610e4b57610e4b610df7565b5060010190565b634e487b7160e01b600052603260045260246000fd5b6020808252825482820181905260008481528281209092916040850190845b81811015610deb5783546001600160a01b031683526001938401939285019201610e87565b600060208284031215610ebe57600080fd5b81518015158114610c7d57600080fd5b60005b83811015610ee9578181015183820152602001610ed1565b50506000910152565b60008251610f04818460208701610ece565b9190910192915050565b6020815260008251806020840152610f2d816040850160208701610ece565b601f01601f1916919091016040019291505056fea26469706673582212201308150acbd5e32afca54d7e30ce3e8e735210e414bce5ef91cef52ef8cca02564736f6c63430008170033";
var isSuperArgs6 = (xs) => xs.length > 1;
var InterestLocker__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs6(args)) {
      super(...args);
    } else {
      super(_abi10, _bytecode6, args[0]);
    }
  }
  getDeployTransaction(initialTokens, overrides) {
    return super.getDeployTransaction(initialTokens, overrides || {});
  }
  deploy(initialTokens, overrides) {
    return super.deploy(initialTokens, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi10);
  }
  static connect(address, runner) {
    return new Contract(address, _abi10, runner);
  }
};
InterestLocker__factory.bytecode = _bytecode6;
InterestLocker__factory.abi = _abi10;

// libs/typechain/src/factories/Locker__factory.ts
var _abi11 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "owner_",
        type: "address"
      },
      {
        internalType: "address[]",
        name: "tokens_",
        type: "address[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "Locker__AddressZero",
    type: "error"
  },
  {
    inputs: [],
    name: "Locker__InvalidTokenAmount",
    type: "error"
  },
  {
    inputs: [],
    name: "Locker__TokenNotSupported",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "OwnableInvalidOwner",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferStarted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address[]",
        name: "tokens",
        type: "address[]"
      }
    ],
    name: "TokensChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "TokensLocked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "contract IERC20",
        name: "token",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "TokensWithdrawn",
    type: "event"
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "lockId",
        type: "uint256"
      }
    ],
    name: "getBeneficiary",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTokens",
    outputs: [
      {
        internalType: "address[]",
        name: "",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "getTotalLocked",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    name: "lockInfo",
    outputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "lockedAt",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "lockTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "nextLockId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address[]",
        name: "tokens",
        type: "address[]"
      }
    ],
    name: "setTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IERC20",
        name: "token",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      }
    ],
    name: "withdrawTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode7 = "0x60806040523480156200001157600080fd5b5060405162000f6e38038062000f6e83398101604081905262000034916200025f565b816001600160a01b0381166200006457604051631e4fbdf760e01b81526000600482015260240160405180910390fd5b6200006f8162000083565b506200007b81620000a1565b5050620003b0565b600180546001600160a01b03191690556200009e816200015b565b50565b60005b8151811015620001075760006001600160a01b0316828281518110620000ce57620000ce62000348565b60200260200101516001600160a01b031603620000fe5760405163573054d760e01b815260040160405180910390fd5b600101620000a4565b5080516200011d906002906020840190620001ab565b507ff815e975aedb10150caccee1a3689966cc454580b1d633e4c2748baf919287f860026040516200015091906200035e565b60405180910390a150565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b82805482825590600052602060002090810192821562000203579160200282015b828111156200020357825182546001600160a01b0319166001600160a01b03909116178255602090920191600190910190620001cc565b506200021192915062000215565b5090565b5b8082111562000211576000815560010162000216565b80516001600160a01b03811681146200024457600080fd5b919050565b634e487b7160e01b600052604160045260246000fd5b600080604083850312156200027357600080fd5b6200027e836200022c565b602084810151919350906001600160401b03808211156200029e57600080fd5b818601915086601f830112620002b357600080fd5b815181811115620002c857620002c862000249565b8060051b604051601f19603f83011681018181108582111715620002f057620002f062000249565b6040529182528482019250838101850191898311156200030f57600080fd5b938501935b82851015620003385762000328856200022c565b8452938501939285019262000314565b8096505050505050509250929050565b634e487b7160e01b600052603260045260246000fd5b6020808252825482820181905260008481528281209092916040850190845b81811015620003a45783546001600160a01b0316835260019384019392850192016200037d565b50909695505050505050565b610bae80620003c06000396000f3fe608060405234801561001057600080fd5b50600436106100af5760003560e01c806305c77a3c146100b4578063302df083146100f05780635b1a4c2414610126578063625adaf2146101845780636518a0b314610199578063715018a6146101a257806379ba5097146101aa5780638da5cb5b146101b2578063a522ad25146101ba578063aa6ca808146101cd578063b1c25586146101e2578063e30c3978146101f5578063f2fde38b146101fd575b600080fd5b6100dd6100c23660046108e0565b6001600160a01b031660009081526005602052604090205490565b6040519081526020015b60405180910390f35b6101196100fe366004610904565b6000908152600460205260409020546001600160a01b031690565b6040516100e7919061091d565b61015f610134366004610904565b6003602052600090815260409020805460018201546002909201546001600160a01b03909116919083565b604080516001600160a01b0390941684526020840192909252908201526060016100e7565b610197610192366004610947565b610210565b005b6100dd60065481565b610197610224565b610197610238565b61011961027d565b6101976101c8366004610a0b565b61028c565b6101d561036c565b6040516100e79190610a44565b6101976101f0366004610a91565b6103ce565b61011961051c565b61019761020b3660046108e0565b61052b565b610218610591565b610221816105c3565b50565b61022c610591565b6102366000610673565b565b338061024261051c565b6001600160a01b031614610274578060405163118cdaa760e01b815260040161026b919061091d565b60405180910390fd5b61022181610673565b6000546001600160a01b031690565b610294610591565b6040516370a0823160e01b81526000906001600160a01b038416906370a08231906102c390309060040161091d565b602060405180830381865afa1580156102e0573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103049190610abd565b905061031a6001600160a01b038416838361068c565b816001600160a01b0316836001600160a01b03167f6337ed398c0e8467698c581374fdce4db14922df487b5a39483079f5f59b60a48360405161035f91815260200190565b60405180910390a3505050565b606060028054806020026020016040519081016040528092919081815260200182805480156103c457602002820191906000526020600020905b81546001600160a01b031681526001909101906020018083116103a6575b5050505050905090565b806000036103ef57604051631c9d27d560e01b815260040160405180910390fd5b6103f8826106f0565b61041557604051634239e62160e01b815260040160405180910390fd5b604080516060810182526001600160a01b038085168083526020808401868152428587019081526006546000818152600385528881208851815498166001600160a01b031998891617815593516001850155915160029093019290925560048352868120805490951633179094559183526005905292812080549293928592906104a0908490610aec565b9091555050600680549060006104b583610b05565b909155506104d090506001600160a01b03851633308661074a565b60408051828152602081018590526001600160a01b0386169133917f68a827b440637f25fd18f4f2a0241695ca03b5a4a85bf191cc09756e6b8b6dc6910160405180910390a350505050565b6001546001600160a01b031690565b610533610591565b600180546001600160a01b0319166001600160a01b03831690811790915561055961027d565b6001600160a01b03167f38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e2270060405160405180910390a350565b3361059a61027d565b6001600160a01b031614610236573360405163118cdaa760e01b815260040161026b919061091d565b60005b81518110156106235760006001600160a01b03168282815181106105ec576105ec610b1e565b60200260200101516001600160a01b03160361061b5760405163573054d760e01b815260040160405180910390fd5b6001016105c6565b508051610637906002906020840190610841565b507ff815e975aedb10150caccee1a3689966cc454580b1d633e4c2748baf919287f860026040516106689190610b34565b60405180910390a150565b600180546001600160a01b031916905561022181610789565b6040516001600160a01b038381166024830152604482018390526106eb91859182169063a9059cbb906064015b604051602081830303815290604052915060e01b6020820180516001600160e01b0383818316178352505050506107d9565b505050565b600254600090815b81811015610743576002818154811061071357610713610b1e565b6000918252602090912001546001600160a01b039081169085160361073b5760019250610743565b6001016106f8565b5050919050565b6040516001600160a01b0384811660248301528381166044830152606482018390526107839186918216906323b872dd906084016106b9565b50505050565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b600080602060008451602086016000885af1806107fc576040513d6000823e3d81fd5b50506000513d91508115610814578060011415610821565b6001600160a01b0384163b155b156107835783604051635274afe760e01b815260040161026b919061091d565b828054828255906000526020600020908101928215610896579160200282015b8281111561089657825182546001600160a01b0319166001600160a01b03909116178255602090920191600190910190610861565b506108a29291506108a6565b5090565b5b808211156108a257600081556001016108a7565b6001600160a01b038116811461022157600080fd5b80356108db816108bb565b919050565b6000602082840312156108f257600080fd5b81356108fd816108bb565b9392505050565b60006020828403121561091657600080fd5b5035919050565b6001600160a01b0391909116815260200190565b634e487b7160e01b600052604160045260246000fd5b6000602080838503121561095a57600080fd5b82356001600160401b038082111561097157600080fd5b818501915085601f83011261098557600080fd5b81358181111561099757610997610931565b8060051b604051601f19603f830116810181811085821117156109bc576109bc610931565b6040529182528482019250838101850191888311156109da57600080fd5b938501935b828510156109ff576109f0856108d0565b845293850193928501926109df565b98975050505050505050565b60008060408385031215610a1e57600080fd5b8235610a29816108bb565b91506020830135610a39816108bb565b809150509250929050565b6020808252825182820181905260009190848201906040850190845b81811015610a855783516001600160a01b031683529284019291840191600101610a60565b50909695505050505050565b60008060408385031215610aa457600080fd5b8235610aaf816108bb565b946020939093013593505050565b600060208284031215610acf57600080fd5b5051919050565b634e487b7160e01b600052601160045260246000fd5b80820180821115610aff57610aff610ad6565b92915050565b600060018201610b1757610b17610ad6565b5060010190565b634e487b7160e01b600052603260045260246000fd5b6020808252825482820181905260008481528281209092916040850190845b81811015610a855783546001600160a01b031683526001938401939285019201610b5356fea26469706673582212200044ea59d65020cd19e3a41e2507c95bf60eabaed080c6dac72cdacc30a7248064736f6c63430008170033";
var isSuperArgs7 = (xs) => xs.length > 1;
var Locker__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs7(args)) {
      super(...args);
    } else {
      super(_abi11, _bytecode7, args[0]);
    }
  }
  getDeployTransaction(owner_, tokens_, overrides) {
    return super.getDeployTransaction(owner_, tokens_, overrides || {});
  }
  deploy(owner_, tokens_, overrides) {
    return super.deploy(owner_, tokens_, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi11);
  }
  static connect(address, runner) {
    return new Contract(address, _abi11, runner);
  }
};
Locker__factory.bytecode = _bytecode7;
Locker__factory.abi = _abi11;

// libs/typechain/src/factories/MorphoProvider__factory.ts
var _abi12 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "metaMorpho_",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "AddressZero",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "contract IRebalancer",
        name: "",
        type: "address"
      }
    ],
    name: "getDepositBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IRebalancer",
        name: "",
        type: "address"
      }
    ],
    name: "getDepositRate",
    outputs: [
      {
        internalType: "uint256",
        name: "rate",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getIdentifier",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "getSource",
    outputs: [
      {
        internalType: "address",
        name: "source",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "contract IRebalancer",
        name: "vault",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode8 = "0x60a060405234801561001057600080fd5b5060405161157038038061157083398101604081905261002f91610067565b6001600160a01b03811661005657604051639fabe1c160e01b815260040160405180910390fd5b6001600160a01b0316608052610097565b60006020828403121561007957600080fd5b81516001600160a01b038116811461009057600080fd5b9392505050565b6080516114796100f76000396000818160e60152818161018401528181610222015281816102a601528181610333015281816103b90152818161045f015281816105d20152818161062501528181610709015261073e01526114796000f3fe608060405234801561001057600080fd5b50600436106100615760003560e01c8062f714ce146100665780630ae112a41461008e5780634c8f411d146100af5780636e553f65146100c257806373f64d44146100d5578063aa23e03d14610123575b600080fd5b610079610074366004610ec8565b610154565b60405190151581526020015b60405180910390f35b6100a161009c366004610ef8565b6101fe565b604051908152602001610085565b6100a16100bd366004610f26565b610321565b6100796100d0366004610ec8565b6106e0565b61010b6100e3366004610f43565b507f000000000000000000000000000000000000000000000000000000000000000092915050565b6040516001600160a01b039091168152602001610085565b604080518082018252600f81526e26b7b9383437afa83937bb34b232b960891b602082015290516100859190610f8e565b604051632d182be560e21b8152600481018390526001600160a01b038281166024830181905260448301526000917f00000000000000000000000000000000000000000000000000000000000000009091169063b460af94906064015b6020604051808303816000875af11580156101d0573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101f49190610fdc565b5060019392505050565b6040516370a0823160e01b81526001600160a01b03838116600483015260009182917f000000000000000000000000000000000000000000000000000000000000000016906370a0823190602401602060405180830381865afa158015610269573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061028d9190610fdc565b6040516303d1689d60e11b8152600481018290529091507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906307a2d13a90602401602060405180830381865afa1580156102f5573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103199190610fdc565b949350505050565b60008061032c61073a565b90506000807f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166333f91ebb6040518163ffffffff1660e01b8152600401602060405180830381865afa15801561038f573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103b39190610fdc565b905060007f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166301e1d1146040518163ffffffff1660e01b8152600401602060405180830381865afa158015610415573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906104399190610fdc565b905060005b8281101561061f576040516362518ddf60e01b8152600481018290526000907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906362518ddf90602401602060405180830381865afa1580156104ae573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906104d29190610fdc565b604051632c3c915760e01b8152600481018290529091506000906001600160a01b03881690632c3c91579060240160a060405180830381865afa15801561051d573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610541919061103c565b604051632e3071cd60e11b8152600481018490529091506000906001600160a01b03891690635c60e39a9060240160c060405180830381865afa15801561058c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906105b091906110eb565b905060006105be83836107c3565b905060006105f66001600160a01b038b16857f00000000000000000000000000000000000000000000000000000000000000006108f1565b90506106028282610945565b61060c908a6111a2565b9850506001909401935061043e92505050565b506106c87f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031663ddca3f436040518163ffffffff1660e01b8152600401602060405180830381865afa158015610681573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906106a591906111b5565b6106b790670de0b6b3a76400006111de565b84906001600160601b031683610961565b6106d690633b9aca006111fd565b9695505050505050565b604051636e553f6560e01b8152600481018390526001600160a01b0382811660248301526000917f000000000000000000000000000000000000000000000000000000000000000090911690636e553f65906044016101b1565b60007f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316633acb56246040518163ffffffff1660e01b8152600401602060405180830381865afa15801561079a573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906107be9190611214565b905090565b6000806107ce61073a565b60608501519091506000906001600160a01b03166107f1576000925050506108eb565b6108726301e1338086606001516001600160a01b0316638c00bf6b88886040518363ffffffff1660e01b815260040161082b929190611231565b602060405180830381865afa158015610848573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061086c9190610fdc565b90610978565b905060008061088a6001600160a01b038516886109d9565b5092505091506000816000146108a9576108a48284610c62565b6108ac565b60005b90506108e3816108dd8960a00151670de0b6b3a76400006108cd91906112c6565b87906001600160801b0316610945565b90610945565b955050505050505b92915050565b6000806108ff8460a0902090565b905060006109176001600160a01b0387168386610c77565b905060008061092688886109d9565b5091935091506109399050838383610d27565b98975050505050505050565b600061095a8383670de0b6b3a7640000610961565b9392505050565b60008161096e84866111fd565b61031991906112e5565b60008061098583856111fd565b905060006109a682806109a1670de0b6b3a764000060026111fd565b610961565b905060006109c282846109a1670de0b6b3a764000060036111fd565b9050806109cf83856111a2565b6106d691906111a2565b60008060008060006109ec8660a0902090565b604051632e3071cd60e11b8152600481018290529091506000906001600160a01b03891690635c60e39a9060240160c060405180830381865afa158015610a37573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610a5b91906110eb565b9050600081608001516001600160801b031642610a789190611307565b90508015801590610a95575060408201516001600160801b031615155b8015610aad575060608801516001600160a01b031615155b15610c2e576060880151604051638c00bf6b60e01b81526000916001600160a01b031690638c00bf6b90610ae7908c908790600401611231565b602060405180830381865afa158015610b04573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610b289190610fdc565b90506000610b4d610b398385610978565b60408601516001600160801b031690610945565b9050610b5881610d4c565b84604001818151610b69919061131a565b6001600160801b0316905250610b7e81610d4c565b84518590610b8d90839061131a565b6001600160801b0390811690915260a086015116159050610c2b576000610bca8560a001516001600160801b03168361094590919063ffffffff16565b90506000610c008287600001516001600160801b0316610bea9190611307565b60208801518491906001600160801b0316610db2565b9050610c0b81610d4c565b86602001818151610c1c919061131a565b6001600160801b031690525050505b50505b508051602082015160408301516060909301516001600160801b039283169b9183169a509282169850911695509350505050565b600061095a83670de0b6b3a764000084610dcf565b600080610c8c610c878585610df1565b610e65565b604051637784c68560e01b81529091506001600160a01b03861690637784c68590610cbb908490600401611339565b600060405180830381865afa158015610cd8573d6000803e3d6000fd5b505050506040513d6000823e601f3d908101601f19168201604052610d00919081019061137c565b600081518110610d1257610d1261142d565b602002602001015160001c9150509392505050565b6000610319610d376001856111a2565b610d44620f4240856111a2565b869190610961565b6040805180820190915260148152731b585e081d5a5b9d0c4c8e08195e18d95959195960621b60208201526000906001600160801b03831115610dab5760405162461bcd60e51b8152600401610da29190610f8e565b60405180910390fd5b5090919050565b6000610319610dc4620f4240846111a2565b610d446001866111a2565b600081610ddd600182611307565b610de785876111fd565b61096e91906111a2565b60008082846002604051602001610e12929190918252602082015260400190565b60408051601f1981840301815282825280516020918201206001600160a01b03909416908301528101919091526060016040516020818303038152906040528051906020012060001c61095a91906111a2565b60408051600180825281830190925260609160009190602080830190803683370190505090508281600081518110610e9f57610e9f61142d565b602090810291909101015292915050565b6001600160a01b0381168114610ec557600080fd5b50565b60008060408385031215610edb57600080fd5b823591506020830135610eed81610eb0565b809150509250929050565b60008060408385031215610f0b57600080fd5b8235610f1681610eb0565b91506020830135610eed81610eb0565b600060208284031215610f3857600080fd5b813561095a81610eb0565b600080600060608486031215610f5857600080fd5b8335610f6381610eb0565b92506020840135610f7381610eb0565b91506040840135610f8381610eb0565b809150509250925092565b602081526000825180602084015260005b81811015610fbc5760208186018101516040868401015201610f9f565b506000604082850101526040601f19601f83011684010191505092915050565b600060208284031215610fee57600080fd5b5051919050565b634e487b7160e01b600052604160045260246000fd5b604051601f8201601f1916810167ffffffffffffffff8111828210171561103457611034610ff5565b604052919050565b600060a082840312801561104f57600080fd5b5060405160a0810167ffffffffffffffff8111828210171561107357611073610ff5565b604052825161108181610eb0565b8152602083015161109181610eb0565b602082015260408301516110a481610eb0565b604082015260608301516110b781610eb0565b60608201526080928301519281019290925250919050565b80516001600160801b03811681146110e657600080fd5b919050565b600060c08284031280156110fe57600080fd5b5060405160c0810167ffffffffffffffff8111828210171561112257611122610ff5565b60405261112e836110cf565b815261113c602084016110cf565b602082015261114d604084016110cf565b604082015261115e606084016110cf565b606082015261116f608084016110cf565b608082015261118060a084016110cf565b60a08201529392505050565b634e487b7160e01b600052601160045260246000fd5b808201808211156108eb576108eb61118c565b6000602082840312156111c757600080fd5b81516001600160601b038116811461095a57600080fd5b6001600160601b0382811682821603908111156108eb576108eb61118c565b80820281158282048414176108eb576108eb61118c565b60006020828403121561122657600080fd5b815161095a81610eb0565b82516001600160a01b039081168252602080850151821681840152604080860151831681850152606080870151909316838501526080958601518685015284516001600160801b0390811660a08087019190915292860151811660c086015290850151811660e08501529184015182166101008401529383015181166101208301529190920151166101408201526101600190565b6001600160801b0382811682821603908111156108eb576108eb61118c565b60008261130257634e487b7160e01b600052601260045260246000fd5b500490565b818103818111156108eb576108eb61118c565b6001600160801b0381811683821601908111156108eb576108eb61118c565b602080825282518282018190526000918401906040840190835b81811015611371578351835260209384019390920191600101611353565b509095945050505050565b60006020828403121561138e57600080fd5b815167ffffffffffffffff8111156113a557600080fd5b8201601f810184136113b657600080fd5b805167ffffffffffffffff8111156113d0576113d0610ff5565b8060051b6113e06020820161100b565b918252602081840181019290810190878411156113fc57600080fd5b6020850194505b8385101561142257845180835260209586019590935090910190611403565b979650505050505050565b634e487b7160e01b600052603260045260246000fdfea264697066735822122073447f18f888b4816851811a534a7bc9ecfc5c9c22f36b2f3cdb4e3bcbd3ef4264736f6c63430008210033";
var isSuperArgs8 = (xs) => xs.length > 1;
var MorphoProvider__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs8(args)) {
      super(...args);
    } else {
      super(_abi12, _bytecode8, args[0]);
    }
  }
  getDeployTransaction(metaMorpho_, overrides) {
    return super.getDeployTransaction(metaMorpho_, overrides || {});
  }
  deploy(metaMorpho_, overrides) {
    return super.deploy(metaMorpho_, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi12);
  }
  static connect(address, runner) {
    return new Contract(address, _abi12, runner);
  }
};
MorphoProvider__factory.bytecode = _bytecode8;
MorphoProvider__factory.abi = _abi12;

// libs/typechain/src/factories/Multicall__factory.ts
var _abi13 = [
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]"
      }
    ],
    name: "aggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256"
      },
      {
        internalType: "bytes[]",
        name: "returnData",
        type: "bytes[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]"
      }
    ],
    name: "blockAndAggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256"
      },
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool"
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Result[]",
        name: "returnData",
        type: "tuple[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256"
      }
    ],
    name: "getBlockHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getBlockNumber",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getCurrentBlockCoinbase",
    outputs: [
      {
        internalType: "address",
        name: "coinbase",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getCurrentBlockDifficulty",
    outputs: [
      {
        internalType: "uint256",
        name: "difficulty",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getCurrentBlockGasLimit",
    outputs: [
      {
        internalType: "uint256",
        name: "gaslimit",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getCurrentBlockTimestamp",
    outputs: [
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "getEthBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getL1BlockNumber",
    outputs: [
      {
        internalType: "uint256",
        name: "l1BlockNumber",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getLastBlockHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bool",
        name: "requireSuccess",
        type: "bool"
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]"
      }
    ],
    name: "tryAggregate",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool"
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Result[]",
        name: "returnData",
        type: "tuple[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bool",
        name: "requireSuccess",
        type: "bool"
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]"
      }
    ],
    name: "tryBlockAndAggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256"
      },
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool"
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes"
          }
        ],
        internalType: "struct Multicall2.Result[]",
        name: "returnData",
        type: "tuple[]"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var Multicall__factory = class {
  static createInterface() {
    return new Interface(_abi13);
  }
  static connect(address, runner) {
    return new Contract(address, _abi13, runner);
  }
};
Multicall__factory.abi = _abi13;

// libs/typechain/src/factories/ProviderManager__factory.ts
var _abi14 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "owner_",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "OwnableInvalidOwner",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        indexed: true,
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "assetTwo",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "market",
        type: "address"
      }
    ],
    name: "MarketUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferStarted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        indexed: true,
        internalType: "address",
        name: "asset",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "yieldToken",
        type: "address"
      }
    ],
    name: "YieldTokenUpdated",
    type: "event"
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "getIdentifiers",
    outputs: [
      {
        internalType: "string[]",
        name: "",
        type: "string[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        internalType: "address",
        name: "assetTwo",
        type: "address"
      }
    ],
    name: "getMarket",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "asset",
        type: "address"
      }
    ],
    name: "getYieldToken",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "assetOne",
        type: "address"
      },
      {
        internalType: "address",
        name: "assetTwo",
        type: "address"
      },
      {
        internalType: "address",
        name: "market",
        type: "address"
      }
    ],
    name: "setMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "identifier",
        type: "string"
      },
      {
        internalType: "address",
        name: "asset",
        type: "address"
      },
      {
        internalType: "address",
        name: "yieldToken",
        type: "address"
      }
    ],
    name: "setYieldToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode9 = "0x608060405234801561001057600080fd5b50604051610c35380380610c3583398101604081905261002f916100da565b806001600160a01b03811661005e57604051631e4fbdf760e01b81526000600482015260240160405180910390fd5b6100678161006e565b505061010a565b600180546001600160a01b03191690556100878161008a565b50565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6000602082840312156100ec57600080fd5b81516001600160a01b038116811461010357600080fd5b9392505050565b610b1c806101196000396000f3fe608060405234801561001057600080fd5b506004361061009e5760003560e01c8063a4770a8811610066578063a4770a8814610109578063a8d01ca91461011e578063c41adf5014610131578063e30c397814610144578063f2fde38b1461015557600080fd5b8063715018a6146100a3578063784260d6146100ad57806379ba5097146100dd5780638da5cb5b146100e557806395c8193a146100f6575b600080fd5b6100ab610168565b005b6100c06100bb366004610755565b61017c565b6040516001600160a01b0390911681526020015b60405180910390f35b6100ab6101cb565b6000546001600160a01b03166100c0565b6100ab610104366004610755565b610214565b61011161033f565b6040516100d49190610803565b6100ab61012c366004610868565b610418565b6100c061013f3660046108d7565b610551565b6001546001600160a01b03166100c0565b6100ab610163366004610925565b610592565b610170610603565b61017a6000610630565b565b600060038460405161018e9190610947565b908152604080519182900360209081019092206001600160a01b038087166000908152918452828220868216835290935220541690509392505050565b60015433906001600160a01b031681146102085760405163118cdaa760e01b81526001600160a01b03821660048201526024015b60405180910390fd5b61021181610630565b50565b61021c610603565b60048360405161022c9190610947565b9081526040519081900360200190205460ff166102b35760016004846040516102559190610947565b908152604051908190036020019020805491151560ff19909216919091179055600580546001810182556000919091527f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db0016102b184826109f9565b505b806002846040516102c49190610947565b90815260408051602092819003830181206001600160a01b0387811660008181529290955292902080546001600160a01b03191694909216939093179055907fc277be270aa676292d0cbddf713f8160bb9528890b12a3c5b2fc6e30052d07e1906103329086908590610abc565b60405180910390a2505050565b60606005805480602002602001604051908101604052809291908181526020016000905b8282101561040f57838290600052602060002001805461038290610963565b80601f01602080910402602001604051908101604052809291908181526020018280546103ae90610963565b80156103fb5780601f106103d0576101008083540402835291602001916103fb565b820191906000526020600020905b8154815290600101906020018083116103de57829003601f168201915b505050505081526020019060010190610363565b50505050905090565b610420610603565b6004846040516104309190610947565b9081526040519081900360200190205460ff166104b75760016004856040516104599190610947565b908152604051908190036020019020805491151560ff19909216919091179055600580546001810182556000919091527f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db0016104b585826109f9565b505b806003856040516104c89190610947565b90815260408051602092819003830181206001600160a01b03888116600081815292865284832089831680855296529390912080546001600160a01b031916959091169490941790935590917fb2fa499914f4084c208b861c88d34ceb30d98d3e817ddff6468c1a9af5fd9bb4906105439088908690610abc565b60405180910390a350505050565b60006002836040516105639190610947565b90815260408051602092819003830190206001600160a01b039485166000908152925290205490911692915050565b61059a610603565b600180546001600160a01b0383166001600160a01b031990911681179091556105cb6000546001600160a01b031690565b6001600160a01b03167f38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e2270060405160405180910390a350565b6000546001600160a01b0316331461017a5760405163118cdaa760e01b81523360048201526024016101ff565b600180546001600160a01b031916905561021181600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b634e487b7160e01b600052604160045260246000fd5b600082601f8301126106bb57600080fd5b813567ffffffffffffffff8111156106d5576106d5610694565b604051601f8201601f19908116603f0116810167ffffffffffffffff8111828210171561070457610704610694565b60405281815283820160200185101561071c57600080fd5b816020850160208301376000918101602001919091529392505050565b80356001600160a01b038116811461075057600080fd5b919050565b60008060006060848603121561076a57600080fd5b833567ffffffffffffffff81111561078157600080fd5b61078d868287016106aa565b93505061079c60208501610739565b91506107aa60408501610739565b90509250925092565b60005b838110156107ce5781810151838201526020016107b6565b50506000910152565b600081518084526107ef8160208601602086016107b3565b601f01601f19169290920160200192915050565b6000602082016020835280845180835260408501915060408160051b86010192506020860160005b8281101561085c57603f198786030184526108478583516107d7565b9450602093840193919091019060010161082b565b50929695505050505050565b6000806000806080858703121561087e57600080fd5b843567ffffffffffffffff81111561089557600080fd5b6108a1878288016106aa565b9450506108b060208601610739565b92506108be60408601610739565b91506108cc60608601610739565b905092959194509250565b600080604083850312156108ea57600080fd5b823567ffffffffffffffff81111561090157600080fd5b61090d858286016106aa565b92505061091c60208401610739565b90509250929050565b60006020828403121561093757600080fd5b61094082610739565b9392505050565b600082516109598184602087016107b3565b9190910192915050565b600181811c9082168061097757607f821691505b60208210810361099757634e487b7160e01b600052602260045260246000fd5b50919050565b601f8211156109f457828211156109f457806000526020600020601f840160051c60208510156109cb575060005b90810190601f840160051c0360005b818110156109f0576000838201556001016109da565b5050505b505050565b815167ffffffffffffffff811115610a1357610a13610694565b610a2781610a218454610963565b8461099d565b6020601f821160018114610a5b5760008315610a435750848201515b600019600385901b1c1916600184901b178455610ab5565b600084815260208120601f198516915b82811015610a8b5787850151825560209485019460019092019101610a6b565b5084821015610aa95786840151600019600387901b60f8161c191681555b505060018360011b0184555b5050505050565b604081526000610acf60408301856107d7565b905060018060a01b0383166020830152939250505056fea26469706673582212202bd7436580dd2f0e153faab666bbd3f34054d9098ef24e5ab4602546cae1af5264736f6c63430008210033";
var isSuperArgs9 = (xs) => xs.length > 1;
var ProviderManager__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs9(args)) {
      super(...args);
    } else {
      super(_abi14, _bytecode9, args[0]);
    }
  }
  getDeployTransaction(owner_, overrides) {
    return super.getDeployTransaction(owner_, overrides || {});
  }
  deploy(owner_, overrides) {
    return super.deploy(owner_, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi14);
  }
  static connect(address, runner) {
    return new Contract(address, _abi14, runner);
  }
};
ProviderManager__factory.bytecode = _bytecode9;
ProviderManager__factory.abi = _abi14;

// libs/typechain/src/factories/Rebalancer__factory.ts
var _abi15 = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "ActionNotPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "ActionPaused",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "AddressEmptyCode",
    type: "error"
  },
  {
    inputs: [],
    name: "AddressZero",
    type: "error"
  },
  {
    inputs: [],
    name: "ArrayMismatch",
    type: "error"
  },
  {
    inputs: [],
    name: "AssetsBelowMin",
    type: "error"
  },
  {
    inputs: [],
    name: "ECDSAInvalidSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "length",
        type: "uint256"
      }
    ],
    name: "ECDSAInvalidSignatureLength",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "ECDSAInvalidSignatureS",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "allowance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientAllowance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientBalance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "approver",
        type: "address"
      }
    ],
    name: "ERC20InvalidApprover",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "ERC20InvalidReceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSpender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      }
    ],
    name: "ERC2612ExpiredSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "signer",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "ERC2612InvalidSigner",
    type: "error"
  },
  {
    inputs: [],
    name: "EntryProviderNotInProviders",
    type: "error"
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error"
  },
  {
    inputs: [],
    name: "InsufficientLiquidity",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "currentNonce",
        type: "uint256"
      }
    ],
    name: "InvalidAccountNonce",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidCount",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInput",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidProvider",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "provider",
        type: "address"
      }
    ],
    name: "ProviderCapExceeded",
    type: "error"
  },
  {
    inputs: [],
    name: "ProviderUnavailable",
    type: "error"
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "bits",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "SafeCastOverflowedUintDowncast",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    inputs: [],
    name: "Unauthorized",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Deposit",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "EIP712DomainChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider",
        name: "entryProvider",
        type: "address"
      }
    ],
    name: "EntryProviderUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "lastTotalBalance",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "currentTotalBalance",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "performanceFeeShares",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "managementFeeShares",
        type: "uint256"
      }
    ],
    name: "FeesApplied",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "managementFee",
        type: "uint256"
      }
    ],
    name: "ManagementFeeUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "minAssets",
        type: "uint256"
      }
    ],
    name: "MinAssetsUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum IPausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "performanceFee",
        type: "uint256"
      }
    ],
    name: "PerformanceFeeUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "provider",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "capBps",
        type: "uint256"
      }
    ],
    name: "ProviderCapUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "ProvidersUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      }
    ],
    name: "RebalanceExecuted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "provider",
        type: "address"
      }
    ],
    name: "StaleApprovalRevokeFailed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "TreasuryUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum IPausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Unpaused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Withdraw",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "applyFees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "convertToAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "convertToShares",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {
        internalType: "bytes1",
        name: "fields",
        type: "bytes1"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "version",
        type: "string"
      },
      {
        internalType: "uint256",
        name: "chainId",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "verifyingContract",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "extensions",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getAccruedFees",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getEntryProvider",
    outputs: [
      {
        internalType: "contract IProvider",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getLastTimestamp",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getLastTotalAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getManagementFee",
    outputs: [
      {
        internalType: "uint96",
        name: "",
        type: "uint96"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getMinAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getPerformanceFee",
    outputs: [
      {
        internalType: "uint96",
        name: "",
        type: "uint96"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "provider",
        type: "address"
      }
    ],
    name: "getProviderCap",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getProviders",
    outputs: [
      {
        internalType: "contract IProvider[]",
        name: "",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTimelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTreasury",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "admin_",
        type: "address"
      },
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      },
      {
        internalType: "address",
        name: "asset_",
        type: "address"
      },
      {
        internalType: "string",
        name: "name_",
        type: "string"
      },
      {
        internalType: "string",
        name: "symbol_",
        type: "string"
      },
      {
        internalType: "contract IProvider[]",
        name: "providers_",
        type: "address[]"
      },
      {
        internalType: "address",
        name: "treasury_",
        type: "address"
      },
      {
        internalType: "uint96",
        name: "managementFee_",
        type: "uint96"
      },
      {
        internalType: "uint96",
        name: "performanceFee_",
        type: "uint96"
      },
      {
        internalType: "uint256",
        name: "minAssets_",
        type: "uint256"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "mint",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum IPausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum IPausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      },
      {
        internalType: "uint8",
        name: "v",
        type: "uint8"
      },
      {
        internalType: "bytes32",
        name: "r",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "providersHealthy",
    outputs: [
      {
        internalType: "bool",
        name: "healthy",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256[]",
        name: "amounts",
        type: "uint256[]"
      },
      {
        internalType: "contract IProvider[]",
        name: "sources",
        type: "address[]"
      },
      {
        internalType: "contract IProvider[]",
        name: "destinations",
        type: "address[]"
      }
    ],
    name: "rebalance",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "redeem",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "provider",
        type: "address"
      }
    ],
    name: "revokeStaleApproval",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "entryProvider",
        type: "address"
      }
    ],
    name: "setEntryProvider",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "managementFee",
        type: "uint96"
      }
    ],
    name: "setManagementFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "minAssets",
        type: "uint256"
      }
    ],
    name: "setMinAssets",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "performanceFee",
        type: "uint96"
      }
    ],
    name: "setPerformanceFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "provider",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "capBps",
        type: "uint256"
      }
    ],
    name: "setProviderCap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "setProviders",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "setTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum IPausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];
var _bytecode10 = "0x6080604052348015600f57600080fd5b506016601a565b60ca565b7ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00805468010000000000000000900460ff161560695760405163f92ee8a960e01b815260040160405180910390fd5b80546001600160401b039081161460c75780546001600160401b0319166001600160401b0390811782556040519081527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b50565b6149f0806100d96000396000f3fe6080604052600436106103a65760003560e01c806375b238fc116101e7578063bdacb3031161010d578063d905777e116100a0578063edf07f151161006f578063edf07f1514610a59578063ef8b30f714610957578063f0f4426014610a79578063fb68493814610a9957600080fd5b8063d905777e14610690578063dbee7b9f146109f7578063dd62ed3e14610a17578063edc922a914610a3757600080fd5b8063d505accf116100dc578063d505accf14610977578063d547741f14610997578063d88a4307146109b7578063d8bd832c146109d757600080fd5b8063bdacb30314610937578063c63d75b614610690578063c6e6f59214610957578063ce96cb771461069057600080fd5b806395d89b4111610185578063a9059cbb11610154578063a9059cbb146108b7578063b3d7f6b9146108d7578063b460af94146108f7578063ba0876521461091757600080fd5b806395d89b41146108585780639c2b1a951461086d578063a34c347214610882578063a58d1fa51461089757600080fd5b806387451de6116101c157806387451de6146107d85780639135f6d9146107f857806391d148541461081857806394bf804d1461083857600080fd5b806375b238fc1461077b5780637ecebe001461079057806384b0196e146107b057600080fd5b8063301c7e5d116102cc57806342f51d4e1161026a5780635f8e7a1c116102395780635f8e7a1c146107065780636221a54b146107265780636e553f651461073b57806370a082311461075b57600080fd5b806342f51d4e146106b15780634cdad506146103fc57806351fad40d146106d15780635ac86ab7146106e657600080fd5b806337899770116102a6578063378997701461062157806338d52e0f1461064e5780633b19e84a1461067b578063402d267d1461069057600080fd5b8063301c7e5d146105c5578063313ce567146105e55780633644e5151461060c57600080fd5b80631163f6c311610344578063225be10511610313578063225be10514610543578063235c36031461055857806323b872dd146105855780632f2ff15d146105a557600080fd5b80631163f6c3146104b557806318160ddd146104d75780631b98f6ac146104f95780631f3da1501461051957600080fd5b806307bd02651161038057806307bd02651461041c578063095ea7b3146104505780630a28a477146104805780630d560477146104a057600080fd5b806301e1d114146103b257806306fdde03146103da57806307a2d13a146103fc57600080fd5b366103ad57005b600080fd5b3480156103be57600080fd5b506103c7610aae565b6040519081526020015b60405180910390f35b3480156103e657600080fd5b506103ef610abd565b6040516103d19190613efa565b34801561040857600080fd5b506103c7610417366004613f0d565b610b66565b34801561042857600080fd5b506103c77fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6381565b34801561045c57600080fd5b5061047061046b366004613f4b565b610b79565b60405190151581526020016103d1565b34801561048c57600080fd5b506103c761049b366004613f0d565b610b91565b3480156104ac57600080fd5b50610470610b9e565b3480156104c157600080fd5b506104d56104d03660046140dc565b610ba8565b005b3480156104e357600080fd5b5060008051602061495b833981519152546103c7565b34801561050557600080fd5b506104d56105143660046141e3565b610e78565b34801561052557600080fd5b5061052e610e8c565b604080519283526020830191909152016103d1565b34801561054f57600080fd5b506104d5610ead565b34801561056457600080fd5b5061056d610eb5565b6040516001600160601b0390911681526020016103d1565b34801561059157600080fd5b506104706105a036600461421f565b610ed3565b3480156105b157600080fd5b506104d56105c0366004614260565b610ef9565b3480156105d157600080fd5b506104d56105e0366004614290565b610f13565b3480156105f157600080fd5b506105fa610f2b565b60405160ff90911681526020016103d1565b34801561061857600080fd5b506103c7610f47565b34801561062d57600080fd5b50610636610f51565b6040516001600160401b0390911681526020016103d1565b34801561065a57600080fd5b50610663610f6f565b6040516001600160a01b0390911681526020016103d1565b34801561068757600080fd5b50610663610f8a565b34801561069c57600080fd5b506103c76106ab3660046142b1565b50600090565b3480156106bd57600080fd5b506103c76106cc3660046142b1565b610fa8565b3480156106dd57600080fd5b506103c7610fd5565b3480156106f257600080fd5b50610470610701366004614290565b610fea565b34801561071257600080fd5b506104706107213660046142ce565b61104d565b34801561073257600080fd5b506106636113d5565b34801561074757600080fd5b506103c7610756366004614260565b6113f3565b34801561076757600080fd5b506103c76107763660046142b1565b61145c565b34801561078757600080fd5b506103c7600081565b34801561079c57600080fd5b506103c76107ab3660046142b1565b61148f565b3480156107bc57600080fd5b506107c561149a565b6040516103d197969594939291906143b8565b3480156107e457600080fd5b506104d56107f3366004614450565b61154b565b34801561080457600080fd5b506104d5610813366004613f4b565b611568565b34801561082457600080fd5b50610470610833366004614260565b61168b565b34801561084457600080fd5b506103c7610853366004614260565b6116d5565b34801561086457600080fd5b506103ef611726565b34801561087957600080fd5b5061056d611765565b34801561088e57600080fd5b506103c761178a565b3480156108a357600080fd5b506104d56108b2366004613f0d565b61179f565b3480156108c357600080fd5b506104706108d2366004613f4b565b6117b3565b3480156108e357600080fd5b506103c76108f2366004613f0d565b6117c1565b34801561090357600080fd5b506103c761091236600461446b565b6117ce565b34801561092357600080fd5b506103c761093236600461446b565b61183b565b34801561094357600080fd5b506104d56109523660046142b1565b61188d565b34801561096357600080fd5b506103c7610972366004613f0d565b61189e565b34801561098357600080fd5b506104d56109923660046144bc565b6118ab565b3480156109a357600080fd5b506104d56109b2366004614260565b611a04565b3480156109c357600080fd5b506104d56109d23660046142b1565b611a19565b3480156109e357600080fd5b506104d56109f2366004614450565b611a2d565b348015610a0357600080fd5b506104d5610a123660046142b1565b611a4a565b348015610a2357600080fd5b506103c7610a3236600461452d565b611b17565b348015610a4357600080fd5b50610a4c611b61565b6040516103d1919061455b565b348015610a6557600080fd5b506104d5610a74366004614290565b611bcc565b348015610a8557600080fd5b506104d5610a943660046142b1565b611be0565b348015610aa557600080fd5b50610663611bfd565b6000610ab8611c1b565b905090565b6060600060008051602061493b8339815191525b9050806003018054610ae2906145a7565b80601f0160208091040260200160405190810160405280929190818152602001828054610b0e906145a7565b8015610b5b5780601f10610b3057610100808354040283529160200191610b5b565b820191906000526020600020905b815481529060010190602001808311610b3e57829003601f168201915b505050505091505090565b6000610b73826000611c2b565b92915050565b600033610b87818585611c89565b5060019392505050565b6000610b73826001611c96565b6000610b73611cea565b6000610bb2611d74565b805490915060ff600160401b82041615906001600160401b0316600081158015610bd95750825b90506000826001600160401b03166001148015610bf55750303b155b905081158015610c03575080155b15610c215760405163f92ee8a960e01b815260040160405180910390fd5b845467ffffffffffffffff191660011785558315610c4b57845460ff60401b1916600160401b1785555b6001600160a01b038f16610c7257604051639fabe1c160e01b815260040160405180910390fd5b6001600160a01b038d16610c9957604051639fabe1c160e01b815260040160405180910390fd5b85600003610cba5760405163b4fa3fb360e01b815260040160405180910390fd5b610cc38f611d9d565b610ccd8c8c611dae565b610cd68c611dc0565b610cde611deb565b6000610ce8611dfd565b90508d8160000160006101000a8154816001600160a01b0302191690836001600160a01b031602179055508d6001600160a01b031663313ce5676040518163ffffffff1660e01b8152600401602060405180830381865afa158015610d51573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610d7591906145db565b815460ff91909116600160a01b0260ff60a01b19909116178155610d988b611e21565b610dbb8b600081518110610dae57610dae6145f8565b6020026020010151612149565b610dc48f6121d4565b610dcd8a612256565b610dd6896122d8565b610ddf8861236e565b610de887612402565b610df142612446565b60078201805467ffffffffffffffff19166001600160401b0392909216919091179055610e203330898a612480565b508315610e6757845460ff60401b19168555604051600181527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b505050505050505050505050505050565b610e8061258d565b610e8981611e21565b50565b6000806000610e99610aae565b9050610ea4816125cf565b92509250509091565b610e89612755565b600080610ec0611dfd565b600501546001600160601b031692915050565b600033610ee185828561276e565b610eec8585856127d5565b60019150505b9392505050565b6000610f0481612834565b610f0e838361285a565b505050565b6000610f1e81612834565b610f2782612900565b5050565b600080610f36611dfd565b54600160a01b900460ff1692915050565b6000610ab86129b0565b600080610f5c611dfd565b600701546001600160401b031692915050565b600080610f7a611dfd565b546001600160a01b031692915050565b600080610f95611dfd565b600401546001600160a01b031692915050565b600080610fb3611dfd565b6001600160a01b03909316600090815260099093016020525050604090205490565b600080610fe0611dfd565b6008015492915050565b60007f3269bba93b0c415a49697506f3e813e8145a2749219158acdaf45928901f640080828460018111156110215761102161460e565b60018111156110325761103261460e565b815260208101919091526040016000205460ff169392505050565b60007fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6361107981612834565b6110816129ba565b845160008190036110a557604051631a49577b60e11b815260040160405180910390fd5b8451811415806110b6575083518114155b156110d45760405163b7c1140d60e01b815260040160405180910390fd5b60005b818110156113b05760008782815181106110f3576110f36145f8565b602002602001015190506000878381518110611111576111116145f8565b60200260200101519050600087848151811061112f5761112f6145f8565b60200260200101519050611142826129f2565b15806111545750611152816129f2565b155b1561117257604051633b136dc160e11b815260040160405180910390fd5b60008061117e84612a5d565b91509150806111a057604051633b136dc160e11b815260040160405180910390fd5b60001985036111ad578194505b8415806111b957508185115b156111d75760405163b4fa3fb360e01b815260040160405180910390fd5b60006111e1611dfd565b80546040516370a0823160e01b81523060048201529192506000916001600160a01b03909116906370a0823190602401602060405180830381865afa15801561122e573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906112529190614624565b905061127f8760405180604001604052806008815260200167776974686472617760c01b81525088612ae8565b81546040516370a0823160e01b815230600482015260009183916001600160a01b03909116906370a0823190602401602060405180830381865afa1580156112cb573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906112ef9190614624565b6112f99190614653565b90508060000361131c5760405163b4fa3fb360e01b815260040160405180910390fd5b611346816040518060400160405280600781526020016619195c1bdcda5d60ca1b81525088612ae8565b61134f86612b7e565b856001600160a01b0316876001600160a01b03167fee3e5192e827fce944fc05543b769ed2cc86a61d2179214471b7b76b9d73350b8360405161139491815260200190565b60405180910390a35050600190960195506110d7945050505050565b5060019250506113cd600160008051602061499b83398151915255565b509392505050565b6000806113e0611dfd565b600301546001600160a01b031692915050565b60006113fd6129ba565b6000611407612c1d565b905061142b8461142360008051602061495b8339815191525490565b836000612c54565b9150611438838584612c81565b61144433848685612480565b50610b73600160008051602061499b83398151915255565b60008060008051602061493b8339815191525b6001600160a01b0390931660009081526020939093525050604090205490565b6000610b7382612d0d565b6000606080828080838160008051602061497b83398151915280549091501580156114c757506001810154155b6115105760405162461bcd60e51b81526020600482015260156024820152741152540dcc4c8e88155b9a5b9a5d1a585b1a5e9959605a1b60448201526064015b60405180910390fd5b611518612d36565b611520612d75565b60408051600080825260208201909252600f60f81b9c939b5091995046985030975095509350915050565b600061155681612834565b61155e612755565b50610f278261236e565b611571826129f2565b158061157e575061271081115b1561159c5760405163b4fa3fb360e01b815260040160405180910390fd5b60006115a6611dfd565b6001600160a01b038416600090815260098201602052604081205491925083158015906115db57508115806115db5750818411155b60038401549091506001600160a01b0316336001600160a01b03161461162d57801580611610575061160e60003361168b565b155b1561162d576040516282b42960e81b815260040160405180910390fd5b6001600160a01b038516600081815260098501602052604090819020869055517f7bd751611664511c901db72fe265d4ec115476c557140bc8e49a26810832dbe09061167c9087815260200190565b60405180910390a25050505050565b60009182527f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300602090815260408084206001600160a01b0393909316845291905290205460ff1690565b60006116df6129ba565b60006116e9612c1d565b905061170d8461170560008051602061495b8339815191525490565b836001612d8d565b915061171a838386612c81565b61144433848487612480565b7f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace04805460609160008051602061493b83398151915291610ae2906145a7565b600080611770611dfd565b60040154600160a01b90046001600160601b031692915050565b600080611795611dfd565b6006015492915050565b60006117aa81612834565b610f2782612402565b600033610b878185856127d5565b6000610b73826001611c2b565b60006117d86129ba565b60006117e2612755565b9050611806856117fe60008051602061495b8339815191525490565b836001612c54565b91506118168583335b8787612da1565b6118233385858886612e3c565b50610ef2600160008051602061499b83398151915255565b60006118456129ba565b600061184f612755565b90506118738561186b60008051602061495b8339815191525490565b836000612d8d565b915061188082863361180f565b6118233385858589612e3c565b61189561258d565b610e89816121d4565b6000610b73826000611c96565b834211156118cf5760405163313c898160e11b815260048101859052602401611507565b60007f6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c988888861193b8c6001600160a01b031660009081527f5ab42ced628888259c08ac98db1eb0cf702fc1501344311d8b100cd1bfe4bb006020526040902080546001810190915590565b6040805160208101969096526001600160a01b0394851690860152929091166060840152608083015260a082015260c0810186905260e001604051602081830303815290604052805190602001209050600061199682613145565b905060006119a682878787613172565b9050896001600160a01b0316816001600160a01b0316146119ed576040516325c0072360e11b81526001600160a01b0380831660048301528b166024820152604401611507565b6119f88a8a8a611c89565b50505050505050505050565b6000611a0f81612834565b610f0e83836131a0565b6000611a2481612834565b610f2782612149565b6000611a3881612834565b611a40612755565b50610f27826122d8565b333014611a69576040516282b42960e81b815260040160405180910390fd5b6000611a73611dfd565b9050610f27826001600160a01b03166373f64d44611a8f610f6f565b6040516001600160e01b031960e084901b1681526001600160a01b03909116600482015230602482015260006044820152606401602060405180830381865afa158015611ae0573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611b049190614666565b82546001600160a01b0316906000613227565b6001600160a01b0391821660009081527f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace016020908152604080832093909416825291909152205490565b60606000611b6d611dfd565b60018101805460408051602080840282018101909252828152939450830182828015610b5b57602002820191906000526020600020905b81546001600160a01b03168152600190910190602001808311611ba457505050505091505090565b6000611bd781612834565b610f27826132e5565b6000611beb81612834565b611bf3612755565b50610f2782612256565b600080611c08611dfd565b600201546001600160a01b031692915050565b6000611c25611cea565b50919050565b600080611c36610aae565b9050600080611c44836125cf565b91509150611c7f868284611c6460008051602061495b8339815191525490565b611c6e9190614683565b611c789190614683565b8588612d8d565b9695505050505050565b610f0e838383600161337d565b600080611ca1610aae565b9050600080611caf836125cf565b91509150611c7f868284611ccf60008051602061495b8339815191525490565b611cd99190614683565b611ce39190614683565b8588612c54565b6000806000611cf7611dfd565b60018082015490935090915060005b81811015611d6d57600080611d43856001018481548110611d2957611d296145f8565b6000918252602090912001546001600160a01b0316612a5d565b915091508015611d5e57611d578288614683565b9650611d63565b600095505b5050600101611d06565b5050509091565b6000807ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00610b73565b611da5613464565b610e8981613489565b611db6613464565b610f27828261349c565b611dc8613464565b610e8981604051806040016040528060018152602001603160f81b8152506134ed565b611df3613464565b611dfb61354e565b565b7f7e58afa6d55148d409feb524397452494284df87c6d0256f1c37551f5f960b0090565b6000611e2b611dfd565b60028101549091506001600160a01b03168015801590611e525750611e508184613556565b155b15611e70576040516301aff20760e61b815260040160405180910390fd5b600082600101805480602002602001604051908101604052809291908181526020018280548015611eca57602002820191906000526020600020905b81546001600160a01b03168152600190910190602001808311611eac575b5050505050905060005b8451811015611fed5760006001600160a01b0316858281518110611efa57611efa6145f8565b60200260200101516001600160a01b031603611f2957604051639fabe1c160e01b815260040160405180910390fd5b611fe5858281518110611f3e57611f3e6145f8565b60200260200101516001600160a01b03166373f64d44611f5c610f6f565b6040516001600160e01b031960e084901b1681526001600160a01b03909116600482015230602482015260006044820152606401602060405180830381865afa158015611fad573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611fd19190614666565b85546001600160a01b031690600019613227565b600101611ed4565b5060005b81518110156120fc5761201d82828151811061200f5761200f6145f8565b602002602001015186613556565b6120f457306001600160a01b031663dbee7b9f838381518110612042576120426145f8565b60200260200101516040518263ffffffff1660e01b815260040161207591906001600160a01b0391909116815260200190565b600060405180830381600087803b15801561208f57600080fd5b505af19250505080156120a0575060015b6120f4578181815181106120b6576120b66145f8565b60200260200101516001600160a01b03167f90c22ef35246eb5d9185e2cfb17420872a5b10c2ba6af2dcd9db1de01314a91c60405160405180910390a25b600101611ff1565b506001830161210b85826146c6565b507f5f589bfb97387c6d7ce41557510dba9ca4a577876489cacc87a22a395b8b13ca8460405161213b919061455b565b60405180910390a150505050565b612152816129f2565b61216f5760405163b4fa3fb360e01b815260040160405180910390fd5b6000612179611dfd565b6002810180546001600160a01b0319166001600160a01b0385169081179091556040519081529091507f86196c60bb1c10fbc0cf140223f617a9c9157f36cd6ba9333b1d7067a67e9335906020015b60405180910390a15050565b6001600160a01b0381166121fb57604051639fabe1c160e01b815260040160405180910390fd5b6000612205611dfd565b6003810180546001600160a01b0319166001600160a01b038516908117909155604051919250907fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a25050565b6001600160a01b03811661227d57604051639fabe1c160e01b815260040160405180910390fd5b6000612287611dfd565b6004810180546001600160a01b0319166001600160a01b038516908117909155604051919250907f7dae230f18360d76a040c81f050aa14eb9d6dc7901b20fc5d855e2a20fe814d190600090a25050565b66b1a2bc2ec50000816001600160601b031611156123095760405163b4fa3fb360e01b815260040160405180910390fd5b6000612313611dfd565b6004810180546001600160a01b0316600160a01b6001600160601b038616908102919091179091556040519081529091507f2147e2bc8c39e67f74b1a9e08896ea1485442096765942206af1f4bc8bcde917906020016121c8565b6703782dace9d90000816001600160601b031611156123a05760405163b4fa3fb360e01b815260040160405180910390fd5b60006123aa611dfd565b6005810180546bffffffffffffffffffffffff19166001600160601b0385169081179091556040519081529091507f9b49d0cd76012d9c67241c2f68f836efbaf50ea29901a250040671402d5263f5906020016121c8565b600061240c611dfd565b600881018390556040518381529091507f9e41b1fab18e02df1054ed1949900731066cdc4d3a0986308894f1b4abfd9763906020016121c8565b60006001600160401b0382111561247c57604080516306dfcc6560e41b8152600481019190915260248101839052604401611507565b5090565b600061248a611dfd565b60028101549091506001600160a01b03166124a4816129f2565b6124c157604051633b136dc160e11b815260040160405180910390fd5b81546124d8906001600160a01b03168730876135b1565b612502846040518060400160405280600781526020016619195c1bdcda5d60ca1b81525083612ae8565b61250c85846135ea565b838260060160008282546125209190614683565b9091555061252f905081612b7e565b846001600160a01b0316866001600160a01b03167fdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7868660405161257d929190918252602082015260400190565b60405180910390a3505050505050565b6000612597611dfd565b60038101549091506001600160a01b0316336001600160a01b031614610e89576040516282b42960e81b815260040160405180910390fd5b60008060006125dc611dfd565b60068101546004820154600583015460078401549394509192600160a01b9091046001600160601b03908116921690600090612621906001600160401b031642614653565b9050600084891161263357600061263d565b61263d858a614653565b90506000808211801561265957506000846001600160601b0316115b612664576000612682565b612682826001600160601b038616670de0b6b3a76400006000613620565b90506000808411801561269e57506000866001600160601b0316115b6126a95760006126e2565b6126e26001600160601b0387166126cc670de0b6b3a76400006301e13380614696565b6000878f6126da9190614696565b929190613620565b90506000826126f1838e614653565b6126fb9190614653565b905061272061271660008051602061495b8339815191525490565b8490836000613620565b9a5061274561273b60008051602061495b8339815191525490565b8390836000613620565b9950505050505050505050915091565b600061275f611cea565b50905061276b81613664565b90565b600061277a8484611b17565b90506000198110156127cf57818110156127c057604051637dc7a0d960e11b81526001600160a01b03841660048201526024810182905260448101839052606401611507565b6127cf8484848403600061337d565b50505050565b6001600160a01b0383166127ff57604051634b637e8f60e11b815260006004820152602401611507565b6001600160a01b0382166128295760405163ec442f0560e01b815260006004820152602401611507565b610f0e838383613736565b61283e813361168b565b610e89576040516282b42960e81b815260040160405180910390fd5b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300612885838361168b565b610f0e576000838152602082815260408083206001600160a01b03861684529091529020805460ff191660011790556128bb3390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a4505050565b8061290a81613874565b7f3269bba93b0c415a49697506f3e813e8145a2749219158acdaf45928901f6400600081818560018111156129415761294161460e565b60018111156129525761295261460e565b81526020810191909152604001600020805460ff19169115159190911790557f4cd3e1443d03aba343c5d882744f8f172c07b495e955ac3defb325cbd73c8550335b846040516129a392919061474f565b60405180910390a1505050565b6000610ab861389a565b60008051602061499b8339815191528054600119016129ec57604051633ee5aeb560e01b815260040160405180910390fd5b60029055565b6000806129fd611dfd565b600181015490915060005b81811015612a5557826001018181548110612a2557612a256145f8565b6000918252602090912001546001600160a01b0390811690861603612a4d5760019350612a55565b600101612a08565b505050919050565b6040516302b844a960e21b81523060048201819052602482015260009081906001600160a01b03841690630ae112a490622dc6c0906044016020604051808303818786fa93505050508015612acf575060408051601f3d908101601f19168201909252612acc91810190614624565b60015b612ade57506000928392509050565b9360019350915050565b600082604051602001612afb919061478a565b60408051601f1981840301815290829052602482018690523060448301529060640160408051601f198184030181529082905291612b38916147bf565b6040519081900390206020820180516001600160e01b03166001600160e01b03199092169190911790529050612b776001600160a01b0383168261390e565b5050505050565b6000612b88611dfd565b6001600160a01b0383166000908152600982016020526040812054919250819003612bb257505050565b6000612bbd84612a5d565b50905081612bc9610aae565b612bd39190614696565b612bdf61271083614696565b11156127cf576040516314254e5960e01b81526001600160a01b0385166004820152602401611507565b600160008051602061499b83398151915255565b600080612c28611cea565b909250905080612c4b5760405163b799631160e01b815260040160405180910390fd5b61247c82613664565b6000841580612c61575083155b612c7657612c7185858585613620565b612c78565b845b95945050505050565b6000612c8c8161397b565b6000612c96611dfd565b90506001600160a01b038516612cbf57604051639fabe1c160e01b815260040160405180910390fd5b831580612cca575082155b15612ce85760405163b4fa3fb360e01b815260040160405180910390fd5b8060080154841015612b7757604051638ade2a8b60e01b815260040160405180910390fd5b6000807f5ab42ced628888259c08ac98db1eb0cf702fc1501344311d8b100cd1bfe4bb0061146f565b7fa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d102805460609160008051602061497b83398151915291610ae2906145a7565b6060600060008051602061497b833981519152610ad1565b60008315612c7657612c7185848685613620565b6001612dac8161397b565b6001600160a01b0383161580612dc957506001600160a01b038216155b15612de757604051639fabe1c160e01b815260040160405180910390fd5b851580612df2575084155b15612e105760405163b4fa3fb360e01b815260040160405180910390fd5b816001600160a01b0316846001600160a01b031614612e3457612e3482858761276e565b505050505050565b612e4683826139a2565b6000612e50611dfd565b6001810154909150839060005b8181108015612e6c5750600083115b1561308c576000846001018281548110612e8857612e886145f8565b60009182526020822001546001600160a01b0316915080612ea883612a5d565b91509150801580612eb7575081155b15612ec45750505061307a565b600086831015612ed45782612ed6565b865b88546040516370a0823160e01b81523060048201529192506000916001600160a01b03909116906370a0823190602401602060405180830381865afa158015612f23573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190612f479190614624565b604051602481018490523060448201529091506000906001600160a01b0387169060640160408051601f198184030181529181526020820180516001600160e01b0316627b8a6760e11b17905251612f9f91906147bf565b600060405180830381855af49150503d8060008114612fda576040519150601f19603f3d011682016040523d82523d6000602084013e612fdf565b606091505b5050905080156130735789546040516370a0823160e01b815230600482015260009184916001600160a01b03909116906370a0823190602401602060405180830381865afa158015613035573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906130599190614624565b6130639190614653565b905061306f818b614653565b9950505b5050505050505b80613084816147db565b915050612e5d565b5081156130ac5760405163bb55fd2760e01b815260040160405180910390fd5b848360060160008282546130c09190614653565b909155505082546130db906001600160a01b031688876139d8565b856001600160a01b0316876001600160a01b0316896001600160a01b03167ffbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db8888604051613133929190918252602082015260400190565b60405180910390a45050505050505050565b6000610b736131526129b0565b8360405161190160f01b8152600281019290925260228201526042902090565b60008060008061318488888888613a09565b9250925092506131948282613ad8565b50909695505050505050565b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb3006131cb838361168b565b15610f0e576000838152602082815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a4505050565b604080516001600160a01b038416602482015260448082018490528251808303909101815260649091019091526020810180516001600160e01b031663095ea7b360e01b1790526132788482613b91565b6127cf576040516001600160a01b038481166024830152600060448301526132db91869182169063095ea7b3906064015b604051602081830303815290604052915060e01b6020820180516001600160e01b038381831617835250505050613bdb565b6127cf8482613bdb565b806132ef8161397b565b7f3269bba93b0c415a49697506f3e813e8145a2749219158acdaf45928901f6400600181600085838111156133265761332661460e565b60018111156133375761333761460e565b81526020810191909152604001600020805460ff19169115159190911790557f534f879afd40abb4e39f8e1b77a316be4c8e3521d9cf5a3a3db8959d574d455933612994565b60008051602061493b8339815191526001600160a01b0385166133b65760405163e602df0560e01b815260006004820152602401611507565b6001600160a01b0384166133e057604051634a1406b160e11b815260006004820152602401611507565b6001600160a01b03808616600090815260018301602090815260408083209388168352929052208390558115612b7757836001600160a01b0316856001600160a01b03167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9258560405161345591815260200190565b60405180910390a35050505050565b61346c613c4c565b611dfb57604051631afcd79f60e31b815260040160405180910390fd5b613491613464565b610e8960008261285a565b6134a4613464565b60008051602061493b8339815191527f52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace036134de8482614836565b50600481016127cf8382614836565b6134f5613464565b60008051602061497b8339815191527fa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d10261352f8482614836565b506003810161353e8382614836565b5060008082556001909101555050565b612c09613464565b6000805b82518110156135a757836001600160a01b031683828151811061357f5761357f6145f8565b60200260200101516001600160a01b03160361359f576001915050610b73565b60010161355a565b5060009392505050565b6040516001600160a01b0384811660248301528381166044830152606482018390526127cf9186918216906323b872dd906084016132a9565b6001600160a01b0382166136145760405163ec442f0560e01b815260006004820152602401611507565b610f2760008383613736565b600061364f61362e83613c66565b801561364a575060008480613645576136456148f4565b868809115b151590565b61365a868686613c93565b612c789190614683565b600080613670836125cf565b91509150600061367e611dfd565b600681015460408051918252602082018790528101859052606081018490529091507f8b8e0e370e88645a8cd8378c05a30ce6b899b9a13ede0a0872bb604cc0240c2b9060800160405180910390a16006810184905560048101546001600160a01b031683156136f2576136f281856135ea565b82156137025761370281846135ea565b61370b42612446565b600792909201805467ffffffffffffffff19166001600160401b039093169290921790915550505050565b60008051602061493b8339815191526001600160a01b03841661377257818160020160008282546137679190614683565b909155506137e49050565b6001600160a01b038416600090815260208290526040902054828110156137c55760405163391434e360e21b81526001600160a01b03861660048201526024810182905260448101849052606401611507565b6001600160a01b03851660009081526020839052604090209083900390555b6001600160a01b038316613802576002810180548390039055613821565b6001600160a01b03831660009081526020829052604090208054830190555b826001600160a01b0316846001600160a01b03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef8460405161386691815260200190565b60405180910390a350505050565b61387d81610fea565b610e895760405163b123fb4360e01b815260040160405180910390fd5b60007f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f6138c5613d48565b6138cd613db2565b60408051602081019490945283019190915260608201524660808201523060a082015260c00160405160208183030381529060405280519060200120905090565b6060600080846001600160a01b03168460405161392b91906147bf565b600060405180830381855af49150503d8060008114613966576040519150601f19603f3d011682016040523d82523d6000602084013e61396b565b606091505b5091509150612c78858383613df6565b61398481610fea565b15610e89576040516318c0a57b60e31b815260040160405180910390fd5b6001600160a01b0382166139cc57604051634b637e8f60e11b815260006004820152602401611507565b610f2782600083613736565b6040516001600160a01b03838116602483015260448201839052610f0e91859182169063a9059cbb906064016132a9565b600080807f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0841115613a445750600091506003905082613ace565b604080516000808252602082018084528a905260ff891692820192909252606081018790526080810186905260019060a0016020604051602081039080840390855afa158015613a98573d6000803e3d6000fd5b5050604051601f1901519150506001600160a01b038116613ac457506000925060019150829050613ace565b9250600091508190505b9450945094915050565b6000826003811115613aec57613aec61460e565b03613af5575050565b6001826003811115613b0957613b0961460e565b03613b275760405163f645eedf60e01b815260040160405180910390fd5b6002826003811115613b3b57613b3b61460e565b03613b5c5760405163fce698f760e01b815260048101829052602401611507565b6003826003811115613b7057613b7061460e565b03610f27576040516335e2f38360e21b815260048101829052602401611507565b6000806000806020600086516020880160008a5af192503d91506000519050828015611c7f57508115613bc75780600114611c7f565b50505050506001600160a01b03163b151590565b600080602060008451602086016000885af180613bfe576040513d6000823e3d81fd5b50506000513d91508115613c16578060011415613c23565b6001600160a01b0384163b155b156127cf57604051635274afe760e01b81526001600160a01b0385166004820152602401611507565b6000613c56611d74565b54600160401b900460ff16919050565b60006002826003811115613c7c57613c7c61460e565b613c86919061490a565b60ff166001149050919050565b6000806000613ca28686613e52565b9150915081600003613cc757838181613cbd57613cbd6148f4565b0492505050610ef2565b818411613cde57613cde6003851502601118613e70565b6000848688096000868103871696879004966002600389028118808a02820302808a02820302808a02820302808a02820302808a02820302808a02909103029181900381900460010185841190960395909502919093039390930492909217029150509392505050565b600060008051602061497b83398151915281613d62612d36565b805190915015613d7a57805160209091012092915050565b81548015613d89579392505050565b7fc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470935050505090565b600060008051602061497b83398151915281613dcc612d75565b805190915015613de457805160209091012092915050565b60018201548015613d89579392505050565b606082613e0b57613e0682613e82565b610ef2565b8151158015613e2257506001600160a01b0384163b155b15613e4b57604051639996b31560e01b81526001600160a01b0385166004820152602401611507565b5080610ef2565b60008060001983850993909202808410938190039390930393915050565b634e487b71600052806020526024601cfd5b805115613e9157805160208201fd5b60405163d6bda27560e01b815260040160405180910390fd5b60005b83811015613ec5578181015183820152602001613ead565b50506000910152565b60008151808452613ee6816020860160208601613eaa565b601f01601f19169290920160200192915050565b602081526000610ef26020830184613ece565b600060208284031215613f1f57600080fd5b5035919050565b6001600160a01b0381168114610e8957600080fd5b8035613f4681613f26565b919050565b60008060408385031215613f5e57600080fd5b8235613f6981613f26565b946020939093013593505050565b634e487b7160e01b600052604160045260246000fd5b604051601f8201601f191681016001600160401b0381118282101715613fb557613fb5613f77565b604052919050565b600082601f830112613fce57600080fd5b81356001600160401b03811115613fe757613fe7613f77565b613ffa601f8201601f1916602001613f8d565b81815284602083860101111561400f57600080fd5b816020850160208301376000918101602001919091529392505050565b60006001600160401b0382111561404557614045613f77565b5060051b60200190565b600082601f83011261406057600080fd5b813561407361406e8261402c565b613f8d565b8082825260208201915060208360051b86010192508583111561409557600080fd5b602085015b838110156140bb5780356140ad81613f26565b83526020928301920161409a565b5095945050505050565b80356001600160601b0381168114613f4657600080fd5b6000806000806000806000806000806101408b8d0312156140fc57600080fd5b6141058b613f3b565b995061411360208c01613f3b565b985061412160408c01613f3b565b975060608b01356001600160401b0381111561413c57600080fd5b6141488d828e01613fbd565b97505060808b01356001600160401b0381111561416457600080fd5b6141708d828e01613fbd565b96505060a08b01356001600160401b0381111561418c57600080fd5b6141988d828e0161404f565b9550506141a760c08c01613f3b565b93506141b560e08c016140c5565b92506141c46101008c016140c5565b915060006101208c01359050809150509295989b9194979a5092959850565b6000602082840312156141f557600080fd5b81356001600160401b0381111561420b57600080fd5b6142178482850161404f565b949350505050565b60008060006060848603121561423457600080fd5b833561423f81613f26565b9250602084013561424f81613f26565b929592945050506040919091013590565b6000806040838503121561427357600080fd5b82359150602083013561428581613f26565b809150509250929050565b6000602082840312156142a257600080fd5b813560028110610ef257600080fd5b6000602082840312156142c357600080fd5b8135610ef281613f26565b6000806000606084860312156142e357600080fd5b83356001600160401b038111156142f957600080fd5b8401601f8101861361430a57600080fd5b803561431861406e8261402c565b8082825260208201915060208360051b85010192508883111561433a57600080fd5b6020840193505b8284101561435c578335825260209384019390910190614341565b955050505060208401356001600160401b0381111561437a57600080fd5b6143868682870161404f565b92505060408401356001600160401b038111156143a257600080fd5b6143ae8682870161404f565b9150509250925092565b60ff60f81b8816815260e0602082015260006143d760e0830189613ece565b82810360408401526143e98189613ece565b606084018890526001600160a01b038716608085015260a0840186905283810360c08501528451808252602080870193509091019060005b8181101561443f578351835260209384019390920191600101614421565b50909b9a5050505050505050505050565b60006020828403121561446257600080fd5b610ef2826140c5565b60008060006060848603121561448057600080fd5b83359250602084013561449281613f26565b915060408401356144a281613f26565b809150509250925092565b60ff81168114610e8957600080fd5b600080600080600080600060e0888a0312156144d757600080fd5b87356144e281613f26565b965060208801356144f281613f26565b955060408801359450606088013593506080880135614510816144ad565b9699959850939692959460a0840135945060c09093013592915050565b6000806040838503121561454057600080fd5b823561454b81613f26565b9150602083013561428581613f26565b602080825282518282018190526000918401906040840190835b8181101561459c5783516001600160a01b0316835260209384019390920191600101614575565b509095945050505050565b600181811c908216806145bb57607f821691505b602082108103611c2557634e487b7160e01b600052602260045260246000fd5b6000602082840312156145ed57600080fd5b8151610ef2816144ad565b634e487b7160e01b600052603260045260246000fd5b634e487b7160e01b600052602160045260246000fd5b60006020828403121561463657600080fd5b5051919050565b634e487b7160e01b600052601160045260246000fd5b81810381811115610b7357610b7361463d565b60006020828403121561467857600080fd5b8151610ef281613f26565b80820180821115610b7357610b7361463d565b8082028115828204841417610b7357610b7361463d565b60005b82811015610f0e576000828201556001016146b0565b81516001600160401b038111156146df576146df613f77565b600160401b8111156146f3576146f3613f77565b815481835580821015614719578260005281602060002001614717838303826146ad565b505b506020830182600052602060002060005b83811015612e345782516001600160a01b03168282015560209092019160010161472a565b6001600160a01b0383168152604081016002831061477d57634e487b7160e01b600052602160045260246000fd5b8260208301529392505050565b6000825161479c818460208701613eaa565b702875696e743235362c616464726573732960781b920191825250601101919050565b600082516147d1818460208701613eaa565b9190910192915050565b6000600182016147ed576147ed61463d565b5060010190565b601f821115610f0e5782821115610f0e57806000526020600020601f840160051c6020851015614822575060005b612b7781601f860160051c038284016146ad565b81516001600160401b0381111561484f5761484f613f77565b6148638161485d84546145a7565b846147f4565b6020601f821160018114614897576000831561487f5750848201515b600019600385901b1c1916600184901b178455612b77565b600084815260208120601f198516915b828110156148c757878501518255602094850194600190920191016148a7565b50848210156148e55786840151600019600387901b60f8161c191681555b50505050600190811b01905550565b634e487b7160e01b600052601260045260246000fd5b600060ff83168061492b57634e487b7160e01b600052601260045260246000fd5b8060ff8416069150509291505056fe52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace0052c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace02a16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d1009b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220dedefb024618681b0b491d4ee87c46b85fd705cdf54a311d58c2e12929a335e364736f6c63430008210033";
var isSuperArgs10 = (xs) => xs.length > 1;
var Rebalancer__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs10(args)) {
      super(...args);
    } else {
      super(_abi15, _bytecode10, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi15);
  }
  static connect(address, runner) {
    return new Contract(address, _abi15, runner);
  }
};
Rebalancer__factory.bytecode = _bytecode10;
Rebalancer__factory.abi = _abi15;

// libs/typechain/src/factories/RebalancerMulti__factory.ts
var _abi16 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "asset_",
        type: "address"
      },
      {
        internalType: "string",
        name: "name_",
        type: "string"
      },
      {
        internalType: "string",
        name: "symbol_",
        type: "string"
      },
      {
        internalType: "contract IProvider[]",
        name: "providers_",
        type: "address[]"
      },
      {
        internalType: "uint256",
        name: "withdrawFeePercent_",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      },
      {
        internalType: "address",
        name: "treasury_",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotAdmin",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotExecutor",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotOperator",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "AddressEmptyCode",
    type: "error"
  },
  {
    inputs: [],
    name: "ECDSAInvalidSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "length",
        type: "uint256"
      }
    ],
    name: "ECDSAInvalidSignatureLength",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "ECDSAInvalidSignatureS",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "allowance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientAllowance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientBalance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "approver",
        type: "address"
      }
    ],
    name: "ERC20InvalidApprover",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "ERC20InvalidReceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSpender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      }
    ],
    name: "ERC2612ExpiredSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "signer",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "ERC2612InvalidSigner",
    type: "error"
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "currentNonce",
        type: "uint256"
      }
    ],
    name: "InvalidAccountNonce",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidShortString",
    type: "error"
  },
  {
    inputs: [],
    name: "PausableActions__ActionNotPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "PausableActions__ActionPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "Rebalancer__ExcessRebalanceFee",
    type: "error"
  },
  {
    inputs: [],
    name: "Rebalancer__InvalidProvider",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "str",
        type: "string"
      }
    ],
    name: "StringTooLong",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__AddressZero",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__DepositLessThanMin",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__InvalidInput",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__SetupAlreadyCompleted",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__Unauthorized",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider",
        name: "activeProvider",
        type: "address"
      }
    ],
    name: "ActiveProviderUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Deposit",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "EIP712DomainChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      }
    ],
    name: "FeeCharged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "minAmount",
        type: "uint256"
      }
    ],
    name: "MinAmountUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "ProvidersUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsFrom",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsTo",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      }
    ],
    name: "RebalanceExecuted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "setupAddress",
        type: "address"
      }
    ],
    name: "SetupCompleted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "TreasuryUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Unpaused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Withdraw",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "withdrawFeePercent",
        type: "uint256"
      }
    ],
    name: "WithdrawFeePercentUpdated",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "OPERATOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "activeProvider",
    outputs: [
      {
        internalType: "contract IProvider",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "convertToAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "convertToShares",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {
        internalType: "bytes1",
        name: "fields",
        type: "bytes1"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "version",
        type: "string"
      },
      {
        internalType: "uint256",
        name: "chainId",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "verifyingContract",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "extensions",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "getBalanceOfAsset",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getProviders",
    outputs: [
      {
        internalType: "contract IProvider[]",
        name: "",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "minAmount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "mint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      },
      {
        internalType: "uint8",
        name: "v",
        type: "uint8"
      },
      {
        internalType: "bytes32",
        name: "r",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "contract IProvider",
        name: "from",
        type: "address"
      },
      {
        internalType: "contract IProvider",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      }
    ],
    name: "rebalance",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "redeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "_activeProvider",
        type: "address"
      }
    ],
    name: "setActiveProvider",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_minAmount",
        type: "uint256"
      }
    ],
    name: "setMinAmount",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "setProviders",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_timelock",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_treasury",
        type: "address"
      }
    ],
    name: "setTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_withdrawFeePercent",
        type: "uint256"
      }
    ],
    name: "setWithdrawFeePercent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "setupCompleted",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "setupVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "timelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "treasury",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "withdrawFeePercent",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];
var _bytecode11 = "0x6101a06040523480156200001257600080fd5b506040516200426138038062004261833981016040819052620000359162000bb0565b868686868686868580604051806040016040528060018152602001603160f81b815250888881600390816200006b919062000d96565b5060046200007a828262000d96565b506200008c915083905060056200026b565b610120526200009d8160066200026b565b61014052815160208084019190912060e052815190820120610100524660a0526200012b60e05161010051604080517f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f60208201529081019290925260608201524660808201523060a082015260009060c00160405160208183030381529060405280519060200120905090565b60805250503060c0525062000142600033620002a4565b6001600160a01b0387166200016a57604051633335653160e01b815260040160405180910390fd5b6001600160a01b0387166101608190526040805163313ce56760e01b8152905163313ce567916004808201926020929091908290030181865afa158015620001b6573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190620001dc919062000e62565b60ff1661018052620001ee8262000349565b620001f984620003bb565b620002278460008151811062000213576200021362000e8e565b60200260200101516200054260201b60201c565b6200023281620005b8565b6200023d836200062a565b6200024b620f424062000689565b620002576000620006bf565b505050505050505050505050505062000fec565b60006020835110156200028b5762000283836200075f565b90506200029e565b8162000298848262000d96565b5060ff90505b92915050565b60008281526008602090815260408083206001600160a01b038516845290915290205460ff16620003455760008281526008602090815260408083206001600160a01b03851684529091529020805460ff19166001179055620003043390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45b5050565b6001600160a01b0381166200037157604051633335653160e01b815260040160405180910390fd5b600e80546001600160a01b0319166001600160a01b0383169081179091556040517fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a250565b60005b8151811015620004ef5760006001600160a01b0316828281518110620003e857620003e862000e8e565b60200260200101516001600160a01b0316036200041857604051633335653160e01b815260040160405180910390fd5b620004e682828151811062000431576200043162000e8e565b60200260200101516001600160a01b03166373f64d4462000457620007ab60201b60201c565b6040516001600160e01b031960e084901b1681526001600160a01b03909116600482015230602482015260006044820152606401602060405180830381865afa158015620004a9573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190620004cf919062000ea4565b610160516001600160a01b031690600019620007b2565b600101620003be565b5080516200050590600a90602084019062000a24565b507f5f589bfb97387c6d7ce41557510dba9ca4a577876489cacc87a22a395b8b13ca8160405162000537919062000ec4565b60405180910390a150565b6200054d816200088d565b6200056b5760405163207562d360e21b815260040160405180910390fd5b600b80546001600160a01b0319166001600160a01b0383161790556040517f34ea2e3abaf449e8227dcf35ffa3aa94f2b89384cdf95fe6fd34dc2aefc59b09906200053790839062000f13565b6001600160a01b038116620005e057604051633335653160e01b815260040160405180910390fd5b600f80546001600160a01b0319166001600160a01b0383169081179091556040517f7dae230f18360d76a040c81f050aa14eb9d6dc7901b20fc5d855e2a20fe814d190600090a250565b66b1a2bc2ec50000811115620006535760405163207562d360e21b815260040160405180910390fd5b600d8190556040518181527fd84a6d804e5eabc5849fa0d39e4545509125b95c297e1ec5ed98fad0f66befb89060200162000537565b600c8190556040518181527f7a94dccf633222d5f6174016b33ae91ce3449a59c8ac979df57cc84ea1a5b2ef9060200162000537565b80620006cb81620008ee565b600160096000846001811115620006e657620006e662000f27565b6001811115620006fa57620006fa62000f27565b81526020810191909152604001600020805460ff19169115159190911790557f534f879afd40abb4e39f8e1b77a316be4c8e3521d9cf5a3a3db8959d574d4559620007423390565b836040516200075392919062000f3d565b60405180910390a15050565b600080829050601f8151111562000796578260405163305a27a960e01b81526004016200078d919062000f79565b60405180910390fd5b8051620007a38262000fae565b179392505050565b6101605190565b6000836001600160a01b031663095ea7b38484604051602401620007d892919062000fd3565b604051602081830303815290604052915060e01b6020820180516001600160e01b03838183161783525050505090506200081984826200091b60201b60201c565b62000887576200087b84856001600160a01b031663095ea7b38660006040516024016200084892919062000fd3565b60408051808303601f1901815291905260208101805160e09390931b6001600160e01b0393841617905291506200096d16565b6200088784826200096d565b50505050565b600a54600090815b81811015620008e757600a8181548110620008b457620008b462000e8e565b6000918252602090912001546001600160a01b0390811690851603620008de5760019250620008e7565b60010162000895565b5050919050565b620008f981620009db565b1562000918576040516336a4bf2d60e01b815260040160405180910390fd5b50565b6000806000806020600086516020880160008a5af192503d91506000519050828015620009635750811562000954578060011462000963565b6000866001600160a01b03163b115b9695505050505050565b600080602060008451602086016000885af18062000991576040513d6000823e3d81fd5b50506000513d91508115620009ab578060011415620009b8565b6001600160a01b0384163b155b15620008875783604051635274afe760e01b81526004016200078d919062000f13565b600060096000836001811115620009f657620009f662000f27565b600181111562000a0a5762000a0a62000f27565b815260208101919091526040016000205460ff1692915050565b82805482825590600052602060002090810192821562000a7c579160200282015b8281111562000a7c57825182546001600160a01b0319166001600160a01b0390911617825560209092019160019091019062000a45565b5062000a8a92915062000a8e565b5090565b5b8082111562000a8a576000815560010162000a8f565b6001600160a01b03811681146200091857600080fd5b805162000ac88162000aa5565b919050565b634e487b7160e01b600052604160045260246000fd5b604051601f8201601f191681016001600160401b038111828210171562000b0e5762000b0e62000acd565b604052919050565b60005b8381101562000b3357818101518382015260200162000b19565b50506000910152565b600082601f83011262000b4e57600080fd5b81516001600160401b0381111562000b6a5762000b6a62000acd565b62000b7f601f8201601f191660200162000ae3565b81815284602083860101111562000b9557600080fd5b62000ba882602083016020870162000b16565b949350505050565b600080600080600080600060e0888a03121562000bcc57600080fd5b875162000bd98162000aa5565b602089810151919850906001600160401b038082111562000bf957600080fd5b62000c078c838d0162000b3c565b985060408b015191508082111562000c1e57600080fd5b62000c2c8c838d0162000b3c565b975060608b015191508082111562000c4357600080fd5b818b0191508b601f83011262000c5857600080fd5b81518181111562000c6d5762000c6d62000acd565b8060051b915062000c8084830162000ae3565b818152918301840191848101908e84111562000c9b57600080fd5b938501935b8385101562000cc9578451925062000cb88362000aa5565b828252938501939085019062000ca0565b8099505050505050506080880151925062000ce760a0890162000abb565b915062000cf760c0890162000abb565b905092959891949750929550565b600181811c9082168062000d1a57607f821691505b60208210810362000d3b57634e487b7160e01b600052602260045260246000fd5b50919050565b601f82111562000d91576000816000526020600020601f850160051c8101602086101562000d6c5750805b601f850160051c820191505b8181101562000d8d5782815560010162000d78565b5050505b505050565b81516001600160401b0381111562000db25762000db262000acd565b62000dca8162000dc3845462000d05565b8462000d41565b602080601f83116001811462000e02576000841562000de95750858301515b600019600386901b1c1916600185901b17855562000d8d565b600085815260208120601f198616915b8281101562000e335788860151825594840194600190910190840162000e12565b508582101562000e525787850151600019600388901b60f8161c191681555b5050505050600190811b01905550565b60006020828403121562000e7557600080fd5b815160ff8116811462000e8757600080fd5b9392505050565b634e487b7160e01b600052603260045260246000fd5b60006020828403121562000eb757600080fd5b815162000e878162000aa5565b6020808252825182820181905260009190848201906040850190845b8181101562000f075783516001600160a01b03168352928401929184019160010162000ee0565b50909695505050505050565b6001600160a01b0391909116815260200190565b634e487b7160e01b600052602160045260246000fd5b6001600160a01b0383168152604081016002831062000f6c57634e487b7160e01b600052602160045260246000fd5b8260208301529392505050565b602081526000825180602084015262000f9a81604085016020870162000b16565b601f01601f19169190910160400192915050565b8051602080830151919081101562000d3b5760001960209190910360031b1b16919050565b6001600160a01b03929092168252602082015260400190565b60805160a05160c05160e05161010051610120516101405161016051610180516131e162001080600039600061042e015260008181610b4001528181610e5e0152818161144f0152818161161c01528181611e980152611ecc01526000611a7f01526000611a52015260006118ae01526000611886015260006117e10152600061180b0152600061183501526131e16000f3fe6080604052600436106102695760003560e01c806301e1d1141461027557806306fdde031461029d57806307a2d13a146102bf57806307bd0265146102df578063095ea7b3146103135780630a28a477146103435780630fa275391461036357806318160ddd146103855780631b98f6ac1461039a57806323b872dd146103ba5780632f2ff15d146103da578063301c7e5d146103fa578063313ce5671461041a5780633644e5151461045857806338d52e0f1461046d578063402d267d1461048f578063447cb896146104af578063495ef705146104cf5780634cdad506146102bf5780635ac86ab7146104e5578063609da8971461050557806361d027b3146105265780636e553f651461054657806370a082311461056657806371e114301461058657806375b238fc146105a65780637ecebe00146105bb57806384b0196e146105db5780638529727914610603578063897b06371461062357806391d148541461064357806394bf804d1461066357806395d89b411461068357806397f75dd9146106985780639b2cb5d8146106b85780639edd7b23146106ce578063a9059cbb146106ee578063b3d7f6b91461070e578063b460af941461072e578063ba0876521461074e578063bdacb3031461076e578063c63d75b61461048f578063c6e6f5921461078e578063ce96cb77146107ae578063d33219b4146107ce578063d505accf146107ee578063d547741f1461080e578063d905777e1461082e578063dd62ed3e1461084e578063edc922a91461086e578063edf07f1514610890578063ef8b30f71461078e578063f0f44260146108b0578063f5b541a6146108d057600080fd5b3661027057005b600080fd5b34801561028157600080fd5b5061028a6108f2565b6040519081526020015b60405180910390f35b3480156102a957600080fd5b506102b2610901565b6040516102949190612b4a565b3480156102cb57600080fd5b5061028a6102da366004612b5d565b610993565b3480156102eb57600080fd5b5061028a7fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6381565b34801561031f57600080fd5b5061033361032e366004612b8b565b6109a6565b6040519015158152602001610294565b34801561034f57600080fd5b5061028a61035e366004612b5d565b6109be565b34801561036f57600080fd5b5061038361037e366004612b5d565b6109cb565b005b34801561039157600080fd5b5060025461028a565b3480156103a657600080fd5b506103836103b5366004612bdd565b610a70565b3480156103c657600080fd5b506103336103d5366004612ca1565b610aa7565b3480156103e657600080fd5b506103836103f5366004612ce2565b610acd565b34801561040657600080fd5b50610383610415366004612d12565b610b03565b34801561042657600080fd5b5060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152602001610294565b34801561046457600080fd5b5061028a610b34565b34801561047957600080fd5b50610482610b3e565b6040516102949190612d33565b34801561049b57600080fd5b5061028a6104aa366004612d47565b610b62565b3480156104bb57600080fd5b506103836104ca366004612b5d565b610b84565b3480156104db57600080fd5b5061028a600d5481565b3480156104f157600080fd5b50610333610500366004612d12565b610bb5565b34801561051157600080fd5b50600f5461033390600160a01b900460ff1681565b34801561053257600080fd5b50600f54610482906001600160a01b031681565b34801561055257600080fd5b5061028a610561366004612ce2565b610bf8565b34801561057257600080fd5b5061028a610581366004612d47565b610c1d565b34801561059257600080fd5b506103836105a1366004612d47565b610c38565b3480156105b257600080fd5b5061028a600081565b3480156105c757600080fd5b5061028a6105d6366004612d47565b610c69565b3480156105e757600080fd5b506105f0610c87565b6040516102949796959493929190612d64565b34801561060f57600080fd5b5061028a61061e366004612d47565b610ccd565b34801561062f57600080fd5b5061038361063e366004612b5d565b610cdb565b34801561064f57600080fd5b5061033361065e366004612ce2565b610d0c565b34801561066f57600080fd5b5061028a61067e366004612ce2565b610d37565b34801561068f57600080fd5b506102b2610d5c565b3480156106a457600080fd5b50600b54610482906001600160a01b031681565b3480156106c457600080fd5b5061028a600c5481565b3480156106da57600080fd5b506103336106e9366004612dfd565b610d6b565b3480156106fa57600080fd5b50610333610709366004612b8b565b610f15565b34801561071a57600080fd5b5061028a610729366004612b5d565b610f23565b34801561073a57600080fd5b5061028a610749366004612e45565b610f30565b34801561075a57600080fd5b5061028a610769366004612e45565b610f69565b34801561077a57600080fd5b50610383610789366004612d47565b610fa2565b34801561079a57600080fd5b5061028a6107a9366004612b5d565b610fd6565b3480156107ba57600080fd5b5061028a6107c9366004612d47565b610fe3565b3480156107da57600080fd5b50600e54610482906001600160a01b031681565b3480156107fa57600080fd5b50610383610809366004612e87565b611008565b34801561081a57600080fd5b50610383610829366004612ce2565b611138565b34801561083a57600080fd5b5061028a610849366004612d47565b61116a565b34801561085a57600080fd5b5061028a610869366004612efe565b61118c565b34801561087a57600080fd5b506108836111b7565b6040516102949190612f2c565b34801561089c57600080fd5b506103836108ab366004612d12565b611218565b3480156108bc57600080fd5b506103836108cb366004612d47565b611249565b3480156108dc57600080fd5b5061028a60008051602061318c83398151915281565b60006108fc61127a565b905090565b60606003805461091090612f6d565b80601f016020809104026020016040519081016040528092919081815260200182805461093c90612f6d565b80156109895780601f1061095e57610100808354040283529160200191610989565b820191906000526020600020905b81548152906001019060200180831161096c57829003601f168201915b5050505050905090565b60006109a0826000611337565b92915050565b6000336109b481858561136e565b5060019392505050565b60006109a0826001611380565b600f54600160a01b900460ff16156109f657604051632b2cba5d60e01b815260040160405180910390fd5b600c54811015610a19576040516309bb724360e21b815260040160405180910390fd5b610a2360006113b2565b610a2f33308384611442565b600f805460ff60a01b1916600160a01b17905560405133907fb1fa1aae20fc88a51add616c46f8bc3a8d65d75b8fbe30fb0a6a2df2e773632290600090a250565b600e546001600160a01b03163314610a9b5760405163084312d160e41b815260040160405180910390fd5b610aa481611512565b50565b600033610ab585828561169c565b610ac08585856116ef565b60019150505b9392505050565b610ad8600033610d0c565b610af557604051633dcaff7960e21b815260040160405180910390fd5b610aff828261174e565b5050565b610b0e600033610d0c565b610b2b57604051633dcaff7960e21b815260040160405180910390fd5b610aa4816113b2565b60006108fc6117d4565b7f000000000000000000000000000000000000000000000000000000000000000090565b6000610b6e6000610bb5565b15610b7b57506000919050565b50600019919050565b610b8f600033610d0c565b610bac57604051633dcaff7960e21b815260040160405180910390fd5b610aa4816118ff565b600060096000836001811115610bcd57610bcd612fa7565b6001811115610bde57610bde612fa7565b815260208101919091526040016000205460ff1692915050565b600080610c0484610fd6565b9050610c1183858361195c565b610ac633848684611442565b6001600160a01b031660009081526020819052604090205490565b610c43600033610d0c565b610c6057604051633dcaff7960e21b815260040160405180910390fd5b610aa4816119da565b6001600160a01b0381166000908152600760205260408120546109a0565b600060608060008060006060610c9b611a4b565b610ca3611a78565b60408051600080825260208201909252600f60f81b9b939a50919850469750309650945092509050565b60006109a06102da83610c1d565b610ce6600033610d0c565b610d0357604051633dcaff7960e21b815260040160405180910390fd5b610aa481611aa5565b60009182526008602090815260408084206001600160a01b0393909316845291905290205460ff1690565b600080610d4384610f23565b9050610d5083828661195c565b610ac633848387611442565b60606004805461091090612f6d565b6000610d8560008051602061318c83398151915233610d0c565b610da257604051635be2897760e11b815260040160405180910390fd5b610dab84611ada565b1580610dbd5750610dbb83611ada565b155b15610ddb576040516301d9c4ab60e21b815260040160405180910390fd5b610de58286611b34565b610e108560405180604001604052806008815260200167776974686472617760c01b81525086611b74565b610e43610e1d8387612fd3565b6040518060400160405280600781526020016619195c1bdcda5d60ca1b81525085611b74565b8115610eb857600f546001600160a01b0390811690610e85907f0000000000000000000000000000000000000000000000000000000000000000168285611c0a565b806001600160a01b031660008051602061316c83398151915284604051610eae91815260200190565b60405180910390a2505b6001600160a01b038084169085167f086c47503692f7dac9bd7ce63f1c29c814ce3ae59ee29390e242340d6dd8d58f87610ef28682612fd3565b6040805192835260208301919091520160405180910390a3506001949350505050565b6000336109b48185856116ef565b60006109a0826001611337565b600080610f3c856109be565b9050600080610f4e8784338989611c62565b91509150610f5f3387878585611d35565b9695505050505050565b600080610f7585610993565b9050600080610f878388338989611c62565b91509150610f983387878585611d35565b5095945050505050565b600e546001600160a01b03163314610fcd5760405163084312d160e41b815260040160405180910390fd5b610aa481611f8f565b60006109a0826000611380565b6000610fef6001610bb5565b15610ffc57506000919050565b6109a06102da83610c1d565b834211156110315760405163313c898160e11b8152600481018590526024015b60405180910390fd5b60007f6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c988888861107e8c6001600160a01b0316600090815260076020526040902080546001810190915590565b6040805160208101969096526001600160a01b0394851690860152929091166060840152608083015260a082015260c0810186905260e00160405160208183030381529060405280519060200120905060006110d982612000565b905060006110e98287878761202d565b9050896001600160a01b0316816001600160a01b03161461112157808a6040516325c0072360e11b8152600401611028929190612fe6565b61112c8a8a8a61136e565b50505050505050505050565b611143600033610d0c565b61116057604051633dcaff7960e21b815260040160405180910390fd5b610aff828261205b565b60006111766001610bb5565b1561118357506000919050565b6109a082610c1d565b6001600160a01b03918216600090815260016020908152604080832093909416825291909152205490565b6060600a80548060200260200160405190810160405280929190818152602001828054801561098957602002820191906000526020600020905b81546001600160a01b031681526001909101906020018083116111f1575050505050905090565b611223600033610d0c565b61124057604051633dcaff7960e21b815260040160405180910390fd5b610aa4816120c2565b611254600033610d0c565b61127157604051633dcaff7960e21b815260040160405180910390fd5b610aa48161213b565b600a546000908190815b8181101561133157600a818154811061129f5761129f613000565b6000918252602090912001546040516302b844a960e21b81526001600160a01b0390911690630ae112a4906112da9030908190600401612fe6565b602060405180830381865afa1580156112f7573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061131b9190613016565b9250611327838561302f565b9350600101611284565b50505090565b60008061134360025490565b905080156113645761135f6113566108f2565b859083866121ac565b611366565b835b949350505050565b61137b83838360016121f9565b505050565b60008061138c60025490565b9050831580611399575080155b6113645761135f816113a96108f2565b869190866121ac565b806113bc816122c0565b6000600960008460018111156113d4576113d4612fa7565b60018111156113e5576113e5612fa7565b81526020810191909152604001600020805460ff19169115159190911790557f4cd3e1443d03aba343c5d882744f8f172c07b495e955ac3defb325cbd73c8550335b83604051611436929190613042565b60405180910390a15050565b6114776001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000168530856122e6565b60408051808201909152600781526619195c1bdcda5d60ca1b6020820152600b546114ac9184916001600160a01b0316611b74565b6114b6838261231f565b826001600160a01b0316846001600160a01b03167fdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d78484604051611504929190918252602082015260400190565b60405180910390a350505050565b60005b815181101561164d5760006001600160a01b031682828151811061153b5761153b613000565b60200260200101516001600160a01b03160361156a57604051633335653160e01b815260040160405180910390fd5b61164582828151811061157f5761157f613000565b60200260200101516001600160a01b03166373f64d4461159d610b3e565b6040516001600160e01b031960e084901b1681526001600160a01b03909116600482015230602482015260006044820152606401602060405180830381865afa1580156115ee573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611612919061307d565b6001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001690600019612355565b600101611515565b50805161166190600a906020840190612a80565b507f5f589bfb97387c6d7ce41557510dba9ca4a577876489cacc87a22a395b8b13ca816040516116919190612f2c565b60405180910390a150565b60006116a8848461118c565b905060001981146116e957818110156116da57828183604051637dc7a0d960e11b81526004016110289392919061309a565b6116e9848484840360006121f9565b50505050565b6001600160a01b038316611719576000604051634b637e8f60e11b81526004016110289190612d33565b6001600160a01b03821661174357600060405163ec442f0560e01b81526004016110289190612d33565b61137b8383836123e7565b6117588282610d0c565b610aff5760008281526008602090815260408083206001600160a01b03851684529091529020805460ff191660011790556117903390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45050565b6000306001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001614801561182d57507f000000000000000000000000000000000000000000000000000000000000000046145b1561185757507f000000000000000000000000000000000000000000000000000000000000000090565b6108fc604080517f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f60208201527f0000000000000000000000000000000000000000000000000000000000000000918101919091527f000000000000000000000000000000000000000000000000000000000000000060608201524660808201523060a082015260009060c00160405160208183030381529060405280519060200120905090565b66b1a2bc2ec500008111156119275760405163207562d360e21b815260040160405180910390fd5b600d8190556040518181527fd84a6d804e5eabc5849fa0d39e4545509125b95c297e1ec5ed98fad0f66befb890602001611691565b6000611967816124fe565b6001600160a01b03841661198e57604051633335653160e01b815260040160405180910390fd5b821580611999575081155b156119b75760405163207562d360e21b815260040160405180910390fd5b600c548310156116e9576040516309bb724360e21b815260040160405180910390fd5b6119e381611ada565b611a005760405163207562d360e21b815260040160405180910390fd5b600b80546001600160a01b0319166001600160a01b0383161790556040517f34ea2e3abaf449e8227dcf35ffa3aa94f2b89384cdf95fe6fd34dc2aefc59b0990611691908390612d33565b60606108fc7f00000000000000000000000000000000000000000000000000000000000000006005612525565b60606108fc7f00000000000000000000000000000000000000000000000000000000000000006006612525565b600c8190556040518181527f7a94dccf633222d5f6174016b33ae91ce3449a59c8ac979df57cc84ea1a5b2ef90602001611691565b600a54600090815b81811015611b2d57600a8181548110611afd57611afd613000565b6000918252602090912001546001600160a01b0390811690851603611b255760019250611b2d565b600101611ae2565b5050919050565b6000611b51826702c68af0bb140000670de0b6b3a76400006125d0565b90508083111561137b576040516337fa464560e21b815260040160405180910390fd5b600082604051602001611b8791906130bb565b60408051601f1981840301815290829052602482018690523060448301529060640160408051601f198184030181529082905291611bc4916130f0565b6040519081900390206020820180516001600160e01b03166001600160e01b03199092169190911790529050611c036001600160a01b0383168261268b565b5050505050565b61137b83846001600160a01b031663a9059cbb8585604051602401611c3092919061310c565b604051602081830303815290604052915060e01b6020820180516001600160e01b0383818316178352505050506126f8565b6000806001611c70816124fe565b6001600160a01b0385161580611c8d57506001600160a01b038416155b15611cab57604051633335653160e01b815260040160405180910390fd5b871580611cb6575086155b15611cd45760405163207562d360e21b815260040160405180910390fd5b6000611cdf85610fe3565b905080891115611cfe57925082611cf781898b6125d0565b9250611d05565b8893508792505b846001600160a01b0316876001600160a01b031614611d2957611d2985888561169c565b50509550959350505050565b600d54600090611d4f908490670de0b6b3a76400006125d0565b90506000611d5d8285612fd3565b9050611d698584612760565b600a5460005b81811015611e82576000600a8281548110611d8c57611d8c613000565b60009182526020822001546040516302b844a960e21b81526001600160a01b0390911692508290630ae112a490611dc99030908190600401612fe6565b602060405180830381865afa158015611de6573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190611e0a9190613016565b905080600003611e1b575050611e7a565b600088821015611e2b5781611e2d565b885b9050611e5a8160405180604001604052806008815260200167776974686472617760c01b81525085611b74565b611e64818a612fd3565b985088600003611e7657505050611e82565b5050505b600101611d6f565b50600f546001600160a01b0390811690611ebf907f0000000000000000000000000000000000000000000000000000000000000000168286611c0a565b611ef36001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000168985611c0a565b806001600160a01b031660008051602061316c83398151915285604051611f1c91815260200190565b60405180910390a2866001600160a01b0316886001600160a01b03168a6001600160a01b03167ffbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db8689604051611f7c929190918252602082015260400190565b60405180910390a4505050505050505050565b6001600160a01b038116611fb657604051633335653160e01b815260040160405180910390fd5b600e80546001600160a01b0319166001600160a01b0383169081179091556040517fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a250565b60006109a061200d6117d4565b8360405161190160f01b8152600281019290925260228201526042902090565b60008060008061203f88888888612796565b92509250925061204f828261285b565b50909695505050505050565b6120658282610d0c565b15610aff5760008281526008602090815260408083206001600160a01b0385168085529252808320805460ff1916905551339285917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a45050565b806120cc816124fe565b6001600960008460018111156120e4576120e4612fa7565b60018111156120f5576120f5612fa7565b81526020810191909152604001600020805460ff19169115159190911790557f534f879afd40abb4e39f8e1b77a316be4c8e3521d9cf5a3a3db8959d574d455933611427565b6001600160a01b03811661216257604051633335653160e01b815260040160405180910390fd5b600f80546001600160a01b0319166001600160a01b0383169081179091556040517f7dae230f18360d76a040c81f050aa14eb9d6dc7901b20fc5d855e2a20fe814d190600090a250565b60006121db6121ba83612914565b80156121d65750600084806121d1576121d1613125565b868809115b151590565b6121e68686866125d0565b6121f0919061302f565b95945050505050565b6001600160a01b03841661222357600060405163e602df0560e01b81526004016110289190612d33565b6001600160a01b03831661224d576000604051634a1406b160e11b81526004016110289190612d33565b6001600160a01b03808516600090815260016020908152604080832093871683529290522082905580156116e957826001600160a01b0316846001600160a01b03167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9258460405161150491815260200190565b6122c981610bb5565b610aa4576040516360f8581d60e01b815260040160405180910390fd5b6040516001600160a01b0384811660248301528381166044830152606482018390526116e99186918216906323b872dd90608401611c30565b6001600160a01b03821661234957600060405163ec442f0560e01b81526004016110289190612d33565b610aff600083836123e7565b6000836001600160a01b031663095ea7b3848460405160240161237992919061310c565b604051602081830303815290604052915060e01b6020820180516001600160e01b03838183161783525050505090506123b28482612941565b6116e9576123dd84856001600160a01b031663095ea7b3866000604051602401611c3092919061310c565b6116e984826126f8565b6001600160a01b038316612412578060026000828254612407919061302f565b909155506124719050565b6001600160a01b038316600090815260208190526040902054818110156124525783818360405163391434e360e21b81526004016110289392919061309a565b6001600160a01b03841660009081526020819052604090209082900390555b6001600160a01b03821661248d576002805482900390556124ac565b6001600160a01b03821660009081526020819052604090208054820190555b816001600160a01b0316836001600160a01b03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef836040516124f191815260200190565b60405180910390a3505050565b61250781610bb5565b15610aa4576040516336a4bf2d60e01b815260040160405180910390fd5b606060ff831461253f576125388361298b565b90506109a0565b81805461254b90612f6d565b80601f016020809104026020016040519081016040528092919081815260200182805461257790612f6d565b80156125c45780601f10612599576101008083540402835291602001916125c4565b820191906000526020600020905b8154815290600101906020018083116125a757829003601f168201915b505050505090506109a0565b6000838302816000198587098281108382030391505080600003612607578382816125fd576125fd613125565b0492505050610ac6565b80841161261e5761261e60038515026011186129ca565b6000848688096000868103871696879004966002600389028118808a02820302808a02820302808a02820302808a02820302808a02820302808a02909103029181900381900460010186841190950394909402919094039290920491909117919091029150509392505050565b6060600080846001600160a01b0316846040516126a891906130f0565b600060405180830381855af49150503d80600081146126e3576040519150601f19603f3d011682016040523d82523d6000602084013e6126e8565b606091505b50915091506121f08583836129dc565b600080602060008451602086016000885af18061271b576040513d6000823e3d81fd5b50506000513d91508115612733578060011415612740565b6001600160a01b0384163b155b156116e95783604051635274afe760e01b81526004016110289190612d33565b6001600160a01b03821661278a576000604051634b637e8f60e11b81526004016110289190612d33565b610aff826000836123e7565b600080806fa2a8918ca85bafe22016d0b997e4df60600160ff1b038411156127c75750600091506003905082612851565b604080516000808252602082018084528a905260ff891692820192909252606081018790526080810186905260019060a0016020604051602081039080840390855afa15801561281b573d6000803e3d6000fd5b5050604051601f1901519150506001600160a01b03811661284757506000925060019150829050612851565b9250600091508190505b9450945094915050565b600082600381111561286f5761286f612fa7565b03612878575050565b600182600381111561288c5761288c612fa7565b036128aa5760405163f645eedf60e01b815260040160405180910390fd5b60028260038111156128be576128be612fa7565b036128df5760405163fce698f760e01b815260048101829052602401611028565b60038260038111156128f3576128f3612fa7565b03610aff576040516335e2f38360e21b815260048101829052602401611028565b6000600282600381111561292a5761292a612fa7565b612934919061313b565b60ff166001149050919050565b6000806000806020600086516020880160008a5af192503d91506000519050828015610f5f575081156129775780600114610f5f565b50505050506001600160a01b03163b151590565b6060600061299883612a2f565b604080516020808252818301909252919250600091906020820181803683375050509182525060208101929092525090565b634e487b71600052806020526024601cfd5b6060826129f1576129ec82612a57565b610ac6565b8151158015612a0857506001600160a01b0384163b155b15612a285783604051639996b31560e01b81526004016110289190612d33565b5080610ac6565b600060ff8216601f8111156109a057604051632cd44ac360e21b815260040160405180910390fd5b805115612a675780518082602001fd5b60405163d6bda27560e01b815260040160405180910390fd5b828054828255906000526020600020908101928215612ad5579160200282015b82811115612ad557825182546001600160a01b0319166001600160a01b03909116178255602090920191600190910190612aa0565b50612ae1929150612ae5565b5090565b5b80821115612ae15760008155600101612ae6565b60005b83811015612b15578181015183820152602001612afd565b50506000910152565b60008151808452612b36816020860160208601612afa565b601f01601f19169290920160200192915050565b602081526000610ac66020830184612b1e565b600060208284031215612b6f57600080fd5b5035919050565b6001600160a01b0381168114610aa457600080fd5b60008060408385031215612b9e57600080fd5b8235612ba981612b76565b946020939093013593505050565b634e487b7160e01b600052604160045260246000fd5b8035612bd881612b76565b919050565b60006020808385031215612bf057600080fd5b82356001600160401b0380821115612c0757600080fd5b818501915085601f830112612c1b57600080fd5b813581811115612c2d57612c2d612bb7565b8060051b604051601f19603f83011681018181108582111715612c5257612c52612bb7565b604052918252848201925083810185019188831115612c7057600080fd5b938501935b82851015612c9557612c8685612bcd565b84529385019392850192612c75565b98975050505050505050565b600080600060608486031215612cb657600080fd5b8335612cc181612b76565b92506020840135612cd181612b76565b929592945050506040919091013590565b60008060408385031215612cf557600080fd5b823591506020830135612d0781612b76565b809150509250929050565b600060208284031215612d2457600080fd5b813560028110610ac657600080fd5b6001600160a01b0391909116815260200190565b600060208284031215612d5957600080fd5b8135610ac681612b76565b60ff60f81b881681526000602060e06020840152612d8560e084018a612b1e565b8381036040850152612d97818a612b1e565b606085018990526001600160a01b038816608086015260a0850187905284810360c08601528551808252602080880193509091019060005b81811015612deb57835183529284019291840191600101612dcf565b50909c9b505050505050505050505050565b60008060008060808587031215612e1357600080fd5b843593506020850135612e2581612b76565b92506040850135612e3581612b76565b9396929550929360600135925050565b600080600060608486031215612e5a57600080fd5b833592506020840135612e6c81612b76565b91506040840135612e7c81612b76565b809150509250925092565b600080600080600080600060e0888a031215612ea257600080fd5b8735612ead81612b76565b96506020880135612ebd81612b76565b95506040880135945060608801359350608088013560ff81168114612ee157600080fd5b9699959850939692959460a0840135945060c09093013592915050565b60008060408385031215612f1157600080fd5b8235612f1c81612b76565b91506020830135612d0781612b76565b6020808252825182820181905260009190848201906040850190845b8181101561204f5783516001600160a01b031683529284019291840191600101612f48565b600181811c90821680612f8157607f821691505b602082108103612fa157634e487b7160e01b600052602260045260246000fd5b50919050565b634e487b7160e01b600052602160045260246000fd5b634e487b7160e01b600052601160045260246000fd5b818103818111156109a0576109a0612fbd565b6001600160a01b0392831681529116602082015260400190565b634e487b7160e01b600052603260045260246000fd5b60006020828403121561302857600080fd5b5051919050565b808201808211156109a0576109a0612fbd565b6001600160a01b0383168152604081016002831061307057634e487b7160e01b600052602160045260246000fd5b8260208301529392505050565b60006020828403121561308f57600080fd5b8151610ac681612b76565b6001600160a01b039390931683526020830191909152604082015260600190565b600082516130cd818460208701612afa565b702875696e743235362c616464726573732960781b920191825250601101919050565b60008251613102818460208701612afa565b9190910192915050565b6001600160a01b03929092168252602082015260400190565b634e487b7160e01b600052601260045260246000fd5b600060ff83168061315c57634e487b7160e01b600052601260045260246000fd5b8060ff8416069150509291505056fe55bb3cade9d43b798a4fe5ffdd05024b2d7870df53920673bfc7e68047cd0ab197667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929a26469706673582212209072f6c1a5cebcbc3d7ac7397a183d4692082a244a53764886c8095d31dadddb64736f6c63430008170033";
var isSuperArgs11 = (xs) => xs.length > 1;
var RebalancerMulti__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs11(args)) {
      super(...args);
    } else {
      super(_abi16, _bytecode11, args[0]);
    }
  }
  getDeployTransaction(asset_, name_, symbol_, providers_, withdrawFeePercent_, timelock_, treasury_, overrides) {
    return super.getDeployTransaction(
      asset_,
      name_,
      symbol_,
      providers_,
      withdrawFeePercent_,
      timelock_,
      treasury_,
      overrides || {}
    );
  }
  deploy(asset_, name_, symbol_, providers_, withdrawFeePercent_, timelock_, treasury_, overrides) {
    return super.deploy(
      asset_,
      name_,
      symbol_,
      providers_,
      withdrawFeePercent_,
      timelock_,
      treasury_,
      overrides || {}
    );
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi16);
  }
  static connect(address, runner) {
    return new Contract(address, _abi16, runner);
  }
};
RebalancerMulti__factory.bytecode = _bytecode11;
RebalancerMulti__factory.abi = _abi16;

// libs/typechain/src/factories/RewardsDistributor__factory.ts
var _abi17 = [
  {
    inputs: [],
    name: "AccessManager__CallerIsNotAdmin",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotRootUpdater",
    type: "error"
  },
  {
    inputs: [],
    name: "RewardsDistributor__AlreadyClaimed",
    type: "error"
  },
  {
    inputs: [],
    name: "RewardsDistributor__InvalidProof",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "reward",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "RewardsClaimed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "newRoot",
        type: "bytes32"
      }
    ],
    name: "RootUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Unpaused",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ROOT_UPDATER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "address",
        name: "reward",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "claimable",
        type: "uint256"
      },
      {
        internalType: "bytes32[]",
        name: "proof",
        type: "bytes32[]"
      }
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "address",
        name: "reward",
        type: "address"
      }
    ],
    name: "claimed",
    outputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "root",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_root",
        type: "bytes32"
      }
    ],
    name: "updateRoot",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode12 = "0x608060405234801561001057600080fd5b5061001c60003361002b565b6001805460ff191690556100ca565b6000828152602081815260408083206001600160a01b038516845290915290205460ff166100c6576000828152602081815260408083206001600160a01b03851684529091529020805460ff191660011790556100853390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45b5050565b610d0c806100d96000396000f3fe608060405234801561001057600080fd5b50600436106100af5760003560e01c80630c9cbf0e146100b457806321ff9970146100f25780632f2ff15d146101075780633f4ba83a1461011a57806351cff8d9146101225780635c975abb1461013557806375b238fc1461014c5780638456cb591461015457806391d148541461015c578063d547741f1461016f578063d9ab2c5c14610182578063ebf0c717146101a8578063fabed412146101b1575b600080fd5b6100df6100c2366004610a92565b600360209081526000928352604080842090915290825290205481565b6040519081526020015b60405180910390f35b610105610100366004610ac5565b6101c4565b005b610105610115366004610ade565b610245565b61010561027b565b610105610130366004610b01565b6102ad565b60015460ff165b60405190151581526020016100e9565b6100df600081565b61010561035b565b61013c61016a366004610ade565b61038b565b61010561017d366004610ade565b6103b6565b6100df7e9ab23a1010d07a0450a1fbea1d84169b57d2c2273b54bff0f20c3e90199b5d81565b6100df60025481565b6101056101bf366004610b1c565b6103e8565b6101ed7e9ab23a1010d07a0450a1fbea1d84169b57d2c2273b54bff0f20c3e90199b5d3361038b565b61020a5760405163622164c760e11b815260040160405180910390fd5b60028190556040518181527f2cbc14f49c068133583f7cb530018af451c87c1cf1327cf2a4ff4698c4730aa49060200160405180910390a150565b61025060003361038b565b61026d57604051633dcaff7960e21b815260040160405180910390fd5b6102778282610530565b5050565b61028660003361038b565b6102a357604051633dcaff7960e21b815260040160405180910390fd5b6102ab6105b4565b565b6102b860003361038b565b6102d557604051633dcaff7960e21b815260040160405180910390fd5b6040516370a0823160e01b81526000906001600160a01b038316906370a0823190610304903090600401610bb9565b602060405180830381865afa158015610321573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103459190610bcd565b90506102776001600160a01b0383163383610600565b61036660003361038b565b61038357604051633dcaff7960e21b815260040160405180910390fd5b6102ab610657565b6000828152602081815260408083206001600160a01b038516845290915290205460ff165b92915050565b6103c160003361038b565b6103de57604051633dcaff7960e21b815260040160405180910390fd5b6102778282610692565b6103f06106f7565b610445828260025488888860405160200161040d93929190610be6565b60408051601f198184030181528282528051602091820120908301520160405160208183030381529060405280519060200120610742565b610462576040516324de687960e11b815260040160405180910390fd5b6001600160a01b0380861660009081526003602090815260408083209388168352929052908120546104949085610c0a565b9050806000036104b75760405163c1d3caf360e01b815260040160405180910390fd5b6001600160a01b0380871660009081526003602090815260408083209389168084529390915290208590556104ed908783610600565b7f9310ccfcb8de723f578a9e4282ea9f521f05ae40dc08f3068dfad528a65ee3c786868360405161052093929190610be6565b60405180910390a1505050505050565b61053a828261038b565b610277576000828152602081815260408083206001600160a01b03851684529091529020805460ff191660011790556105703390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45050565b6105bc61075c565b6001805460ff191690557f5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa335b6040516105f69190610bb9565b60405180910390a1565b604080516001600160a01b038416602482015260448082018490528251808303909101815260649091019091526020810180516001600160e01b031663a9059cbb60e01b1790526106529084906107a5565b505050565b61065f6106f7565b6001805460ff1916811790557f62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258336105e9565b61069c828261038b565b15610277576000828152602081815260408083206001600160a01b0385168085529252808320805460ff1916905551339285917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a45050565b60015460ff16156102ab5760405162461bcd60e51b815260206004820152601060248201526f14185d5cd8589b194e881c185d5cd95960821b60448201526064015b60405180910390fd5b60008261075086868561087a565b1490505b949350505050565b60015460ff166102ab5760405162461bcd60e51b815260206004820152601460248201527314185d5cd8589b194e881b9bdd081c185d5cd95960621b6044820152606401610739565b60006107fa826040518060400160405280602081526020017f5361666545524332303a206c6f772d6c6576656c2063616c6c206661696c6564815250856001600160a01b03166108bc9092919063ffffffff16565b905080516000148061081b57508080602001905181019061081b9190610c2b565b6106525760405162461bcd60e51b815260206004820152602a60248201527f5361666545524332303a204552433230206f7065726174696f6e20646964206e6044820152691bdd081cdd58d8d9595960b21b6064820152608401610739565b600081815b848110156108b3576108a98287878481811061089d5761089d610c4d565b905060200201356108cb565b915060010161087f565b50949350505050565b606061075484846000856108fd565b60008183106108e75760008281526020849052604090206108f6565b60008381526020839052604090205b9392505050565b60608247101561095e5760405162461bcd60e51b815260206004820152602660248201527f416464726573733a20696e73756666696369656e742062616c616e636520666f6044820152651c8818d85b1b60d21b6064820152608401610739565b600080866001600160a01b0316858760405161097a9190610c87565b60006040518083038185875af1925050503d80600081146109b7576040519150601f19603f3d011682016040523d82523d6000602084013e6109bc565b606091505b50915091506109cd878383876109d8565b979650505050505050565b60608315610a47578251600003610a40576001600160a01b0385163b610a405760405162461bcd60e51b815260206004820152601d60248201527f416464726573733a2063616c6c20746f206e6f6e2d636f6e74726163740000006044820152606401610739565b5081610754565b6107548383815115610a5c5781518083602001fd5b8060405162461bcd60e51b81526004016107399190610ca3565b80356001600160a01b0381168114610a8d57600080fd5b919050565b60008060408385031215610aa557600080fd5b610aae83610a76565b9150610abc60208401610a76565b90509250929050565b600060208284031215610ad757600080fd5b5035919050565b60008060408385031215610af157600080fd5b82359150610abc60208401610a76565b600060208284031215610b1357600080fd5b6108f682610a76565b600080600080600060808688031215610b3457600080fd5b610b3d86610a76565b9450610b4b60208701610a76565b93506040860135925060608601356001600160401b0380821115610b6e57600080fd5b818801915088601f830112610b8257600080fd5b813581811115610b9157600080fd5b8960208260051b8501011115610ba657600080fd5b9699959850939650602001949392505050565b6001600160a01b0391909116815260200190565b600060208284031215610bdf57600080fd5b5051919050565b6001600160a01b039384168152919092166020820152604081019190915260600190565b818103818111156103b057634e487b7160e01b600052601160045260246000fd5b600060208284031215610c3d57600080fd5b815180151581146108f657600080fd5b634e487b7160e01b600052603260045260246000fd5b60005b83811015610c7e578181015183820152602001610c66565b50506000910152565b60008251610c99818460208701610c63565b9190910192915050565b6020815260008251806020840152610cc2816040850160208701610c63565b601f01601f1916919091016040019291505056fea264697066735822122089ba1ba39ce5c3bc1ccc82026c44a5db715c0063912b193e6dc2879d2bfe116764736f6c63430008170033";
var isSuperArgs12 = (xs) => xs.length > 1;
var RewardsDistributor__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs12(args)) {
      super(...args);
    } else {
      super(_abi17, _bytecode12, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi17);
  }
  static connect(address, runner) {
    return new Contract(address, _abi17, runner);
  }
};
RewardsDistributor__factory.bytecode = _bytecode12;
RewardsDistributor__factory.abi = _abi17;

// libs/typechain/src/factories/TickAccountant__factory.ts
var _abi18 = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "ChainSetMismatch",
    type: "error"
  },
  {
    inputs: [],
    name: "HubStateMismatch",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidConfig",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidHubReference",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidTickId",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidTime",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidValue",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "NotQuarantined",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "bits",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "SafeCastOverflowedUintDowncast",
    type: "error"
  },
  {
    inputs: [],
    name: "TooSoon",
    type: "error"
  },
  {
    inputs: [],
    name: "Unauthorized",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownAgent",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownChain",
    type: "error"
  },
  {
    inputs: [],
    name: "UnknownKind",
    type: "error"
  },
  {
    inputs: [],
    name: "UnsortedChains",
    type: "error"
  },
  {
    inputs: [],
    name: "UnsortedInFlight",
    type: "error"
  },
  {
    inputs: [],
    name: "UnsortedPositions",
    type: "error"
  },
  {
    inputs: [],
    name: "UnsupportedVersion",
    type: "error"
  },
  {
    inputs: [],
    name: "VaultAlreadySet",
    type: "error"
  },
  {
    inputs: [],
    name: "ZeroShares",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "AgentUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        indexed: false,
        internalType: "struct ITickAccountant.Bucket",
        name: "up",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        indexed: false,
        internalType: "struct ITickAccountant.Bucket",
        name: "down",
        type: "tuple"
      }
    ],
    name: "BucketsUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64[]",
        name: "chainIds",
        type: "uint64[]"
      }
    ],
    name: "ChainsUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minTickInterval",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxSnapshotAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTickAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTransit",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "maxSpread",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "depositClearingMaxDown",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInFlightRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxOverdueInFlight",
            type: "uint128"
          }
        ],
        indexed: false,
        internalType: "struct ITickAccountant.Config",
        name: "config",
        type: "tuple"
      }
    ],
    name: "ConfigUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "managementFeeAssets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "performanceFeeAssets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "feeShares",
        type: "uint256"
      }
    ],
    name: "FeesAccrued",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint96",
        name: "managementFee",
        type: "uint96"
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "performanceFee",
        type: "uint96"
      }
    ],
    name: "FeesUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bool",
        name: "frozen",
        type: "bool"
      },
      {
        indexed: true,
        internalType: "address",
        name: "by",
        type: "address"
      }
    ],
    name: "FrozenSet",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint128",
        name: "ratio",
        type: "uint128"
      }
    ],
    name: "MaxChainExposureUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "enum ITickAccountant.TickStatus",
        name: "status",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "flags",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "referenceTime",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "hubBlock",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "rateBid",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "rateOffer",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "navBid",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "navOffer",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "navHash",
        type: "bytes32"
      }
    ],
    name: "TickCommitted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "address",
        name: "by",
        type: "address"
      }
    ],
    name: "TickRatified",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "TreasuryUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "vault",
        type: "address"
      }
    ],
    name: "VaultSet",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "FLAG_CHAIN_EXPOSURE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "FLAG_DOWN_BEYOND_DEPOSIT_LIMIT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "FLAG_IN_FLIGHT_LIMIT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "FLAG_OVERDUE_IN_FLIGHT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GUARDIAN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAX_UP_CAPACITY",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAX_UP_REFILL_PER_SECOND",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "NAV_UPDATER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "bridgeSendsAllowed",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "buckets",
    outputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "up",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "down",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "chainIds",
    outputs: [
      {
        internalType: "uint64[]",
        name: "",
        type: "uint64[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "dstChainId",
        type: "uint64"
      }
    ],
    name: "chainSendAllowed",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint16",
            name: "version",
            type: "uint16"
          },
          {
            internalType: "uint64",
            name: "tickId",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "referenceTime",
            type: "uint64"
          },
          {
            components: [
              {
                internalType: "uint64",
                name: "chainId",
                type: "uint64"
              },
              {
                internalType: "uint64",
                name: "blockNumber",
                type: "uint64"
              },
              {
                internalType: "bytes32",
                name: "blockHash",
                type: "bytes32"
              }
            ],
            internalType: "struct NavSnapshot.ChainRef[]",
            name: "chains",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "uint64",
                name: "chainId",
                type: "uint64"
              },
              {
                internalType: "address",
                name: "holder",
                type: "address"
              },
              {
                internalType: "address",
                name: "strategy",
                type: "address"
              },
              {
                internalType: "uint8",
                name: "kind",
                type: "uint8"
              },
              {
                internalType: "uint256",
                name: "units",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "valueBid",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "valueOffer",
                type: "uint256"
              }
            ],
            internalType: "struct NavSnapshot.Position[]",
            name: "positions",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "bytes32",
                name: "transferId",
                type: "bytes32"
              },
              {
                internalType: "uint64",
                name: "srcChainId",
                type: "uint64"
              },
              {
                internalType: "uint64",
                name: "dstChainId",
                type: "uint64"
              },
              {
                internalType: "uint64",
                name: "sentAt",
                type: "uint64"
              },
              {
                internalType: "uint256",
                name: "amountSent",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "minReceive",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "writtenDown",
                type: "uint256"
              }
            ],
            internalType: "struct NavSnapshot.InFlight[]",
            name: "inFlight",
            type: "tuple[]"
          },
          {
            internalType: "uint256",
            name: "hubCash",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "pendingDeposits",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "liabilities",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "totalShares",
            type: "uint256"
          }
        ],
        internalType: "struct NavSnapshot.Snapshot",
        name: "s",
        type: "tuple"
      },
      {
        internalType: "uint256",
        name: "hubCheckpointIndex",
        type: "uint256"
      }
    ],
    name: "commitTick",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "config",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minTickInterval",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxSnapshotAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTickAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTransit",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "maxSpread",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "depositClearingMaxDown",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInFlightRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxOverdueInFlight",
            type: "uint128"
          }
        ],
        internalType: "struct ITickAccountant.Config",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "freeze",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "frozen",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getFees",
    outputs: [
      {
        internalType: "uint96",
        name: "managementFee",
        type: "uint96"
      },
      {
        internalType: "uint96",
        name: "performanceFee",
        type: "uint96"
      },
      {
        internalType: "uint256",
        name: "highWaterMark",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      }
    ],
    name: "getTick",
    outputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "referenceTime",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "committedAt",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "hubBlock",
            type: "uint64"
          },
          {
            internalType: "enum ITickAccountant.TickStatus",
            name: "status",
            type: "uint8"
          },
          {
            internalType: "uint8",
            name: "flags",
            type: "uint8"
          },
          {
            internalType: "uint128",
            name: "rateBid",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "rateOffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "navBid",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "navOffer",
            type: "uint128"
          },
          {
            internalType: "bytes32",
            name: "navHash",
            type: "bytes32"
          }
        ],
        internalType: "struct ITickAccountant.Tick",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTimelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "admin_",
        type: "address"
      },
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      },
      {
        internalType: "address",
        name: "treasury_",
        type: "address"
      },
      {
        internalType: "uint64[]",
        name: "chainIds_",
        type: "uint64[]"
      },
      {
        components: [
          {
            internalType: "uint64",
            name: "minTickInterval",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxSnapshotAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTickAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTransit",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "maxSpread",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "depositClearingMaxDown",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInFlightRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxOverdueInFlight",
            type: "uint128"
          }
        ],
        internalType: "struct ITickAccountant.Config",
        name: "config_",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "up_",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "down_",
        type: "tuple"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "agent",
        type: "address"
      }
    ],
    name: "isAgent",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      }
    ],
    name: "isChainOverExposed",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "lastAcceptedTickId",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "lastTickId",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "latestAccepted",
    outputs: [
      {
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      },
      {
        components: [
          {
            internalType: "uint64",
            name: "referenceTime",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "committedAt",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "hubBlock",
            type: "uint64"
          },
          {
            internalType: "enum ITickAccountant.TickStatus",
            name: "status",
            type: "uint8"
          },
          {
            internalType: "uint8",
            name: "flags",
            type: "uint8"
          },
          {
            internalType: "uint128",
            name: "rateBid",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "rateOffer",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "navBid",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "navOffer",
            type: "uint128"
          },
          {
            internalType: "bytes32",
            name: "navHash",
            type: "bytes32"
          }
        ],
        internalType: "struct ITickAccountant.Tick",
        name: "tick",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "maxChainExposure",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "quarantined",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "tickId",
        type: "uint64"
      }
    ],
    name: "ratifyTick",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "chainId",
        type: "uint64"
      },
      {
        internalType: "address",
        name: "agent",
        type: "address"
      },
      {
        internalType: "bool",
        name: "allowed",
        type: "bool"
      }
    ],
    name: "setAgent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "up_",
        type: "tuple"
      },
      {
        components: [
          {
            internalType: "uint128",
            name: "capacity",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "refillPerSecond",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "level",
            type: "uint128"
          },
          {
            internalType: "uint64",
            name: "updatedAt",
            type: "uint64"
          }
        ],
        internalType: "struct ITickAccountant.Bucket",
        name: "down_",
        type: "tuple"
      }
    ],
    name: "setBuckets",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64[]",
        name: "chainIds_",
        type: "uint64[]"
      }
    ],
    name: "setChains",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "minTickInterval",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxSnapshotAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTickAge",
            type: "uint64"
          },
          {
            internalType: "uint64",
            name: "maxTransit",
            type: "uint64"
          },
          {
            internalType: "uint128",
            name: "maxSpread",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "depositClearingMaxDown",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxInFlightRatio",
            type: "uint128"
          },
          {
            internalType: "uint128",
            name: "maxOverdueInFlight",
            type: "uint128"
          }
        ],
        internalType: "struct ITickAccountant.Config",
        name: "config_",
        type: "tuple"
      }
    ],
    name: "setConfig",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "managementFee_",
        type: "uint96"
      },
      {
        internalType: "uint96",
        name: "performanceFee_",
        type: "uint96"
      }
    ],
    name: "setFees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint128",
        name: "ratio",
        type: "uint128"
      }
    ],
    name: "setMaxChainExposure",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "timelock_",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "treasury_",
        type: "address"
      }
    ],
    name: "setTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "vault_",
        type: "address"
      }
    ],
    name: "setVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "unfreeze",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "vault",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
];
var _bytecode13 = "0x6080604052348015600f57600080fd5b506016601a565b60ca565b7ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00805468010000000000000000900460ff161560695760405163f92ee8a960e01b815260040160405180910390fd5b80546001600160401b039081161460c75780546001600160401b0319166001600160401b0390811782556040519081527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b50565b615304806100d96000396000f3fe608060405234801561001057600080fd5b50600436106102745760003560e01c806375b238fc11610151578063d717028d116100c3578063e6e9db7e11610087578063e6e9db7e1461059a578063f0f44260146105ad578063f1c73409146105c0578063fbe4b7c0146105d3578063fbfa77cf146105e8578063fcf2fa51146105f057600080fd5b8063d717028d14610512578063db8d55f114610525578063dffffc3f14610561578063e38c6a8714610574578063e51079121461058757600080fd5b8063a07023cc11610115578063a07023cc1461048a578063a6897896146104b1578063bcf1a918146104b9578063bdacb303146104d9578063c7a412cd146104ec578063d547741f146104ff57600080fd5b806375b238fc1461043c57806379502c5514610444578063867975d81461045957806391d148541461046157806394e26a311461047457600080fd5b80634f175f13116101ea57806362a5af3b116101ae57806362a5af3b146103eb5780636817031b146103f357806368a445511461040657806369beef41146104195780636a28f0001461042c578063745b65fc1461043457600080fd5b80634f175f13146103a5578063534af84a146103b357806356d798d7146103bb5780635dcb6425146103c35780636221a54b146103cb57600080fd5b80631af2252b1161023c5780631af2252b14610308578063247a22071461032857806324ea54f41461033b5780632f2ff15d1461036257806337ea2b9114610375578063423316a21461038b57600080fd5b8063012c4c7f14610279578063054f7d9c1461029e57806306a45bb8146102b657806307bd0265146102cb57806307d9336e14610300575b600080fd5b610281610603565b6040516001600160401b0390911681526020015b60405180910390f35b6102a6610626565b6040519015158152602001610295565b6102c96102c4366004614286565b61065f565b005b6102f27fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6381565b604051908152602001610295565b6102a66106c5565b6103106106e2565b6040516001600160801b039091168152602001610295565b6102a66103363660046142e1565b6106fb565b6102f27f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a504181565b6102c9610370366004614315565b61072a565b61037d610744565b604051610295929190614382565b610393600181565b60405160ff9091168152602001610295565b61031066470de4df82000081565b610393600281565b610393600881565b61031061082b565b6103d3610847565b6040516001600160a01b039091168152602001610295565b6102c9610863565b6102c961040136600461439e565b610934565b6102c96104143660046143d9565b6109e5565b6102c96104273660046143f6565b610ab2565b6102c9610f5f565b6102a6610fe0565b6102f2600081565b61044c610ff7565b6040516102959190614440565b610393600481565b6102a661046f366004614315565b6110c9565b61047c611115565b604051610295929190614626565b6102f27ff69ff10a3df3288bad92772f5c483e526b0c6cf77ac120db1f6c7bf1a45540df81565b610281611221565b6104cc6104c73660046142e1565b611244565b6040516102959190614644565b6102c96104e736600461439e565b61133b565b6102c96104fa366004614666565b611383565b6102c961050d366004614315565b6113d6565b6102c96105203660046146ce565b6113eb565b61052d611759565b604080516001600160601b039586168152949093166020850152918301526001600160a01b03166060820152608001610295565b6102c961056f366004614791565b6117a1565b6102c96105823660046147bb565b6118bc565b6102a6610595366004614809565b6119cd565b6102c96105a83660046142e1565b611a13565b6102c96105bb36600461439e565b611bd8565b6102a66105ce3660046142e1565b611c1d565b6105db611c61565b6040516102959190614835565b6103d3611cf4565b6102c96105fe366004614881565b611d0d565b600061060d611d53565b60030154600160a01b90046001600160401b0316919050565b600080610631611d53565b6004810154909150600160801b900460ff168061065957506004810154600160881b900460ff165b91505090565b610667611d53565b600101546001600160a01b0316336001600160a01b03161461069b576040516282b42960e81b815260040160405180910390fd5b6106c16106ad36849003840184614901565b6106bc36849003840184614901565b611d77565b5050565b60006106cf611d53565b60040154600160881b900460ff16919050565b6106f86301e13380670de0b6b3a76400006149b3565b81565b6000610705611d53565b6001600160401b03909216600090815260129290920160205250604090205460ff1690565b600061073581611f20565b61073f8383611f46565b505050565b6040805160808101825260008082526020820181905291810182905260608101919091526040805160808101825260008082526020820181905291810182905260608101919091526000610796611d53565b604080516080808201835260098401546001600160801b038082168452600160801b918290048116602080860191909152600a870154808316868801526001600160401b0390849004811660608088019190915287519586018852600b8901548085168752859004841692860192909252600c9097015491821695840195909552049093169183019190915294909350915050565b6000610835611d53565b601101546001600160801b0316919050565b6000610851611d53565b600101546001600160a01b0316919050565b61088d7f55435dd261a4b9b3364963f7738a7a662ad9c84396d64be3365284bb7f0a5041336110c9565b1580156108a257506108a06000336110c9565b155b156108bf576040516282b42960e81b815260040160405180910390fd5b60016108c9611d53565b6004018054911515600160801b0260ff60801b199092169190911790556108ed3390565b6001600160a01b03167fdc02e86542de14a5ec56514f744712f0f70c86f61ff675df1faad885b9c100a8600160405161092a911515815260200190565b60405180910390a2565b600061093f81611f20565b6000610949611d53565b80549091506001600160a01b03161561097557604051631bb0ddfb60e01b815260040160405180910390fd5b6001600160a01b03831661099c576040516306b7c75960e31b815260040160405180910390fd5b80546001600160a01b0319166001600160a01b03841690811782556040517fe7ae49f883c825b05681b3e00e8be6fdea9ed2a8a45e4c6ecb9390fc44cce61590600090a2505050565b6109ed611d53565b600101546001600160a01b0316336001600160a01b031614610a21576040516282b42960e81b815260040160405180910390fd5b670de0b6b3a7640000816001600160801b03161115610a53576040516306b7c75960e31b815260040160405180910390fd5b80610a5c611d53565b60110180546001600160801b0319166001600160801b0392831617905560405190821681527f0edee03e30897aca38417bae54dd71048cdd3122be69fbfa1ef36dd8b0ed2640906020015b60405180910390a150565b7ff69ff10a3df3288bad92772f5c483e526b0c6cf77ac120db1f6c7bf1a45540df610adc81611f20565b6000610ae6611d53565b80549091506001600160a01b0316610b11576040516306b7c75960e31b815260040160405180910390fd5b610b1b8185611fec565b610b2484612163565b610b2e8185612442565b610b3661419e565b610b41828686612774565b6001600160401b0390811682526006830154610b66918791600160c01b900416612b3a565b60c08201526101208501351580610b80575060c081015151155b15610b9e57604051639811e0c760e01b815260040160405180910390fd5b60c081015151610bbc90670de0b6b3a7640000610120880135612d88565b604082015260c081015160200151610be290670de0b6b3a7640000610120880135612d88565b60608201526003820154600160a01b90046001600160401b031660009081526010830160205260408120600101546001600160801b0316608083015260c082015151610c319084908890612e3d565b60e080850191909152604080516101008101825260068701546001600160401b038082168352600160401b820481166020840152600160801b808304821684860152600160c01b90920416606083015260078801546001600160801b0380821660808086019190915291839004811660a085015260088a015480821660c080870191909152939004169483019490945286015191860151928601519394508493610cde9391929190612f88565b1760ff166020830152610cf08661301f565b60a08301526007830154600090610d3090610d1c906001600160801b0316670de0b6b3a76400006149e1565b604085015190670de0b6b3a7640000612d88565b836060015111158015610d515750610d51848460400151856080015161304f565b9050610d6360408801602089016142e1565b60038501805467ffffffffffffffff60601b1916600160601b6001600160401b039384160217905560048501805467ffffffffffffffff19164390921691909117905580610dff5760048401805460ff60881b1916600160881b179055610df684610dd460408a0160208b016142e1565b610de460608b0160408c016142e1565b6002878860400151896060015161318c565b50505050505050565b600080610e2286610e1660408c0160208d016142e1565b878c6101200135613370565b9092509050610e3760408a0160208b016142e1565b8660030160146101000a8154816001600160401b0302191690836001600160401b031602179055508560050154821115610e7357600586018290555b610ea186610e8760408c0160208d016142e1565b610e9760608d0160408e016142e1565b600189878761318c565b60005b610eb160608b018b6149f4565b9050811015610f44578560e001518181518110610ed057610ed0614a3c565b60200260200101518760120160008c8060600190610eee91906149f4565b85818110610efe57610efe614a3c565b610f1492602060609092020190810191506142e1565b6001600160401b031681526020810191909152604001600020805460ff1916911515919091179055600101610ea4565b5050506004909301805460ff60881b19169055505050505050565b6000610f6a81611f20565b6000610f74611d53565b6004018054911515600160801b0260ff60801b19909216919091179055610f983390565b6001600160a01b03167fdc02e86542de14a5ec56514f744712f0f70c86f61ff675df1faad885b9c100a86000604051610fd5911515815260200190565b60405180910390a250565b6000610ff2610fed611d53565b613579565b905090565b6040805161010081018252600080825260208201819052918101829052606081018290526080810182905260a0810182905260c0810182905260e0810191909152611040611d53565b604080516101008101825260068301546001600160401b038082168352600160401b820481166020840152600160801b808304821694840194909452600160c01b90910416606082015260078301546001600160801b03808216608084015290839004811660a083015260089093015480841660c08301529190910490911660e0820152919050565b60008281527f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300602090815260408083206001600160a01b038516845290915290205460ff165b92915050565b600061111f61421b565b6000611129611d53565b600381810154600160a01b90046001600160401b03908116600081815260108501602090815260409182902082516101408101845281548087168252600160401b8104871693820193909352600160801b8304909516928501929092529197509394509092916060840191600160c01b900460ff16908111156111ae576111ae614509565b60038111156111bf576111bf614509565b81528154600160c81b900460ff16602082015260018201546001600160801b038082166040840152600160801b918290048116606084015260028401548082166080850152919091041660a082015260039091015460c0909101529293915050565b600061122b611d53565b60030154600160601b90046001600160401b0316919050565b61124c61421b565b611254611d53565b6001600160401b038381166000908152601092909201602090815260409283902083516101408101855281548085168252600160401b8104851693820193909352600160801b8304909316938301939093529091906060830190600160c01b900460ff1660038111156112c9576112c9614509565b60038111156112da576112da614509565b81528154600160c81b900460ff16602082015260018201546001600160801b038082166040840152600160801b918290048116606084015260028401548082166080850152919091041660a082015260039091015460c09091015292915050565b611343611d53565b600101546001600160a01b0316336001600160a01b031614611377576040516282b42960e81b815260040160405180910390fd5b61138081613615565b50565b61138b611d53565b600101546001600160a01b0316336001600160a01b0316146113bf576040516282b42960e81b815260040160405180910390fd5b6113806113d136839003830183614a52565b613692565b60006113e181611f20565b61073f838361380a565b60006113f5613891565b805490915060ff600160401b82041615906001600160401b031660008115801561141c5750825b90506000826001600160401b031660011480156114385750303b155b905081158015611446575080155b156114645760405163f92ee8a960e01b815260040160405180910390fd5b845467ffffffffffffffff19166001178555831561148e57845460ff60401b1916600160401b1785555b6001600160a01b038d166114b5576040516306b7c75960e31b815260040160405180910390fd5b6114be8d6138ba565b6114c78c613615565b6114d08b6138cb565b6114da8a8a613948565b6114ec6113d1368a90038a018a614a52565b61150d6114fe36899003890189614901565b6106bc36899003890189614901565b6000611517611d53565b670de0b6b3a7640000600582018190556004820180546001600160801b0319908116600160401b426001600160401b0390811682810267ffffffffffffffff1916939093174382169081179095556040805161014081018252848152602080820195865281830197885260016060830190815260006080840181905260a084018b905260c084019a909a5260e083018a905261010083018a905261012083018a905289805260108b019091529190972087518154955197518416600160801b0267ffffffffffffffff60801b1998851690950295909616959092169490941792909217938416811782559151949550929391839160ff60c01b191668ffffffffffffffffff60801b1990911617600160c01b83600381111561163b5761163b614509565b02179055506080820151815460ff60c81b1916600160c81b60ff9092169190910217815560a082015160c08301516001600160801b03918216600160801b91831682021760018085019190915560e08501516101008601519084169316909102919091176002830155610120909201516003909101556040516000917fefc967d026ee8c5f9f26fb04fc2d13f229a95961be704383e2ba4df65daa4533916116fb9190849042904390670de0b6b3a7640000908190859081908190614afa565b60405180910390a250831561174a57845460ff60401b19168555604051600181527fc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d29060200160405180910390a15b50505050505050505050505050565b6000806000806000611769611d53565b600281015460038201546005909201546001600160601b03600160a01b83048116999316975095506001600160a01b03169350915050565b6117a9611d53565b600101546001600160a01b0316336001600160a01b0316146117dd576040516282b42960e81b815260040160405180910390fd5b66b1a2bc2ec50000826001600160601b0316118061180b57506703782dace9d90000816001600160601b0316115b15611829576040516306b7c75960e31b815260040160405180910390fd5b6000611833611d53565b6002810180546001600160a01b0316600160a01b6001600160601b03878116918202929092179092556003830180546bffffffffffffffffffffffff191691861691821790556040805192835260208301919091529192507fb0a436a088b0f5d6ac800fa74399c64737e8c83c62f2dd85969007f7f87bd9bb91015b60405180910390a1505050565b6118c4611d53565b600101546001600160a01b0316336001600160a01b0316146118f8576040516282b42960e81b815260040160405180910390fd5b6000611902611d53565b6001600160401b0385166000908152600e8201602052604090205490915060ff16158061193657506001600160a01b038316155b15611954576040516306b7c75960e31b815260040160405180910390fd5b6001600160401b0384166000818152600f8301602090815260408083206001600160a01b03881680855290835292819020805460ff191687151590811790915590519081529192917fc172f4f79ff9c38dff317bb18336859e21bef9f284d26fc78165af407366946b910160405180910390a350505050565b60006119d7611d53565b6001600160401b0384166000908152600f91909101602090815260408083206001600160a01b038616845290915290205460ff16905092915050565b6000611a1d611d53565b6001600160401b0380841660008181526010840160205260409020600384015493945092600160601b9004909116141580611a75575060028154600160c01b900460ff166003811115611a7257611a72614509565b14155b15611a9357604051630721e99960e31b815260040160405180910390fd5b6003820154600160a01b90046001600160401b031660009081526010830160205260409020600190810154908201546001600160801b0391821691161115611b0f5760018201546001600160a01b0316336001600160a01b031614611b0a576040516282b42960e81b815260040160405180910390fd5b611b5a565b611b1a6000336110c9565b158015611b3d575060018201546001600160a01b0316336001600160a01b031614155b15611b5a576040516282b42960e81b815260040160405180910390fd5b805460ff60c01b1916600360c01b17815560038201805467ffffffffffffffff60a01b1916600160a01b6001600160401b0386169081029190911790915560048301805460ff60881b191690556040513391907ff342a4e23f656f42400a30ec3caddb84547ba364bcc105db64372abfc838d13e90600090a3505050565b611be0611d53565b600101546001600160a01b0316336001600160a01b031614611c14576040516282b42960e81b815260040160405180910390fd5b611380816138cb565b600080611c28611d53565b9050611c3381613579565b8015611c5a57506001600160401b038316600090815260128201602052604090205460ff16155b9392505050565b6060611c6b611d53565b600d01805480602002602001604051908101604052809291908181526020018280548015611cea57602002820191906000526020600020906000905b82829054906101000a90046001600160401b03166001600160401b031681526020019060080190602082600701049283019260010382029150808411611ca75790505b5050505050905090565b6000611cfe611d53565b546001600160a01b0316919050565b611d15611d53565b600101546001600160a01b0316336001600160a01b031614611d49576040516282b42960e81b815260040160405180910390fd5b6106c18282613948565b7f275c27e0892c4e08d7ad6683f674b5fdf50673ed4093c27fc04ebfefcac2240090565b81516001600160801b03161580611da05750815166470de4df8200006001600160801b03909116115b80611dd55750611dbc6301e13380670de0b6b3a76400006149b3565b6001600160801b031682602001516001600160801b0316115b80611de8575080516001600160801b0316155b80611e085750670de0b6b3a764000081600001516001600160801b031610155b15611e26576040516306b7c75960e31b815260040160405180910390fd5b6000611e30611d53565b604080516080808201835286516001600160801b039081168084526020808a015183168186018190528a5184168688018190526001600160401b0342166060978801819052600160801b92830290941760098a01908155600a8a0180548487026001600160c01b0319918216909417841790915589519788018a528c5187168089528d86015188169589018690528d51909716888b0181905297909801949094529102909217600b8701908155600c8701805490951690931790911790925591519293507f7c1bb3b4e9e70cee5d688173dd5d7b96d74e79c4b00a2b73ca9bacb94ecd99cd926118af9290614b51565b611f2a81336110c9565b611380576040516282b42960e81b815260040160405180910390fd5b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb300611f7183836110c9565b61073f576000838152602082815260408083206001600160a01b03861684529091529020805460ff19166001179055611fa73390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a4505050565b600382015461200c90600160601b90046001600160401b03166001614bb8565b6001600160401b031661202560408301602084016142e1565b6001600160401b03161461204c576040516376ebc70960e01b815260040160405180910390fd5b60038201546001600160401b03600160601b909104811660009081526010840160205260409081902080549092169061208b90606085019085016142e1565b6001600160401b03161115806120b85750426120ad60608401604085016142e1565b6001600160401b0316115b806120f857506006830154600160401b90046001600160401b03166120e360608401604085016142e1565b6120f6906001600160401b031642614bd7565b115b15612116576040516337bf561360e11b815260040160405180910390fd5b6006830154815461213a916001600160401b0390811691600160401b900416614bb8565b6001600160401b031642101561073f57604051636fed7d8560e01b815260040160405180910390fd5b60016121726020830183614bfc565b61ffff16146121945760405163b01318a560e01b815260040160405180910390fd5b60015b6121a460608301836149f4565b9050811015612255576121ba60608301836149f4565b6121c5600184614bd7565b8181106121d4576121d4614a3c565b6121ea92602060609092020190810191506142e1565b6001600160401b031661220060608401846149f4565b8381811061221057612210614a3c565b61222692602060609092020190810191506142e1565b6001600160401b03161161224d57604051633b7d9b8960e11b815260040160405180910390fd5b600101612197565b5060005b6122666080830183614c17565b905081101561235f573661227d6080840184614c17565b8381811061228d5761228d614a3c565b60e002919091019150600190506122aa6080830160608401614c70565b60ff1611156122cc576040516327dd2e9960e21b815260040160405180910390fd5b8060a001358160c0013510156122f557604051632a9ffab760e21b815260040160405180910390fd5b6000821180156123385750612336816123116080860186614c17565b61231c600187614bd7565b81811061232b5761232b614a3c565b905060e00201613b77565b155b156123565760405163315c2bc960e01b815260040160405180910390fd5b50600101612259565b5060005b61237060a0830183614c17565b90508110156106c1573661238760a0840184614c17565b8381811061239757612397614a3c565b905060e00201905080608001358160a0013511806123bc575080608001358160c00135115b156123da57604051632a9ffab760e21b815260040160405180910390fd5b60008211801561241b57506123f260a0840184614c17565b6123fd600185614bd7565b81811061240c5761240c614a3c565b60e00291909101358235111590505b1561243957604051633e5f14ab60e01b815260040160405180910390fd5b50600101612363565b600d8201805461245560608401846149f4565b90501461247557604051636d0811bf60e11b815260040160405180910390fd5b60005b815481101561251c5781818154811061249357612493614a3c565b6000918252602090912060048204015460039091166008026101000a90046001600160401b03166124c760608501856149f4565b838181106124d7576124d7614a3c565b6124ed92602060609092020190810191506142e1565b6001600160401b03161461251457604051636d0811bf60e11b815260040160405180910390fd5b600101612478565b5060005b61252d6080840184614c17565b905081101561267557600e840160006125496080860186614c17565b8481811061255957612559614a3c565b61256f92602060e09092020190810191506142e1565b6001600160401b0316815260208101919091526040016000205460ff166125a9576040516305a1a5df60e01b815260040160405180910390fd5b600f840160006125bc6080860186614c17565b848181106125cc576125cc614a3c565b6125e292602060e09092020190810191506142e1565b6001600160401b03168152602081019190915260400160009081209061260b6080860186614c17565b8481811061261b5761261b614a3c565b905060e002016020016020810190612633919061439e565b6001600160a01b0316815260208101919091526040016000205460ff1661266d57604051630df2949d60e01b815260040160405180910390fd5b600101612520565b5060005b61268660a0840184614c17565b905081101561276e57600e840160006126a260a0860186614c17565b848181106126b2576126b2614a3c565b905060e0020160200160208101906126ca91906142e1565b6001600160401b0316815260208101919091526040016000205460ff1615806127485750600e8401600061270160a0860186614c17565b8481811061271157612711614a3c565b905060e00201604001602081019061272991906142e1565b6001600160401b0316815260208101919091526040016000205460ff16155b15612766576040516305a1a5df60e01b815260040160405180910390fd5b600101612679565b50505050565b6000600019815b61278860608601866149f4565b90508110156127e3574661279f60608701876149f4565b838181106127af576127af614a3c565b6127c592602060609092020190810191506142e1565b6001600160401b0316036127db578091506127e3565b60010161277b565b50600019810361280657604051630232a01960e31b815260040160405180910390fd5b61281360608501856149f4565b8281811061282357612823614a3c565b905060600201602001602081019061283b91906142e1565b915043826001600160401b0316101580612865575060048501546001600160401b03908116908316105b8061288357506101006128816001600160401b03841643614bd7565b115b806128be575061289660608501856149f4565b828181106128a6576128a6614a3c565b90506060020160400135826001600160401b03164014155b156128dc57604051630232a01960e31b815260040160405180910390fd5b84546040516001626ac92560e01b03198152600481018590526001600160a01b0390911690600090829063ff9536db9060240160a060405180830381865afa15801561292c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906129509190614c8b565b9050836001600160401b031681600001516001600160401b031611156129895760405163db86711560e01b815260040160405180910390fd5b816001600160a01b0316631f618cd26040518163ffffffff1660e01b8152600401602060405180830381865afa1580156129c7573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906129eb9190614d24565b6129f68660016149e1565b1015612aa7576001600160401b0384166001600160a01b03831663ff9536db612a208860016149e1565b6040518263ffffffff1660e01b8152600401612a3e91815260200190565b60a060405180830381865afa158015612a5b573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190612a7f9190614c8b565b516001600160401b031611612aa75760405163db86711560e01b815260040160405180910390fd5b80602001516001600160801b03168660c00135141580612ad8575080604001516001600160801b03168660e0013514155b80612af5575080606001516001600160801b031686610100013514155b80612b12575080608001516001600160801b031686610120013514155b15612b305760405163db86711560e01b815260040160405180910390fd5b5050509392505050565b612b656040518060800160405280600081526020016000815260200160008152602001600081525090565b60c08301358060005b612b7b6080870187614c17565b9050811015612bf457612b916080870187614c17565b82818110612ba157612ba1614a3c565b905060e0020160a0013583612bb691906149e1565b9250612bc56080870187614c17565b82818110612bd557612bd5614a3c565b905060e0020160c0013582612bea91906149e1565b9150600101612b6e565b5060005b612c0560a0870187614c17565b9050811015612d2a5736612c1c60a0880188614c17565b83818110612c2c57612c2c614a3c565b905060e00201905060008160c001358260800135612c4a9190614bd7565b90506000818360a0013510612c5f5781612c65565b8260a001355b9050612c7181876149e1565b9550612c7d82866149e1565b94508187604001818151612c9191906149e1565b905250612ca460808401606085016142e1565b6001600160401b0316612cbd60608b0160408c016142e1565b6001600160401b0316118015612d04575087612cdf60808501606086016142e1565b612cef60608c0160408d016142e1565b612cf99190614d3d565b6001600160401b0316115b15612d1f578187606001818151612d1b91906149e1565b9052505b505050600101612bf8565b506000612d4061010087013560e08801356149e1565b905080831015612d6357604051632a9ffab760e21b815260040160405180910390fd5b612d6d8184614bd7565b8452612d798183614bd7565b60208501525091949350505050565b6000806000612d978686613cdd565b9150915081600003612dbc57838181612db257612db2614987565b0492505050611c5a565b818411612dd357612dd36003851502601118613cfb565b6000848688096000868103871696879004966002600389028118808a02820302808a02820302808a02820302808a02820302808a02820302808a02909103029181900381900460010185841190960395909502919093039390930492909217029150509392505050565b60118301546000906060906001600160801b031682612e5c8646613d0d565b90506000610100870135612e7460e0890135886149e1565b612e7e91906149e1565b90506000612e958285670de0b6b3a7640000612d88565b9050612ea460608901896149f4565b90506001600160401b03811115612ebd57612ebd6148c2565b604051908082528060200260200182016040528015612ee6578160200160208202803683370190505b50945060005b612ef960608a018a6149f4565b9050811015612f7b578415801590612f29575081848281518110612f1f57612f1f614a3c565b6020026020010151115b868281518110612f3b57612f3b614a3c565b602002602001019015159081151581525050858181518110612f5f57612f5f614a3c565b602002602001015115612f73576008871796505b600101612eec565b5050505050935093915050565b6000612fbe8560a001516001600160801b0316670de0b6b3a7640000612fae9190614bd7565b8390670de0b6b3a7640000612d88565b831015612fc9576001175b8460e001516001600160801b031684606001511115612fe6576002175b60c08501518451613008916001600160801b0316670de0b6b3a7640000612d88565b84604001511115613017576004175b949350505050565b6000816040516020016130329190614f9f565b604051602081830303815290604052805190602001209050919050565b600061305d84600901613eb7565b61306984600b01613eb7565b8183106130ff576000613093670de0b6b3a764000084600161308b8289614bd7565b929190613f74565b600a8601549091506001600160801b03168111156130b5576000915050611c5a565b600a850180548291906000906130d59084906001600160801b03166150a7565b92506101000a8154816001600160801b0302191690836001600160801b0316021790555050613182565b600061311a670de0b6b3a764000084600161308b8883614bd7565b600c8601549091506001600160801b031681111561313c576000915050611c5a565b600c8501805482919060009061315c9084906001600160801b03166150a7565b92506101000a8154816001600160801b0302191690836001600160801b03160217905550505b5060019392505050565b6001600160401b0380871660009081526010890160205260409020805485518316600160801b0267ffffffffffffffff60801b19428516600160401b026001600160801b0319909316948a1694909417919091179283168117825590918691839160ff60c01b1990911668ffffffffffffffffff60801b1990911617600160c01b83600381111561321f5761321f614509565b02179055506020840151815460ff909116600160c81b0260ff60c81b1990911617815561324b83613fc1565b6001820180546001600160801b0319166001600160801b039290921691909117905561327682613fc1565b6001820180546001600160801b03928316600160801b02921691909117905560c0840151516132a490613fc1565b6002820180546001600160801b0319166001600160801b039290921691909117905560c0840151602001516132d890613fc1565b6002820180546001600160801b03928316600160801b02921691909117905560a084015160038201819055602080860151865160c088015180519301516040516001600160401b038d16957fefc967d026ee8c5f9f26fb04fc2d13f229a95961be704383e2ba4df65daa45339561335e958d9590948f9491938d938d9390929190614afa565b60405180910390a25050505050505050565b60008060008460c001516000015190506000806133938984896040015189613ffd565b60048b0180546fffffffffffffffff00000000000000001916600160401b426001600160401b031602179055909250905060006133d082846149e1565b9050806000036133f157876040015188606001519550955050505050613570565b6000613475826134018188614bd7565b8d54604080516318160ddd60e01b815290516001600160a01b03909216916318160ddd916004808201926020929091908290030181865afa15801561344a573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061346e9190614d24565b9190612d88565b905080156134e7578a5460028c0154604051634a3a418d60e01b81526001600160a01b03918216600482015260248101849052911690634a3a418d90604401600060405180830381600087803b1580156134ce57600080fd5b505af11580156134e2573d6000803e3d6000fd5b505050505b6135006134f48387614bd7565b60408b01519087612d88565b965061351b61350f8387614bd7565b60608b01519087612d88565b60408051868152602081018690529081018390529096506001600160401b038b16907f8eeb3b7a5bc4e75e96038f3d470f47319f01707f9c748070b95312b41493705b9060600160405180910390a250505050505b94509492505050565b6003810154600160a01b90046001600160401b0316600090815260108201602052604081206004830154600160801b900460ff161580156135c657506004830154600160881b900460ff16155b80156135fc5750600683015481546001600160401b03600160801b9092048216916135f991600160401b90041642614bd7565b11155b8015611c5a575054600160c81b90046006161592915050565b6001600160a01b03811661363c576040516306b7c75960e31b815260040160405180910390fd5b80613645611d53565b60010180546001600160a01b0319166001600160a01b03928316179055604051908216907fc046b9e8f0cd9b70a3b838962e9c229277fbb7abee68ea0fad4acf2898ed2ca990600090a250565b60208101516001600160401b031615806136b7575060408101516001600160401b0316155b806136cd575060608101516001600160401b0316155b806136ed5750670de0b6b3a76400008160a001516001600160801b031610155b8061370c5750670de0b6b3a76400008160c001516001600160801b0316115b1561372a576040516306b7c75960e31b815260040160405180910390fd5b80613733611d53565b8151600682018054602085015160408087015160608801516001600160401b03908116600160c01b026001600160c01b03928216600160801b908102939093166001600160801b03958316600160401b026001600160801b031990971692909816919091179490941783169590951792909217909255608085015160a08601518316840290831617600785015560c085015160e0909501518216909202931692909217600890910155517fab65963e67b4b8f99f18d86581744215e7333d81fd48e4f2eef67ad7772b835f90610aa7908390614440565b7f269ca335d49f0b8bbf3a5a2cc9876243b5841edd3dfc837ebccdab385b0bb30061383583836110c9565b1561073f576000838152602082815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a4505050565b6000807ff0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a0061110f565b6138c261411d565b61138081614144565b6001600160a01b0381166138f2576040516306b7c75960e31b815260040160405180910390fd5b806138fb611d53565b60020180546001600160a01b0319166001600160a01b03928316179055604051908216907f7dae230f18360d76a040c81f050aa14eb9d6dc7901b20fc5d855e2a20fe814d190600090a250565b6000613952611d53565b90506000805b600d8301548110156139cd57600083600e01600085600d01848154811061398157613981614a3c565b6000918252602080832060048304015460039092166008026101000a9091046001600160401b031683528201929092526040019020805460ff1916911515919091179055600101613958565b5060005b83811015613b0957600081118015613a51575084846139f1600184614bd7565b818110613a0057613a00614a3c565b9050602002016020810190613a1591906142e1565b6001600160401b0316858583818110613a3057613a30614a3c565b9050602002016020810190613a4591906142e1565b6001600160401b031611155b15613a6f576040516306b7c75960e31b815260040160405180910390fd5b46858583818110613a8257613a82614a3c565b9050602002016020810190613a9791906142e1565b6001600160401b031603613aaa57600191505b600183600e016000878785818110613ac457613ac4614a3c565b9050602002016020810190613ad991906142e1565b6001600160401b031681526020810191909152604001600020805460ff19169115159190911790556001016139d1565b5080613b28576040516306b7c75960e31b815260040160405180910390fd5b600d8201613b3784868361516e565b507fd9c64d96bf7fd3b14da1d5284e6cedc3a9a9dab5181bb626dc54bed63b0d9ca98484604051613b69929190615246565b60405180910390a150505050565b6000613b8660208301836142e1565b6001600160401b0316613b9c60208501856142e1565b6001600160401b031614613bde57613bb760208301836142e1565b6001600160401b0316613bcd60208501856142e1565b6001600160401b031611905061110f565b613bee604083016020840161439e565b6001600160a01b0316613c07604085016020860161439e565b6001600160a01b031614613c4f57613c25604083016020840161439e565b6001600160a01b0316613c3e604085016020860161439e565b6001600160a01b031611905061110f565b613c5f606083016040840161439e565b6001600160a01b0316613c78606085016040860161439e565b6001600160a01b031614613caf57613c96606083016040840161439e565b6001600160a01b0316613c3e606085016040860161439e565b613cbf6080830160608401614c70565b60ff16613cd26080850160608601614c70565b60ff16119392505050565b60008060001983850993909202808410938190039390930393915050565b634e487b71600052806020526024601cfd5b6060613d1b838201846149f4565b90506001600160401b03811115613d3457613d346148c2565b604051908082528060200260200182016040528015613d5d578160200160208202803683370190505b5090506000805b613d7160608601866149f4565b9050811015613eaf576000613d8960608701876149f4565b83818110613d9957613d99614a3c565b613daf92602060609092020190810191506142e1565b90506000856001600160401b0316826001600160401b031614613dd3576000613dd9565b8660c001355b90505b613de96080880188614c17565b905084108015613e3c57506001600160401b038216613e0b6080890189614c17565b86818110613e1b57613e1b614a3c565b613e3192602060e09092020190810191506142e1565b6001600160401b0316145b15613e8757613e4e6080880188614c17565b85818110613e5e57613e5e614a3c565b905060e0020160a0013581613e7391906149e1565b905083613e7f81615293565b945050613ddc565b80858481518110613e9a57613e9a614a3c565b60209081029190910101525050600101613d64565b505092915050565b6001810154600090613ed990600160801b90046001600160401b031642614bd7565b8254909150600090613efb90600160801b90046001600160801b0316836150c6565b6001840154613f1391906001600160801b03166149e1565b83549091506001600160801b03168111613f2d5780613f39565b82546001600160801b03165b60019390930180546001600160801b039094166001600160c01b031990941693909317600160801b426001600160401b031602179092555050565b6000613fa3613f8283614157565b8015613f9e575060008480613f9957613f99614987565b868809115b151590565b613fae868686612d88565b613fb891906149e1565b95945050505050565b60006001600160801b03821115613ff9576040516306dfcc6560e41b8152608060048201526024810183905260440160405180910390fd5b5090565b60048401546000908190819061402390600160401b90046001600160401b031642614bd7565b60028801549091506140689061404a908390600160a01b90046001600160601b03166150c6565b614060670de0b6b3a76400006301e133806150c6565b889190612d88565b925085831061407f5761407c600187614bd7565b92505b6005870154600061409b614093868a614bd7565b88908a612d88565b60038a01549091506001600160601b0316158015906140b957508181115b156141115760038901546140e6906001600160601b0316670de0b6b3a764000061346e8982828888614bd7565b9350876140f385876149e1565b10614111576001614104868a614bd7565b61410e9190614bd7565b93505b50505094509492505050565b614125614184565b61414257604051631afcd79f60e31b815260040160405180910390fd5b565b61414c61411d565b611380600082611f46565b6000600282600381111561416d5761416d614509565b61417791906152ac565b60ff166001149050919050565b600061418e613891565b54600160401b900460ff16919050565b60405180610100016040528060006001600160401b03168152602001600060ff1681526020016000815260200160008152602001600081526020016000801916815260200161420e6040518060800160405280600081526020016000815260200160008152602001600081525090565b8152602001606081525090565b6040805161014081018252600080825260208201819052918101829052906060820190815260006020820181905260408201819052606082018190526080820181905260a0820181905260c09091015290565b60006080828403121561428057600080fd5b50919050565b600080610100838503121561429a57600080fd5b6142a4848461426e565b91506142b3846080850161426e565b90509250929050565b6001600160401b038116811461138057600080fd5b80356142dc816142bc565b919050565b6000602082840312156142f357600080fd5b8135611c5a816142bc565b80356001600160a01b03811681146142dc57600080fd5b6000806040838503121561432857600080fd5b823591506142b3602084016142fe565b6001600160801b0381511682526001600160801b0360208201511660208301526001600160801b0360408201511660408301526001600160401b0360608201511660608301525050565b61010081016143918285614338565b611c5a6080830184614338565b6000602082840312156143b057600080fd5b611c5a826142fe565b6001600160801b038116811461138057600080fd5b80356142dc816143b9565b6000602082840312156143eb57600080fd5b8135611c5a816143b9565b6000806040838503121561440957600080fd5b82356001600160401b0381111561441f57600080fd5b8301610140818603121561443257600080fd5b946020939093013593505050565b6000610100820190506001600160401b0383511682526001600160401b0360208401511660208301526001600160401b036040840151166040830152606083015161449660608401826001600160401b03169052565b5060808301516144b160808401826001600160801b03169052565b5060a08301516144cc60a08401826001600160801b03169052565b5060c08301516144e760c08401826001600160801b03169052565b5060e083015161450260e08401826001600160801b03169052565b5092915050565b634e487b7160e01b600052602160045260246000fd5b6004811061453d57634e487b7160e01b600052602160045260246000fd5b9052565b80516001600160401b03168252602081015161456860208401826001600160401b03169052565b50604081015161458360408401826001600160401b03169052565b506060810151614596606084018261451f565b5060808101516145ab608084018260ff169052565b5060a08101516145c660a08401826001600160801b03169052565b5060c08101516145e160c08401826001600160801b03169052565b5060e08101516145fc60e08401826001600160801b03169052565b506101008101516146196101008401826001600160801b03169052565b5061012090810151910152565b6001600160401b03831681526101608101611c5a6020830184614541565b610140810161110f8284614541565b6000610100828403121561428057600080fd5b6000610100828403121561467957600080fd5b611c5a8383614653565b60008083601f84011261469557600080fd5b5081356001600160401b038111156146ac57600080fd5b6020830191508360208260051b85010111156146c757600080fd5b9250929050565b600080600080600080600080610280898b0312156146eb57600080fd5b6146f4896142fe565b975061470260208a016142fe565b965061471060408a016142fe565b955060608901356001600160401b0381111561472b57600080fd5b6147378b828c01614683565b909650945061474b90508a60808b01614653565b925061475b8a6101808b0161426e565b915061476b8a6102008b0161426e565b90509295985092959890939650565b80356001600160601b03811681146142dc57600080fd5b600080604083850312156147a457600080fd5b6147ad8361477a565b91506142b36020840161477a565b6000806000606084860312156147d057600080fd5b83356147db816142bc565b92506147e9602085016142fe565b9150604084013580151581146147fe57600080fd5b809150509250925092565b6000806040838503121561481c57600080fd5b8235614827816142bc565b91506142b3602084016142fe565b602080825282518282018190526000918401906040840190835b818110156148765783516001600160401b031683526020938401939092019160010161484f565b509095945050505050565b6000806020838503121561489457600080fd5b82356001600160401b038111156148aa57600080fd5b6148b685828601614683565b90969095509350505050565b634e487b7160e01b600052604160045260246000fd5b60405161010081016001600160401b03811182821017156148fb576148fb6148c2565b60405290565b6000608082840312801561491457600080fd5b50604051608081016001600160401b0381118282101715614937576149376148c2565b6040528235614945816143b9565b81526020830135614955816143b9565b60208201526040830135614968816143b9565b6040820152606083013561497b816142bc565b60608201529392505050565b634e487b7160e01b600052601260045260246000fd5b634e487b7160e01b600052601160045260246000fd5b60006001600160801b038316806149cc576149cc614987565b806001600160801b0384160491505092915050565b8082018082111561110f5761110f61499d565b6000808335601e19843603018112614a0b57600080fd5b8301803591506001600160401b03821115614a2557600080fd5b60200191506060810236038213156146c757600080fd5b634e487b7160e01b600052603260045260246000fd5b6000610100828403128015614a6657600080fd5b50614a6f6148d8565b8235614a7a816142bc565b8152614a88602084016142d1565b6020820152614a99604084016142d1565b6040820152614aaa606084016142d1565b6060820152614abb608084016143ce565b6080820152614acc60a084016143ce565b60a0820152614add60c084016143ce565b60c0820152614aee60e084016143ce565b60e08201529392505050565b6101208101614b09828c61451f565b60ff9990991660208201526001600160401b039788166040820152959096166060860152608085019390935260a084019190915260c083015260e08201526101000152919050565b82546001600160801b038082168352608091821c60208401526001808601548083166040860152831c6001600160401b039081166060860152855480841685870152841c60a08601529085015491821660c0850152911c1660e08201526101008101611c5a565b6001600160401b03818116838216019081111561110f5761110f61499d565b8181038181111561110f5761110f61499d565b803561ffff811681146142dc57600080fd5b600060208284031215614c0e57600080fd5b611c5a82614bea565b6000808335601e19843603018112614c2e57600080fd5b8301803591506001600160401b03821115614c4857600080fd5b602001915060e0810236038213156146c757600080fd5b803560ff811681146142dc57600080fd5b600060208284031215614c8257600080fd5b611c5a82614c5f565b600060a0828403128015614c9e57600080fd5b5060405160a081016001600160401b0381118282101715614cc157614cc16148c2565b6040528251614ccf816142bc565b81526020830151614cdf816143b9565b60208201526040830151614cf2816143b9565b60408201526060830151614d05816143b9565b60608201526080830151614d18816143b9565b60808201529392505050565b600060208284031215614d3657600080fd5b5051919050565b6001600160401b03828116828216039081111561110f5761110f61499d565b6000808335601e19843603018112614d7357600080fd5b83016020810192503590506001600160401b03811115614d9257600080fd5b6060810236038213156146c757600080fd5b81835260208301925060008160005b84811015614e09578135614dc6816142bc565b6001600160401b031686526020820135614ddf816142bc565b6001600160401b031660208701526040828101359087015260609586019590910190600101614db3565b5093949350505050565b6000808335601e19843603018112614e2a57600080fd5b83016020810192503590506001600160401b03811115614e4957600080fd5b60e0810236038213156146c757600080fd5b81835260208301925060008160005b84811015614e09578135614e7d816142bc565b6001600160401b031686526001600160a01b03614e9c602084016142fe565b1660208701526001600160a01b03614eb6604084016142fe565b16604087015260ff614eca60608401614c5f565b1660608701526080828101359087015260a0808301359087015260c0808301359087015260e09586019590910190600101614e6a565b81835260208301925060008160005b84811015614e0957813586526020820135614f29816142bc565b6001600160401b031660208701526040820135614f45816142bc565b6001600160401b031660408701526060820135614f61816142bc565b6001600160401b031660608701526080828101359087015260a0808301359087015260c0808301359087015260e09586019590910190600101614f0f565b60208152614fbb60208201614fb384614bea565b61ffff169052565b6000614fc9602084016142d1565b6001600160401b038116604084015250614fe5604084016142d1565b6001600160401b0381166060840152506150026060840184614d5c565b610140608085015261501961016085018284614da4565b9150506150296080850185614e13565b848303601f190160a0860152615040838284614e5b565b9250505061505160a0850185614e13565b848303601f190160c0860152615068838284614f00565b60c087013560e0878101919091528701356101008088019190915287013561012080880191909152909601356101409095019490945250929392505050565b6001600160801b03828116828216039081111561110f5761110f61499d565b808202811582820484141761110f5761110f61499d565b600160401b8211156150f1576150f16148c2565b80548282558083101561073f576003830160021c826000528060206000200160188560031b16801561513457600019820180546000198360200360031b1c168155505b50816003840160021c03915060005b8281101561515957600082820155600101615143565b505050505050565b6000813561110f816142bc565b6001600160401b03831115615185576151856148c2565b61518f83826150dd565b60008181526020902082908460021c60005b818110156151fd576000805b60048110156151f0576151df6151c287615161565b6001600160401b03908116600684901b90811b91901b1984161790565b6020969096019591506001016151ad565b50838201556001016151a1565b50600319861680870381881461523c576000805b82811015615236576152256151c288615161565b602097909701969150600101615211565b50848401555b5050505050505050565b6020808252810182905260008360408301825b8581101561528957823561526c816142bc565b6001600160401b0316825260209283019290910190600101615259565b5095945050505050565b6000600182016152a5576152a561499d565b5060010190565b600060ff8316806152bf576152bf614987565b8060ff8416069150509291505056fea264697066735822122063dc08e22ee70037b331b79eec652356d7d2e73dfa1466f74ab403759e98d84464736f6c63430008210033";
var isSuperArgs13 = (xs) => xs.length > 1;
var TickAccountant__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs13(args)) {
      super(...args);
    } else {
      super(_abi18, _bytecode13, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi18);
  }
  static connect(address, runner) {
    return new Contract(address, _abi18, runner);
  }
};
TickAccountant__factory.bytecode = _bytecode13;
TickAccountant__factory.abi = _abi18;

// libs/typechain/src/factories/Timelock__factory.ts
var _abi19 = [
  {
    inputs: [
      {
        internalType: "address",
        name: "owner_",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "delay_",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "AddressEmptyCode",
    type: "error"
  },
  {
    inputs: [],
    name: "AlreadyQueued",
    type: "error"
  },
  {
    inputs: [],
    name: "Expired",
    type: "error"
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "InsufficientBalance",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidDelay",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidTimestamp",
    type: "error"
  },
  {
    inputs: [],
    name: "NotQueued",
    type: "error"
  },
  {
    inputs: [],
    name: "OnlySelf",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "OwnableInvalidOwner",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error"
  },
  {
    inputs: [],
    name: "StillLocked",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "txId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "Cancelled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "delay",
        type: "uint256"
      }
    ],
    name: "DelayUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "txId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "Executed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferStarted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "txId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "Queued",
    type: "event"
  },
  {
    inputs: [],
    name: "GRACE_PERIOD",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAX_DELAY",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MIN_DELAY",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "cancel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "execute",
    outputs: [
      {
        internalType: "bytes",
        name: "returnData",
        type: "bytes"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "getDelay",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "txId",
        type: "bytes32"
      }
    ],
    name: "getQueued",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256"
      }
    ],
    name: "queue",
    outputs: [
      {
        internalType: "bytes32",
        name: "txId",
        type: "bytes32"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "delay",
        type: "uint256"
      }
    ],
    name: "setDelay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];
var _bytecode14 = "0x608060405234801561001057600080fd5b50604051610cef380380610cef83398101604081905261002f9161014f565b816001600160a01b03811661005e57604051631e4fbdf760e01b81526000600482015260240160405180910390fd5b61006781610078565b5061007181610094565b5050610189565b600180546001600160a01b0319169055610091816100ff565b50565b6107088110806100a6575062278d0081115b156100c4576040516327df2edd60e11b815260040160405180910390fd5b60038190556040518181527f7ed9288af3fe7320be9af1fcb6714d780e3ffd1a17c1a395594978fd6741ddcb9060200160405180910390a150565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6000806040838503121561016257600080fd5b82516001600160a01b038116811461017957600080fd5b6020939093015192949293505050565b610b57806101986000396000f3fe6080604052600436106100e15760003560e01c8063aa76bfc51161007f578063e177246e11610059578063e177246e14610237578063e30c397814610257578063f2fde38b14610275578063fc83e7db1461029557600080fd5b8063aa76bfc5146101eb578063c1a287e21461020b578063cebc9a821461022257600080fd5b806374420f4c116100bb57806374420f4c1461016e57806379ba50971461018e5780638da5cb5b146101a35780639f81aed7146101d557600080fd5b80630f3a9284146100ed5780634125ff9014610132578063715018a61461015757600080fd5b366100e857005b600080fd5b3480156100f957600080fd5b5061011d610108366004610917565b60009081526002602052604090205460ff1690565b60405190151581526020015b60405180910390f35b34801561013e57600080fd5b5061014962278d0081565b604051908152602001610129565b34801561016357600080fd5b5061016c6102b5565b005b61018161017c36600461094c565b6102c9565b6040516101299190610a02565b34801561019a57600080fd5b5061016c61042f565b3480156101af57600080fd5b506000546001600160a01b03165b6040516001600160a01b039091168152602001610129565b3480156101e157600080fd5b5061014961070881565b3480156101f757600080fd5b5061014961020636600461094c565b610478565b34801561021757600080fd5b506101496212750081565b34801561022e57600080fd5b50600354610149565b34801561024357600080fd5b5061016c610252366004610917565b61057e565b34801561026357600080fd5b506001546001600160a01b03166101bd565b34801561028157600080fd5b5061016c610290366004610a35565b6105a7565b3480156102a157600080fd5b5061016c6102b036600461094c565b610618565b6102bd6106ec565b6102c76000610719565b565b60606102d36106ec565b600086868686866040516020016102ee959493929190610a79565b60408051601f1981840301815291815281516020928301206000818152600290935291205490915060ff166103365760405163ccbc0d7160e01b815260040160405180910390fd5b8242101561035757604051636100d92960e11b815260040160405180910390fd5b6103646212750084610ab3565b42111561038457604051630407b05b60e31b815260040160405180910390fd5b600081815260026020908152604091829020805460ff191690558151601f87018290048202810182019092528582526103db91899188908890819084018382808284376000920191909152508b9250610732915050565b9150866001600160a01b0316817fbc76564aec85e3f50672da2d1ddca0390851fecefe61cd19d89dea91a82678298888888860405161041d9493929190610ada565b60405180910390a35095945050505050565b60015433906001600160a01b0316811461046c5760405163118cdaa760e01b81526001600160a01b03821660048201526024015b60405180910390fd5b61047581610719565b50565b60006104826106ec565b60035461048f9042610ab3565b8210156104af5760405163b7d0949760e01b815260040160405180910390fd5b85858585856040516020016104c8959493929190610a79565b60408051601f1981840301815291815281516020928301206000818152600290935291205490915060ff161561051157604051632fc2a3e160e11b815260040160405180910390fd5b60008181526002602052604090819020805460ff19166001179055516001600160a01b0387169082907f8d6fedd41517ab865c3658696c50923b3493c8a93ffd016d919a599f03c7531b9061056d908990899089908990610ada565b60405180910390a395945050505050565b33301461059e5760405163029a949d60e31b815260040160405180910390fd5b610475816107d8565b6105af6106ec565b600180546001600160a01b0383166001600160a01b031990911681179091556105e06000546001600160a01b031690565b6001600160a01b03167f38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e2270060405160405180910390a350565b6106206106ec565b6000858585858560405160200161063b959493929190610a79565b60408051601f1981840301815291815281516020928301206000818152600290935291205490915060ff166106835760405163ccbc0d7160e01b815260040160405180910390fd5b60008181526002602052604090819020805460ff19169055516001600160a01b0387169082907f13bab63395711ddfbcfcad2895395748af5821e5696a0c57286cf7063f605d50906106dc908990899089908990610ada565b60405180910390a3505050505050565b6000546001600160a01b031633146102c75760405163118cdaa760e01b8152336004820152602401610463565b600180546001600160a01b031916905561047581610843565b60608147101561075e5760405163cf47918160e01b815247600482015260248101839052604401610463565b600080856001600160a01b0316848660405161077a9190610b05565b60006040518083038185875af1925050503d80600081146107b7576040519150601f19603f3d011682016040523d82523d6000602084013e6107bc565b606091505b50915091506107cc868383610893565b925050505b9392505050565b6107088110806107ea575062278d0081115b15610808576040516327df2edd60e11b815260040160405180910390fd5b60038190556040518181527f7ed9288af3fe7320be9af1fcb6714d780e3ffd1a17c1a395594978fd6741ddcb9060200160405180910390a150565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6060826108a8576108a3826108ef565b6107d1565b81511580156108bf57506001600160a01b0384163b155b156108e857604051639996b31560e01b81526001600160a01b0385166004820152602401610463565b50806107d1565b8051156108fe57805160208201fd5b60405163d6bda27560e01b815260040160405180910390fd5b60006020828403121561092957600080fd5b5035919050565b80356001600160a01b038116811461094757600080fd5b919050565b60008060008060006080868803121561096457600080fd5b61096d86610930565b945060208601359350604086013567ffffffffffffffff81111561099057600080fd5b8601601f810188136109a157600080fd5b803567ffffffffffffffff8111156109b857600080fd5b8860208284010111156109ca57600080fd5b959894975060200195606001359392505050565b60005b838110156109f95781810151838201526020016109e1565b50506000910152565b6020815260008251806020840152610a218160408501602087016109de565b601f01601f19169190910160400192915050565b600060208284031215610a4757600080fd5b6107d182610930565b81835281816020850137506000828201602090810191909152601f909101601f19169091010190565b60018060a01b0386168152846020820152608060408201526000610aa1608083018587610a50565b90508260608301529695505050505050565b80820180821115610ad457634e487b7160e01b600052601160045260246000fd5b92915050565b848152606060208201526000610af4606083018587610a50565b905082604083015295945050505050565b60008251610b178184602087016109de565b919091019291505056fea26469706673582212204a11df918d70f8d043a155bc2fc090d40cd5fc0686a7c2a8b75ef992aa05229f64736f6c63430008210033";
var isSuperArgs14 = (xs) => xs.length > 1;
var Timelock__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs14(args)) {
      super(...args);
    } else {
      super(_abi19, _bytecode14, args[0]);
    }
  }
  getDeployTransaction(owner_, delay_, overrides) {
    return super.getDeployTransaction(owner_, delay_, overrides || {});
  }
  deploy(owner_, delay_, overrides) {
    return super.deploy(owner_, delay_, overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi19);
  }
  static connect(address, runner) {
    return new Contract(address, _abi19, runner);
  }
};
Timelock__factory.bytecode = _bytecode14;
Timelock__factory.abi = _abi19;

// libs/typechain/src/factories/Vault__factory.ts
var _abi20 = [
  {
    inputs: [],
    name: "AccessManager__CallerIsNotAdmin",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotExecutor",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotOperator",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotRootUpdater",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "AddressEmptyCode",
    type: "error"
  },
  {
    inputs: [],
    name: "ECDSAInvalidSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "length",
        type: "uint256"
      }
    ],
    name: "ECDSAInvalidSignatureLength",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "ECDSAInvalidSignatureS",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "allowance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientAllowance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "needed",
        type: "uint256"
      }
    ],
    name: "ERC20InsufficientBalance",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "approver",
        type: "address"
      }
    ],
    name: "ERC20InvalidApprover",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "ERC20InvalidReceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "ERC20InvalidSpender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      }
    ],
    name: "ERC2612ExpiredSignature",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "signer",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "ERC2612InvalidSigner",
    type: "error"
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "currentNonce",
        type: "uint256"
      }
    ],
    name: "InvalidAccountNonce",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidShortString",
    type: "error"
  },
  {
    inputs: [],
    name: "PausableActions__ActionNotPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "PausableActions__ActionPaused",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      }
    ],
    name: "SafeERC20FailedOperation",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "str",
        type: "string"
      }
    ],
    name: "StringTooLong",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__AddressZero",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__DepositLessThanMin",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__InvalidInput",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__SetupAlreadyCompleted",
    type: "error"
  },
  {
    inputs: [],
    name: "Vault__Unauthorized",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider",
        name: "activeProvider",
        type: "address"
      }
    ],
    name: "ActiveProviderUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Deposit",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "rewardsDistributor",
        type: "address"
      }
    ],
    name: "DistributorUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "EIP712DomainChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      }
    ],
    name: "FeeCharged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "minAmount",
        type: "uint256"
      }
    ],
    name: "MinAmountUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "ProvidersUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsFrom",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assetsTo",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      }
    ],
    name: "RebalanceExecuted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "RewardsTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "setupAddress",
        type: "address"
      }
    ],
    name: "SetupCompleted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "timelock",
        type: "address"
      }
    ],
    name: "TimelockUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "treasury",
        type: "address"
      }
    ],
    name: "TreasuryUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "Unpaused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "Withdraw",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "withdrawFeePercent",
        type: "uint256"
      }
    ],
    name: "WithdrawFeePercentUpdated",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "OPERATOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ROOT_UPDATER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "activeProvider",
    outputs: [
      {
        internalType: "contract IProvider",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "asset",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "convertToAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "convertToShares",
    outputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {
        internalType: "bytes1",
        name: "fields",
        type: "bytes1"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "version",
        type: "string"
      },
      {
        internalType: "uint256",
        name: "chainId",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "verifyingContract",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "extensions",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "getBalanceOfAsset",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getProviders",
    outputs: [
      {
        internalType: "contract IProvider[]",
        name: "",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "maxMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "maxWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "minAmount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      }
    ],
    name: "mint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "spender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256"
      },
      {
        internalType: "uint8",
        name: "v",
        type: "uint8"
      },
      {
        internalType: "bytes32",
        name: "r",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32"
      }
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewMint",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      }
    ],
    name: "previewRedeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "previewWithdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "contract IProvider",
        name: "from",
        type: "address"
      },
      {
        internalType: "contract IProvider",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      },
      {
        internalType: "bool",
        name: "activateToProvider",
        type: "bool"
      }
    ],
    name: "rebalance",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "redeem",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider",
        name: "_activeProvider",
        type: "address"
      }
    ],
    name: "setActiveProvider",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_minAmount",
        type: "uint256"
      }
    ],
    name: "setMinAmount",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IProvider[]",
        name: "providers",
        type: "address[]"
      }
    ],
    name: "setProviders",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_timelock",
        type: "address"
      }
    ],
    name: "setTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_treasury",
        type: "address"
      }
    ],
    name: "setTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_withdrawFeePercent",
        type: "uint256"
      }
    ],
    name: "setWithdrawFeePercent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "setupCompleted",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    name: "setupVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "timelock",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalAssets",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "treasury",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum PausableActions.Actions",
        name: "action",
        type: "uint8"
      }
    ],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "withdrawFeePercent",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
];
var Vault__factory = class {
  static createInterface() {
    return new Interface(_abi20);
  }
  static connect(address, runner) {
    return new Contract(address, _abi20, runner);
  }
};
Vault__factory.abi = _abi20;

// libs/typechain/src/factories/VaultManager__factory.ts
var _abi21 = [
  {
    inputs: [],
    name: "AccessManager__CallerIsNotAdmin",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotExecutor",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotOperator",
    type: "error"
  },
  {
    inputs: [],
    name: "AccessManager__CallerIsNotRootUpdater",
    type: "error"
  },
  {
    inputs: [],
    name: "VaultManager__InvalidAssetAmount",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    inputs: [],
    name: "ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EXECUTOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "OPERATOR_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ROOT_UPDATER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "contract IVault",
        name: "vault",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256"
      },
      {
        internalType: "contract IProvider",
        name: "from",
        type: "address"
      },
      {
        internalType: "contract IProvider",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      },
      {
        internalType: "bool",
        name: "activateToProvider",
        type: "bool"
      }
    ],
    name: "rebalanceVault",
    outputs: [
      {
        internalType: "bool",
        name: "success",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
var _bytecode15 = "0x608060405234801561001057600080fd5b5061001c600033610021565b6100c0565b6000828152602081815260408083206001600160a01b038516845290915290205460ff166100bc576000828152602081815260408083206001600160a01b03851684529091529020805460ff1916600117905561007b3390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45b5050565b6105a9806100cf6000396000f3fe608060405234801561001057600080fd5b50600436106100785760003560e01c806307bd02651461007d578063190e2863146100a55780632f2ff15d146100c857806375b238fc146100dd57806391d14854146100e5578063d547741f146100f8578063d9ab2c5c1461010b578063f5b541a614610131575b600080fd5b61009260008051602061055483398151915281565b6040519081526020015b60405180910390f35b6100b86100b3366004610476565b610158565b604051901515815260200161009c565b6100db6100d63660046104e6565b6102d6565b005b610092600081565b6100b86100f33660046104e6565b61030c565b6100db6101063660046104e6565b610335565b6100927e9ab23a1010d07a0450a1fbea1d84169b57d2c2273b54bff0f20c3e90199b5d81565b6100927f97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b92981565b60006101726000805160206105548339815191523361030c565b61018f57604051633f9135d360e01b815260040160405180910390fd5b6040516302b844a960e21b81526001600160a01b0388811660048301819052602483015260009190871690630ae112a490604401602060405180830381865afa1580156101e0573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102049190610516565b90506000198703610213578096505b86158061021f57508087115b1561023d5760405163ee9052f960e01b815260040160405180910390fd5b604051637abac32960e01b8152600481018890526001600160a01b0387811660248301528681166044830152606482018690528415156084830152891690637abac3299060a4016020604051808303816000875af11580156102a3573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102c7919061052f565b50600198975050505050505050565b6102e160003361030c565b6102fe57604051633dcaff7960e21b815260040160405180910390fd5b6103088282610367565b5050565b6000918252602082815260408084206001600160a01b0393909316845291905290205460ff1690565b61034060003361030c565b61035d57604051633dcaff7960e21b815260040160405180910390fd5b61030882826103eb565b610371828261030c565b610308576000828152602081815260408083206001600160a01b03851684529091529020805460ff191660011790556103a73390565b6001600160a01b0316816001600160a01b0316837f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45050565b6103f5828261030c565b15610308576000828152602081815260408083206001600160a01b0385168085529252808320805460ff1916905551339285917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a45050565b6001600160a01b038116811461046557600080fd5b50565b801515811461046557600080fd5b60008060008060008060c0878903121561048f57600080fd5b863561049a81610450565b95506020870135945060408701356104b181610450565b935060608701356104c181610450565b92506080870135915060a08701356104d881610468565b809150509295509295509295565b600080604083850312156104f957600080fd5b82359150602083013561050b81610450565b809150509250929050565b60006020828403121561052857600080fd5b5051919050565b60006020828403121561054157600080fd5b815161054c81610468565b939250505056fed8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63a264697066735822122012a2a3a29996836a01a4a4135ed0b6a57fe340d21121ca483b2efc40645cc93964736f6c63430008170033";
var isSuperArgs15 = (xs) => xs.length > 1;
var VaultManager__factory = class extends ContractFactory {
  constructor(...args) {
    if (isSuperArgs15(args)) {
      super(...args);
    } else {
      super(_abi21, _bytecode15, args[0]);
    }
  }
  getDeployTransaction(overrides) {
    return super.getDeployTransaction(overrides || {});
  }
  deploy(overrides) {
    return super.deploy(overrides || {});
  }
  connect(runner) {
    return super.connect(runner);
  }
  static createInterface() {
    return new Interface(_abi21);
  }
  static connect(address, runner) {
    return new Contract(address, _abi21, runner);
  }
};
VaultManager__factory.bytecode = _bytecode15;
VaultManager__factory.abi = _abi21;

// libs/library/src/allocation/rate-history.ts
var providerInterface = IProvider__factory.createInterface();

// node_modules/decimal.js/decimal.mjs
var EXP_LIMIT = 9e15;
var MAX_DIGITS = 1e9;
var NUMERALS = "0123456789abcdef";
var LN10 = "2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058";
var PI = "3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789";
var DEFAULTS = {
  // These values must be integers within the stated ranges (inclusive).
  // Most of these values can be changed at run-time using the `Decimal.config` method.
  // The maximum number of significant digits of the result of a calculation or base conversion.
  // E.g. `Decimal.config({ precision: 20 });`
  precision: 20,
  // 1 to MAX_DIGITS
  // The rounding mode used when rounding to `precision`.
  //
  // ROUND_UP         0 Away from zero.
  // ROUND_DOWN       1 Towards zero.
  // ROUND_CEIL       2 Towards +Infinity.
  // ROUND_FLOOR      3 Towards -Infinity.
  // ROUND_HALF_UP    4 Towards nearest neighbour. If equidistant, up.
  // ROUND_HALF_DOWN  5 Towards nearest neighbour. If equidistant, down.
  // ROUND_HALF_EVEN  6 Towards nearest neighbour. If equidistant, towards even neighbour.
  // ROUND_HALF_CEIL  7 Towards nearest neighbour. If equidistant, towards +Infinity.
  // ROUND_HALF_FLOOR 8 Towards nearest neighbour. If equidistant, towards -Infinity.
  //
  // E.g.
  // `Decimal.rounding = 4;`
  // `Decimal.rounding = Decimal.ROUND_HALF_UP;`
  rounding: 4,
  // 0 to 8
  // The modulo mode used when calculating the modulus: a mod n.
  // The quotient (q = a / n) is calculated according to the corresponding rounding mode.
  // The remainder (r) is calculated as: r = a - n * q.
  //
  // UP         0 The remainder is positive if the dividend is negative, else is negative.
  // DOWN       1 The remainder has the same sign as the dividend (JavaScript %).
  // FLOOR      3 The remainder has the same sign as the divisor (Python %).
  // HALF_EVEN  6 The IEEE 754 remainder function.
  // EUCLID     9 Euclidian division. q = sign(n) * floor(a / abs(n)). Always positive.
  //
  // Truncated division (1), floored division (3), the IEEE 754 remainder (6), and Euclidian
  // division (9) are commonly used for the modulus operation. The other rounding modes can also
  // be used, but they may not give useful results.
  modulo: 1,
  // 0 to 9
  // The exponent value at and beneath which `toString` returns exponential notation.
  // JavaScript numbers: -7
  toExpNeg: -7,
  // 0 to -EXP_LIMIT
  // The exponent value at and above which `toString` returns exponential notation.
  // JavaScript numbers: 21
  toExpPos: 21,
  // 0 to EXP_LIMIT
  // The minimum exponent value, beneath which underflow to zero occurs.
  // JavaScript numbers: -324  (5e-324)
  minE: -EXP_LIMIT,
  // -1 to -EXP_LIMIT
  // The maximum exponent value, above which overflow to Infinity occurs.
  // JavaScript numbers: 308  (1.7976931348623157e+308)
  maxE: EXP_LIMIT,
  // 1 to EXP_LIMIT
  // Whether to use cryptographically-secure random number generation, if available.
  crypto: false
  // true/false
};
var inexact;
var quadrant;
var external = true;
var decimalError = "[DecimalError] ";
var invalidArgument = decimalError + "Invalid argument: ";
var precisionLimitExceeded = decimalError + "Precision limit exceeded";
var cryptoUnavailable = decimalError + "crypto unavailable";
var tag = "[object Decimal]";
var mathfloor = Math.floor;
var mathpow = Math.pow;
var isBinary = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i;
var isHex = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i;
var isOctal = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i;
var isDecimal = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
var BASE = 1e7;
var LOG_BASE = 7;
var MAX_SAFE_INTEGER = 9007199254740991;
var LN10_PRECISION = LN10.length - 1;
var PI_PRECISION = PI.length - 1;
var P = { toStringTag: tag };
P.absoluteValue = P.abs = function() {
  var x = new this.constructor(this);
  if (x.s < 0)
    x.s = 1;
  return finalise(x);
};
P.ceil = function() {
  return finalise(new this.constructor(this), this.e + 1, 2);
};
P.clampedTo = P.clamp = function(min2, max2) {
  var k, x = this, Ctor = x.constructor;
  min2 = new Ctor(min2);
  max2 = new Ctor(max2);
  if (!min2.s || !max2.s)
    return new Ctor(NaN);
  if (min2.gt(max2))
    throw Error(invalidArgument + max2);
  k = x.cmp(min2);
  return k < 0 ? min2 : x.cmp(max2) > 0 ? max2 : new Ctor(x);
};
P.comparedTo = P.cmp = function(y) {
  var i, j, xdL, ydL, x = this, xd = x.d, yd = (y = new x.constructor(y)).d, xs = x.s, ys = y.s;
  if (!xd || !yd) {
    return !xs || !ys ? NaN : xs !== ys ? xs : xd === yd ? 0 : !xd ^ xs < 0 ? 1 : -1;
  }
  if (!xd[0] || !yd[0])
    return xd[0] ? xs : yd[0] ? -ys : 0;
  if (xs !== ys)
    return xs;
  if (x.e !== y.e)
    return x.e > y.e ^ xs < 0 ? 1 : -1;
  xdL = xd.length;
  ydL = yd.length;
  for (i = 0, j = xdL < ydL ? xdL : ydL; i < j; ++i) {
    if (xd[i] !== yd[i])
      return xd[i] > yd[i] ^ xs < 0 ? 1 : -1;
  }
  return xdL === ydL ? 0 : xdL > ydL ^ xs < 0 ? 1 : -1;
};
P.cosine = P.cos = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (!x.d)
    return new Ctor(NaN);
  if (!x.d[0])
    return new Ctor(1);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
  Ctor.rounding = 1;
  x = cosine(Ctor, toLessThanHalfPi(Ctor, x));
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return finalise(quadrant == 2 || quadrant == 3 ? x.neg() : x, pr, rm, true);
};
P.cubeRoot = P.cbrt = function() {
  var e, m, n2, r, rep, s, sd, t, t3, t3plusx, x = this, Ctor = x.constructor;
  if (!x.isFinite() || x.isZero())
    return new Ctor(x);
  external = false;
  s = x.s * mathpow(x.s * x, 1 / 3);
  if (!s || Math.abs(s) == 1 / 0) {
    n2 = digitsToString(x.d);
    e = x.e;
    if (s = (e - n2.length + 1) % 3)
      n2 += s == 1 || s == -2 ? "0" : "00";
    s = mathpow(n2, 1 / 3);
    e = mathfloor((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2));
    if (s == 1 / 0) {
      n2 = "5e" + e;
    } else {
      n2 = s.toExponential();
      n2 = n2.slice(0, n2.indexOf("e") + 1) + e;
    }
    r = new Ctor(n2);
    r.s = x.s;
  } else {
    r = new Ctor(s.toString());
  }
  sd = (e = Ctor.precision) + 3;
  for (; ; ) {
    t = r;
    t3 = t.times(t).times(t);
    t3plusx = t3.plus(x);
    r = divide(t3plusx.plus(x).times(t), t3plusx.plus(t3), sd + 2, 1);
    if (digitsToString(t.d).slice(0, sd) === (n2 = digitsToString(r.d)).slice(0, sd)) {
      n2 = n2.slice(sd - 3, sd + 1);
      if (n2 == "9999" || !rep && n2 == "4999") {
        if (!rep) {
          finalise(t, e + 1, 0);
          if (t.times(t).times(t).eq(x)) {
            r = t;
            break;
          }
        }
        sd += 4;
        rep = 1;
      } else {
        if (!+n2 || !+n2.slice(1) && n2.charAt(0) == "5") {
          finalise(r, e + 1, 1);
          m = !r.times(r).times(r).eq(x);
        }
        break;
      }
    }
  }
  external = true;
  return finalise(r, e, Ctor.rounding, m);
};
P.decimalPlaces = P.dp = function() {
  var w, d = this.d, n2 = NaN;
  if (d) {
    w = d.length - 1;
    n2 = (w - mathfloor(this.e / LOG_BASE)) * LOG_BASE;
    w = d[w];
    if (w)
      for (; w % 10 == 0; w /= 10)
        n2--;
    if (n2 < 0)
      n2 = 0;
  }
  return n2;
};
P.dividedBy = P.div = function(y) {
  return divide(this, new this.constructor(y));
};
P.dividedToIntegerBy = P.divToInt = function(y) {
  var x = this, Ctor = x.constructor;
  return finalise(divide(x, new Ctor(y), 0, 1, 1), Ctor.precision, Ctor.rounding);
};
P.equals = P.eq = function(y) {
  return this.cmp(y) === 0;
};
P.floor = function() {
  return finalise(new this.constructor(this), this.e + 1, 3);
};
P.greaterThan = P.gt = function(y) {
  return this.cmp(y) > 0;
};
P.greaterThanOrEqualTo = P.gte = function(y) {
  var k = this.cmp(y);
  return k == 1 || k === 0;
};
P.hyperbolicCosine = P.cosh = function() {
  var k, n2, pr, rm, len, x = this, Ctor = x.constructor, one = new Ctor(1);
  if (!x.isFinite())
    return new Ctor(x.s ? 1 / 0 : NaN);
  if (x.isZero())
    return one;
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
  Ctor.rounding = 1;
  len = x.d.length;
  if (len < 32) {
    k = Math.ceil(len / 3);
    n2 = (1 / tinyPow(4, k)).toString();
  } else {
    k = 16;
    n2 = "2.3283064365386962890625e-10";
  }
  x = taylorSeries(Ctor, 1, x.times(n2), new Ctor(1), true);
  var cosh2_x, i = k, d8 = new Ctor(8);
  for (; i--; ) {
    cosh2_x = x.times(x);
    x = one.minus(cosh2_x.times(d8.minus(cosh2_x.times(d8))));
  }
  return finalise(x, Ctor.precision = pr, Ctor.rounding = rm, true);
};
P.hyperbolicSine = P.sinh = function() {
  var k, pr, rm, len, x = this, Ctor = x.constructor;
  if (!x.isFinite() || x.isZero())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
  Ctor.rounding = 1;
  len = x.d.length;
  if (len < 3) {
    x = taylorSeries(Ctor, 2, x, x, true);
  } else {
    k = 1.4 * Math.sqrt(len);
    k = k > 16 ? 16 : k | 0;
    x = x.times(1 / tinyPow(5, k));
    x = taylorSeries(Ctor, 2, x, x, true);
    var sinh2_x, d5 = new Ctor(5), d16 = new Ctor(16), d20 = new Ctor(20);
    for (; k--; ) {
      sinh2_x = x.times(x);
      x = x.times(d5.plus(sinh2_x.times(d16.times(sinh2_x).plus(d20))));
    }
  }
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return finalise(x, pr, rm, true);
};
P.hyperbolicTangent = P.tanh = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (!x.isFinite())
    return new Ctor(x.s);
  if (x.isZero())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + 7;
  Ctor.rounding = 1;
  return divide(x.sinh(), x.cosh(), Ctor.precision = pr, Ctor.rounding = rm);
};
P.inverseCosine = P.acos = function() {
  var x = this, Ctor = x.constructor, k = x.abs().cmp(1), pr = Ctor.precision, rm = Ctor.rounding;
  if (k !== -1) {
    return k === 0 ? x.isNeg() ? getPi(Ctor, pr, rm) : new Ctor(0) : new Ctor(NaN);
  }
  if (x.isZero())
    return getPi(Ctor, pr + 4, rm).times(0.5);
  Ctor.precision = pr + 6;
  Ctor.rounding = 1;
  x = new Ctor(1).minus(x).div(x.plus(1)).sqrt().atan();
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return x.times(2);
};
P.inverseHyperbolicCosine = P.acosh = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (x.lte(1))
    return new Ctor(x.eq(1) ? 0 : NaN);
  if (!x.isFinite())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + Math.max(Math.abs(x.e), x.sd()) + 4;
  Ctor.rounding = 1;
  external = false;
  x = x.times(x).minus(1).sqrt().plus(x);
  external = true;
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return x.ln();
};
P.inverseHyperbolicSine = P.asinh = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (!x.isFinite() || x.isZero())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + 2 * Math.max(Math.abs(x.e), x.sd()) + 6;
  Ctor.rounding = 1;
  external = false;
  x = x.times(x).plus(1).sqrt().plus(x);
  external = true;
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return x.ln();
};
P.inverseHyperbolicTangent = P.atanh = function() {
  var pr, rm, wpr, xsd, x = this, Ctor = x.constructor;
  if (!x.isFinite())
    return new Ctor(NaN);
  if (x.e >= 0)
    return new Ctor(x.abs().eq(1) ? x.s / 0 : x.isZero() ? x : NaN);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  xsd = x.sd();
  if (Math.max(xsd, pr) < 2 * -x.e - 1)
    return finalise(new Ctor(x), pr, rm, true);
  Ctor.precision = wpr = xsd - x.e;
  x = divide(x.plus(1), new Ctor(1).minus(x), wpr + pr, 1);
  Ctor.precision = pr + 4;
  Ctor.rounding = 1;
  x = x.ln();
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return x.times(0.5);
};
P.inverseSine = P.asin = function() {
  var halfPi, k, pr, rm, x = this, Ctor = x.constructor;
  if (x.isZero())
    return new Ctor(x);
  k = x.abs().cmp(1);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  if (k !== -1) {
    if (k === 0) {
      halfPi = getPi(Ctor, pr + 4, rm).times(0.5);
      halfPi.s = x.s;
      return halfPi;
    }
    return new Ctor(NaN);
  }
  Ctor.precision = pr + 6;
  Ctor.rounding = 1;
  x = x.div(new Ctor(1).minus(x.times(x)).sqrt().plus(1)).atan();
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return x.times(2);
};
P.inverseTangent = P.atan = function() {
  var i, j, k, n2, px, t, r, wpr, x2, x = this, Ctor = x.constructor, pr = Ctor.precision, rm = Ctor.rounding;
  if (!x.isFinite()) {
    if (!x.s)
      return new Ctor(NaN);
    if (pr + 4 <= PI_PRECISION) {
      r = getPi(Ctor, pr + 4, rm).times(0.5);
      r.s = x.s;
      return r;
    }
  } else if (x.isZero()) {
    return new Ctor(x);
  } else if (x.abs().eq(1) && pr + 4 <= PI_PRECISION) {
    r = getPi(Ctor, pr + 4, rm).times(0.25);
    r.s = x.s;
    return r;
  }
  Ctor.precision = wpr = pr + 10;
  Ctor.rounding = 1;
  k = Math.min(28, wpr / LOG_BASE + 2 | 0);
  for (i = k; i; --i)
    x = x.div(x.times(x).plus(1).sqrt().plus(1));
  external = false;
  j = Math.ceil(wpr / LOG_BASE);
  n2 = 1;
  x2 = x.times(x);
  r = new Ctor(x);
  px = x;
  for (; i !== -1; ) {
    px = px.times(x2);
    t = r.minus(px.div(n2 += 2));
    px = px.times(x2);
    r = t.plus(px.div(n2 += 2));
    if (r.d[j] !== void 0)
      for (i = j; r.d[i] === t.d[i] && i--; )
        ;
  }
  if (k)
    r = r.times(2 << k - 1);
  external = true;
  return finalise(r, Ctor.precision = pr, Ctor.rounding = rm, true);
};
P.isFinite = function() {
  return !!this.d;
};
P.isInteger = P.isInt = function() {
  return !!this.d && mathfloor(this.e / LOG_BASE) > this.d.length - 2;
};
P.isNaN = function() {
  return !this.s;
};
P.isNegative = P.isNeg = function() {
  return this.s < 0;
};
P.isPositive = P.isPos = function() {
  return this.s > 0;
};
P.isZero = function() {
  return !!this.d && this.d[0] === 0;
};
P.lessThan = P.lt = function(y) {
  return this.cmp(y) < 0;
};
P.lessThanOrEqualTo = P.lte = function(y) {
  return this.cmp(y) < 1;
};
P.logarithm = P.log = function(base) {
  var isBase10, d, denominator, k, inf, num, sd, r, arg = this, Ctor = arg.constructor, pr = Ctor.precision, rm = Ctor.rounding, guard = 5;
  if (base == null) {
    base = new Ctor(10);
    isBase10 = true;
  } else {
    base = new Ctor(base);
    d = base.d;
    if (base.s < 0 || !d || !d[0] || base.eq(1))
      return new Ctor(NaN);
    isBase10 = base.eq(10);
  }
  d = arg.d;
  if (arg.s < 0 || !d || !d[0] || arg.eq(1)) {
    return new Ctor(d && !d[0] ? -1 / 0 : arg.s != 1 ? NaN : d ? 0 : 1 / 0);
  }
  if (isBase10) {
    if (d.length > 1) {
      inf = true;
    } else {
      for (k = d[0]; k % 10 === 0; )
        k /= 10;
      inf = k !== 1;
    }
  }
  external = false;
  sd = pr + guard;
  num = naturalLogarithm(arg, sd);
  denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
  r = divide(num, denominator, sd, 1);
  if (checkRoundingDigits(r.d, k = pr, rm)) {
    do {
      sd += 10;
      num = naturalLogarithm(arg, sd);
      denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
      r = divide(num, denominator, sd, 1);
      if (!inf) {
        if (+digitsToString(r.d).slice(k + 1, k + 15) + 1 == 1e14) {
          r = finalise(r, pr + 1, 0);
        }
        break;
      }
    } while (checkRoundingDigits(r.d, k += 10, rm));
  }
  external = true;
  return finalise(r, pr, rm);
};
P.minus = P.sub = function(y) {
  var d, e, i, j, k, len, pr, rm, xd, xe, xLTy, yd, x = this, Ctor = x.constructor;
  y = new Ctor(y);
  if (!x.d || !y.d) {
    if (!x.s || !y.s)
      y = new Ctor(NaN);
    else if (x.d)
      y.s = -y.s;
    else
      y = new Ctor(y.d || x.s !== y.s ? x : NaN);
    return y;
  }
  if (x.s != y.s) {
    y.s = -y.s;
    return x.plus(y);
  }
  xd = x.d;
  yd = y.d;
  pr = Ctor.precision;
  rm = Ctor.rounding;
  if (!xd[0] || !yd[0]) {
    if (yd[0])
      y.s = -y.s;
    else if (xd[0])
      y = new Ctor(x);
    else
      return new Ctor(rm === 3 ? -0 : 0);
    return external ? finalise(y, pr, rm) : y;
  }
  e = mathfloor(y.e / LOG_BASE);
  xe = mathfloor(x.e / LOG_BASE);
  xd = xd.slice();
  k = xe - e;
  if (k) {
    xLTy = k < 0;
    if (xLTy) {
      d = xd;
      k = -k;
      len = yd.length;
    } else {
      d = yd;
      e = xe;
      len = xd.length;
    }
    i = Math.max(Math.ceil(pr / LOG_BASE), len) + 2;
    if (k > i) {
      k = i;
      d.length = 1;
    }
    d.reverse();
    for (i = k; i--; )
      d.push(0);
    d.reverse();
  } else {
    i = xd.length;
    len = yd.length;
    xLTy = i < len;
    if (xLTy)
      len = i;
    for (i = 0; i < len; i++) {
      if (xd[i] != yd[i]) {
        xLTy = xd[i] < yd[i];
        break;
      }
    }
    k = 0;
  }
  if (xLTy) {
    d = xd;
    xd = yd;
    yd = d;
    y.s = -y.s;
  }
  len = xd.length;
  for (i = yd.length - len; i > 0; --i)
    xd[len++] = 0;
  for (i = yd.length; i > k; ) {
    if (xd[--i] < yd[i]) {
      for (j = i; j && xd[--j] === 0; )
        xd[j] = BASE - 1;
      --xd[j];
      xd[i] += BASE;
    }
    xd[i] -= yd[i];
  }
  for (; xd[--len] === 0; )
    xd.pop();
  for (; xd[0] === 0; xd.shift())
    --e;
  if (!xd[0])
    return new Ctor(rm === 3 ? -0 : 0);
  y.d = xd;
  y.e = getBase10Exponent(xd, e);
  return external ? finalise(y, pr, rm) : y;
};
P.modulo = P.mod = function(y) {
  var q, x = this, Ctor = x.constructor;
  y = new Ctor(y);
  if (!x.d || !y.s || y.d && !y.d[0])
    return new Ctor(NaN);
  if (!y.d || x.d && !x.d[0]) {
    return finalise(new Ctor(x), Ctor.precision, Ctor.rounding);
  }
  external = false;
  if (Ctor.modulo == 9) {
    q = divide(x, y.abs(), 0, 3, 1);
    q.s *= y.s;
  } else {
    q = divide(x, y, 0, Ctor.modulo, 1);
  }
  q = q.times(y);
  external = true;
  return x.minus(q);
};
P.naturalExponential = P.exp = function() {
  return naturalExponential(this);
};
P.naturalLogarithm = P.ln = function() {
  return naturalLogarithm(this);
};
P.negated = P.neg = function() {
  var x = new this.constructor(this);
  x.s = -x.s;
  return finalise(x);
};
P.plus = P.add = function(y) {
  var carry, d, e, i, k, len, pr, rm, xd, yd, x = this, Ctor = x.constructor;
  y = new Ctor(y);
  if (!x.d || !y.d) {
    if (!x.s || !y.s)
      y = new Ctor(NaN);
    else if (!x.d)
      y = new Ctor(y.d || x.s === y.s ? x : NaN);
    return y;
  }
  if (x.s != y.s) {
    y.s = -y.s;
    return x.minus(y);
  }
  xd = x.d;
  yd = y.d;
  pr = Ctor.precision;
  rm = Ctor.rounding;
  if (!xd[0] || !yd[0]) {
    if (!yd[0])
      y = new Ctor(x);
    return external ? finalise(y, pr, rm) : y;
  }
  k = mathfloor(x.e / LOG_BASE);
  e = mathfloor(y.e / LOG_BASE);
  xd = xd.slice();
  i = k - e;
  if (i) {
    if (i < 0) {
      d = xd;
      i = -i;
      len = yd.length;
    } else {
      d = yd;
      e = k;
      len = xd.length;
    }
    k = Math.ceil(pr / LOG_BASE);
    len = k > len ? k + 1 : len + 1;
    if (i > len) {
      i = len;
      d.length = 1;
    }
    d.reverse();
    for (; i--; )
      d.push(0);
    d.reverse();
  }
  len = xd.length;
  i = yd.length;
  if (len - i < 0) {
    i = len;
    d = yd;
    yd = xd;
    xd = d;
  }
  for (carry = 0; i; ) {
    carry = (xd[--i] = xd[i] + yd[i] + carry) / BASE | 0;
    xd[i] %= BASE;
  }
  if (carry) {
    xd.unshift(carry);
    ++e;
  }
  for (len = xd.length; xd[--len] == 0; )
    xd.pop();
  y.d = xd;
  y.e = getBase10Exponent(xd, e);
  return external ? finalise(y, pr, rm) : y;
};
P.precision = P.sd = function(z) {
  var k, x = this;
  if (z !== void 0 && z !== !!z && z !== 1 && z !== 0)
    throw Error(invalidArgument + z);
  if (x.d) {
    k = getPrecision(x.d);
    if (z && x.e + 1 > k)
      k = x.e + 1;
  } else {
    k = NaN;
  }
  return k;
};
P.round = function() {
  var x = this, Ctor = x.constructor;
  return finalise(new Ctor(x), x.e + 1, Ctor.rounding);
};
P.sine = P.sin = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (!x.isFinite())
    return new Ctor(NaN);
  if (x.isZero())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
  Ctor.rounding = 1;
  x = sine(Ctor, toLessThanHalfPi(Ctor, x));
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return finalise(quadrant > 2 ? x.neg() : x, pr, rm, true);
};
P.squareRoot = P.sqrt = function() {
  var m, n2, sd, r, rep, t, x = this, d = x.d, e = x.e, s = x.s, Ctor = x.constructor;
  if (s !== 1 || !d || !d[0]) {
    return new Ctor(!s || s < 0 && (!d || d[0]) ? NaN : d ? x : 1 / 0);
  }
  external = false;
  s = Math.sqrt(+x);
  if (s == 0 || s == 1 / 0) {
    n2 = digitsToString(d);
    if ((n2.length + e) % 2 == 0)
      n2 += "0";
    s = Math.sqrt(n2);
    e = mathfloor((e + 1) / 2) - (e < 0 || e % 2);
    if (s == 1 / 0) {
      n2 = "5e" + e;
    } else {
      n2 = s.toExponential();
      n2 = n2.slice(0, n2.indexOf("e") + 1) + e;
    }
    r = new Ctor(n2);
  } else {
    r = new Ctor(s.toString());
  }
  sd = (e = Ctor.precision) + 3;
  for (; ; ) {
    t = r;
    r = t.plus(divide(x, t, sd + 2, 1)).times(0.5);
    if (digitsToString(t.d).slice(0, sd) === (n2 = digitsToString(r.d)).slice(0, sd)) {
      n2 = n2.slice(sd - 3, sd + 1);
      if (n2 == "9999" || !rep && n2 == "4999") {
        if (!rep) {
          finalise(t, e + 1, 0);
          if (t.times(t).eq(x)) {
            r = t;
            break;
          }
        }
        sd += 4;
        rep = 1;
      } else {
        if (!+n2 || !+n2.slice(1) && n2.charAt(0) == "5") {
          finalise(r, e + 1, 1);
          m = !r.times(r).eq(x);
        }
        break;
      }
    }
  }
  external = true;
  return finalise(r, e, Ctor.rounding, m);
};
P.tangent = P.tan = function() {
  var pr, rm, x = this, Ctor = x.constructor;
  if (!x.isFinite())
    return new Ctor(NaN);
  if (x.isZero())
    return new Ctor(x);
  pr = Ctor.precision;
  rm = Ctor.rounding;
  Ctor.precision = pr + 10;
  Ctor.rounding = 1;
  x = x.sin();
  x.s = 1;
  x = divide(x, new Ctor(1).minus(x.times(x)).sqrt(), pr + 10, 0);
  Ctor.precision = pr;
  Ctor.rounding = rm;
  return finalise(quadrant == 2 || quadrant == 4 ? x.neg() : x, pr, rm, true);
};
P.times = P.mul = function(y) {
  var carry, e, i, k, r, rL, t, xdL, ydL, x = this, Ctor = x.constructor, xd = x.d, yd = (y = new Ctor(y)).d;
  y.s *= x.s;
  if (!xd || !xd[0] || !yd || !yd[0]) {
    return new Ctor(!y.s || xd && !xd[0] && !yd || yd && !yd[0] && !xd ? NaN : !xd || !yd ? y.s / 0 : y.s * 0);
  }
  e = mathfloor(x.e / LOG_BASE) + mathfloor(y.e / LOG_BASE);
  xdL = xd.length;
  ydL = yd.length;
  if (xdL < ydL) {
    r = xd;
    xd = yd;
    yd = r;
    rL = xdL;
    xdL = ydL;
    ydL = rL;
  }
  r = [];
  rL = xdL + ydL;
  for (i = rL; i--; )
    r.push(0);
  for (i = ydL; --i >= 0; ) {
    carry = 0;
    for (k = xdL + i; k > i; ) {
      t = r[k] + yd[i] * xd[k - i - 1] + carry;
      r[k--] = t % BASE | 0;
      carry = t / BASE | 0;
    }
    r[k] = (r[k] + carry) % BASE | 0;
  }
  for (; !r[--rL]; )
    r.pop();
  if (carry)
    ++e;
  else
    r.shift();
  y.d = r;
  y.e = getBase10Exponent(r, e);
  return external ? finalise(y, Ctor.precision, Ctor.rounding) : y;
};
P.toBinary = function(sd, rm) {
  return toStringBinary(this, 2, sd, rm);
};
P.toDecimalPlaces = P.toDP = function(dp, rm) {
  var x = this, Ctor = x.constructor;
  x = new Ctor(x);
  if (dp === void 0)
    return x;
  checkInt32(dp, 0, MAX_DIGITS);
  if (rm === void 0)
    rm = Ctor.rounding;
  else
    checkInt32(rm, 0, 8);
  return finalise(x, dp + x.e + 1, rm);
};
P.toExponential = function(dp, rm) {
  var str, x = this, Ctor = x.constructor;
  if (dp === void 0) {
    str = finiteToString(x, true);
  } else {
    checkInt32(dp, 0, MAX_DIGITS);
    if (rm === void 0)
      rm = Ctor.rounding;
    else
      checkInt32(rm, 0, 8);
    x = finalise(new Ctor(x), dp + 1, rm);
    str = finiteToString(x, true, dp + 1);
  }
  return x.isNeg() && !x.isZero() ? "-" + str : str;
};
P.toFixed = function(dp, rm) {
  var str, y, x = this, Ctor = x.constructor;
  if (dp === void 0) {
    str = finiteToString(x);
  } else {
    checkInt32(dp, 0, MAX_DIGITS);
    if (rm === void 0)
      rm = Ctor.rounding;
    else
      checkInt32(rm, 0, 8);
    y = finalise(new Ctor(x), dp + x.e + 1, rm);
    str = finiteToString(y, false, dp + y.e + 1);
  }
  return x.isNeg() && !x.isZero() ? "-" + str : str;
};
P.toFraction = function(maxD) {
  var d, d0, d1, d2, e, k, n2, n0, n1, pr, q, r, x = this, xd = x.d, Ctor = x.constructor;
  if (!xd)
    return new Ctor(x);
  n1 = d0 = new Ctor(1);
  d1 = n0 = new Ctor(0);
  d = new Ctor(d1);
  e = d.e = getPrecision(xd) - x.e - 1;
  k = e % LOG_BASE;
  d.d[0] = mathpow(10, k < 0 ? LOG_BASE + k : k);
  if (maxD == null) {
    maxD = e > 0 ? d : n1;
  } else {
    n2 = new Ctor(maxD);
    if (!n2.isInt() || n2.lt(n1))
      throw Error(invalidArgument + n2);
    maxD = n2.gt(d) ? e > 0 ? d : n1 : n2;
  }
  external = false;
  n2 = new Ctor(digitsToString(xd));
  pr = Ctor.precision;
  Ctor.precision = e = xd.length * LOG_BASE * 2;
  for (; ; ) {
    q = divide(n2, d, 0, 1, 1);
    d2 = d0.plus(q.times(d1));
    if (d2.cmp(maxD) == 1)
      break;
    d0 = d1;
    d1 = d2;
    d2 = n1;
    n1 = n0.plus(q.times(d2));
    n0 = d2;
    d2 = d;
    d = n2.minus(q.times(d2));
    n2 = d2;
  }
  d2 = divide(maxD.minus(d0), d1, 0, 1, 1);
  n0 = n0.plus(d2.times(n1));
  d0 = d0.plus(d2.times(d1));
  n0.s = n1.s = x.s;
  r = divide(n1, d1, e, 1).minus(x).abs().cmp(divide(n0, d0, e, 1).minus(x).abs()) < 1 ? [n1, d1] : [n0, d0];
  Ctor.precision = pr;
  external = true;
  return r;
};
P.toHexadecimal = P.toHex = function(sd, rm) {
  return toStringBinary(this, 16, sd, rm);
};
P.toNearest = function(y, rm) {
  var x = this, Ctor = x.constructor;
  x = new Ctor(x);
  if (y == null) {
    if (!x.d)
      return x;
    y = new Ctor(1);
    rm = Ctor.rounding;
  } else {
    y = new Ctor(y);
    if (rm === void 0) {
      rm = Ctor.rounding;
    } else {
      checkInt32(rm, 0, 8);
    }
    if (!x.d)
      return y.s ? x : y;
    if (!y.d) {
      if (y.s)
        y.s = x.s;
      return y;
    }
  }
  if (y.d[0]) {
    external = false;
    x = divide(x, y, 0, rm, 1).times(y);
    external = true;
    finalise(x);
  } else {
    y.s = x.s;
    x = y;
  }
  return x;
};
P.toNumber = function() {
  return +this;
};
P.toOctal = function(sd, rm) {
  return toStringBinary(this, 8, sd, rm);
};
P.toPower = P.pow = function(y) {
  var e, k, pr, r, rm, s, x = this, Ctor = x.constructor, yn = +(y = new Ctor(y));
  if (!x.d || !y.d || !x.d[0] || !y.d[0])
    return new Ctor(mathpow(+x, yn));
  x = new Ctor(x);
  if (x.eq(1))
    return x;
  pr = Ctor.precision;
  rm = Ctor.rounding;
  if (y.eq(1))
    return finalise(x, pr, rm);
  e = mathfloor(y.e / LOG_BASE);
  if (e >= y.d.length - 1 && (k = yn < 0 ? -yn : yn) <= MAX_SAFE_INTEGER) {
    r = intPow(Ctor, x, k, pr);
    return y.s < 0 ? new Ctor(1).div(r) : finalise(r, pr, rm);
  }
  s = x.s;
  if (s < 0) {
    if (e < y.d.length - 1)
      return new Ctor(NaN);
    if ((y.d[e] & 1) == 0)
      s = 1;
    if (x.e == 0 && x.d[0] == 1 && x.d.length == 1) {
      x.s = s;
      return x;
    }
  }
  k = mathpow(+x, yn);
  e = k == 0 || !isFinite(k) ? mathfloor(yn * (Math.log("0." + digitsToString(x.d)) / Math.LN10 + x.e + 1)) : new Ctor(k + "").e;
  if (e > Ctor.maxE + 1 || e < Ctor.minE - 1)
    return new Ctor(e > 0 ? s / 0 : 0);
  external = false;
  Ctor.rounding = x.s = 1;
  k = Math.min(12, (e + "").length);
  r = naturalExponential(y.times(naturalLogarithm(x, pr + k)), pr);
  if (r.d) {
    r = finalise(r, pr + 5, 1);
    if (checkRoundingDigits(r.d, pr, rm)) {
      e = pr + 10;
      r = finalise(naturalExponential(y.times(naturalLogarithm(x, e + k)), e), e + 5, 1);
      if (+digitsToString(r.d).slice(pr + 1, pr + 15) + 1 == 1e14) {
        r = finalise(r, pr + 1, 0);
      }
    }
  }
  r.s = s;
  external = true;
  Ctor.rounding = rm;
  return finalise(r, pr, rm);
};
P.toPrecision = function(sd, rm) {
  var str, x = this, Ctor = x.constructor;
  if (sd === void 0) {
    str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
  } else {
    checkInt32(sd, 1, MAX_DIGITS);
    if (rm === void 0)
      rm = Ctor.rounding;
    else
      checkInt32(rm, 0, 8);
    x = finalise(new Ctor(x), sd, rm);
    str = finiteToString(x, sd <= x.e || x.e <= Ctor.toExpNeg, sd);
  }
  return x.isNeg() && !x.isZero() ? "-" + str : str;
};
P.toSignificantDigits = P.toSD = function(sd, rm) {
  var x = this, Ctor = x.constructor;
  if (sd === void 0) {
    sd = Ctor.precision;
    rm = Ctor.rounding;
  } else {
    checkInt32(sd, 1, MAX_DIGITS);
    if (rm === void 0)
      rm = Ctor.rounding;
    else
      checkInt32(rm, 0, 8);
  }
  return finalise(new Ctor(x), sd, rm);
};
P.toString = function() {
  var x = this, Ctor = x.constructor, str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
  return x.isNeg() && !x.isZero() ? "-" + str : str;
};
P.truncated = P.trunc = function() {
  return finalise(new this.constructor(this), this.e + 1, 1);
};
P.valueOf = P.toJSON = function() {
  var x = this, Ctor = x.constructor, str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
  return x.isNeg() ? "-" + str : str;
};
function digitsToString(d) {
  var i, k, ws, indexOfLastWord = d.length - 1, str = "", w = d[0];
  if (indexOfLastWord > 0) {
    str += w;
    for (i = 1; i < indexOfLastWord; i++) {
      ws = d[i] + "";
      k = LOG_BASE - ws.length;
      if (k)
        str += getZeroString(k);
      str += ws;
    }
    w = d[i];
    ws = w + "";
    k = LOG_BASE - ws.length;
    if (k)
      str += getZeroString(k);
  } else if (w === 0) {
    return "0";
  }
  for (; w % 10 === 0; )
    w /= 10;
  return str + w;
}
function checkInt32(i, min2, max2) {
  if (i !== ~~i || i < min2 || i > max2) {
    throw Error(invalidArgument + i);
  }
}
function checkRoundingDigits(d, i, rm, repeating) {
  var di, k, r, rd;
  for (k = d[0]; k >= 10; k /= 10)
    --i;
  if (--i < 0) {
    i += LOG_BASE;
    di = 0;
  } else {
    di = Math.ceil((i + 1) / LOG_BASE);
    i %= LOG_BASE;
  }
  k = mathpow(10, LOG_BASE - i);
  rd = d[di] % k | 0;
  if (repeating == null) {
    if (i < 3) {
      if (i == 0)
        rd = rd / 100 | 0;
      else if (i == 1)
        rd = rd / 10 | 0;
      r = rm < 4 && rd == 99999 || rm > 3 && rd == 49999 || rd == 5e4 || rd == 0;
    } else {
      r = (rm < 4 && rd + 1 == k || rm > 3 && rd + 1 == k / 2) && (d[di + 1] / k / 100 | 0) == mathpow(10, i - 2) - 1 || (rd == k / 2 || rd == 0) && (d[di + 1] / k / 100 | 0) == 0;
    }
  } else {
    if (i < 4) {
      if (i == 0)
        rd = rd / 1e3 | 0;
      else if (i == 1)
        rd = rd / 100 | 0;
      else if (i == 2)
        rd = rd / 10 | 0;
      r = (repeating || rm < 4) && rd == 9999 || !repeating && rm > 3 && rd == 4999;
    } else {
      r = ((repeating || rm < 4) && rd + 1 == k || !repeating && rm > 3 && rd + 1 == k / 2) && (d[di + 1] / k / 1e3 | 0) == mathpow(10, i - 3) - 1;
    }
  }
  return r;
}
function convertBase(str, baseIn, baseOut) {
  var j, arr = [0], arrL, i = 0, strL = str.length;
  for (; i < strL; ) {
    for (arrL = arr.length; arrL--; )
      arr[arrL] *= baseIn;
    arr[0] += NUMERALS.indexOf(str.charAt(i++));
    for (j = 0; j < arr.length; j++) {
      if (arr[j] > baseOut - 1) {
        if (arr[j + 1] === void 0)
          arr[j + 1] = 0;
        arr[j + 1] += arr[j] / baseOut | 0;
        arr[j] %= baseOut;
      }
    }
  }
  return arr.reverse();
}
function cosine(Ctor, x) {
  var k, len, y;
  if (x.isZero())
    return x;
  len = x.d.length;
  if (len < 32) {
    k = Math.ceil(len / 3);
    y = (1 / tinyPow(4, k)).toString();
  } else {
    k = 16;
    y = "2.3283064365386962890625e-10";
  }
  Ctor.precision += k;
  x = taylorSeries(Ctor, 1, x.times(y), new Ctor(1));
  for (var i = k; i--; ) {
    var cos2x = x.times(x);
    x = cos2x.times(cos2x).minus(cos2x).times(8).plus(1);
  }
  Ctor.precision -= k;
  return x;
}
var divide = function() {
  function multiplyInteger(x, k, base) {
    var temp, carry = 0, i = x.length;
    for (x = x.slice(); i--; ) {
      temp = x[i] * k + carry;
      x[i] = temp % base | 0;
      carry = temp / base | 0;
    }
    if (carry)
      x.unshift(carry);
    return x;
  }
  function compare(a, b2, aL, bL) {
    var i, r;
    if (aL != bL) {
      r = aL > bL ? 1 : -1;
    } else {
      for (i = r = 0; i < aL; i++) {
        if (a[i] != b2[i]) {
          r = a[i] > b2[i] ? 1 : -1;
          break;
        }
      }
    }
    return r;
  }
  function subtract(a, b2, aL, base) {
    var i = 0;
    for (; aL--; ) {
      a[aL] -= i;
      i = a[aL] < b2[aL] ? 1 : 0;
      a[aL] = i * base + a[aL] - b2[aL];
    }
    for (; !a[0] && a.length > 1; )
      a.shift();
  }
  return function(x, y, pr, rm, dp, base) {
    var cmp, e, i, k, logBase, more, prod, prodL, q, qd, rem, remL, rem0, sd, t, xi, xL, yd0, yL, yz, Ctor = x.constructor, sign2 = x.s == y.s ? 1 : -1, xd = x.d, yd = y.d;
    if (!xd || !xd[0] || !yd || !yd[0]) {
      return new Ctor(
        // Return NaN if either NaN, or both Infinity or 0.
        !x.s || !y.s || (xd ? yd && xd[0] == yd[0] : !yd) ? NaN : (
          // Return ±0 if x is 0 or y is ±Infinity, or return ±Infinity as y is 0.
          xd && xd[0] == 0 || !yd ? sign2 * 0 : sign2 / 0
        )
      );
    }
    if (base) {
      logBase = 1;
      e = x.e - y.e;
    } else {
      base = BASE;
      logBase = LOG_BASE;
      e = mathfloor(x.e / logBase) - mathfloor(y.e / logBase);
    }
    yL = yd.length;
    xL = xd.length;
    q = new Ctor(sign2);
    qd = q.d = [];
    for (i = 0; yd[i] == (xd[i] || 0); i++)
      ;
    if (yd[i] > (xd[i] || 0))
      e--;
    if (pr == null) {
      sd = pr = Ctor.precision;
      rm = Ctor.rounding;
    } else if (dp) {
      sd = pr + (x.e - y.e) + 1;
    } else {
      sd = pr;
    }
    if (sd < 0) {
      qd.push(1);
      more = true;
    } else {
      sd = sd / logBase + 2 | 0;
      i = 0;
      if (yL == 1) {
        k = 0;
        yd = yd[0];
        sd++;
        for (; (i < xL || k) && sd--; i++) {
          t = k * base + (xd[i] || 0);
          qd[i] = t / yd | 0;
          k = t % yd | 0;
        }
        more = k || i < xL;
      } else {
        k = base / (yd[0] + 1) | 0;
        if (k > 1) {
          yd = multiplyInteger(yd, k, base);
          xd = multiplyInteger(xd, k, base);
          yL = yd.length;
          xL = xd.length;
        }
        xi = yL;
        rem = xd.slice(0, yL);
        remL = rem.length;
        for (; remL < yL; )
          rem[remL++] = 0;
        yz = yd.slice();
        yz.unshift(0);
        yd0 = yd[0];
        if (yd[1] >= base / 2)
          ++yd0;
        do {
          k = 0;
          cmp = compare(yd, rem, yL, remL);
          if (cmp < 0) {
            rem0 = rem[0];
            if (yL != remL)
              rem0 = rem0 * base + (rem[1] || 0);
            k = rem0 / yd0 | 0;
            if (k > 1) {
              if (k >= base)
                k = base - 1;
              prod = multiplyInteger(yd, k, base);
              prodL = prod.length;
              remL = rem.length;
              cmp = compare(prod, rem, prodL, remL);
              if (cmp == 1) {
                k--;
                subtract(prod, yL < prodL ? yz : yd, prodL, base);
              }
            } else {
              if (k == 0)
                cmp = k = 1;
              prod = yd.slice();
            }
            prodL = prod.length;
            if (prodL < remL)
              prod.unshift(0);
            subtract(rem, prod, remL, base);
            if (cmp == -1) {
              remL = rem.length;
              cmp = compare(yd, rem, yL, remL);
              if (cmp < 1) {
                k++;
                subtract(rem, yL < remL ? yz : yd, remL, base);
              }
            }
            remL = rem.length;
          } else if (cmp === 0) {
            k++;
            rem = [0];
          }
          qd[i++] = k;
          if (cmp && rem[0]) {
            rem[remL++] = xd[xi] || 0;
          } else {
            rem = [xd[xi]];
            remL = 1;
          }
        } while ((xi++ < xL || rem[0] !== void 0) && sd--);
        more = rem[0] !== void 0;
      }
      if (!qd[0])
        qd.shift();
    }
    if (logBase == 1) {
      q.e = e;
      inexact = more;
    } else {
      for (i = 1, k = qd[0]; k >= 10; k /= 10)
        i++;
      q.e = i + e * logBase - 1;
      finalise(q, dp ? pr + q.e + 1 : pr, rm, more);
    }
    return q;
  };
}();
function finalise(x, sd, rm, isTruncated) {
  var digits, i, j, k, rd, roundUp, w, xd, xdi, Ctor = x.constructor;
  out:
    if (sd != null) {
      xd = x.d;
      if (!xd)
        return x;
      for (digits = 1, k = xd[0]; k >= 10; k /= 10)
        digits++;
      i = sd - digits;
      if (i < 0) {
        i += LOG_BASE;
        j = sd;
        w = xd[xdi = 0];
        rd = w / mathpow(10, digits - j - 1) % 10 | 0;
      } else {
        xdi = Math.ceil((i + 1) / LOG_BASE);
        k = xd.length;
        if (xdi >= k) {
          if (isTruncated) {
            for (; k++ <= xdi; )
              xd.push(0);
            w = rd = 0;
            digits = 1;
            i %= LOG_BASE;
            j = i - LOG_BASE + 1;
          } else {
            break out;
          }
        } else {
          w = k = xd[xdi];
          for (digits = 1; k >= 10; k /= 10)
            digits++;
          i %= LOG_BASE;
          j = i - LOG_BASE + digits;
          rd = j < 0 ? 0 : w / mathpow(10, digits - j - 1) % 10 | 0;
        }
      }
      isTruncated = isTruncated || sd < 0 || xd[xdi + 1] !== void 0 || (j < 0 ? w : w % mathpow(10, digits - j - 1));
      roundUp = rm < 4 ? (rd || isTruncated) && (rm == 0 || rm == (x.s < 0 ? 3 : 2)) : rd > 5 || rd == 5 && (rm == 4 || isTruncated || rm == 6 && // Check whether the digit to the left of the rounding digit is odd.
      (i > 0 ? j > 0 ? w / mathpow(10, digits - j) : 0 : xd[xdi - 1]) % 10 & 1 || rm == (x.s < 0 ? 8 : 7));
      if (sd < 1 || !xd[0]) {
        xd.length = 0;
        if (roundUp) {
          sd -= x.e + 1;
          xd[0] = mathpow(10, (LOG_BASE - sd % LOG_BASE) % LOG_BASE);
          x.e = -sd || 0;
        } else {
          xd[0] = x.e = 0;
        }
        return x;
      }
      if (i == 0) {
        xd.length = xdi;
        k = 1;
        xdi--;
      } else {
        xd.length = xdi + 1;
        k = mathpow(10, LOG_BASE - i);
        xd[xdi] = j > 0 ? (w / mathpow(10, digits - j) % mathpow(10, j) | 0) * k : 0;
      }
      if (roundUp) {
        for (; ; ) {
          if (xdi == 0) {
            for (i = 1, j = xd[0]; j >= 10; j /= 10)
              i++;
            j = xd[0] += k;
            for (k = 1; j >= 10; j /= 10)
              k++;
            if (i != k) {
              x.e++;
              if (xd[0] == BASE)
                xd[0] = 1;
            }
            break;
          } else {
            xd[xdi] += k;
            if (xd[xdi] != BASE)
              break;
            xd[xdi--] = 0;
            k = 1;
          }
        }
      }
      for (i = xd.length; xd[--i] === 0; )
        xd.pop();
    }
  if (external) {
    if (x.e > Ctor.maxE) {
      x.d = null;
      x.e = NaN;
    } else if (x.e < Ctor.minE) {
      x.e = 0;
      x.d = [0];
    }
  }
  return x;
}
function finiteToString(x, isExp, sd) {
  if (!x.isFinite())
    return nonFiniteToString(x);
  var k, e = x.e, str = digitsToString(x.d), len = str.length;
  if (isExp) {
    if (sd && (k = sd - len) > 0) {
      str = str.charAt(0) + "." + str.slice(1) + getZeroString(k);
    } else if (len > 1) {
      str = str.charAt(0) + "." + str.slice(1);
    }
    str = str + (x.e < 0 ? "e" : "e+") + x.e;
  } else if (e < 0) {
    str = "0." + getZeroString(-e - 1) + str;
    if (sd && (k = sd - len) > 0)
      str += getZeroString(k);
  } else if (e >= len) {
    str += getZeroString(e + 1 - len);
    if (sd && (k = sd - e - 1) > 0)
      str = str + "." + getZeroString(k);
  } else {
    if ((k = e + 1) < len)
      str = str.slice(0, k) + "." + str.slice(k);
    if (sd && (k = sd - len) > 0) {
      if (e + 1 === len)
        str += ".";
      str += getZeroString(k);
    }
  }
  return str;
}
function getBase10Exponent(digits, e) {
  var w = digits[0];
  for (e *= LOG_BASE; w >= 10; w /= 10)
    e++;
  return e;
}
function getLn10(Ctor, sd, pr) {
  if (sd > LN10_PRECISION) {
    external = true;
    if (pr)
      Ctor.precision = pr;
    throw Error(precisionLimitExceeded);
  }
  return finalise(new Ctor(LN10), sd, 1, true);
}
function getPi(Ctor, sd, rm) {
  if (sd > PI_PRECISION)
    throw Error(precisionLimitExceeded);
  return finalise(new Ctor(PI), sd, rm, true);
}
function getPrecision(digits) {
  var w = digits.length - 1, len = w * LOG_BASE + 1;
  w = digits[w];
  if (w) {
    for (; w % 10 == 0; w /= 10)
      len--;
    for (w = digits[0]; w >= 10; w /= 10)
      len++;
  }
  return len;
}
function getZeroString(k) {
  var zs = "";
  for (; k--; )
    zs += "0";
  return zs;
}
function intPow(Ctor, x, n2, pr) {
  var isTruncated, r = new Ctor(1), k = Math.ceil(pr / LOG_BASE + 4);
  external = false;
  for (; ; ) {
    if (n2 % 2) {
      r = r.times(x);
      if (truncate(r.d, k))
        isTruncated = true;
    }
    n2 = mathfloor(n2 / 2);
    if (n2 === 0) {
      n2 = r.d.length - 1;
      if (isTruncated && r.d[n2] === 0)
        ++r.d[n2];
      break;
    }
    x = x.times(x);
    truncate(x.d, k);
  }
  external = true;
  return r;
}
function isOdd(n2) {
  return n2.d[n2.d.length - 1] & 1;
}
function maxOrMin(Ctor, args, n2) {
  var k, y, x = new Ctor(args[0]), i = 0;
  for (; ++i < args.length; ) {
    y = new Ctor(args[i]);
    if (!y.s) {
      x = y;
      break;
    }
    k = x.cmp(y);
    if (k === n2 || k === 0 && x.s === n2) {
      x = y;
    }
  }
  return x;
}
function naturalExponential(x, sd) {
  var denominator, guard, j, pow2, sum2, t, wpr, rep = 0, i = 0, k = 0, Ctor = x.constructor, rm = Ctor.rounding, pr = Ctor.precision;
  if (!x.d || !x.d[0] || x.e > 17) {
    return new Ctor(x.d ? !x.d[0] ? 1 : x.s < 0 ? 0 : 1 / 0 : x.s ? x.s < 0 ? 0 : x : 0 / 0);
  }
  if (sd == null) {
    external = false;
    wpr = pr;
  } else {
    wpr = sd;
  }
  t = new Ctor(0.03125);
  while (x.e > -2) {
    x = x.times(t);
    k += 5;
  }
  guard = Math.log(mathpow(2, k)) / Math.LN10 * 2 + 5 | 0;
  wpr += guard;
  denominator = pow2 = sum2 = new Ctor(1);
  Ctor.precision = wpr;
  for (; ; ) {
    pow2 = finalise(pow2.times(x), wpr, 1);
    denominator = denominator.times(++i);
    t = sum2.plus(divide(pow2, denominator, wpr, 1));
    if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum2.d).slice(0, wpr)) {
      j = k;
      while (j--)
        sum2 = finalise(sum2.times(sum2), wpr, 1);
      if (sd == null) {
        if (rep < 3 && checkRoundingDigits(sum2.d, wpr - guard, rm, rep)) {
          Ctor.precision = wpr += 10;
          denominator = pow2 = t = new Ctor(1);
          i = 0;
          rep++;
        } else {
          return finalise(sum2, Ctor.precision = pr, rm, external = true);
        }
      } else {
        Ctor.precision = pr;
        return sum2;
      }
    }
    sum2 = t;
  }
}
function naturalLogarithm(y, sd) {
  var c, c0, denominator, e, numerator, rep, sum2, t, wpr, x1, x2, n2 = 1, guard = 10, x = y, xd = x.d, Ctor = x.constructor, rm = Ctor.rounding, pr = Ctor.precision;
  if (x.s < 0 || !xd || !xd[0] || !x.e && xd[0] == 1 && xd.length == 1) {
    return new Ctor(xd && !xd[0] ? -1 / 0 : x.s != 1 ? NaN : xd ? 0 : x);
  }
  if (sd == null) {
    external = false;
    wpr = pr;
  } else {
    wpr = sd;
  }
  Ctor.precision = wpr += guard;
  c = digitsToString(xd);
  c0 = c.charAt(0);
  if (Math.abs(e = x.e) < 15e14) {
    while (c0 < 7 && c0 != 1 || c0 == 1 && c.charAt(1) > 3) {
      x = x.times(y);
      c = digitsToString(x.d);
      c0 = c.charAt(0);
      n2++;
    }
    e = x.e;
    if (c0 > 1) {
      x = new Ctor("0." + c);
      e++;
    } else {
      x = new Ctor(c0 + "." + c.slice(1));
    }
  } else {
    t = getLn10(Ctor, wpr + 2, pr).times(e + "");
    x = naturalLogarithm(new Ctor(c0 + "." + c.slice(1)), wpr - guard).plus(t);
    Ctor.precision = pr;
    return sd == null ? finalise(x, pr, rm, external = true) : x;
  }
  x1 = x;
  sum2 = numerator = x = divide(x.minus(1), x.plus(1), wpr, 1);
  x2 = finalise(x.times(x), wpr, 1);
  denominator = 3;
  for (; ; ) {
    numerator = finalise(numerator.times(x2), wpr, 1);
    t = sum2.plus(divide(numerator, new Ctor(denominator), wpr, 1));
    if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum2.d).slice(0, wpr)) {
      sum2 = sum2.times(2);
      if (e !== 0)
        sum2 = sum2.plus(getLn10(Ctor, wpr + 2, pr).times(e + ""));
      sum2 = divide(sum2, new Ctor(n2), wpr, 1);
      if (sd == null) {
        if (checkRoundingDigits(sum2.d, wpr - guard, rm, rep)) {
          Ctor.precision = wpr += guard;
          t = numerator = x = divide(x1.minus(1), x1.plus(1), wpr, 1);
          x2 = finalise(x.times(x), wpr, 1);
          denominator = rep = 1;
        } else {
          return finalise(sum2, Ctor.precision = pr, rm, external = true);
        }
      } else {
        Ctor.precision = pr;
        return sum2;
      }
    }
    sum2 = t;
    denominator += 2;
  }
}
function nonFiniteToString(x) {
  return String(x.s * x.s / 0);
}
function parseDecimal(x, str) {
  var e, i, len;
  if ((e = str.indexOf(".")) > -1)
    str = str.replace(".", "");
  if ((i = str.search(/e/i)) > 0) {
    if (e < 0)
      e = i;
    e += +str.slice(i + 1);
    str = str.substring(0, i);
  } else if (e < 0) {
    e = str.length;
  }
  for (i = 0; str.charCodeAt(i) === 48; i++)
    ;
  for (len = str.length; str.charCodeAt(len - 1) === 48; --len)
    ;
  str = str.slice(i, len);
  if (str) {
    len -= i;
    x.e = e = e - i - 1;
    x.d = [];
    i = (e + 1) % LOG_BASE;
    if (e < 0)
      i += LOG_BASE;
    if (i < len) {
      if (i)
        x.d.push(+str.slice(0, i));
      for (len -= LOG_BASE; i < len; )
        x.d.push(+str.slice(i, i += LOG_BASE));
      str = str.slice(i);
      i = LOG_BASE - str.length;
    } else {
      i -= len;
    }
    for (; i--; )
      str += "0";
    x.d.push(+str);
    if (external) {
      if (x.e > x.constructor.maxE) {
        x.d = null;
        x.e = NaN;
      } else if (x.e < x.constructor.minE) {
        x.e = 0;
        x.d = [0];
      }
    }
  } else {
    x.e = 0;
    x.d = [0];
  }
  return x;
}
function parseOther(x, str) {
  var base, Ctor, divisor, i, isFloat, len, p, xd, xe;
  if (str.indexOf("_") > -1) {
    str = str.replace(/(\d)_(?=\d)/g, "$1");
    if (isDecimal.test(str))
      return parseDecimal(x, str);
  } else if (str === "Infinity" || str === "NaN") {
    if (!+str)
      x.s = NaN;
    x.e = NaN;
    x.d = null;
    return x;
  }
  if (isHex.test(str)) {
    base = 16;
    str = str.toLowerCase();
  } else if (isBinary.test(str)) {
    base = 2;
  } else if (isOctal.test(str)) {
    base = 8;
  } else {
    throw Error(invalidArgument + str);
  }
  i = str.search(/p/i);
  if (i > 0) {
    p = +str.slice(i + 1);
    str = str.substring(2, i);
  } else {
    str = str.slice(2);
  }
  i = str.indexOf(".");
  isFloat = i >= 0;
  Ctor = x.constructor;
  if (isFloat) {
    str = str.replace(".", "");
    len = str.length;
    i = len - i;
    divisor = intPow(Ctor, new Ctor(base), i, i * 2);
  }
  xd = convertBase(str, base, BASE);
  xe = xd.length - 1;
  for (i = xe; xd[i] === 0; --i)
    xd.pop();
  if (i < 0)
    return new Ctor(x.s * 0);
  x.e = getBase10Exponent(xd, xe);
  x.d = xd;
  external = false;
  if (isFloat)
    x = divide(x, divisor, len * 4);
  if (p)
    x = x.times(Math.abs(p) < 54 ? mathpow(2, p) : Decimal.pow(2, p));
  external = true;
  return x;
}
function sine(Ctor, x) {
  var k, len = x.d.length;
  if (len < 3) {
    return x.isZero() ? x : taylorSeries(Ctor, 2, x, x);
  }
  k = 1.4 * Math.sqrt(len);
  k = k > 16 ? 16 : k | 0;
  x = x.times(1 / tinyPow(5, k));
  x = taylorSeries(Ctor, 2, x, x);
  var sin2_x, d5 = new Ctor(5), d16 = new Ctor(16), d20 = new Ctor(20);
  for (; k--; ) {
    sin2_x = x.times(x);
    x = x.times(d5.plus(sin2_x.times(d16.times(sin2_x).minus(d20))));
  }
  return x;
}
function taylorSeries(Ctor, n2, x, y, isHyperbolic) {
  var j, t, u, x2, i = 1, pr = Ctor.precision, k = Math.ceil(pr / LOG_BASE);
  external = false;
  x2 = x.times(x);
  u = new Ctor(y);
  for (; ; ) {
    t = divide(u.times(x2), new Ctor(n2++ * n2++), pr, 1);
    u = isHyperbolic ? y.plus(t) : y.minus(t);
    y = divide(t.times(x2), new Ctor(n2++ * n2++), pr, 1);
    t = u.plus(y);
    if (t.d[k] !== void 0) {
      for (j = k; t.d[j] === u.d[j] && j--; )
        ;
      if (j == -1)
        break;
    }
    j = u;
    u = y;
    y = t;
    t = j;
    i++;
  }
  external = true;
  t.d.length = k + 1;
  return t;
}
function tinyPow(b2, e) {
  var n2 = b2;
  while (--e)
    n2 *= b2;
  return n2;
}
function toLessThanHalfPi(Ctor, x) {
  var t, isNeg = x.s < 0, pi = getPi(Ctor, Ctor.precision, 1), halfPi = pi.times(0.5);
  x = x.abs();
  if (x.lte(halfPi)) {
    quadrant = isNeg ? 4 : 1;
    return x;
  }
  t = x.divToInt(pi);
  if (t.isZero()) {
    quadrant = isNeg ? 3 : 2;
  } else {
    x = x.minus(t.times(pi));
    if (x.lte(halfPi)) {
      quadrant = isOdd(t) ? isNeg ? 2 : 3 : isNeg ? 4 : 1;
      return x;
    }
    quadrant = isOdd(t) ? isNeg ? 1 : 4 : isNeg ? 3 : 2;
  }
  return x.minus(pi).abs();
}
function toStringBinary(x, baseOut, sd, rm) {
  var base, e, i, k, len, roundUp, str, xd, y, Ctor = x.constructor, isExp = sd !== void 0;
  if (isExp) {
    checkInt32(sd, 1, MAX_DIGITS);
    if (rm === void 0)
      rm = Ctor.rounding;
    else
      checkInt32(rm, 0, 8);
  } else {
    sd = Ctor.precision;
    rm = Ctor.rounding;
  }
  if (!x.isFinite()) {
    str = nonFiniteToString(x);
  } else {
    str = finiteToString(x);
    i = str.indexOf(".");
    if (isExp) {
      base = 2;
      if (baseOut == 16) {
        sd = sd * 4 - 3;
      } else if (baseOut == 8) {
        sd = sd * 3 - 2;
      }
    } else {
      base = baseOut;
    }
    if (i >= 0) {
      str = str.replace(".", "");
      y = new Ctor(1);
      y.e = str.length - i;
      y.d = convertBase(finiteToString(y), 10, base);
      y.e = y.d.length;
    }
    xd = convertBase(str, 10, base);
    e = len = xd.length;
    for (; xd[--len] == 0; )
      xd.pop();
    if (!xd[0]) {
      str = isExp ? "0p+0" : "0";
    } else {
      if (i < 0) {
        e--;
      } else {
        x = new Ctor(x);
        x.d = xd;
        x.e = e;
        x = divide(x, y, sd, rm, 0, base);
        xd = x.d;
        e = x.e;
        roundUp = inexact;
      }
      i = xd[sd];
      k = base / 2;
      roundUp = roundUp || xd[sd + 1] !== void 0;
      roundUp = rm < 4 ? (i !== void 0 || roundUp) && (rm === 0 || rm === (x.s < 0 ? 3 : 2)) : i > k || i === k && (rm === 4 || roundUp || rm === 6 && xd[sd - 1] & 1 || rm === (x.s < 0 ? 8 : 7));
      xd.length = sd;
      if (roundUp) {
        for (; ++xd[--sd] > base - 1; ) {
          xd[sd] = 0;
          if (!sd) {
            ++e;
            xd.unshift(1);
          }
        }
      }
      for (len = xd.length; !xd[len - 1]; --len)
        ;
      for (i = 0, str = ""; i < len; i++)
        str += NUMERALS.charAt(xd[i]);
      if (isExp) {
        if (len > 1) {
          if (baseOut == 16 || baseOut == 8) {
            i = baseOut == 16 ? 4 : 3;
            for (--len; len % i; len++)
              str += "0";
            xd = convertBase(str, base, baseOut);
            for (len = xd.length; !xd[len - 1]; --len)
              ;
            for (i = 1, str = "1."; i < len; i++)
              str += NUMERALS.charAt(xd[i]);
          } else {
            str = str.charAt(0) + "." + str.slice(1);
          }
        }
        str = str + (e < 0 ? "p" : "p+") + e;
      } else if (e < 0) {
        for (; ++e; )
          str = "0" + str;
        str = "0." + str;
      } else {
        if (++e > len)
          for (e -= len; e--; )
            str += "0";
        else if (e < len)
          str = str.slice(0, e) + "." + str.slice(e);
      }
    }
    str = (baseOut == 16 ? "0x" : baseOut == 2 ? "0b" : baseOut == 8 ? "0o" : "") + str;
  }
  return x.s < 0 ? "-" + str : str;
}
function truncate(arr, len) {
  if (arr.length > len) {
    arr.length = len;
    return true;
  }
}
function abs(x) {
  return new this(x).abs();
}
function acos(x) {
  return new this(x).acos();
}
function acosh(x) {
  return new this(x).acosh();
}
function add(x, y) {
  return new this(x).plus(y);
}
function asin(x) {
  return new this(x).asin();
}
function asinh(x) {
  return new this(x).asinh();
}
function atan(x) {
  return new this(x).atan();
}
function atanh(x) {
  return new this(x).atanh();
}
function atan2(y, x) {
  y = new this(y);
  x = new this(x);
  var r, pr = this.precision, rm = this.rounding, wpr = pr + 4;
  if (!y.s || !x.s) {
    r = new this(NaN);
  } else if (!y.d && !x.d) {
    r = getPi(this, wpr, 1).times(x.s > 0 ? 0.25 : 0.75);
    r.s = y.s;
  } else if (!x.d || y.isZero()) {
    r = x.s < 0 ? getPi(this, pr, rm) : new this(0);
    r.s = y.s;
  } else if (!y.d || x.isZero()) {
    r = getPi(this, wpr, 1).times(0.5);
    r.s = y.s;
  } else if (x.s < 0) {
    this.precision = wpr;
    this.rounding = 1;
    r = this.atan(divide(y, x, wpr, 1));
    x = getPi(this, wpr, 1);
    this.precision = pr;
    this.rounding = rm;
    r = y.s < 0 ? r.minus(x) : r.plus(x);
  } else {
    r = this.atan(divide(y, x, wpr, 1));
  }
  return r;
}
function cbrt(x) {
  return new this(x).cbrt();
}
function ceil(x) {
  return finalise(x = new this(x), x.e + 1, 2);
}
function clamp(x, min2, max2) {
  return new this(x).clamp(min2, max2);
}
function config(obj) {
  if (!obj || typeof obj !== "object")
    throw Error(decimalError + "Object expected");
  var i, p, v, useDefaults = obj.defaults === true, ps = [
    "precision",
    1,
    MAX_DIGITS,
    "rounding",
    0,
    8,
    "toExpNeg",
    -EXP_LIMIT,
    0,
    "toExpPos",
    0,
    EXP_LIMIT,
    "maxE",
    0,
    EXP_LIMIT,
    "minE",
    -EXP_LIMIT,
    0,
    "modulo",
    0,
    9
  ];
  for (i = 0; i < ps.length; i += 3) {
    if (p = ps[i], useDefaults)
      this[p] = DEFAULTS[p];
    if ((v = obj[p]) !== void 0) {
      if (mathfloor(v) === v && v >= ps[i + 1] && v <= ps[i + 2])
        this[p] = v;
      else
        throw Error(invalidArgument + p + ": " + v);
    }
  }
  if (p = "crypto", useDefaults)
    this[p] = DEFAULTS[p];
  if ((v = obj[p]) !== void 0) {
    if (v === true || v === false || v === 0 || v === 1) {
      if (v) {
        if (typeof crypto != "undefined" && crypto && (crypto.getRandomValues || crypto.randomBytes)) {
          this[p] = true;
        } else {
          throw Error(cryptoUnavailable);
        }
      } else {
        this[p] = false;
      }
    } else {
      throw Error(invalidArgument + p + ": " + v);
    }
  }
  return this;
}
function cos(x) {
  return new this(x).cos();
}
function cosh(x) {
  return new this(x).cosh();
}
function clone(obj) {
  var i, p, ps;
  function Decimal2(v) {
    var e, i2, t, x = this;
    if (!(x instanceof Decimal2))
      return new Decimal2(v);
    x.constructor = Decimal2;
    if (isDecimalInstance(v)) {
      x.s = v.s;
      if (external) {
        if (!v.d || v.e > Decimal2.maxE) {
          x.e = NaN;
          x.d = null;
        } else if (v.e < Decimal2.minE) {
          x.e = 0;
          x.d = [0];
        } else {
          x.e = v.e;
          x.d = v.d.slice();
        }
      } else {
        x.e = v.e;
        x.d = v.d ? v.d.slice() : v.d;
      }
      return;
    }
    t = typeof v;
    if (t === "number") {
      if (v === 0) {
        x.s = 1 / v < 0 ? -1 : 1;
        x.e = 0;
        x.d = [0];
        return;
      }
      if (v < 0) {
        v = -v;
        x.s = -1;
      } else {
        x.s = 1;
      }
      if (v === ~~v && v < 1e7) {
        for (e = 0, i2 = v; i2 >= 10; i2 /= 10)
          e++;
        if (external) {
          if (e > Decimal2.maxE) {
            x.e = NaN;
            x.d = null;
          } else if (e < Decimal2.minE) {
            x.e = 0;
            x.d = [0];
          } else {
            x.e = e;
            x.d = [v];
          }
        } else {
          x.e = e;
          x.d = [v];
        }
        return;
      }
      if (v * 0 !== 0) {
        if (!v)
          x.s = NaN;
        x.e = NaN;
        x.d = null;
        return;
      }
      return parseDecimal(x, v.toString());
    }
    if (t === "string") {
      if ((i2 = v.charCodeAt(0)) === 45) {
        v = v.slice(1);
        x.s = -1;
      } else {
        if (i2 === 43)
          v = v.slice(1);
        x.s = 1;
      }
      return isDecimal.test(v) ? parseDecimal(x, v) : parseOther(x, v);
    }
    if (t === "bigint") {
      if (v < 0) {
        v = -v;
        x.s = -1;
      } else {
        x.s = 1;
      }
      return parseDecimal(x, v.toString());
    }
    throw Error(invalidArgument + v);
  }
  Decimal2.prototype = P;
  Decimal2.ROUND_UP = 0;
  Decimal2.ROUND_DOWN = 1;
  Decimal2.ROUND_CEIL = 2;
  Decimal2.ROUND_FLOOR = 3;
  Decimal2.ROUND_HALF_UP = 4;
  Decimal2.ROUND_HALF_DOWN = 5;
  Decimal2.ROUND_HALF_EVEN = 6;
  Decimal2.ROUND_HALF_CEIL = 7;
  Decimal2.ROUND_HALF_FLOOR = 8;
  Decimal2.EUCLID = 9;
  Decimal2.config = Decimal2.set = config;
  Decimal2.clone = clone;
  Decimal2.isDecimal = isDecimalInstance;
  Decimal2.abs = abs;
  Decimal2.acos = acos;
  Decimal2.acosh = acosh;
  Decimal2.add = add;
  Decimal2.asin = asin;
  Decimal2.asinh = asinh;
  Decimal2.atan = atan;
  Decimal2.atanh = atanh;
  Decimal2.atan2 = atan2;
  Decimal2.cbrt = cbrt;
  Decimal2.ceil = ceil;
  Decimal2.clamp = clamp;
  Decimal2.cos = cos;
  Decimal2.cosh = cosh;
  Decimal2.div = div;
  Decimal2.exp = exp;
  Decimal2.floor = floor;
  Decimal2.hypot = hypot;
  Decimal2.ln = ln;
  Decimal2.log = log;
  Decimal2.log10 = log10;
  Decimal2.log2 = log2;
  Decimal2.max = max;
  Decimal2.min = min;
  Decimal2.mod = mod;
  Decimal2.mul = mul;
  Decimal2.pow = pow;
  Decimal2.random = random;
  Decimal2.round = round;
  Decimal2.sign = sign;
  Decimal2.sin = sin;
  Decimal2.sinh = sinh;
  Decimal2.sqrt = sqrt;
  Decimal2.sub = sub;
  Decimal2.sum = sum;
  Decimal2.tan = tan;
  Decimal2.tanh = tanh;
  Decimal2.trunc = trunc;
  if (obj === void 0)
    obj = {};
  if (obj) {
    if (obj.defaults !== true) {
      ps = ["precision", "rounding", "toExpNeg", "toExpPos", "maxE", "minE", "modulo", "crypto"];
      for (i = 0; i < ps.length; )
        if (!obj.hasOwnProperty(p = ps[i++]))
          obj[p] = this[p];
    }
  }
  Decimal2.config(obj);
  return Decimal2;
}
function div(x, y) {
  return new this(x).div(y);
}
function exp(x) {
  return new this(x).exp();
}
function floor(x) {
  return finalise(x = new this(x), x.e + 1, 3);
}
function hypot() {
  var i, n2, t = new this(0);
  external = false;
  for (i = 0; i < arguments.length; ) {
    n2 = new this(arguments[i++]);
    if (!n2.d) {
      if (n2.s) {
        external = true;
        return new this(1 / 0);
      }
      t = n2;
    } else if (t.d) {
      t = t.plus(n2.times(n2));
    }
  }
  external = true;
  return t.sqrt();
}
function isDecimalInstance(obj) {
  return obj instanceof Decimal || obj && obj.toStringTag === tag || false;
}
function ln(x) {
  return new this(x).ln();
}
function log(x, y) {
  return new this(x).log(y);
}
function log2(x) {
  return new this(x).log(2);
}
function log10(x) {
  return new this(x).log(10);
}
function max() {
  return maxOrMin(this, arguments, -1);
}
function min() {
  return maxOrMin(this, arguments, 1);
}
function mod(x, y) {
  return new this(x).mod(y);
}
function mul(x, y) {
  return new this(x).mul(y);
}
function pow(x, y) {
  return new this(x).pow(y);
}
function random(sd) {
  var d, e, k, n2, i = 0, r = new this(1), rd = [];
  if (sd === void 0)
    sd = this.precision;
  else
    checkInt32(sd, 1, MAX_DIGITS);
  k = Math.ceil(sd / LOG_BASE);
  if (!this.crypto) {
    for (; i < k; )
      rd[i++] = Math.random() * 1e7 | 0;
  } else if (crypto.getRandomValues) {
    d = crypto.getRandomValues(new Uint32Array(k));
    for (; i < k; ) {
      n2 = d[i];
      if (n2 >= 429e7) {
        d[i] = crypto.getRandomValues(new Uint32Array(1))[0];
      } else {
        rd[i++] = n2 % 1e7;
      }
    }
  } else if (crypto.randomBytes) {
    d = crypto.randomBytes(k *= 4);
    for (; i < k; ) {
      n2 = d[i] + (d[i + 1] << 8) + (d[i + 2] << 16) + ((d[i + 3] & 127) << 24);
      if (n2 >= 214e7) {
        crypto.randomBytes(4).copy(d, i);
      } else {
        rd.push(n2 % 1e7);
        i += 4;
      }
    }
    i = k / 4;
  } else {
    throw Error(cryptoUnavailable);
  }
  k = rd[--i];
  sd %= LOG_BASE;
  if (k && sd) {
    n2 = mathpow(10, LOG_BASE - sd);
    rd[i] = (k / n2 | 0) * n2;
  }
  for (; rd[i] === 0; i--)
    rd.pop();
  if (i < 0) {
    e = 0;
    rd = [0];
  } else {
    e = -1;
    for (; rd[0] === 0; e -= LOG_BASE)
      rd.shift();
    for (k = 1, n2 = rd[0]; n2 >= 10; n2 /= 10)
      k++;
    if (k < LOG_BASE)
      e -= LOG_BASE - k;
  }
  r.e = e;
  r.d = rd;
  return r;
}
function round(x) {
  return finalise(x = new this(x), x.e + 1, this.rounding);
}
function sign(x) {
  x = new this(x);
  return x.d ? x.d[0] ? x.s : 0 * x.s : x.s || NaN;
}
function sin(x) {
  return new this(x).sin();
}
function sinh(x) {
  return new this(x).sinh();
}
function sqrt(x) {
  return new this(x).sqrt();
}
function sub(x, y) {
  return new this(x).sub(y);
}
function sum() {
  var i = 0, args = arguments, x = new this(args[i]);
  external = false;
  for (; x.s && ++i < args.length; )
    x = x.plus(args[i]);
  external = true;
  return finalise(x, this.precision, this.rounding);
}
function tan(x) {
  return new this(x).tan();
}
function tanh(x) {
  return new this(x).tanh();
}
function trunc(x) {
  return finalise(x = new this(x), x.e + 1, 1);
}
P[Symbol.for("nodejs.util.inspect.custom")] = P.toString;
P[Symbol.toStringTag] = "Decimal";
var Decimal = P.constructor = clone(DEFAULTS);
LN10 = new Decimal(LN10);
PI = new Decimal(PI);

// apps/rebalancer/fork/replay/policies.ts
var LIVE = {
  capPercent: 60,
  minActive: 2,
  maxDeviationPercent: 100,
  minSamples: 3,
  smaWindowSeconds: 24 * 3600,
  cooldownSeconds: 30 * 60,
  thresholdBps: 25,
  minTarget: 100000n
};
var RAY_DECIMAL = new Decimal(10).pow(27);
function anomalyGate(input, config3) {
  const window = input.recorded.filter(({ t }) => t < input.t && t >= input.t - config3.smaWindowSeconds);
  return input.spots.map((rate, i) => {
    if (window.length < config3.minSamples)
      return false;
    const average = window.reduce((sum2, { rates }) => sum2 + rates[i], 0n) / BigInt(window.length);
    if (average === 0n)
      return false;
    const diff = rate > average ? rate - average : average - rate;
    return Number(diff * 10000n / average) / 100 > config3.maxDeviationPercent;
  });
}
var coolingDown = (input, config3) => input.lastMoveAt !== null && input.t - input.lastMoveAt <= config3.cooldownSeconds;
function applyCap(distribution, maxPercent) {
  const safeMax = Math.max(1, Math.min(100, Math.floor(maxPercent)));
  if (safeMax >= 100)
    return [...distribution];
  const capped = [...distribution];
  let excess = 0;
  for (let i = 0; i < capped.length; i++) {
    if (capped[i] > safeMax) {
      excess += capped[i] - safeMax;
      capped[i] = safeMax;
    }
  }
  while (excess > 0) {
    const candidates = capped.map((value, index) => ({ index, capacity: safeMax - value })).filter((item) => item.capacity > 0);
    if (candidates.length === 0)
      break;
    let distributed = 0;
    for (const candidate of candidates) {
      if (excess <= 0)
        break;
      const add2 = Math.min(candidate.capacity, Math.max(1, Math.floor(excess / candidates.length)));
      capped[candidate.index] += add2;
      excess -= add2;
      distributed += add2;
    }
    if (distributed === 0)
      break;
  }
  const sum2 = capped.reduce((acc, value) => acc + value, 0);
  if (sum2 !== 100) {
    const target = capped.findIndex((value) => value < safeMax);
    capped[target >= 0 ? target : 0] += 100 - sum2;
  }
  return capped;
}
function ensureMinActive(distribution, minActive) {
  const normalizedMin = Math.max(1, Math.min(distribution.length, Math.floor(minActive)));
  if (distribution.filter((v) => v > 0).length >= normalizedMin)
    return [...distribution];
  const sorted = distribution.map((value, index) => ({ value, index })).sort((a, b2) => b2.value - a.value).map((item) => item.index);
  const adjusted = [...distribution];
  let donor = 0;
  for (let i = 0; i < normalizedMin - distribution.filter((v) => v > 0).length; i++) {
    const target = sorted.find((idx) => adjusted[idx] === 0);
    if (target === void 0)
      break;
    while (donor < sorted.length && adjusted[sorted[donor]] <= 1)
      donor += 1;
    if (donor >= sorted.length)
      break;
    adjusted[sorted[donor]] -= 1;
    adjusted[target] += 1;
  }
  return adjusted;
}
var postOptimization = (distribution, config3) => ensureMinActive(applyCap(distribution, config3.capPercent), config3.minActive);
function excludeAnomalous(distribution, anomalous, config3, reapply) {
  const adjusted = distribution.map((percent2, i) => anomalous[i] ? 0 : percent2);
  const excess = distribution.reduce((sum2, percent2, i) => anomalous[i] ? sum2 + percent2 : sum2, 0);
  if (excess === 0)
    return { distribution: adjusted, withinLimits: true };
  const remaining = adjusted.map((_, i) => i).filter((i) => !anomalous[i]);
  if (remaining.length === 0)
    return { distribution: adjusted, withinLimits: false };
  const remainingTotal = remaining.reduce((sum2, i) => sum2 + adjusted[i], 0);
  if (remainingTotal === 0) {
    const base = Math.floor(100 / remaining.length);
    let remainder = 100 - base * remaining.length;
    for (const i of remaining) {
      adjusted[i] = base + (remainder > 0 ? 1 : 0);
      remainder = remainder > 0 ? remainder - 1 : 0;
    }
  } else {
    let given = 0;
    remaining.forEach((index, k) => {
      if (k === remaining.length - 1) {
        adjusted[index] += excess - given;
        return;
      }
      const share2 = Math.floor(adjusted[index] / remainingTotal * excess);
      adjusted[index] += share2;
      given += share2;
    });
  }
  if (!reapply)
    return { distribution: adjusted, withinLimits: true };
  const limited = postOptimization(
    remaining.map((i) => adjusted[i]),
    config3
  );
  remaining.forEach((index, k) => adjusted[index] = limited[k]);
  const withinLimits = adjusted.every((percent2) => percent2 <= config3.capPercent) && adjusted.filter((percent2) => percent2 > 0).length >= Math.min(config3.minActive, adjusted.length);
  return { distribution: adjusted, withinLimits };
}
function buildMoveInstructions(balances, distribution, config3) {
  const total = balances.reduce((sum2, b2) => sum2 + b2, 0n);
  const targets = distribution.map((percent2) => {
    const target = BigInt(new Decimal(total.toString()).mul(percent2).div(100).floor().toFixed(0));
    return target === 0n ? config3.minTarget : target;
  });
  const buffer = config3.minTarget * 10n;
  const available = balances.map((b2) => b2 > buffer ? b2 - buffer : 0n);
  const senders = [];
  const receivers = [];
  balances.forEach((current, i) => {
    if (current > targets[i]) {
      const raw = current - targets[i];
      senders.push({ index: i, excess: raw < available[i] ? raw : available[i] });
    } else if (current < targets[i]) {
      receivers.push({ index: i, deficit: targets[i] - current });
    }
  });
  const legs = [];
  let s = 0;
  let r = 0;
  while (s < senders.length && r < receivers.length) {
    const sender = senders[s];
    const receiver = receivers[r];
    const amount = sender.excess < receiver.deficit ? sender.excess : receiver.deficit;
    if (amount <= config3.minTarget) {
      if (sender.excess <= config3.minTarget)
        s++;
      else
        r++;
      continue;
    }
    if (amount > available[sender.index]) {
      s++;
      continue;
    }
    legs.push({ from: sender.index, to: receiver.index, amount });
    available[sender.index] -= amount;
    sender.excess -= amount;
    receiver.deficit -= amount;
    if (sender.excess === 0n)
      s++;
    if (receiver.deficit === 0n)
      r++;
  }
  return legs;
}
function decideNew(input, config3 = LIVE) {
  const anomalous = anomalyGate(input, config3);
  if (anomalous.every(Boolean))
    return { stop: "all anomalous", anomalous, legs: [] };
  if (coolingDown(input, config3))
    return { stop: "cooldown", anomalous, legs: [] };
  const signals = input.spots.map(
    (spot, i) => anomalous[i] ? 0n : rateSignal(spot, input.histories[i], INTRA_CHAIN_SIGNAL_WINDOW.windowSeconds / 2)
  );
  const totalHeld = input.balances.reduce((sum2, b2) => sum2 + b2, 0n);
  const raw = solveSegmentGreedy(
    input.spots.map((spot, i) => ({
      spot: anomalous[i] ? 0n : spot,
      signal: signals[i],
      heldPercent: totalHeld === 0n ? 0 : Number(input.balances[i] * 100n / totalHeld)
    })),
    config3.capPercent
  );
  const exclusion = excludeAnomalous(postOptimization(raw, config3), anomalous, config3, true);
  if (!exclusion.withinLimits)
    return { stop: "exclusion outside limits", anomalous, signals, legs: [] };
  const distribution = exclusion.distribution;
  const gain = allocationGain(
    input.spots.map((spot, i) => ({ spot, signal: signals[i], held: input.balances[i] })),
    distribution.map((percent2) => totalHeld * BigInt(percent2) / 100n),
    input.balances
  );
  const delta = totalHeld === 0n ? new Decimal(0) : new Decimal(gain).div(totalHeld.toString()).mul(100);
  const deltaPercent = delta.toNumber();
  if (delta.lt(new Decimal(config3.thresholdBps).div(100))) {
    return { stop: "below threshold", anomalous, distribution, deltaPercent, signals, legs: [] };
  }
  const legs = buildMoveInstructions(input.balances, distribution, config3);
  return { stop: legs.length === 0 ? "no legs" : null, anomalous, distribution, deltaPercent, signals, legs };
}
var XC = {
  capBps: 6e3,
  maxShareOfMarketBps: 1e3,
  intraMinGainBps: 5,
  horizonDays: 7,
  hysteresisK: 2,
  gasCost: 100000n,
  minMove: 1000000000n,
  persistenceRuns: 2
};
var LEG_DUST = 10000000n;
function decideWaterFill(input, config3 = XC) {
  const total = input.balances.reduce((sum2, b2) => sum2 + b2, 0n);
  const curves = input.spots.map((spot, i) => {
    const byBps = total * BigInt(config3.capBps - 1) / 10000n;
    const byMarket = input.marketSizes[i] * BigInt(config3.maxShareOfMarketBps) / 10000n;
    return {
      spot,
      signal: input.signals[i],
      held: input.balances[i],
      alpha: input.alphas[i],
      marketSize: input.marketSizes[i],
      cap: byBps < byMarket ? byBps : byMarket
    };
  });
  const targets = total > 0n ? solveWaterFilling(curves, input.entry, total).amounts : input.balances.map(() => 0n);
  const senders = input.balances.map((b2, index) => ({ index, excess: b2 - targets[index] })).filter((e) => e.excess > 0n).sort((a, b2) => b2.excess > a.excess ? 1 : b2.excess < a.excess ? -1 : 0);
  const receivers = input.balances.map((b2, index) => ({ index, deficit: targets[index] - b2 })).filter((e) => e.deficit > 0n).sort((a, b2) => b2.deficit > a.deficit ? 1 : b2.deficit < a.deficit ? -1 : 0);
  const built = [];
  for (let s = 0, r = 0; s < senders.length && r < receivers.length; ) {
    const amount = senders[s].excess < receivers[r].deficit ? senders[s].excess : receivers[r].deficit;
    if (amount > 0n)
      built.push({ from: senders[s].index, to: receivers[r].index, amount });
    senders[s].excess -= amount;
    receivers[r].deficit -= amount;
    if (senders[s].excess <= 0n)
      s++;
    if (receivers[r].deficit <= 0n)
      r++;
  }
  const value = (legs2) => {
    const after2 = [...input.balances];
    for (const leg of legs2) {
      after2[leg.from] -= leg.amount;
      after2[leg.to] += leg.amount;
    }
    const gain2 = allocationGain(curves, after2, input.balances);
    return { after: after2, gain: gain2, deltaPercent: total === 0n ? 0 : gain2 / Number(total) * 100 };
  };
  const legs = built.filter((leg) => leg.amount >= LEG_DUST);
  const moved = legs.reduce((sum2, leg) => sum2 + leg.amount, 0n);
  const { after, gain, deltaPercent } = value(legs);
  const ranked = moved > 0n && moved >= config3.minMove && gain >= Number(total) * config3.intraMinGainBps / 1e4 && gain * config3.horizonDays / 365 > Number(config3.gasCost) * config3.hysteresisK;
  let previous = null;
  if (ranked) {
    const side = (sign2) => after.map((amount, i) => (amount - input.balances[i]) * sign2 >= config3.minMove ? i : -1).filter((i) => i >= 0).join(",");
    const fingerprint = `in:${side(1n)}|out:${side(-1n)}`;
    previous = { fingerprint, count: input.previous?.fingerprint === fingerprint ? input.previous.count + 1 : 1 };
    if (previous.count >= config3.persistenceRuns)
      return { legs, previous, deltaPercent, stop: null };
  }
  const left = /* @__PURE__ */ new Map();
  input.balances.forEach((balance, i) => {
    if (i !== input.entry && balance * 10000n > total * BigInt(config3.capBps))
      left.set(i, balance - total * BigInt(config3.capBps - 1) / 10000n);
  });
  const restore = [];
  for (const leg of built) {
    const room = left.get(leg.from) ?? 0n;
    const amount = leg.amount < room ? leg.amount : room;
    if (amount <= 0n)
      continue;
    left.set(leg.from, room - amount);
    restore.push({ ...leg, amount });
  }
  if (restore.length > 0)
    return { legs: restore, previous, deltaPercent: value(restore).deltaPercent, stop: null, restore: true };
  return {
    legs: [],
    previous,
    deltaPercent,
    stop: previous ? `run ${previous.count} of ${config3.persistenceRuns}` : "below threshold"
  };
}

// scripts/tangem/simulate.ts
var config2 = JSON.parse((0, import_fs.readFileSync)(process.argv[2], "utf8"));
var DIR = (0, import_path.join)(process.cwd(), "data/tangem", config2.network.toLowerCase());
var OUT = (0, import_path.join)(DIR, config2.output ?? "simulation");
var USDC = 1e6;
var RAY2 = 1e27;
var DAY = 86400;
var YEAR = 365 * DAY;
var REBALANCE_GAS_PER_LEG = 982930;
var PROBES = [4e6, 6e6, 1e7];
function loadSamples() {
  const from = Date.parse(config2.start_date) / 1e3;
  const to = Date.parse(config2.end_date) / 1e3;
  return (0, import_fs.readFileSync)((0, import_path.join)(DIR, "raw.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).sort((a, b2) => a.block - b2.block).map(({ values }) => {
    const number2 = (key) => Number(values[key] ?? 0);
    const ethUsd = number2("ethUsd") / 1e8;
    const price = number2("gas.baseFeeMedian") + number2("gas.priorityFeeMedian");
    const usd = (wei) => [wei, wei / 1e18 * ethUsd];
    return {
      t: number2("timestamp"),
      venues: config2.providers.map((name) => {
        for (const field of ["rate", "supplied", "liquidity"]) {
          if (number2(`${name}.index`) > 0 && values[`${name}.${field}`] == null)
            throw new Error(`${name}.${field} has no reading on ${dayOf(number2("timestamp"))}`);
        }
        const rate = number2(`${name}.rate`) / RAY2;
        const curve = [[0, rate]];
        const refused = [];
        for (const size of PROBES) {
          const after = values[`${name}.rateAfter${size / 1e6}`];
          if (after != null)
            curve.push([size, Number(after) / RAY2]);
          else
            refused.push(size);
        }
        return {
          rate,
          curve,
          refused,
          index: number2(`${name}.index`),
          liquidity: number2(`${name}.liquidity`) / USDC,
          supplied: number2(`${name}.supplied`) / USDC
        };
      }),
      legGas: usd(REBALANCE_GAS_PER_LEG * price),
      l1Fee: usd(number2("gas.l1Fee"))
    };
  }).filter((sample) => sample.t >= from && sample.t <= to + 4 * 3600);
}
function rateAt(venue, position) {
  if (!config2.rate_impact_enabled || position <= 0 || venue.curve.length === 1)
    return venue.rate;
  const { curve } = venue;
  let k = 1;
  while (k < curve.length - 1 && curve[k][0] < position)
    k++;
  const [x0, r0] = curve[k - 1];
  const [x1, r1] = curve[k];
  return Math.max(0, r0 + (r1 - r0) * (position - x0) / (x1 - x0));
}
function refusesDeposit(venue, position) {
  const probe = PROBES.find((size) => size >= position) ?? PROBES[PROBES.length - 1];
  return venue.index === 0 || venue.refused.includes(probe);
}
var productionExponent = (provider) => ["AaveV3Provider", "CompoundV3Provider"].includes(provider) ? 2 : 1.75;
function measuredExponent(venue) {
  const size = PROBES[PROBES.length - 1];
  const probe = venue.curve.find(([position]) => position === size);
  if (!probe || !(venue.rate > 0) || !(venue.supplied > 0))
    return null;
  if (probe[1] >= venue.rate)
    return 0;
  if (probe[1] <= 0)
    return 10;
  return Math.min(10, Math.log(venue.rate / probe[1]) / Math.log((venue.supplied + size) / venue.supplied));
}
var dayOf = (t) => new Date(t * 1e3).toISOString().slice(0, 10);
var label = (provider) => config2.labels[provider] ?? provider;
var inSet = (provider, t) => config2.eligible_periods === void 0 || (config2.eligible_periods[provider] ?? []).some(([from, to]) => dayOf(t) >= from && dayOf(t) < to);
var boundaries = [...new Set(Object.values(config2.eligible_periods ?? {}).flat(2))];
var trigger = Date.parse(config2.stress.trigger_date) / 1e3;
var BARRED = {
  no_reading: "forced exit: the venue has no reading",
  outside_set: "forced exit: the venue is not in the set",
  too_small: "forced exit: the venue is too small for a full position"
};
var shutAt = (sample, i, fullPosition) => config2.liquidity_rule === true && sample.venues[i].liquidity < fullPosition;
function barredAt(sample, i, fullPosition) {
  const venue = sample.venues[i];
  if (venue.index === 0)
    return "no_reading";
  if (!inSet(config2.providers[i], sample.t))
    return "outside_set";
  const tooSmall = config2.max_share_of_venue_percent !== void 0 && fullPosition > (venue.supplied + fullPosition) * config2.max_share_of_venue_percent / 100;
  return tooSmall ? "too_small" : null;
}
function largest(positions, only) {
  let best = -1;
  positions.forEach((position, i) => {
    if (only && !only(config2.providers[i]))
      return;
    if (best < 0 || position > positions[best])
      best = i;
  });
  return best;
}
function resolveTarget(provider, positions) {
  const index = provider === "largest" ? largest(positions) : provider === "largest_morpho" ? largest(positions, (name) => name.includes("Morpho") && !name.includes("Market")) : config2.providers.indexOf(provider);
  if (index < 0)
    throw new Error(`Stress provider ${provider} is not among the simulated providers`);
  if (!(positions[index] > 2))
    throw new Error(`Stress provider ${provider}: the vault holds nothing in ${config2.providers[index]} that day`);
  return index;
}
var pathConfig = config2.risk_guard_enabled ? {
  ...LIVE,
  capPercent: config2.provider_cap_percent ?? LIVE.capPercent,
  minActive: config2.min_active_providers ?? LIVE.minActive
} : { ...LIVE, capPercent: 100, minActive: 1, maxDeviationPercent: Infinity, cooldownSeconds: 0 };
var waterFill = {
  ...XC,
  capBps: pathConfig.capPercent * 100,
  maxShareOfMarketBps: config2.max_share_of_venue_percent === void 0 ? XC.maxShareOfMarketBps : config2.max_share_of_venue_percent * 100
};
function legsTo(positions, targets) {
  const least = Number(pathConfig.minTarget) / USDC;
  const excess = positions.map((position, i) => position - targets[i]);
  const legs = [];
  for (let from = 0, to = 0; ; ) {
    while (from < excess.length && excess[from] <= least)
      from++;
    while (to < excess.length && excess[to] >= -least)
      to++;
    if (from === excess.length || to === excess.length)
      return legs;
    const amount = Math.min(excess[from], -excess[to]);
    legs.push({ from, to, amount });
    excess[from] -= amount;
    excess[to] += amount;
  }
}
function simulate(samples, strategy, scenario) {
  const n2 = config2.providers.length;
  const everyVenue = config2.providers.map((_, i) => i);
  const positions = new Array(n2).fill(0);
  const takes = (i, deposit) => !refusesDeposit(samples[0].venues[i], deposit);
  let bestVault;
  if (strategy === "thesauros_simple" || strategy === "first_split_held") {
    const entry = config2.providers.indexOf(config2.entry_provider);
    const why = barredAt(samples[0], entry, config2.initial_deposit * pathConfig.capPercent / 100);
    if (why)
      throw new Error(`entry_provider ${config2.entry_provider} takes no money at the first reading: ${why}`);
    if (shutAt(samples[0], entry, config2.initial_deposit * pathConfig.capPercent / 100))
      throw new Error(
        `entry_provider ${config2.entry_provider} has less free liquidity than a full position at the first reading`
      );
    positions[entry] = config2.initial_deposit;
  } else if (strategy === "just_aave") {
    positions[config2.providers.indexOf(config2.aave_provider)] = config2.initial_deposit;
  } else if (strategy === "eligible_equal_weight") {
    const fullPosition = config2.initial_deposit * pathConfig.capPercent / 100;
    let open = positions.map((_, i) => i).filter((i) => !barredAt(samples[0], i, fullPosition) && !shutAt(samples[0], i, fullPosition));
    while (open.some((i) => !takes(i, config2.initial_deposit / open.length))) {
      open = open.filter((i) => takes(i, config2.initial_deposit / open.length));
    }
    if (open.length === 0)
      throw new Error("eligible_equal_weight: no provider takes money at the first reading");
    open.forEach((i) => positions[i] = config2.initial_deposit / open.length);
  } else {
    const rate = (i) => inSet(config2.providers[i], samples[0].t) && takes(i, config2.initial_deposit) ? samples[0].venues[i].rate : -1;
    const best = samples[0].venues.reduce((top, _venue, i) => rate(i) > rate(top) ? i : top, 0);
    if (rate(best) < 0)
      throw new Error("just_best_vault: no provider in the set takes the deposit on the first day");
    positions[best] = config2.initial_deposit;
    bestVault = label(config2.providers[best]);
  }
  positions.forEach((position, i) => {
    if (position > 0 && !takes(i, position))
      throw new Error(`${strategy}: ${config2.providers[i]} does not take the deposit at the first reading`);
  });
  const total = () => positions.reduce((sum2, position) => sum2 + position, 0);
  const apr = (sample) => {
    const sum2 = total();
    return sum2 === 0 ? 0 : positions.reduce((acc, p, i) => acc + p * rateAt(sample.venues[i], p), 0) / sum2;
  };
  const seen = [];
  const readSince = new Array(n2).fill(Infinity);
  const dilution = new Array(n2).fill(1);
  let split2 = null;
  const exponents = config2.providers.map(productionExponent);
  let proposed = null;
  const decisions = [];
  const days = [];
  const moves = [];
  let lastMoveAt = null;
  let previousTotal = total();
  let peak = total();
  let dayStart = total();
  const newDay = () => ({ rebalances: 0, refused: 0, gasWei: 0, gasUsd: 0, interest: new Array(n2).fill(0) });
  let day = newDay();
  let lowestPayable = 1;
  let dead = -1;
  let frozenUntil = 0;
  let fired = false;
  let tx = 0;
  for (let k = 0; k < samples.length - 1; k++) {
    const sample = samples[k];
    if (scenario && !fired && sample.t >= trigger) {
      fired = true;
      const stress = config2.stress;
      if (scenario.kind === "curator_bad_debt") {
        scenario.target = resolveTarget(stress.curator_bad_debt.provider, positions);
        positions[scenario.target] *= 1 - stress.curator_bad_debt.loss_percent / 100;
      } else if (scenario.kind === "protocol_hack") {
        scenario.target = resolveTarget(stress.protocol_hack.provider, positions);
        positions[scenario.target] *= 1 - stress.protocol_hack.loss_percent / 100;
        dead = scenario.target;
      } else if (scenario.kind === "withdrawal_freeze") {
        scenario.target = resolveTarget(stress.withdrawal_freeze.provider, positions);
        frozenUntil = sample.t + stress.withdrawal_freeze.days * DAY;
        scenario.frozen = [sample.t, frozenUntil];
      }
    }
    const frozen = scenario?.kind === "withdrawal_freeze" && fired && sample.t < frozenUntil ? scenario.target : -1;
    const fullPosition = total() * pathConfig.capPercent / 100;
    const barred = (i) => barredAt(sample, i, fullPosition);
    const shut = (i) => shutAt(sample, i, fullPosition);
    sample.venues.forEach((venue, i) => readSince[i] = venue.index > 0 ? Math.min(readSince[i], sample.t) : Infinity);
    const payableBy = (i) => {
      const { liquidity, supplied } = sample.venues[i];
      if (i === frozen || i === dead)
        return 0;
      if (config2.rate_impact_enabled)
        return liquidity + positions[i];
      return supplied === 0 ? 0 : liquidity * (1 + positions[i] / supplied);
    };
    const executable = (legs) => {
      const out = new Array(n2).fill(0);
      const into = new Array(n2).fill(0);
      return legs.filter(({ from, to, amount }) => {
        const can = out[from] + amount <= payableBy(from) && !refusesDeposit(sample.venues[to], positions[to] + into[to] + amount);
        if (can) {
          out[from] += amount;
          into[to] += amount;
        }
        return can;
      });
    };
    const execute = (legs, transactions, expectedGain, restore) => {
      const aprBefore = apr(sample);
      const gasWei = config2.gas_modeling_enabled ? sample.legGas[0] * legs.length + sample.l1Fee[0] * transactions : 0;
      const gasUsd = config2.gas_modeling_enabled ? sample.legGas[1] * legs.length + sample.l1Fee[1] * transactions : 0;
      for (const leg of legs) {
        if (barred(leg.to) || shut(leg.to))
          throw new Error(`a leg enters ${config2.providers[leg.to]}, which takes no money`);
        positions[leg.from] -= leg.amount;
        positions[leg.to] += leg.amount;
        if (positions[leg.from] < 0 && positions[leg.from] > -1e-6)
          positions[leg.from] = 0;
      }
      const kept = 1 - gasUsd / total();
      positions.forEach((_, i) => positions[i] *= kept);
      const aprAfter = apr(sample);
      for (const leg of legs) {
        if (transactions > 1 || leg === legs[0])
          tx++;
        moves.push({
          t: sample.t,
          tx,
          ...leg,
          sourceLiquidity: sample.venues[leg.from].liquidity,
          gasUsed: REBALANCE_GAS_PER_LEG,
          gasWei: gasWei / legs.length,
          gasUsd: gasUsd / legs.length,
          aprBefore,
          aprAfter,
          expectedGain,
          restore
        });
      }
      day.rebalances += legs.length;
      day.gasWei += gasWei;
      day.gasUsd += gasUsd;
      lastMoveAt = sample.t;
    };
    const spots = sample.venues.map(
      (venue, i) => i === dead ? 0n : BigInt(Math.round(rateAt(venue, positions[i]) * RAY2))
    );
    if (strategy === "eligible_equal_weight" && k > 0 && boundaries.some((date) => dayOf(sample.t) >= date && dayOf(samples[k - 1].t) < date)) {
      split2 = { open: everyVenue.filter((i) => !barred(i) && !shut(i)), late: everyVenue };
    }
    if (split2) {
      const open = split2.open.filter((i) => !barred(i) && !shut(i));
      const late = split2.late.some((i) => open.includes(i)) ? split2.late : everyVenue;
      const takers = late.filter((i) => open.includes(i));
      const rest = late.reduce((sum2, i) => sum2 + positions[i], 0);
      const legs = legsTo(
        positions,
        positions.map((position, i) => !late.includes(i) ? position : takers.includes(i) ? rest / takers.length : 0)
      ).map((leg) => ({ ...leg, forced: barred(leg.from) ?? void 0 }));
      const can = executable(legs);
      const waiting = legs.filter((leg) => !can.includes(leg));
      day.refused += waiting.length;
      if (can.length > 0)
        execute(can, can.length, null);
      split2 = waiting.length > 0 ? { open, late: [...new Set(waiting.flatMap((leg) => [leg.from, leg.to]))] } : null;
    }
    if (strategy === "thesauros_simple" || strategy === "first_split_held" && lastMoveAt === null) {
      const change = previousTotal === 0 ? 0 : Math.abs(total() - previousTotal) / previousTotal * 100;
      const tripped = config2.policy !== "water_filling" && config2.risk_guard_enabled && change > config2.circuit_breaker_percent;
      if (tripped) {
        scenario?.events.push({ rule: "circuit_breaker", date: dayOf(sample.t), change });
      } else {
        const histories = spots.map(
          (_, i) => readSince[i] > sample.t - 12 * 3600 + 600 || shut(i) ? "unavailable" : Array.from({ length: 12 }, (_unused, hour) => {
            const at = sample.t - (hour + 1) * 3600;
            const after = seen.findIndex((entry) => entry.t >= at);
            const right = after < 0 ? { t: sample.t, rates: spots } : seen[after];
            const left = seen[Math.max(0, (after < 0 ? seen.length : after) - 1)];
            const share2 = right.t === left.t ? 0 : Math.max(0, at - left.t) / (right.t - left.t);
            const rate = Number(left.rates[i]) + (Number(right.rates[i]) - Number(left.rates[i])) * share2;
            return { ageSeconds: (hour + 1) * 3600, rate: BigInt(Math.round(rate)) };
          })
        );
        const balances = positions.map((position) => BigInt(Math.floor(position * USDC)));
        const read = spots.map((spot, i) => barred(i) ? 0n : spot);
        let decided;
        let gain;
        let restore;
        if (config2.policy === "water_filling") {
          if (config2.impact_exponent === "measured") {
            sample.venues.forEach((venue, i) => exponents[i] = measuredExponent(venue) ?? exponents[i]);
          }
          const input = {
            spots: read,
            signals: read.map((spot, i) => rateSignal(spot, histories[i], INTRA_CHAIN_SIGNAL_WINDOW.windowSeconds / 2)),
            balances,
            alphas: [...exponents],
            // The planner's market size has the vault's own position in it.
            marketSizes: sample.venues.map((venue, i) => BigInt(Math.floor(venue.supplied * USDC)) + balances[i]),
            entry: config2.providers.indexOf(config2.entry_provider),
            previous: proposed
          };
          const decision = decideWaterFill(input, waterFill);
          proposed = decision.previous;
          if (strategy === "thesauros_simple" && !scenario) {
            decisions.push(
              JSON.stringify(
                { t: sample.t, input, config: waterFill, decision },
                (_key, value) => typeof value === "bigint" ? value.toString() : value
              )
            );
          }
          decided = decision;
          gain = decision.deltaPercent;
          restore = decision.restore;
        } else {
          const decision = decideNew(
            { t: sample.t, spots: read, balances, recorded: seen, lastMoveAt, histories },
            pathConfig
          );
          if (scenario?.target !== void 0 && sample.t < trigger + 7 * DAY && decision.anomalous[scenario.target]) {
            scenario.events.push({ rule: "anomaly_gate", date: dayOf(sample.t) });
          }
          decided = decision;
          gain = decision.deltaPercent ?? null;
        }
        const legs = decided.legs.filter((leg) => !barred(leg.to) && !shut(leg.to) && leg.to !== dead).map((leg) => ({
          from: leg.from,
          to: leg.to,
          amount: Number(leg.amount) / USDC,
          forced: barred(leg.from) ?? void 0
        }));
        if (decided.stop === null && legs.length > 0) {
          if (legs.some((leg) => leg.from === frozen)) {
            scenario.events.push({ rule: "frozen_move", date: dayOf(sample.t) });
          }
          if (executable(legs).length < legs.length) {
            day.refused += legs.length;
          } else {
            execute(legs, 1, legs.some((leg) => leg.forced) ? null : gain, restore);
          }
        }
      }
    }
    previousTotal = total();
    const payable = (reading) => positions.reduce(
      (sum2, position, i) => sum2 + (i === frozen || i === dead ? 0 : Math.min(position, reading.venues[i].liquidity)),
      0
    ) / (total() || 1);
    lowestPayable = Math.min(lowestPayable, payable(sample));
    seen.push({ t: sample.t, rates: spots });
    while (seen[0].t < sample.t - 2 * DAY)
      seen.shift();
    const next = samples[k + 1];
    positions.forEach((position, i) => {
      if (position === 0 || i === dead)
        return;
      const venue = sample.venues[i];
      if (!(venue.index > 0 && next.venues[i].index > 0))
        throw new Error(`${config2.providers[i]} holds ${position} with no index reading after ${dayOf(sample.t)}`);
      const growth = next.venues[i].index / venue.index - 1;
      if (venue.rate > 0 && venue.curve.length > 1)
        dilution[i] = Math.min(1, rateAt(venue, position) / venue.rate);
      positions[i] = position * (1 + (growth > 0 ? growth * dilution[i] : growth));
      day.interest[i] += positions[i] - position;
    });
    if (dayOf(next.t) === dayOf(sample.t) && k < samples.length - 2)
      continue;
    let fees = 0;
    if (strategy === "thesauros_simple") {
      const gross = total();
      const base = config2.high_water_mark ? peak : dayStart;
      fees = Math.max(0, gross - base) * config2.performance_fee_percent / 100 + gross * config2.management_fee_percent / 100 / 365;
      if (fees > 0)
        positions.forEach((_, i) => positions[i] *= 1 - fees / gross);
      peak = Math.max(peak, total());
    }
    const depegged = scenario?.kind === "depeg" && sample.t >= trigger && sample.t < trigger + config2.stress.depeg.days * DAY;
    days.push({
      date: dayOf(sample.t),
      assets: total(),
      price: depegged ? config2.stress.depeg.price : 1,
      ...day,
      fees,
      liquidity: Math.min(lowestPayable, payable(next)) * total(),
      positions: [...positions],
      venueLiquidity: next.venues.map((venue, i) => i === frozen || i === dead ? 0 : venue.liquidity)
    });
    dayStart = total();
    day = newDay();
    lowestPayable = 1;
  }
  return { days, moves, bestVault, decisions };
}
var money = (value) => value.toFixed(2);
var percent = (fraction) => (fraction * 100).toFixed(4);
var share = (position, assets) => (assets === 0 ? 0 : position / assets * 100).toFixed(2);
function writeCsv(file, header, rows) {
  (0, import_fs.writeFileSync)((0, import_path.join)(OUT, file), [header, ...rows].map((row) => row.join(",")).join("\n") + "\n");
  console.log(`${file}: ${rows.length} rows`);
}
function dailyRows(strategy, run) {
  return run.days.map((row, d) => {
    const before = d === 0 ? config2.initial_deposit : run.days[d - 1].assets;
    const monthAgo = d >= 30 ? run.days[d - 30].assets : null;
    const t = Date.parse(row.date) / 1e3;
    return [
      row.date,
      strategy,
      money(row.assets),
      money(row.assets - before),
      money(row.assets - config2.initial_deposit),
      monthAgo === null ? "" : percent((row.assets / monthAgo) ** (365 / 30) - 1),
      row.rebalances,
      row.refused,
      Math.round(row.gasWei),
      money(row.gasUsd),
      money(row.fees),
      // TS-394: the baselines carry no Thesauros fee; what a protocol or a curator takes is already in its rate.
      strategy === "thesauros_simple" ? `performance ${config2.performance_fee_percent}% of ${config2.high_water_mark ? "gains above the high-water mark" : "each day's gain"}` : "none (native protocol fees are inside the rates)",
      money(row.liquidity),
      share(
        row.positions.reduce((sum2, position, i) => inSet(config2.providers[i], t) ? sum2 : sum2 + position, 0),
        row.assets
      ),
      ...row.positions.map((position) => share(position, row.assets)),
      // Half a cent of a fall is no fall: not "-0.00".
      ...row.interest.map((earned) => money(earned).replace(/^-0\.00$/, "0.00"))
    ];
  });
}
function daysToExit(run, from) {
  const left = [...run.days[from].positions];
  for (let d = from; d < run.days.length; d++) {
    left.forEach((amount, i) => left[i] = amount - Math.min(amount, run.days[d].venueLiquidity[i]));
    if (left.every((amount) => amount < 1))
      return d - from;
  }
  return null;
}
function describeResponse(scenario, run, triggerDay, loss) {
  const dayBefore = run.days[triggerDay - 1];
  const share2 = scenario.target === void 0 ? 0 : dayBefore.positions[scenario.target] / dayBefore.assets * 100;
  const planner = config2.policy === "water_filling";
  const cap = pathConfig.capPercent >= 100 ? "" : planner && config2.providers[scenario.target ?? -1] === config2.entry_provider ? " (the entry provider, which the allocator does not cap)" : planner && Number(share2.toFixed(2)) > pathConfig.capPercent ? ` (above the provider cap of ${pathConfig.capPercent}%: the allocator takes the excess out at the next reading at which the move can execute)` : Number(share2.toFixed(2)) > pathConfig.capPercent ? ` (above the provider cap of ${pathConfig.capPercent}%, which acts only when a rebalance executes)` : ` (provider cap ${pathConfig.capPercent}%)`;
  const limit = config2.circuit_breaker_percent;
  const breaker = scenario.events.find((event) => event.rule === "circuit_breaker");
  const anomaly = scenario.events.find((event) => event.rule === "anomaly_gate");
  const excluded = anomaly ? ` Anomaly gate excluded the provider on ${anomaly.date}.` : "";
  const tripped = planner ? "RiskGuard's circuit breaker and anomaly gate are the public vault's and are not on the allocator's path: no rule of the allocator reads a loss." : breaker ? `Circuit breaker triggered on ${breaker.date} (assets moved ${breaker.change.toFixed(
    1
  )}% against a ${limit}% threshold): no rebalance was decided at that reading, and the breaker acts at that reading only.` : `Circuit breaker not triggered: assets moved ${(loss * 100).toFixed(1)}% against a ${limit}% threshold.`;
  const next = run.days.slice(triggerDay).find((row) => row.rebalances > 0);
  const moved = next ? `The vault's first movement after the event is on ${next.date}.` : "The vault makes no movement in the rest of the year.";
  const lost = `${(loss * 100).toFixed(2)}% of the vault's assets at the lowest daily close`;
  switch (scenario.kind) {
    case "depeg":
      return "Nothing in the vault reacts: it is denominated in USDC and no rule reads the dollar price. The USDC balance is unaffected; the scenario changes the USD valuation only.";
    case "curator_bad_debt":
      return `The position was ${share2.toFixed(2)}% of the vault${cap}, so the loss is ${lost}. ${tripped} There is no exit rule: the position stays until a rebalance by rate moves it. ${moved}` + (config2.high_water_mark ? " No performance fee is charged until the previous high is regained." : " The performance fee is charged again from the first positive day: the contract has no high-water mark.") + excluded;
    case "protocol_hack": {
      const after = run.days[triggerDay];
      const top = largest(after.positions);
      return `${tripped} ${moved} The position was ${share2.toFixed(2)}% of the vault${cap}, so the loss is ${lost}. ` + (Math.round(share2) >= 100 ? "Nothing was held in another provider." : `${after.rebalances === 0 ? "What was left stayed where it was" : "What was left was rebalanced that day"}: ${(after.positions[top] / after.assets * 100).toFixed(2)}% of it in ${label(
        config2.providers[top]
      )} at the close of that day.`) + (config2.stress.protocol_hack.loss_percent < 100 ? " What the venue kept cannot be withdrawn, so no later rebalance that moves it can execute." : "");
    }
    case "withdrawal_freeze": {
      const frozenDays = run.days.slice(triggerDay, triggerDay + config2.stress.withdrawal_freeze.days);
      const payable = (row) => row.liquidity / row.assets * 100;
      const lowest = frozenDays.reduce((low, row) => payable(row) < payable(low) ? row : low);
      const reverted = scenario.events.filter((event) => event.rule === "frozen_move");
      const [from, until] = scenario.frozen;
      const made = run.moves.filter((move) => move.t >= from && move.t < until).length;
      return `No loss. ${payable(frozenDays[0]).toFixed(2)}% of the vault's assets could be withdrawn on the first day and ${payable(lowest).toFixed(2)}% at the lowest, on ${lowest.date}; the frozen position returns after ${config2.stress.withdrawal_freeze.days} days. No rule detects a freeze. Days on which a rebalance with a movement out of the frozen venue would have reverted as a whole: ${new Set(reverted.map((event) => event.date)).size}, at ${reverted.length} readings. ` + (made === 0 ? "The vault made no movement while the venue was frozen." : `The vault made ${made} movements while the venue was frozen, none of them out of it.`) + excluded;
    }
  }
}
function main() {
  for (const name of [config2.entry_provider, config2.aave_provider, ...Object.keys(config2.eligible_periods ?? {})]) {
    if (!config2.providers.includes(name))
      throw new Error(`${name} is not among the simulated providers`);
  }
  for (const [from, to] of Object.values(config2.eligible_periods ?? {}).flat()) {
    if (!([from, to].every((date) => /^\d{4}-\d\d-\d\d$/.test(date)) && from < to))
      throw new Error(`eligible_periods: [${from}, ${to}) is not a period of UTC dates`);
  }
  if (config2.policy === "water_filling" && !config2.risk_guard_enabled)
    throw new Error("policy water_filling reads its cap through risk_guard_enabled: set it to true");
  (0, import_fs.mkdirSync)(OUT, { recursive: true });
  const samples = loadSamples();
  const strategies = [
    "thesauros_simple",
    "first_split_held",
    "eligible_equal_weight",
    "just_aave",
    "just_best_vault"
  ];
  const columns = (prefix) => config2.providers.map((name) => `${prefix}_${label(name).toLowerCase().replace(/ /g, "_")}`);
  const venueColumns = columns("pct");
  const runs = strategies.map((strategy) => simulate(samples, strategy));
  const [thesauros] = runs;
  if (process.env.TANGEM_DECISIONS)
    (0, import_fs.writeFileSync)(process.env.TANGEM_DECISIONS, thesauros.decisions.join("\n") + "\n");
  writeCsv(
    "tangem-simulation-daily.csv",
    [
      "date",
      "strategy",
      "total_assets",
      "daily_yield",
      "cumulative_yield",
      "apy_trailing_30d",
      "rebalance_count",
      "rebalances_refused",
      "gas_spent_wei",
      "gas_spent_usd",
      "fees_paid",
      "fee_basis",
      "available_liquidity",
      "outside_set_percent",
      ...venueColumns,
      ...columns("interest")
    ],
    runs.flatMap((run, i) => dailyRows(strategies[i], run))
  );
  writeCsv(
    "tangem-simulation-rebalances.csv",
    [
      "datetime_utc",
      "date",
      "strategy",
      "tx",
      "from",
      "to",
      "amount",
      "source_free_liquidity",
      "gas_used",
      "gas_cost_wei",
      "gas_cost_usd",
      "apr_before_percent",
      "apr_after_percent",
      "expected_gain_pp",
      "realized_change_pp",
      "reason"
    ],
    runs.flatMap(
      (run, i) => run.moves.map((move) => [
        new Date(move.t * 1e3).toISOString().replace(".000Z", "Z"),
        dayOf(move.t),
        strategies[i],
        move.tx,
        label(config2.providers[move.from]),
        label(config2.providers[move.to]),
        money(move.amount),
        money(move.sourceLiquidity),
        move.gasUsed,
        Math.round(move.gasWei),
        move.gasUsd.toFixed(4),
        percent(move.aprBefore),
        percent(move.aprAfter),
        move.expectedGain === null ? "" : move.expectedGain.toFixed(4),
        ((move.aprAfter - move.aprBefore) * 100).toFixed(4),
        // The decision compares rates as they stand before the move; what the vault earns after it is
        // the column before. A forced exit is no such comparison: the venue was read as paying nothing.
        move.forced ? BARRED[move.forced] : strategies[i] === "eligible_equal_weight" ? "equal parts over the venues that take money" : move.restore ? `back under the provider cap of ${pathConfig.capPercent}% whatever the move earns` : move.expectedGain === null ? "moved in the transaction of a forced exit" : config2.policy === "water_filling" ? `expected gain with the vault's own deposit priced at least ${waterFill.intraMinGainBps / 100} pp a year at ${waterFill.persistenceRuns} readings in a row` : `expected gain on the rates before the move at least ${LIVE.thresholdBps / 100} pp a year`
      ])
    )
  );
  const kinds = ["depeg", "curator_bad_debt", "protocol_hack", "withdrawal_freeze"];
  const stressRows = [];
  const timelines = [];
  const triggerDay = thesauros.days.findIndex((row) => row.date >= config2.stress.trigger_date);
  const unstressed = thesauros.days[thesauros.days.length - 1].assets;
  stressRows.push([
    "no_stress",
    "",
    config2.stress.trigger_date,
    triggerDay + 1,
    money(0),
    percent(0),
    daysToExit(thesauros, triggerDay) ?? "not within the period",
    money(unstressed),
    money(0),
    '"reference run"'
  ]);
  for (const kind of kinds) {
    const scenario = { kind, events: [] };
    const run = simulate(samples, "thesauros_simple", scenario);
    const value = (row) => row.assets * row.price;
    const before = value(run.days[triggerDay - 1]);
    const worst = Math.min(...run.days.slice(triggerDay).map(value));
    const last = run.days[run.days.length - 1];
    const exit = daysToExit(run, triggerDay);
    const response = describeResponse(scenario, run, triggerDay, Math.max(0, before - worst) / before);
    stressRows.push([
      kind,
      kind === "depeg" ? "" : label(config2.providers[scenario.target]),
      config2.stress.trigger_date,
      triggerDay + 1,
      money(Math.max(0, before - worst)),
      percent(Math.max(0, before - worst) / before),
      exit === null ? "not within the period" : exit,
      money(value(last)),
      money(value(last) - unstressed),
      `"${response}"`
    ]);
    run.days.forEach(
      (row) => timelines.push([
        kind,
        row.date,
        money(row.assets),
        row.price,
        money(value(row)),
        money(row.liquidity),
        row.rebalances,
        ...row.positions.map((position) => share(position, row.assets))
      ])
    );
  }
  writeCsv(
    "tangem-stress-tests.csv",
    [
      "scenario",
      "provider_hit",
      "trigger_date",
      "trigger_day",
      "max_loss_usd",
      "max_loss_percent",
      "time_to_exit_days",
      "final_balance_usd",
      "final_balance_vs_no_stress_usd",
      "riskguard_response"
    ],
    stressRows
  );
  writeCsv(
    "tangem-stress-timelines.csv",
    [
      "scenario",
      "date",
      "total_assets_usdc",
      "usdc_price",
      "total_value_usd",
      "available_liquidity",
      "rebalance_count",
      ...venueColumns
    ],
    timelines
  );
  const years = (samples[samples.length - 1].t - samples[0].t) / YEAR;
  runs.forEach((run, i) => {
    const last = run.days[run.days.length - 1];
    const yields = run.days.reduce(
      (sum2, row, d) => sum2 + row.assets - (d ? run.days[d - 1].assets : config2.initial_deposit),
      0
    );
    if (!(Math.abs(yields - (last.assets - config2.initial_deposit)) <= 0.01))
      throw new Error(`${strategies[i]}: daily yields do not add up`);
    run.days.forEach((row, d) => {
      const change = row.assets - (d ? run.days[d - 1].assets : config2.initial_deposit);
      const paid = row.interest.reduce((sum2, earned) => sum2 + earned, 0) - row.gasUsd - row.fees;
      if (!(Math.abs(paid - change) <= 0.01))
        throw new Error(`${strategies[i]}: interest less gas and fees is not the change of the balance on ${row.date}`);
    });
    if (run.days.some((row) => row.positions.some((position) => !(position >= 0))))
      throw new Error(`${strategies[i]}: a position is negative or not a number`);
    const counted = run.days.reduce((sum2, row) => sum2 + row.rebalances, 0);
    if (counted !== run.moves.length)
      throw new Error(`${strategies[i]}: rebalance rows ${run.moves.length} != daily count ${counted}`);
    const outside = run.days.flatMap(
      (row) => config2.providers.filter((name, p) => row.positions[p] > 2 && !inSet(name, Date.parse(row.date) / 1e3)).map((name) => `${row.date} ${label(name)}`)
    );
    console.log(
      `${strategies[i].padEnd(21)} ${run.days[0].date}..${last.date} (${run.days.length} days)  final $${money(
        last.assets
      )}  net APY ${percent((last.assets / config2.initial_deposit) ** (1 / years) - 1)}%  rebalances ${run.moves.length}  refused ${run.days.reduce((s, r) => s + r.refused, 0)}  gas $${money(run.days.reduce((s, r) => s + r.gasUsd, 0))}  fees $${money(
        run.days.reduce((s, r) => s + r.fees, 0)
      )}` + (config2.eligible_periods ? `  outside the set ${outside.length} venue-days${outside.length ? ", first " + outside[0] : ""}` : "") + (run.bestVault ? `  (${run.bestVault})` : "")
    );
  });
  if (thesauros.days[0].date !== config2.start_date)
    throw new Error(`the series starts on ${thesauros.days[0].date}`);
  stressRows.forEach((row) => console.log(row.join(" | ")));
  console.log(
    "Checks passed: daily yields add up to the final balance, interest less gas and fees is the change of the balance on every day, no position is negative or not a number, rebalance rows match the daily counts"
  );
}
main();
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

decimal.js/decimal.mjs:
  (*!
   *  decimal.js v10.6.0
   *  An arbitrary-precision Decimal type for JavaScript.
   *  https://github.com/MikeMcl/decimal.js
   *  Copyright (c) 2025 Michael Mclaughlin <M8ch88l@gmail.com>
   *  MIT Licence
   *)
*/
