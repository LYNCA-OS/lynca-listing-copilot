import { inflateRawSync } from "node:zlib";

function endOfCentralDirectoryOffset(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("xlsx_end_of_central_directory_missing");
}

export function readXlsxPackageEntries(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const eocd = endOfCentralDirectoryOffset(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("xlsx_central_directory_entry_invalid");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("xlsx_local_file_header_invalid");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const bytes = method === 0 ? Buffer.from(compressed)
      : method === 8 ? inflateRawSync(compressed)
        : null;
    if (!bytes) throw new Error(`xlsx_compression_method_unsupported:${method}`);
    entries.set(name, bytes);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

export function inspectXlsxImagePackage(value) {
  const entries = readXlsxPackageEntries(value);
  const contentTypes = entries.get("[Content_Types].xml")?.toString("utf8") || "";
  const drawingRelationships = [...entries.entries()]
    .filter(([name]) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(name))
    .map(([name, bytes]) => ({ name, xml: bytes.toString("utf8") }));
  const media = [...entries.entries()]
    .filter(([name]) => /^xl\/media\/[^/]+$/.test(name))
    .map(([name, bytes]) => ({
      name,
      extension: name.split(".").at(-1)?.toLowerCase() || "",
      bytes
    }));
  return { contentTypes, drawingRelationships, media };
}
