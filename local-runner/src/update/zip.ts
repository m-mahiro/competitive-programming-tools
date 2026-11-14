import zlib from "node:zlib";

// zip の読み取り。外部のコマンド(unzip、tar、PowerShell)に頼らず、どの OS でも同じように展開するために持つ。
// 配布物に要る範囲だけを扱う: 無圧縮と deflate、4GB 未満、暗号化なし。

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const FLAG_ENCRYPTED = 0x0001;
const HOST_UNIX = 3;

export type ZipEntry = {
	/** zip の中のパス。区切りは `/`。 */
	readonly name: string;
	readonly isDirectory: boolean;
	/** Unix の権限(実行の可否など)。Unix で作られた zip でなければ null。 */
	readonly mode: number | null;
	/** 中身を取り出す。壊れていればエラーにする。 */
	read(): Buffer;
};

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (let index = 0; index < data.length; index++) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** 末尾から、中央ディレクトリの終わりの記録を探す。コメントの分だけ前にずれていることがある。 */
function findEndRecord(archive: Buffer): number {
	const lowest = Math.max(0, archive.length - END_RECORD_SIZE - MAX_COMMENT_SIZE);
	for (let offset = archive.length - END_RECORD_SIZE; offset >= lowest; offset--) {
		if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
	}
	throw new Error("This is not a zip file (the end record was not found).");
}

function readEntry(archive: Buffer, name: string, method: number, crc: number, compressedSize: number, size: number, localOffset: number): Buffer {
	if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error(`The zip file is broken (no local header for ${name}).`);
	const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
	const compressed = archive.subarray(dataStart, dataStart + compressedSize);
	if (compressed.length !== compressedSize) throw new Error(`The zip file is cut off (${name}).`);
	let data: Buffer;
	if (method === METHOD_STORED) data = compressed;
	else if (method === METHOD_DEFLATED) data = zlib.inflateRawSync(compressed);
	else throw new Error(`Unsupported compression method ${method} (${name}).`);
	if (data.length !== size || crc32(data) !== crc) throw new Error(`The zip file is broken (${name} does not match its checksum).`);
	return data;
}

/** zip の中身の一覧を返す。中身は read() を呼ぶまで取り出さない。 */
export function readZip(archive: Buffer): ZipEntry[] {
	if (archive.length < END_RECORD_SIZE) throw new Error("This is not a zip file (it is too short).");
	const end = findEndRecord(archive);
	const count = archive.readUInt16LE(end + 10);
	let offset = archive.readUInt32LE(end + 16);
	if (count === 0xffff || offset === 0xffffffff) throw new Error("Zip64 files are not supported.");

	const entries: ZipEntry[] = [];
	for (let index = 0; index < count; index++) {
		if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
			throw new Error("The zip file is broken (the file list is damaged).");
		}
		const host = archive.readUInt16LE(offset + 4) >>> 8;
		const flags = archive.readUInt16LE(offset + 8);
		const method = archive.readUInt16LE(offset + 10);
		const crc = archive.readUInt32LE(offset + 16);
		const compressedSize = archive.readUInt32LE(offset + 20);
		const size = archive.readUInt32LE(offset + 24);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const externalAttributes = archive.readUInt32LE(offset + 38);
		const localOffset = archive.readUInt32LE(offset + 42);
		const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
		if (flags & FLAG_ENCRYPTED) throw new Error(`Encrypted zip files are not supported (${name}).`);
		if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error("Zip64 files are not supported.");
		entries.push({
			name,
			isDirectory: name.endsWith("/"),
			mode: host === HOST_UNIX ? (externalAttributes >>> 16) & 0o7777 : null,
			read: () => readEntry(archive, name, method, crc, compressedSize, size, localOffset),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}
