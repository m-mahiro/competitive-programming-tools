import zlib from "node:zlib";

// テスト用の zip を作る。読み取り(zip.ts)とは別の実装で書き、読み取りの誤りを同じ誤りで見逃さないようにする。

export type TestZipEntry = {
	name: string;
	data?: Buffer | string;
	/** 無圧縮で入れる。 */
	stored?: boolean;
	/** Unix の権限。指定すると、Unix で作った zip として記録する。 */
	mode?: number;
};

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** 項目の並びから zip を作る。名前が `/` で終わる項目はフォルダになる。 */
export function createTestZip(entries: readonly TestZipEntry[], comment = ""): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const data = Buffer.from(entry.data ?? "");
		const stored = entry.stored === true || data.length === 0;
		const body = stored ? data : zlib.deflateRawSync(data);
		const method = stored ? 0 : 8;
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(entry.mode === undefined ? 20 : (3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(entry.mode === undefined ? 0 : (entry.mode << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += 30 + name.length + body.length;
	}
	const centralDirectory = Buffer.concat(centrals);
	const commentBytes = Buffer.from(comment, "utf8");
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(commentBytes.length, 20);
	return Buffer.concat([...locals, centralDirectory, end, commentBytes]);
}
