const MAX_ENTRIES = 5_000;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

/**
 * Walks an OOXML file's ZIP central directory and refuses anything that would be
 * unsafe to expand: multi-volume and ZIP64 containers, encrypted entries, paths
 * that escape the archive, and the compression ratios that make a zip bomb.
 *
 * DOCX and XLSX are the same container with different parts inside, so both go
 * through this before any decompression happens. `label` only shapes the error
 * text a person reads.
 */
export function validateOoxmlArchive(bytes: Buffer, label: string): void {
  const minEocdBytes = 22;
  const searchStart = Math.max(0, bytes.length - minEocdBytes - 0xffff);
  let eocdOffset = -1;
  for (let offset = bytes.length - minEocdBytes; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + minEocdBytes + bytes.readUInt16LE(offset + 20) === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`${label} archive directory is missing or corrupt.`);

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralBytes = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error(`Multi-volume ${label} archives are not supported.`);
  if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) throw new Error(`ZIP64 ${label} archives are not supported.`);
  if (entryCount === 0 || entryCount > MAX_ENTRIES) throw new Error(`${label} archive must contain at most ${MAX_ENTRIES} entries.`);
  if (centralOffset + centralBytes > eocdOffset) throw new Error(`${label} archive directory is corrupt.`);

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${label} archive entry is corrupt.`);
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedBytes = bytes.readUInt32LE(offset + 24);
    const nameBytes = bytes.readUInt16LE(offset + 28);
    const extraBytes = bytes.readUInt16LE(offset + 30);
    const commentBytes = bytes.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (nextOffset > bytes.length || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) throw new Error(`ZIP64 ${label} entries are not supported.`);
    if ((flags & 0x1) !== 0) throw new Error(`Encrypted ${label} archives are not supported.`);
    const name = bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:\//i.test(name) || name.split('/').includes('..')) throw new Error(`${label} archive contains an unsafe entry path.`);
    if (uncompressedBytes > MAX_ENTRY_BYTES) throw new Error(`${label} archive contains an oversized entry.`);
    if (uncompressedBytes > 1_000_000 && compressedBytes > 0 && uncompressedBytes / compressedBytes > MAX_COMPRESSION_RATIO) {
      throw new Error(`${label} archive has an unsafe compression ratio.`);
    }
    totalUncompressed += uncompressedBytes;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error(`${label} archive expands beyond the safe limit.`);
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralBytes) throw new Error(`${label} archive directory size does not match its entries.`);
}
