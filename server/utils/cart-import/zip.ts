import { inflateRawSync } from 'node:zlib';

/**
 * Just enough of the ZIP format to read the parts of an .xlsx workbook.
 *
 * Reads the central directory, then inflates single entries on request with
 * a hard ceiling on the inflated size, so a small upload cannot expand into
 * a large allocation. Encrypted entries, ZIP64 archives and compression
 * methods other than stored and deflate are refused: Excel writes none of
 * them for a workbook of this size.
 */

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipReadError';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export function isZipArchive(content: Buffer): boolean {
  return (
    content.length >= 4 &&
    (content.readUInt32LE(0) === LOCAL_HEADER ||
      content.readUInt32LE(0) === END_OF_DIRECTORY)
  );
}

function findEndOfDirectory(content: Buffer): number {
  const last = content.length - END_RECORD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT_SIZE);
  for (let offset = last; offset >= first; offset--) {
    if (content.readUInt32LE(offset) === END_OF_DIRECTORY) return offset;
  }
  throw new ZipReadError('No end of central directory record');
}

/** Entry names normalised to forward slashes without a leading slash. */
export function listZipEntries(content: Buffer): Map<string, ZipEntry> {
  if (content.length < END_RECORD_SIZE) {
    throw new ZipReadError('Too short to be a ZIP archive');
  }
  const end = findEndOfDirectory(content);
  const count = content.readUInt16LE(end + 10);
  const directorySize = content.readUInt32LE(end + 12);
  const directoryOffset = content.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new ZipReadError('ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > content.length) {
    throw new ZipReadError('Central directory outside the archive');
  }

  const entries = new Map<string, ZipEntry>();
  let offset = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (
      offset + 46 > content.length ||
      content.readUInt32LE(offset) !== DIRECTORY_ENTRY
    ) {
      throw new ZipReadError('Malformed central directory entry');
    }
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > content.length) {
      throw new ZipReadError('Entry name outside the archive');
    }
    const name = content
      .toString('utf8', offset + 46, nameEnd)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    entries.set(name, {
      name,
      flags: content.readUInt16LE(offset + 8),
      method: content.readUInt16LE(offset + 10),
      compressedSize: content.readUInt32LE(offset + 20),
      size: content.readUInt32LE(offset + 24),
      localOffset: content.readUInt32LE(offset + 42),
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

/**
 * Inflate one entry. `maxBytes` caps the output whatever the directory
 * claims the size to be: zlib stops and throws once it is passed.
 */
export function readZipEntry(
  content: Buffer,
  entry: ZipEntry,
  maxBytes: number,
): Buffer {
  if (entry.flags & 0x1) throw new ZipReadError('Encrypted entry');
  const local = entry.localOffset;
  if (
    local + 30 > content.length ||
    content.readUInt32LE(local) !== LOCAL_HEADER
  ) {
    throw new ZipReadError('Malformed local header');
  }
  const start =
    local +
    30 +
    content.readUInt16LE(local + 26) +
    content.readUInt16LE(local + 28);
  const end = start + entry.compressedSize;
  if (end > content.length) throw new ZipReadError('Entry outside the archive');
  const data = content.subarray(start, end);

  if (entry.method === 0) {
    if (data.length > maxBytes) throw new ZipReadError('Entry too large');
    return data;
  }
  if (entry.method === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength: maxBytes });
    } catch {
      throw new ZipReadError('Entry could not be inflated within the limit');
    }
  }
  throw new ZipReadError(`Unsupported compression method ${entry.method}`);
}
