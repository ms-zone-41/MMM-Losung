// Tests for reading and downloading the yearly file

const assert = require("node:assert/strict");
const test = require("node:test");
const { DOWNLOAD_URLS, decodeFile, downloadYear, parseLosungen, xmlFromZip } = require("../losungen-data");
const { networkError, response, yearlyXml, zipOf } = require("./support");

const urlsOf = (year) => DOWNLOAD_URLS.map((url) => url.replace("{year}", year));
const zipOfYear = (year) => zipOf([{ name: `Losungen Free ${year}.xml`, data: yearlyXml(year) }]);

test("reads all days of a year with their texts and marks", () => {
	const lehrtext = "/Paulus sprach:/ Ein erfundener Satz &amp; ein #betontes# Wort.";
	const days = parseLosungen(yearlyXml(2026, { "2026-10-20": { Lehrtext: lehrtext } }), 2026);
	assert.equal(days.size, 365);
	assert.deepEqual(days.get("2026-10-20"), {
		losung: { text: "Losung 2026-10-20", reference: "Psalm 1,1" },
		lehrtext: { text: "/Paulus sprach:/ Ein erfundener Satz & ein #betontes# Wort.", reference: "Matthäus 1,1" }
	});
	assert.equal(parseLosungen(yearlyXml(2028), 2028).size, 366);
});

test("rejects files of another year and broken files", () => {
	assert.throws(() => parseLosungen(yearlyXml(2025), 2026), /Unexpected date/);
	assert.throws(() => parseLosungen(yearlyXml(2026, { "2026-03-01": { Lehrtext: "" } }), 2026), /Lehrtext is missing on 2026-03-01/);
	assert.throws(() => parseLosungen("<html>Wartungsarbeiten</html>", 2026), /only 0 days/);
	const xml = yearlyXml(2026);
	const firstDay = xml.match(/\t<Losungen>[\s\S]*?<\/Losungen>\r\n/)[0];
	assert.throws(() => parseLosungen(xml.replace("</FreeXml>", `${firstDay}</FreeXml>`), 2026), /2026-01-01 appears twice/);
});

test("reads crafted files in linear time", () => {
	// About 200 KB each, which a quadratic parser needs seconds for
	for (const crafted of [`<Losungen>${"<a>".repeat(70000)}</Losungen>`, "<Losungen>".repeat(20000), "<Losungen ".repeat(20000)]) {
		const start = performance.now();
		assert.throws(() => parseLosungen(crafted, 2026));
		assert(performance.now() - start < 250, `took ${performance.now() - start} ms`);
	}
});

test("quotes only a short excerpt of the file in errors", () => {
	const crafted = yearlyXml(2026).replace("2026-01-01T00:00:00.000", `\u001b[2J${"x".repeat(100000)}`);
	assert.throws(() => parseLosungen(crafted, 2026), (error) => {
		assert(error.message.length < 100, error.message);
		assert.doesNotMatch(error.message, /\p{Cc}/u);
		return true;
	});
});

test("decodes a file with the encoding of its declaration", () => {
	const xml = yearlyXml(2026, { "2026-01-01": { Losungstext: "Grüße aus Herrnhut" } });
	const textOf = (bytes) => parseLosungen(decodeFile(bytes), 2026).get("2026-01-01").losung.text;
	assert.equal(textOf(Buffer.from(`\uFEFF${xml}`)), "Grüße aus Herrnhut");
	assert.equal(textOf(Buffer.from(xml.replace("UTF-8", "ISO-8859-1"), "latin1")), "Grüße aus Herrnhut");
});

test("extracts the XML file from a zip file of the publisher", () => {
	const xml = yearlyXml(2026);
	const terms = { name: "NUTZUNGSBEDINGUNGEN November 2023.pdf", data: "%PDF-1.7" };
	assert.equal(xmlFromZip(zipOf([{ name: "Losungen Free 2026.xml", data: xml }, terms])).toString(), xml);
	assert.equal(xmlFromZip(zipOf([terms, { name: "Losungen Free 2026.xml", data: xml, store: true }])).toString(), xml);
});

test("rejects damaged zip files", () => {
	const zip = zipOfYear(2026);
	const damaged = Buffer.from(zip);
	// A byte of the compressed data, after the header and the name
	damaged[60] ^= 0xff;
	assert.throws(() => xmlFromZip(damaged));
	assert.throws(() => xmlFromZip(zip.subarray(0, zip.length - 30)), /Not a zip file/);
	assert.throws(() => xmlFromZip(Buffer.from("<html>Wartungsarbeiten</html>")), /Not a zip file/);
	assert.throws(() => xmlFromZip(zipOf([{ name: "readme.txt", data: "Text" }])), /No XML file/);
	// A changed text in a stored entry is found by the checksum only
	const stored = zipOf([{ name: "Losungen Free 2026.xml", data: yearlyXml(2026), store: true }]);
	stored[stored.indexOf("Losung 2026-10-20") + 16] = "9".charCodeAt(0);
	assert.throws(() => xmlFromZip(stored), /Damaged zip file/);
	// A wrong size in the central directory
	const sized = Buffer.from(zip);
	const central = sized.readUInt32LE(sized.length - 22 + 16);
	sized.writeUInt32LE(sized.readUInt32LE(central + 24) + 1, central + 24);
	assert.throws(() => xmlFromZip(sized), /Damaged zip file/);
});

test("downloads from the first server that has a valid file", async () => {
	const requested = [];
	const fetch = async (url) => {
		requested.push(url);
		if (requested.length === 1) throw networkError();
		return response(200, zipOfYear(2027));
	};
	const { xml, days, url } = await downloadYear(2027, { fetch });
	assert.deepEqual(requested, urlsOf(2027).slice(0, 2));
	assert.equal(url, urlsOf(2027)[1]);
	assert.equal(parseLosungen(xml.toString(), 2027).size, 365);
	assert.equal(days.get("2027-10-20").losung.text, "Losung 2027-10-20");
});

test("skips error pages and files of other years", async () => {
	const answers = [response(200, "<html>Wartungsarbeiten</html>"), response(200, zipOfYear(2026))];
	await assert.rejects(downloadYear(2027, { fetch: async () => answers.shift() }), (error) => {
		assert.match(error.message, /Not a zip file.*Unexpected date/);
		assert.equal(error.notPublished, false);
		return true;
	});
	await assert.rejects(downloadYear(2027, { fetch: async () => response(503) }), (error) => {
		assert.match(error.message, /HTTP 503.*HTTP 503/);
		assert.equal(error.notPublished, false);
		return true;
	});
});

test("follows redirects only to https addresses", async () => {
	const cdn = "https://cdn.example.org/Losung_2027_XML.zip";
	const requested = [];
	const answers = {
		[urlsOf(2027)[0]]: response(302, "", { location: "http://www.ebu.de/Losung_2027_XML.zip" }),
		[urlsOf(2027)[1]]: response(301, "", { location: cdn }),
		[cdn]: response(200, zipOfYear(2027))
	};
	const fetch = async (url, options) => {
		requested.push(url);
		assert.equal(options.redirect, "manual");
		return answers[url];
	};
	const { url } = await downloadYear(2027, { fetch });
	assert.equal(url, cdn);
	assert.deepEqual(requested, [urlsOf(2027)[0], urlsOf(2027)[1], cdn]);
	const loop = async (url) => response(302, "", { location: `${url}?again` });
	await assert.rejects(downloadYear(2027, { fetch: loop, urls: [DOWNLOAD_URLS[0]] }), /too many redirects/);
});

test("follows relative redirects and at most three", async () => {
	const base = urlsOf(2027)[0];
	const hops = (count) => async (url) => {
		const hop = Number(new URL(url).searchParams.get("hop") || 0);
		return hop < count ? response(302, "", { location: `next.zip?hop=${hop + 1}` }) : response(200, zipOfYear(2027));
	};
	const { url } = await downloadYear(2027, { fetch: hops(3), urls: [base] });
	assert.equal(url, new URL("next.zip?hop=3", base).href);
	await assert.rejects(downloadYear(2027, { fetch: hops(4), urls: [base] }), /too many redirects/);
});

test("treats a redirect without an address as an error", async () => {
	await assert.rejects(downloadYear(2027, { fetch: async () => response(302), urls: [DOWNLOAD_URLS[0]] }), /HTTP 302/);
});

test("frees the connections of answers it does not read", async () => {
	const answers = [response(302, "", { location: "https://www.ebu.de/moved.zip" }), response(404), response(200, "", { "content-length": String(6 * 1024 * 1024) })];
	const given = [...answers];
	await assert.rejects(downloadYear(2027, { fetch: async () => answers.shift() }), /HTTP 404.*too large/);
	assert.deepEqual(given.map((answer) => answer.body.cancelled), [true, true, true]);
});

test("gives all redirects of a server one timeout together", async () => {
	// Each step takes 30 ms, two steps take longer than the 50 ms of a server
	const fetch = (url, { signal }) => new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(url.endsWith("moved.zip") ? response(200, zipOfYear(2027)) : response(302, "", { location: "moved.zip" })), 30);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});
	await assert.rejects(downloadYear(2027, { fetch, urls: [DOWNLOAD_URLS[0]], timeoutMs: 50 }), /timeout/);
});

test("stops reading an answer that is too large, whatever its headers say", async () => {
	let chunks = 0;
	const endless = (async function* () {
		// Without a limit the module would read on and on
		while (chunks < 100) {
			chunks++;
			yield Buffer.alloc(1024 * 1024);
		}
		throw new Error("read 100 MB");
	}());
	await assert.rejects(downloadYear(2027, { fetch: async () => response(200, endless), urls: [DOWNLOAD_URLS[0]] }), /too large/);
	assert(chunks <= 6, `read ${chunks} MB`);
});

test("gives each server its own timeout", async () => {
	const signals = [];
	const fetch = (url, { signal }) => {
		signals.push(signal);
		// The first server does not answer
		if (signals.length === 1) return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
		assert.equal(signal.aborted, false);
		return Promise.resolve(response(200, zipOfYear(2027)));
	};
	// AbortSignal.timeout does not keep Node running, so the test does
	const alive = setTimeout(() => {}, 5000);
	try {
		const { url } = await downloadYear(2027, { fetch, timeoutMs: 50 });
		assert.equal(url, urlsOf(2027)[1]);
		assert.notEqual(signals[0], signals[1]);
	} finally {
		clearTimeout(alive);
	}
});

test("reports a year that is not online yet", async () => {
	const fetch = async (url) => {
		if (url.startsWith("https://www.brueder-unitaet.de/")) throw networkError();
		return response(404);
	};
	await assert.rejects(downloadYear(2027, { fetch }), (error) => {
		assert.equal(error.notPublished, true);
		assert.match(error.message, /HTTP 404.*ECONNREFUSED/);
		return true;
	});
});

test("keeps control characters and long texts of errors out of the log", async () => {
	const fetch = async () => {
		throw new Error(`\u001b[31m${"x".repeat(10000)}`);
	};
	await assert.rejects(downloadYear(2027, { fetch }), (error) => {
		assert.doesNotMatch(error.message, /\p{Cc}/u);
		assert(error.message.length < 1000, `${error.message.length} characters`);
		return true;
	});
});
