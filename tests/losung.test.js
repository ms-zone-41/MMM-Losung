// Tests for the node helper and the frontend

// The local day differs from the UTC day only in a time zone other than UTC
process.env.TZ = "Europe/Berlin";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { JSDOM } = require("jsdom");
const { BOOKS } = require("../bible");
const { bibleEpub, networkError, response, yearlyXml, zipOf } = require("./support");

const moduleDirectory = path.resolve(__dirname, "..");
const dataDirectories = [];
test.after(() => dataDirectories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));
const texts = { losung: { text: "Testlosung", reference: "Psalm 1,1" }, lehrtext: { text: "Testlehrtext", reference: "Matthaeus 1,1" } };
const losungOf = (date, extra = {}) => ({ date, ...texts, nextYearMissing: null, ...extra });
// Objects from the sandbox have other prototypes, so they are compared as data
const plain = (value) => JSON.parse(JSON.stringify(value));
const zipOfYear = (year, special) => zipOf([{ name: `Losungen Free ${year}.xml`, data: yearlyXml(year, special) }]);

// config is the configuration of MagicMirror, which the helper reads for bibleFile
function loadHelper(fetch = async () => response(404), config = undefined) {
	const filename = path.join(moduleDirectory, "node_helper.js");
	const localRequire = createRequire(filename);
	const helperModule = { exports: {} };
	const FakeDate = class extends Date {
		static now() {
			return FakeDate.current;
		}
	};
	FakeDate.current = Date.parse("2026-10-20T08:00:00");
	const logs = [];
	// The logger of MagicMirror²
	const logger = {
		log(message) {
			logs.push(["log", message]);
		},
		error(message) {
			logs.push(["error", message]);
		}
	};
	const timers = [];
	// The file functions of the helper, which a test can replace
	const files = { ...fs.promises };
	vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
		module: helperModule,
		__dirname: moduleDirectory,
		require(name) {
			if (name === "node_helper") return { create: (definition) => definition };
			if (name === "logger") return logger;
			if (name === "node:fs/promises") return files;
			return localRequire(name);
		},
		Date: FakeDate,
		setTimeout(callback, ms) {
			timers.push({ kind: "timeout", callback, ms });
			return timers.at(-1);
		},
		setInterval(callback, ms) {
			timers.push({ kind: "interval", callback, ms });
			return timers.at(-1);
		},
		clearTimeout(timer) { timer.cleared = true; },
		clearInterval(timer) { timer.cleared = true; },
		config
	});
	const notifications = [];
	const helper = helperModule.exports;
	helper.sendSocketNotification = (type, payload) => notifications.push({ type, payload });
	helper.name = "MMM-Losung";
	helper.start();
	logs.length = 0;
	// Every test gets its own folder for the yearly files
	helper.dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-losung-"));
	dataDirectories.push(helper.dataDirectory);
	helper.fetch = fetch;
	const fileOf = (year) => path.join(helper.dataDirectory, `Losungen Free ${year}.xml`);
	const writeYear = (year, content = yearlyXml(year)) => fs.writeFileSync(fileOf(year), content);
	return { helper, notifications, logs, timers, files, fileOf, writeYear, advance: (ms) => {
		FakeDate.current += ms;
	} };
}

test("helper answers with the texts of the day from the yearly file", async () => {
	const { helper, notifications, writeYear } = loadHelper();
	writeYear(2026, yearlyXml(2026, { "2026-10-20": { Lehrtext: "/Paulus sprach:/ Ein erfundener Satz." } }));
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(plain(notifications), [{
		type: "Losung",
		payload: {
			date: "2026-10-20",
			losung: { text: "Losung 2026-10-20", reference: "Psalm 1,1" },
			lehrtext: { text: "/Paulus sprach:/ Ein erfundener Satz.", reference: "Matthäus 1,1" },
			nextYearMissing: null
		}
	}]);
});

// An EPUB with made-up verses, e.g. 1. Mose 3,15 = "Vers 3,15."
function writeBible(directory = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-losung-bible-"))) {
	dataDirectories.push(directory);
	fs.writeFileSync(path.join(directory, "bibel.epub"), bibleEpub());
	return path.join(directory, "bibel.epub");
}

test("helper shows the full verses of the Bible of the user", async () => {
	const bibleFile = writeBible();
	const { helper, notifications, logs, writeYear } = loadHelper(undefined, { modules: [{ module: "MMM-Losung", config: { bibleFile } }] });
	writeYear(2026, yearlyXml(2026, { "2026-10-20": { Losungsvers: "1. Mose 3,15" } }));
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(plain(notifications[0].payload), {
		date: "2026-10-20",
		losung: { text: "Vers 3,15.", reference: "1. Mose 3,15" },
		// A verse that is not in the Bible keeps the text of the Losungen
		lehrtext: { text: "Lehrtext 2026-10-20", reference: "Matthäus 1,1" },
		nextYearMissing: null
	});
	assert.match(logs.find(([level]) => level === "log")[1], /Showing the verses of the Testbibel/);
});

test("helper finds the Bible in the home folder", async () => {
	const home = process.env.HOME;
	process.env.HOME = path.dirname(writeBible());
	try {
		const { helper, notifications, writeYear } = loadHelper(undefined, { modules: [{ module: "MMM-Losung", config: { bibleFile: "~/bibel.epub" } }] });
		writeYear(2026, yearlyXml(2026, { "2026-10-20": { Losungsvers: "1. Mose 3,15" } }));
		await helper._sendLosung("2026-10-20");
		assert.equal(notifications[0].payload.losung.text, "Vers 3,15.");
	} finally {
		process.env.HOME = home;
	}
});

test("helper shows the texts of the Losungen when the Bible cannot be read", async () => {
	const notABible = path.join(path.dirname(writeBible()), "roman.epub");
	fs.writeFileSync(notABible, "Kein E-Book");
	for (const bibleFile of ["/nicht/da/bibel.epub", notABible]) {
		const { helper, notifications, logs, writeYear } = loadHelper(undefined, { modules: [{ module: "MMM-Losung", config: { bibleFile } }] });
		writeYear(2026, yearlyXml(2026, { "2026-10-20": { Losungsvers: "1. Mose 3,15" } }));
		await helper._sendLosung("2026-10-20");
		assert.deepEqual(plain(notifications[0].payload.losung), { text: "Losung 2026-10-20", reference: "1. Mose 3,15" }, bibleFile);
		assert.match(logs.find(([level]) => level === "error")[1], /cannot be used, so the texts of the Losungen are shown/);
	}
});

test("helper ignores the Bible of a disabled entry", async () => {
	const bibleFile = writeBible();
	const { helper, notifications, writeYear } = loadHelper(undefined, { modules: [{ module: "MMM-Losung", disabled: true, config: { bibleFile } }, { module: "MMM-Losung", config: {} }] });
	writeYear(2026, yearlyXml(2026, { "2026-10-20": { Losungsvers: "1. Mose 3,15" } }));
	await helper._sendLosung("2026-10-20");
	assert.equal(notifications[0].payload.losung.text, "Losung 2026-10-20");
});

test("helper downloads a missing year once for several requests", async () => {
	let calls = 0;
	const { helper, notifications } = loadHelper(async () => {
		calls++;
		return response(200, zipOfYear(2026));
	});
	await Promise.all([helper._sendLosung("2026-10-20"), helper._sendLosung("2026-10-20")]);
	assert.equal(calls, 1);
	assert.deepEqual(notifications.map((notification) => notification.type), ["Losung", "Losung"]);
	// Saved under the name of the file in the zip file, without a temporary file
	assert.deepEqual(fs.readdirSync(helper.dataDirectory), ["Losungen Free 2026.xml"]);
});

test("helper reports a missing year and retries the download only after an hour", async () => {
	let calls = 0;
	const { helper, notifications, logs, advance } = loadHelper(async () => {
		calls++;
		throw networkError();
	});
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(plain(notifications[0]), { type: "Error", payload: { date: "2026-10-20", reason: "missing", year: 2026 } });
	assert.equal(calls, 2);
	await helper._sendLosung("2026-10-20");
	assert.equal(calls, 2);
	advance(61 * 60 * 1000);
	await helper._sendLosung("2026-10-20");
	assert.equal(calls, 4);
	assert.match(logs.find(([level]) => level === "error")[1], /could not be downloaded.*ECONNREFUSED/);
});

test("helper logs the reasons when the current year is missing, but only notes a next year that is not out yet", async () => {
	const { helper, logs } = loadHelper(async (url) => (url.includes("www.brueder-unitaet.de") ? Promise.reject(networkError()) : response(404)));
	await helper._sendLosung("2026-10-20");
	await helper._checkDownloads(new Date(2026, 9, 20));
	assert.deepEqual(logs.map(([level]) => level), ["error", "log"]);
	assert.match(logs[0][1], /^The Losungen of 2026 could not be downloaded \(.*HTTP 404.*ECONNREFUSED\)/);
	assert.match(logs[1][1], /^The Losungen of 2027 are not online yet: .*HTTP 404/);
});

test("helper uses a file that was put in by hand at once", async () => {
	const { helper, notifications, writeYear } = loadHelper();
	await helper._sendLosung("2026-10-20");
	writeYear(2026);
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(notifications.map((notification) => notification.type), ["Error", "Losung"]);
});

test("helper reads a changed file again, even with its old time", async () => {
	const { helper, notifications, fileOf, writeYear } = loadHelper();
	const time = new Date("2026-10-01T12:00:00");
	writeYear(2026);
	fs.utimesSync(fileOf(2026), time, time);
	await helper._sendLosung("2026-10-20");
	// Like a copy that keeps the time of the file
	writeYear(2026, yearlyXml(2026, { "2026-10-20": { Losungstext: "Neue Losung" } }));
	fs.utimesSync(fileOf(2026), time, time);
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(notifications.map((notification) => notification.payload.losung.text), ["Losung 2026-10-20", "Neue Losung"]);
});

test("helper tries a file again that could not be read", async () => {
	const { helper, notifications, logs, files, writeYear } = loadHelper();
	writeYear(2026);
	const readFile = files.readFile;
	files.readFile = async () => {
		throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
	};
	await helper._sendLosung("2026-10-20");
	assert.match(logs.find(([level]) => level === "error")[1], /cannot be read: EIO/);
	// The same, unchanged file can be read again
	files.readFile = readFile;
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(notifications.map((notification) => notification.type), ["Error", "Losung"]);
});

test("helper replaces a broken file with a download", async () => {
	const { helper, notifications, fileOf, writeYear } = loadHelper(async () => response(200, zipOfYear(2026)));
	writeYear(2026, "<FreeXml></FreeXml>");
	await helper._sendLosung("2026-10-20");
	assert.equal(notifications[0].type, "Losung");
	assert.match(fs.readFileSync(fileOf(2026), "utf8"), /Losung 2026-10-20/);
});

test("helper keeps a download in memory when the folder cannot be written", async () => {
	let calls = 0;
	const { helper, notifications, logs, fileOf, advance } = loadHelper(async () => {
		calls++;
		return response(200, zipOfYear(2026));
	});
	// A folder in the place of the temporary file makes saving fail
	fs.mkdirSync(fileOf(2026).replace(/\.xml$/, ".part.xml"));
	await helper._sendLosung("2026-10-20");
	advance(2 * 60 * 60 * 1000);
	await helper._sendLosung("2026-10-21");
	assert.deepEqual(notifications.map((notification) => notification.type), ["Losung", "Losung"]);
	assert.equal(calls, 1);
	assert.equal(fs.existsSync(fileOf(2026)), false);
	assert.match(logs.find(([level]) => level === "error")[1], /cannot be saved.*write access/);
});

test("helper serves a download from memory when a broken or unreadable file cannot be replaced", async () => {
	for (const unreadable of [false, true]) {
		const { helper, notifications, files, writeYear } = loadHelper(async () => response(200, zipOfYear(2026)));
		writeYear(2026, "<FreeXml></FreeXml>");
		const denied = async () => {
			throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
		};
		files.writeFile = denied;
		if (unreadable) files.readFile = denied;
		await helper._sendLosung("2026-10-20");
		await helper._sendLosung("2026-10-21");
		assert.deepEqual(notifications.map((notification) => notification.type), ["Losung", "Losung"], `unreadable: ${unreadable}`);
	}
});

test("helper logs the same read error only once", async () => {
	const { helper, logs, files, writeYear, advance } = loadHelper();
	writeYear(2026);
	let reads = 0;
	files.readFile = async () => {
		reads++;
		throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
	};
	for (let request = 0; request < 3; request++) {
		await helper._sendLosung("2026-10-20");
		advance(10 * 60 * 1000);
	}
	assert.equal(logs.filter(([, message]) => /cannot be read/.test(message)).length, 1);
	// Read again after the first download, but not after the skipped ones
	assert.equal(reads, 4);
});

test("helper reports a day that is missing in the file", async () => {
	const { helper, notifications, writeYear } = loadHelper();
	writeYear(2026, yearlyXml(2026).replace(/\t<Losungen>\r\n\t\t<Datum>2026-10-20[\s\S]*?<\/Losungen>\r\n/, ""));
	await helper._sendLosung("2026-10-20");
	assert.deepEqual(plain(notifications[0]), { type: "Error", payload: { date: "2026-10-20", reason: "day" } });
});

test("helper warns in December while the next year is missing, without downloading it", async () => {
	let calls = 0;
	const { helper, notifications, writeYear } = loadHelper(async () => {
		calls++;
		return response(404);
	});
	writeYear(2026);
	await helper._sendLosung("2026-11-30");
	await helper._sendLosung("2026-12-01");
	writeYear(2027);
	await helper._sendLosung("2026-12-02");
	assert.deepEqual(notifications.map((notification) => notification.payload.nextYearMissing), [null, 2027, null]);
	assert.equal(calls, 0);
});

test("helper downloads only the previous, current and next year", async () => {
	const requested = [];
	const { helper, notifications } = loadHelper(async (url) => {
		requested.push(url);
		return response(404);
	});
	await helper._sendLosung("2019-03-03");
	await helper._sendLosung("2099-03-03");
	await helper._sendLosung("2028-03-03");
	assert.deepEqual(requested, []);
	await helper._sendLosung("2027-01-01");
	assert(requested.length > 0 && requested.every((url) => url.includes("2027")));
	assert.deepEqual(notifications.map((notification) => notification.payload.reason), ["missing", "missing", "missing", "missing"]);
});

test("helper shows no texts of other years, even from files that are there", async () => {
	const { helper, notifications, writeYear } = loadHelper();
	writeYear(2019);
	writeYear(2028);
	await helper._sendLosung("2019-03-03");
	await helper._sendLosung("2028-03-03");
	assert.deepEqual(notifications.map((notification) => notification.type), ["Error", "Error"]);
});

test("helper forgets the texts of old years that it kept in memory", async () => {
	const { helper, files, advance } = loadHelper(async () => response(200, zipOfYear(2026)));
	files.writeFile = async () => {
		throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
	};
	await helper._sendLosung("2026-10-20");
	assert(helper.unsaved.has(2026));
	advance(500 * 24 * 60 * 60 * 1000);
	await helper._checkDownloads(new Date(2028, 2, 1));
	assert.equal(helper.unsaved.has(2026), false);
});

test("helper looks for the next year from October on", async () => {
	const requested = [];
	const { helper, writeYear } = loadHelper(async (url) => {
		requested.push(url);
		return response(404);
	});
	writeYear(2026);
	await helper._checkDownloads(new Date(2026, 8, 30));
	assert.deepEqual(requested, []);
	await helper._checkDownloads(new Date(2026, 9, 1));
	assert(requested.length > 0 && requested.every((url) => url.includes("2027")));
});

test("helper deletes the files of years before the previous year", async () => {
	const { helper, writeYear } = loadHelper();
	for (const year of [2019, 2024, 2025, 2026]) writeYear(year);
	fs.writeFileSync(path.join(helper.dataDirectory, "Losungen Free 2023.part.xml"), "");
	fs.writeFileSync(path.join(helper.dataDirectory, "notes.xml"), "");
	await helper._checkDownloads(new Date(2026, 9, 1));
	assert.deepEqual(fs.readdirSync(helper.dataDirectory).sort(), ["Losungen Free 2025.xml", "Losungen Free 2026.xml", "notes.xml"]);
});

test("helper checks a minute after the start and then once a day", () => {
	const { helper, timers } = loadHelper();
	assert.deepEqual(timers.map(({ kind, ms }) => [kind, ms]), [["timeout", 60 * 1000], ["interval", 24 * 60 * 60 * 1000]]);
	let checks = 0;
	helper._checkDownloads = () => checks++;
	timers.forEach((timer) => timer.callback());
	assert.equal(checks, 2);
	helper.stop();
	assert(timers.every((timer) => timer.cleared));
});

test("helper ignores requests without a valid date", async () => {
	let calls = 0;
	const { helper, notifications } = loadHelper(async () => {
		calls++;
		return response(404);
	});
	for (const date of [undefined, "../../config/config", "2026-10-20T00:00", 20261020, ["2026-10-20"], { toString: 0 }])
		await helper._sendLosung(date);
	helper.socketNotificationReceived("GetLosung");
	helper.socketNotificationReceived("GetLosung", { date: { toString: 0 } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(notifications, []);
	assert.equal(calls, 0);
});

function loadFrontend(now = "2026-10-03T12:00:00", config = {}) {
	let definition;
	const document = new JSDOM("<!doctype html>").window.document;
	const FakeDate = class extends Date {
		constructor(...args) {
			super(...(args.length ? args : [FakeDate.now()]));
		}

		static now() {
			return new Date(FakeDate.current).getTime();
		}
	};
	FakeDate.current = now;
	vm.runInNewContext(fs.readFileSync(path.join(moduleDirectory, "MMM-Losung.js"), "utf8"), {
		Module: { register(name, value) { definition = value; } },
		Log: { info() {} },
		document,
		console: { error() {} },
		Date: FakeDate,
		setInterval() {}
	});
	const frontend = Object.assign(Object.create(definition), {
		name: "MMM-Losung",
		config: { ...definition.defaults, ...config },
		requests: [],
		domUpdates: 0,
		updateDom() { this.domUpdates++; },
		sendSocketNotification(type, payload) { this.requests.push({ type, payload }); }
	});
	frontend.start();
	return { frontend, setNow: (value) => {
		FakeDate.current = value;
	} };
}

test("frontend asks for the local day and shows the texts as soon as they arrive", () => {
	// Half past midnight in Berlin is still the day before in UTC
	const { frontend } = loadFrontend("2026-10-04T00:30:00");
	assert.deepEqual(plain(frontend.requests), [{ type: "GetLosung", payload: { date: "2026-10-04" } }]);
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-04"));
	assert.equal(frontend.domUpdates, 1);
	assert.match(frontend.getDom().textContent, /Testlosung.*Testlehrtext/);
});

test("frontend keeps the texts during a refresh without redrawing", () => {
	const { frontend } = loadFrontend();
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	frontend.getData(frontend);
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	assert.equal(frontend.domUpdates, 1);
	assert.match(frontend.getDom().textContent, /Testlosung/);
});

test("frontend shows an error instead of the text of yesterday", () => {
	const { frontend, setNow } = loadFrontend("2026-10-03T23:55:00");
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	setNow("2026-10-04T00:05:00");
	frontend.getData(frontend);
	frontend.socketNotificationReceived("Error", { date: "2026-10-04", reason: "failed" });
	assert.equal(frontend.getDom().textContent, "Losung konnte nicht geladen werden.");
});

test("frontend keeps today's text when a refresh fails", () => {
	const { frontend } = loadFrontend();
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	frontend.socketNotificationReceived("Error", { date: "2026-10-03", reason: "failed" });
	assert.match(frontend.getDom().textContent, /Testlosung/);
});

test("frontend ignores late answers for another day", () => {
	const { frontend, setNow } = loadFrontend("2026-10-03T23:59:59");
	setNow("2026-10-04T00:00:01");
	frontend.getData(frontend);
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	assert.equal(frontend.DailyVerse, null);
});

test("frontend names a missing year and a missing day", () => {
	let { frontend } = loadFrontend("2027-01-01T00:01:00");
	frontend.socketNotificationReceived("Error", { date: "2027-01-01", reason: "missing", year: 2027 });
	assert.equal(frontend.getDom().textContent, "Die Losungen für 2027 fehlen.");
	({ frontend } = loadFrontend());
	frontend.socketNotificationReceived("Error", { date: "2026-10-03", reason: "day" });
	assert.equal(frontend.getDom().textContent, "Für heute gibt es keine Losung.");
});

test("frontend shows loading and errors as a small status line in the normal color", () => {
	const { frontend } = loadFrontend();
	let dom = frontend.getDom();
	// The same size as the texts, and not dimmed: the line keeps its color
	assert.deepEqual([...dom.classList], ["moravian-container", "small"]);
	assert.equal(dom.textContent, "Losung wird geladen ...");
	frontend.socketNotificationReceived("Error", { date: "2026-10-03", reason: "failed" });
	dom = frontend.getDom();
	assert.deepEqual([...dom.classList], ["moravian-container", "small"]);
	assert.equal(dom.textContent, "Losung konnte nicht geladen werden.");
});

test("frontend shows the texts bright and light, the references in the normal color", () => {
	const { frontend } = loadFrontend();
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
	const dom = frontend.getDom();
	assert.deepEqual([...dom.classList], ["moravian-container", "small"]);
	assert.deepEqual([...dom.children].map((element) => element.className), ["moravian-moravian light", "moravian-teaching light"]);
	assert.deepEqual([...dom.querySelectorAll(".bright")].map((element) => [element.className, element.textContent]), [["moravian-text bright", "Testlosung"], ["teaching-text bright", "Testlehrtext"]]);
	assert.deepEqual([...dom.querySelectorAll(".moravian-vers, .teaching-vers")].map((element) => [element.className, element.textContent]), [["moravian-vers", "Psalm 1,1"], ["teaching-vers", "Matthaeus 1,1"]]);
	// No labels such as "Losung:", the header of the module names it
	assert.equal(dom.querySelector(".moravian-header"), null);
	assert.equal(dom.querySelector("[style]"), null);
});

test("frontend shows the short form of each reference at the end of its text with compact", () => {
	const { frontend } = loadFrontend(undefined, { compact: true });
	const losung = { text: "Ein erfundener Satz.", reference: "1. Korinther 13,4" };
	const lehrtext = { text: "/Paulus sprach:/ Ein #anderer# Satz.", reference: "Apostelgeschichte 2,5.7-8" };
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03", { losung, lehrtext }));
	const dom = frontend.getDom();
	// No line of its own for the references
	assert.deepEqual([...dom.children].map((element) => [...element.children].map((child) => child.className)), [["moravian-text bright"], ["teaching-text bright"]]);
	assert.deepEqual([...dom.querySelectorAll(".bright")].map((element) => element.textContent), ["Ein erfundener Satz.\u00a01. Kor 13,4", "Paulus sprach: Ein anderer Satz.\u00a0Apg 2,5.7-8"]);
	assert.deepEqual([...dom.querySelectorAll(".moravian-vers, .teaching-vers")].map((element) => [element.tagName, element.className]), [["SPAN", "moravian-vers normal"], ["SPAN", "teaching-vers normal"]]);
});

test("frontend knows a short form for every book of the Losungen and keeps other references", () => {
	const { frontend } = loadFrontend(undefined, { compact: true });
	assert.deepEqual(Object.keys(frontend.shortBookNames), Object.keys(BOOKS));
	assert.equal(new Set(Object.values(frontend.shortBookNames)).size, Object.keys(BOOKS).length);
	for (const reference of ["Matthaeus 1,1", "Psalm 23", "Jesaja 40,31; Psalm 23,1", "toString 1,1"])
		assert.equal(frontend._shortReference(reference), reference);
});

test("frontend shows the introduction of a quotation in the normal color and keeps emphasis", () => {
	const { frontend } = loadFrontend();
	const lehrtext = { text: "/Paulus sprach:/ Ein erfundener Satz und ein #betontes# Wort.", reference: "Apostelgeschichte 17,23" };
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03", { lehrtext }));
	const text = frontend.getDom().querySelector(".teaching-text");
	assert.equal(text.textContent, "Paulus sprach: Ein erfundener Satz und ein betontes Wort.");
	assert.deepEqual([...text.children].map((element) => [element.tagName, element.className, element.textContent]), [["SPAN", "teaching-intro normal", "Paulus sprach:"], ["EM", "", "betontes"]]);
});

test("frontend shows the texts as plain text", () => {
	const { frontend } = loadFrontend();
	const losung = { text: "<img src=x onerror=alert(1)> & Text", reference: "<b>Psalm 1,1</b>" };
	frontend.socketNotificationReceived("Losung", losungOf("2026-10-03", { losung }));
	const dom = frontend.getDom();
	assert.equal(dom.querySelector("img, b"), null);
	assert.equal(dom.querySelector(".moravian-text").textContent, "<img src=x onerror=alert(1)> & Text");
});

test("frontend shows only the selected texts", () => {
	for (const [config, expected] of [[{ showDailyText: false }, ["Testlehrtext"]], [{ showTeachingText: false }, ["Testlosung"]]]) {
		const { frontend } = loadFrontend(undefined, config);
		frontend.socketNotificationReceived("Losung", losungOf("2026-10-03"));
		const dom = frontend.getDom();
		// A text that is switched off is not rendered at all
		assert.equal(dom.children.length, 1);
		assert.deepEqual([...dom.querySelectorAll(".bright")].map((element) => element.textContent), expected);
	}
});

test("frontend warns in December while the next year is missing", () => {
	const { frontend } = loadFrontend("2026-12-01T08:00:00");
	frontend.socketNotificationReceived("Losung", losungOf("2026-12-01", { nextYearMissing: 2027 }));
	const warning = frontend.getDom().querySelector(".moravian-warning");
	assert.deepEqual([warning.className, warning.textContent], ["moravian-warning xsmall dimmed", "Die Losungen für 2027 fehlen noch."]);
	frontend.socketNotificationReceived("Losung", losungOf("2026-12-01"));
	assert.equal(frontend.domUpdates, 2);
	assert.equal(frontend.getDom().querySelector(".moravian-warning"), null);
});

test("stylesheet leaves fonts, sizes, colors and alignment to MagicMirror", () => {
	const css = fs.readFileSync(path.join(moduleDirectory, "MMM-Losung.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	assert.doesNotMatch(css, /font|color|text-align|line-height|opacity/);
	// Rules on .MMM-Losung alone would also change the header of the module
	assert.doesNotMatch(css, /(^|})\s*\.MMM-Losung\s*[{,]/);
});
