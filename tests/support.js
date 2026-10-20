// Yearly files, zip files and fetch answers for the tests. The tests use
// made-up texts, because the terms of use allow the real ones only for the
// previous, current and next year.
const zlib = require("node:zlib");

/**
 * A yearly file in the format of the publisher with a text for every day.
 * @param {number} year The year
 * @param {object} special The fields of single days by date "YYYY-MM-DD"
 * @returns {string} The file
 */
function yearlyXml(year, special = {}) {
	const entries = [];
	for (const day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
		const date = day.toISOString().slice(0, 10);
		const fields = { Losungstext: `Losung ${date}`, Losungsvers: "Psalm 1,1", Lehrtext: `Lehrtext ${date}`, Lehrtextvers: "Matthäus 1,1", ...special[date] };
		const lines = Object.entries(fields).map(([name, value]) => `\t\t<${name}>${value}</${name}>\r\n`);
		entries.push(`\t<Losungen>\r\n\t\t<Datum>${date}T00:00:00.000</Datum>\r\n\t\t<Wtag>Tag</Wtag>\r\n${lines.join("")}\t</Losungen>\r\n`);
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<FreeXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\r\n${entries.join("")}</FreeXml>\r\n`;
}

/**
 * A zip file like the ones of the publisher.
 * @param {{name: string, data: string|Buffer, store?: boolean}[]} files The
 * files, deflated unless store is set
 * @returns {Buffer} The zip file
 */
function zipOf(files) {
	const parts = [];
	const directory = [];
	let offset = 0;
	for (const { name, data, store = false } of files) {
		const content = Buffer.from(data);
		const compressed = store ? content : zlib.deflateRawSync(content);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(store ? 0 : 8, 8);
		local.writeUInt32LE(zlib.crc32(content), 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(content.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(store ? 0 : 8, 10);
		central.writeUInt32LE(zlib.crc32(content), 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(content.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		parts.push(local, nameBytes, compressed);
		directory.push(central, nameBytes);
		offset += local.length + nameBytes.length + compressed.length;
	}
	const centralDirectory = Buffer.concat(directory);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, centralDirectory, end]);
}

/**
 * An answer of fetch.
 * @param {number} status The HTTP status
 * @param {string|Buffer|AsyncIterable} body The body, or chunks of it
 * @param {object} headers More headers, e.g. location
 * @returns {object} The answer
 */
function response(status, body = "", headers = {}) {
	const chunks = typeof body === "string" || Buffer.isBuffer(body) ? [Buffer.from(body)] : body;
	const length = Array.isArray(chunks) ? { "content-length": String(chunks[0].length) } : {};
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Map(Object.entries({ ...length, ...headers })),
		body: {
			cancelled: false,
			async* [Symbol.asyncIterator]() {
				yield* chunks;
			},
			// Like a stream of fetch, which frees the connection
			cancel() {
				this.cancelled = true;
				return Promise.resolve();
			}
		}
	};
}

/**
 * The error of fetch for a server that cannot be reached.
 * @returns {TypeError} The error
 */
function networkError() {
	return Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
}

module.exports = { networkError, response, yearlyXml, zipOf };
