// The yearly file of the Losungen, "Losungen Free YYYY.xml". The publisher
// offers it once a year as a zip file on https://www.losungen.de/download/.
const zlib = require("node:zlib");

// Both servers belong to the publisher and serve the same files. The
// second one is used if the first one fails.
const DOWNLOAD_URLS = [
	"https://www.ebu.de/fileadmin/media-losungen/download/Losung_{year}_XML.zip",
	"https://www.brueder-unitaet.de/download/Losung_{year}_XML.zip"
];
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
// The zip file of a year has about 150 KB, the XML file about 180 KB
const MAX_ZIP_BYTES = 5 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

const fileNameOf = (year) => `Losungen Free ${year}.xml`;

// Downloaded text in a message is cut short and quoted, so it cannot flood
// the log or send control characters to a terminal
const excerpt = (text) => JSON.stringify(String(text).slice(0, 40));
const clean = (text) => String(text).replace(/\p{Cc}/gu, " ").slice(0, 200);

function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, name) => {
		if (name[0] !== "#") return ENTITIES[name.toLowerCase()];
		return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
	});
}

/**
 * Decodes the bytes of an XML file with the encoding of its declaration.
 * The files of the publisher are UTF-8.
 * @param {Buffer} bytes The file
 * @returns {string} The text
 */
function decodeFile(bytes) {
	const declared = /^\s*<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(bytes.subarray(0, 200).toString("latin1"));
	return new TextDecoder(declared ? declared[1] : "utf-8").decode(bytes);
}

/**
 * Reads the texts of a year. The texts keep the marks of the file: words
 * between slashes introduce a quotation, e.g. "/Paulus sprach:/", and words
 * between hash signs are emphasized.
 * @param {string} xml The yearly file
 * @param {number} year The year the file must contain
 * @returns {Map<string, object>} The texts by date "YYYY-MM-DD"
 */
function parseLosungen(xml, year) {
	const days = new Map();
	// Linear for any input, even a crafted one: a day ends at the next
	// closing tag, and a value cannot contain "<"
	for (const piece of xml.split("</Losungen>").slice(0, -1)) {
		const start = piece.lastIndexOf("<Losungen");
		const open = start < 0 ? null : /^<Losungen(?:\s[^<>]*)?>/.exec(piece.slice(start));
		if (!open) continue;
		const fields = {};
		for (const [, name, value] of piece.slice(start + open[0].length).matchAll(/<(\w+)(?:\s[^<>]*)?>([^<]*)<\/\1>/g))
			fields[name] = decodeEntities(value).trim();
		const date = /^\d{4}-\d{2}-\d{2}/.exec(fields.Datum || "");
		if (!date || Number(date[0].slice(0, 4)) !== year)
			throw new Error(`Unexpected date ${excerpt(fields.Datum)} in the Losungen of ${year}`);
		for (const name of ["Losungstext", "Losungsvers", "Lehrtext", "Lehrtextvers"])
			if (!fields[name]) throw new Error(`${name} is missing on ${date[0]}`);
		if (days.has(date[0])) throw new Error(`${date[0]} appears twice`);
		days.set(date[0], {
			losung: { text: fields.Losungstext, reference: fields.Losungsvers },
			lehrtext: { text: fields.Lehrtext, reference: fields.Lehrtextvers }
		});
	}
	// A broken or foreign file is rejected; a file with a missing day is not
	if (days.size < 360) throw new Error(`The Losungen of ${year} have only ${days.size} days`);
	return days;
}

/**
 * Extracts the XML file from the zip file of the publisher. Only stored and
 * deflated entries without ZIP64 are supported, which is what it uses.
 * @param {Buffer} zip The zip file
 * @returns {Buffer} The XML file
 */
function xmlFromZip(zip) {
	const [xml] = filesFromZip(zip, (name) => /\.xml$/i.test(name)).values();
	if (!xml) throw new Error("No XML file in the zip file");
	return xml;
}

/**
 * Extracts the files whose names are wanted from a zip file, e.g. the
 * yearly file or an EPUB. Only stored and deflated entries without ZIP64
 * are supported, which is what the publishers use.
 * @param {Buffer} zip The zip file
 * @param {function(string): boolean} wanted Whether a file name is wanted
 * @returns {Map<string, Buffer>} The files by name
 */
function filesFromZip(zip, wanted) {
	const end = zip.lastIndexOf(Buffer.from("PK\x05\x06", "latin1"));
	if (end < 0 || end + 22 > zip.length) throw new Error("Not a zip file");
	const count = zip.readUInt16LE(end + 10);
	let offset = zip.readUInt32LE(end + 16);
	const files = new Map();
	for (let index = 0; index < count; index++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Damaged zip file");
		const method = zip.readUInt16LE(offset + 10);
		const crc = zip.readUInt32LE(offset + 16);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const size = zip.readUInt32LE(offset + 24);
		const nameLength = zip.readUInt16LE(offset + 28);
		const localHeader = zip.readUInt32LE(offset + 42);
		const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
		if (!wanted(name)) continue;

		if (size > MAX_XML_BYTES) throw new Error(`${excerpt(name)} is too large`);
		if (zip.readUInt32LE(localHeader) !== 0x04034b50) throw new Error("Damaged zip file");
		const start = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
		const data = zip.subarray(start, start + compressedSize);
		if (data.length !== compressedSize) throw new Error("Damaged zip file");
		let file;
		if (method === 0) file = data;
		else if (method === 8) file = zlib.inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
		else throw new Error(`Unsupported compression of ${excerpt(name)}`);
		if (file.length !== size || zlib.crc32(file) !== crc) throw new Error("Damaged zip file");
		files.set(name, file);
	}
	return files;
}

function describe(error) {
	if (error.name === "TimeoutError") return "timeout";
	return clean((error.cause && (error.cause.code || error.cause.message)) || error.message);
}

// Frees the connection of an answer whose body is not needed
function discard(response) {
	if (response.body && response.body.cancel) response.body.cancel().catch(() => {});
}

// Follows redirects only to https addresses, so no step of the way can be
// changed in the network
async function get(url, fetch, timeoutMs) {
	const signal = AbortSignal.timeout(timeoutMs);
	for (let redirects = 0; ; redirects++) {
		const response = await fetch(url, { signal, redirect: "manual" });
		const location = response.headers.get("location");
		if (response.status < 300 || response.status >= 400 || !location) return { response, url };
		discard(response);
		if (redirects === MAX_REDIRECTS) throw new Error("too many redirects");
		url = new URL(location, url).href;
		if (!url.startsWith("https:")) throw new Error(`redirected to ${excerpt(url)}`);
	}
}

// The size is counted while reading, after fetch has undone any
// compression of the transfer
async function readZip(response) {
	if (Number(response.headers.get("content-length")) > MAX_ZIP_BYTES) {
		discard(response);
		throw new Error("too large");
	}
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > MAX_ZIP_BYTES) throw new Error("too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, length);
}

/**
 * Downloads the yearly file from the first server that has it.
 * @param {number} year The year
 * @param {object} options fetch: the fetch function, urls: the addresses
 * with "{year}", timeoutMs: the time for each server
 * @returns {Promise<{xml: Buffer, days: Map, url: string}>} The checked XML
 * file, its texts and where it came from. It fails with notPublished set
 * when a server answered 404, which for the next year means it is not out yet.
 */
async function downloadYear(year, { fetch = globalThis.fetch, urls = DOWNLOAD_URLS, timeoutMs = TIMEOUT_MS } = {}) {
	const errors = [];
	let notPublished = false;
	for (const address of urls.map((template) => template.replace("{year}", year))) {
		try {
			const { response, url } = await get(address, fetch, timeoutMs);
			if (response.status === 404) notPublished = true;
			if (!response.ok) {
				discard(response);
				throw new Error(`HTTP ${response.status}`);
			}
			const xml = xmlFromZip(await readZip(response));
			return { xml, days: parseLosungen(decodeFile(xml), year), url };
		} catch (error) {
			errors.push(`${address}: ${describe(error)}`);
		}
	}
	const error = new Error(`The Losungen of ${year} could not be downloaded (${errors.join(", ")})`);
	error.notPublished = notPublished;
	throw error;
}

module.exports = { DOWNLOAD_URLS, clean, decodeEntities, decodeFile, downloadYear, fileNameOf, filesFromZip, parseLosungen, xmlFromZip };
