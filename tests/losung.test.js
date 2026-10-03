// Run from the MagicMirror root (needs its jsdom):
// node --test modules/MMM-Losung/tests/losung.test.js
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { X509Certificate } = require("node:crypto");
const { JSDOM } = require("jsdom");

const moduleDirectory = path.resolve(__dirname, "..");
const sampleHtml = "<table><tr><td>Header</td></tr><tr><td>&nbsp;</td></tr><tr><td><font><b>Testlosung</b><br>Psalm 1,1</font></td></tr><tr><td>&nbsp;</td></tr><tr><td><font><b>Testlehrtext</b><br>Matthaeus 1,1</font></td></tr></table>";
const urlOf = (date) => `https://www.losungen.de/fileadmin/media-losungen/heute/${date.slice(0, 4)}/${date.slice(5, 7)}${date.slice(8, 10)}.html`;

function loadHelper(fetch) {
	const filename = path.join(moduleDirectory, "node_helper.js");
	const localRequire = createRequire(filename);
	const helperModule = { exports: {} };
	vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
		module: helperModule,
		__dirname: moduleDirectory,
		require (name) {
			if (name === "node_helper") return { create: (definition) => definition };
			if (name === "node-fetch") return fetch;
			return localRequire(name);
		},
		console: { log () {}, error () {} },
		Date,
		Map,
		Promise
	});
	const notifications = [];
	const helper = helperModule.exports;
	helper.sendSocketNotification = (type, payload) => notifications.push({ type, payload });
	helper.start();
	return { helper, notifications };
}

function loadFrontend(now = "2026-10-03T12:00:00") {
	let definition;
	const document = new JSDOM("<!doctype html>").window.document;
	const FakeDate = class extends Date {
		constructor (...args) {
			super(...(args.length ? args : [FakeDate.now()]));
		}

		static now () {
			return new Date(FakeDate.current).getTime();
		}
	};
	FakeDate.current = now;
	vm.runInNewContext(fs.readFileSync(path.join(moduleDirectory, "MMM-Losung.js"), "utf8"), {
		Module: { register (name, value) { definition = value; } },
		Log: { info () {} },
		document,
		console: { error () {} },
		Date: FakeDate,
		setInterval () {}
	});
	const frontend = Object.assign(Object.create(definition), {
		name: "MMM-Losung",
		config: { ...definition.defaults },
		requests: [],
		domUpdates: 0,
		updateDom () { this.domUpdates++; },
		sendSocketNotification (type, url) { this.requests.push(url); }
	});
	frontend.start();
	return { frontend, setNow: (value) => { FakeDate.current = value; } };
}

test("helper verifies TLS with the bundled certificate chain", async () => {
	const { helper, notifications } = loadHelper(async (url, options) => {
		assert.notEqual(options.agent.options.rejectUnauthorized, false);
		assert(options.agent.options.ca.some((pem) => new X509Certificate(pem).subject.includes("CN=YR2")));
		return { ok: true, status: 200, text: async () => sampleHtml };
	});
	await helper._getWebData(urlOf("2026-10-03"));
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].type, "WebData");
	assert.equal(notifications[0].payload.url, urlOf("2026-10-03"));
	assert.equal(notifications[0].payload.html, sampleHtml);
});

test("helper reports HTTP errors instead of forwarding the error page", async () => {
	const { helper, notifications } = loadHelper(async () => ({ ok: false, status: 404, text: async () => "Not found" }));
	await helper._getWebData(urlOf("2026-10-03"));
	assert.equal(notifications[0].type, "Error");
	assert.equal(notifications[0].payload.url, urlOf("2026-10-03"));
});

test("helper caches the text of a day", async () => {
	let calls = 0;
	const { helper, notifications } = loadHelper(async () => {
		calls++;
		return { ok: true, status: 200, text: async () => sampleHtml };
	});
	await helper._getWebData(urlOf("2026-10-03"));
	await helper._getWebData(urlOf("2026-10-03"));
	assert.equal(calls, 1);
	assert.equal(notifications.length, 2);
	await helper._getWebData(urlOf("2026-10-04"));
	assert.equal(calls, 2);
});

test("helper shares a running request, but not across days", async () => {
	const pending = [];
	const { helper, notifications } = loadHelper((url) => new Promise((resolve) => {
		pending.push(() => resolve({ ok: true, status: 200, text: async () => url }));
	}));
	const requests = [helper._getWebData(urlOf("2026-10-03")), helper._getWebData(urlOf("2026-10-03")), helper._getWebData(urlOf("2026-10-04"))];
	assert.equal(pending.length, 2);
	pending.forEach((finish) => finish());
	await Promise.all(requests);
	assert.deepEqual(notifications.map((notification) => notification.payload.url), [urlOf("2026-10-03"), urlOf("2026-10-04")]);
});

test("frontend shows the texts as soon as they arrive", () => {
	const { frontend } = loadFrontend();
	assert.deepEqual(frontend.requests, [urlOf("2026-10-03")]);
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	assert.equal(frontend.domUpdates, 1);
	assert.match(frontend.getDom().textContent, /Testlosung.*Testlehrtext/);
});

test("frontend keeps the texts during a refresh without redrawing", () => {
	const { frontend } = loadFrontend();
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	frontend.getData(frontend);
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	assert.equal(frontend.domUpdates, 1);
	assert.match(frontend.getDom().textContent, /Testlosung/);
});

test("frontend shows an error instead of the text of yesterday", () => {
	const { frontend, setNow } = loadFrontend("2026-10-03T23:55:00");
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	setNow("2026-10-04T00:05:00");
	frontend.getData(frontend);
	frontend.socketNotificationReceived("Error", { url: urlOf("2026-10-04"), message: "HTTP 503" });
	assert.equal(frontend.getDom().textContent, "Losung konnte nicht geladen werden.");
});

test("frontend keeps today's text when a refresh fails", () => {
	const { frontend } = loadFrontend();
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	frontend.socketNotificationReceived("Error", { url: urlOf("2026-10-03"), message: "HTTP 503" });
	assert.match(frontend.getDom().textContent, /Testlosung/);
});

test("frontend ignores late answers for another day", () => {
	const { frontend, setNow } = loadFrontend("2026-10-03T23:59:59");
	setNow("2026-10-04T00:00:01");
	frontend.getData(frontend);
	frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: sampleHtml });
	assert.equal(frontend.DailyVerse, null);
});

test("frontend handles an unexpected page without crashing", () => {
	const { frontend } = loadFrontend();
	assert.doesNotThrow(() => frontend.socketNotificationReceived("WebData", { url: urlOf("2026-10-03"), html: "Invalid page" }));
	assert.equal(frontend.getDom().textContent, "Losung konnte nicht gelesen werden.");
});
