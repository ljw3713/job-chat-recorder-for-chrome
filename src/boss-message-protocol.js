(function () {
  'use strict';

  const encoder = new TextEncoder();
  const bytes = (value) => value instanceof Uint8Array ? value : encoder.encode(String(value));
  const join = (...parts) => {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length); let offset = 0;
    parts.forEach((part) => { out.set(part, offset); offset += part.length; });
    return out;
  };
  const varint = (input) => {
    let value = BigInt(input); if (value < 0n) throw new Error('Varint 不能为负数。');
    const out = []; do { let byte = Number(value & 127n); value >>= 7n; if (value) byte |= 128; out.push(byte); } while (value);
    return Uint8Array.from(out);
  };
  const readVarint = (data, offset = 0) => {
    let value = 0n; let shift = 0n;
    for (let i = offset; i < data.length && i - offset < 10; i += 1) {
      const byte = data[i]; value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return { value, offset: i + 1 };
      shift += 7n;
    }
    throw new Error('无效 Varint。');
  };
  const u16 = (value) => Uint8Array.of((Number(value) >>> 8) & 255, Number(value) & 255);
  const u64be = (data, offset) => new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, false);
  const field = (number, wire, value) => join(varint((number << 3) | wire), value);
  const vint = (number, value) => field(number, 0, varint(value));
  const nested = (number, value) => field(number, 2, join(varint(value.length), value));
  const text = (number, value) => nested(number, bytes(value));
  const fixed64 = (number, value) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(value), true); return field(number, 1, out); };
  const frame = (type, payload) => join(Uint8Array.of(type), varint(payload.length), payload);
  const route = (sequence, message) => join(u16(4), bytes('chat'), u16(sequence), message);

  function authFrame({ connectionId, httpToken, wt2 }) {
    const magic = bytes('MQIsdp');
    const payload = join(u16(magic.length), magic, Uint8Array.of(3, 194, 0, 25), u16(bytes(connectionId).length), bytes(connectionId), u16(bytes(`${httpToken}|0`).length), bytes(`${httpToken}|0`), u16(bytes(wt2).length), bytes(wt2));
    return frame(0x10, payload);
  }
  function registerFrame(context) {
    const client = join(text(1, context.version || '4.92'), nested(2, new Uint8Array()), nested(3, new Uint8Array()), nested(4, new Uint8Array()), text(5, context.pcDeviceId), text(6, context.publicIp), vint(7, context.clientCode || 9019), text(8, 'web'), text(9, '-1'), nested(10, new Uint8Array()), nested(11, new Uint8Array()), fixed64(12, 0), fixed64(13, 0));
    const register = join(vint(1, 1), vint(2, context.userId), nested(3, client), vint(5, 0));
    return frame(0x33, route(1, join(vint(1, 2), nested(4, register))));
  }
  function textFrame({ sequence, userId, friendId, peerKey, cmid, message, timestamp = Date.now() }) {
    const from = join(vint(1, userId), vint(7, 0));
    const to = join(vint(1, friendId), text(2, peerKey), vint(7, 0));
    const content = join(vint(1, 1), vint(2, 1), text(3, message));
    const chat = join(nested(1, from), nested(2, to), vint(3, 1), vint(4, cmid), vint(5, timestamp), nested(6, content), vint(11, cmid));
    return frame(0x33, route(sequence, join(vint(1, 1), nested(3, chat))));
  }
  function parseFrame(raw) {
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (data.length < 2) throw new Error('服务端帧过短。');
    const length = readVarint(data, 1); const payloadLength = Number(length.value);
    if (data.length !== length.offset + payloadLength) throw new Error('服务端帧长度不匹配。');
    return { type: data[0], payload: data.slice(length.offset), payloadLength };
  }
  function parseAck(payload) {
    if (payload.length === 2) return { sequence: (payload[0] << 8) | payload[1] };
    if (payload.length !== 18) return null;
    return { sequence: (payload[0] << 8) | payload[1], cmid: u64be(payload, 2), mid: u64be(payload, 10) };
  }
  function pushSequence(payload) {
    if (payload.length < 8 || payload[0] !== 0 || payload[1] !== 4 || String.fromCharCode(...payload.slice(2, 6)) !== 'chat') return null;
    return (payload[6] << 8) | payload[7];
  }
  function ackFrame(sequence) { return frame(0x40, u16(sequence)); }

  globalThis.JobChatBossProtocol = { authFrame, registerFrame, textFrame, parseFrame, parseAck, pushSequence, ackFrame, varint, readVarint };
})();
