var NodeHelper = require("node_helper");
const fs = require("node:fs/promises");
const path = require("node:path");
const { clean, decodeFile, downloadYear, fileNameOf, parseLosungen } = require("./losungen-data");

// A missing year is downloaded at most once an hour while its texts are
// requested. Once a day, the helper also looks for the current year and,
// from October on, for the next year, which the publisher puts online
// between October and November.
const RETRY_MS = 60 * 60 * 1000;
const CHECK_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;
const FILE_PATTERN = /^Losungen Free (\d{4})(\.part)?\.xml$/;

module.exports = NodeHelper.create({
	start: function () {
		console.log("MMM-Losung helper started ...");
		// The yearly files are kept next to the module, where they can also
		// be put by hand
		this.dataDirectory = __dirname;
		this.fetch = globalThis.fetch;
		this.years = new Map();
		// Downloaded texts that could not be saved stay here until a restart
		this.unsaved = new Map();
		this.readErrors = new Map();
		this.downloads = new Map();
		this.timers = [
			setTimeout(() => this._checkDownloads(), FIRST_CHECK_MS),
			setInterval(() => this._checkDownloads(), CHECK_MS)
		];
	},

	stop: function () {
		clearTimeout(this.timers[0]);
		clearInterval(this.timers[1]);
	},

	/**
	 * Reads the file of a year again when it has changed. The time of the
	 * last status change is compared too, because a chmod or a copy that
	 * keeps the time of the file changes only that one.
	 * @param {number} year The year
	 * @returns {Promise<Map|null>} The texts, or null without a usable file
	 */
	async _readYear(year) {
		const file = path.join(this.dataDirectory, fileNameOf(year));
		let stats;
		try {
			stats = await fs.stat(file);
		} catch {
			this.years.delete(year);
			return this.unsaved.get(year) || null;
		}
		const version = `${stats.mtimeMs}/${stats.ctimeMs}/${stats.size}`;
		const loaded = this.years.get(year);
		if (loaded && loaded.version === version) return loaded.days || this.unsaved.get(year) || null;
		let bytes;
		try {
			bytes = await fs.readFile(file);
		} catch (error) {
			// A file that cannot be read is tried again next time, but the
			// same error is logged only once
			const readError = `${version}/${error.code}`;
			if (this.readErrors.get(year) !== readError)
				console.error(`MMM-Losung: ${fileNameOf(year)} cannot be read: ${error.message}`);
			this.readErrors.set(year, readError);
			return this.unsaved.get(year) || null;
		}
		this.readErrors.delete(year);
		let days = null;
		try {
			days = parseLosungen(decodeFile(bytes), year);
		} catch (error) {
			console.error(`MMM-Losung: ${fileNameOf(year)} cannot be used: ${clean(error.message)}`);
		}
		this.years.set(year, { version, days });
		return days || this.unsaved.get(year) || null;
	},

	/**
	 * The texts of a year, downloaded first if the file is missing or broken.
	 * @param {number} year The year
	 * @param {boolean} download false to use only the file at hand
	 * @returns {Promise<Map|null>} The texts, or null
	 */
	async _getYear(year, download = true) {
		const days = await this._readYear(year);
		if (days || !download) return days;
		// The file is read again only when a download ran
		return (await this._download(year)) ? this._readYear(year) : null;
	},

	// Several requests share one download, and a failed one is not repeated
	// for an hour. Resolves to false when no download ran.
	_download(year) {
		const state = this.downloads.get(year) || {};
		if (state.running) return state.running;
		if (Date.now() - (state.lastAttempt || 0) < RETRY_MS) return Promise.resolve(false);
		const running = (async () => {
			try {
				const { xml, days, url } = await downloadYear(year, { fetch: this.fetch });
				console.log(`MMM-Losung: Downloaded the Losungen of ${year} from ${url}`);
				await this._save(year, xml, days);
			} catch (error) {
				// In autumn the next year is usually not out yet
				if (error.notPublished && year > new Date(Date.now()).getFullYear())
					console.log(`MMM-Losung: The Losungen of ${year} are not online yet: ${error.message}`);
				else
					console.error(`MMM-Losung: ${error.message}`);
			} finally {
				this.downloads.set(year, { lastAttempt: Date.now() });
			}
			return true;
		})();
		this.downloads.set(year, { ...state, running });
		return running;
	},

	async _save(year, xml, days) {
		const file = path.join(this.dataDirectory, fileNameOf(year));
		const partFile = file.replace(/\.xml$/, ".part.xml");
		try {
			await fs.writeFile(partFile, xml);
			await fs.rename(partFile, file);
			this.unsaved.delete(year);
		} catch (error) {
			await fs.rm(partFile, { force: true }).catch(() => {});
			this.unsaved.set(year, days);
			console.error(`MMM-Losung: ${fileNameOf(year)} cannot be saved, so the texts are only kept until MagicMirror restarts. The user of MagicMirror needs write access to ${this.dataDirectory}: ${error.message}`);
		}
		// Read again even if the time of the file did not change
		this.years.delete(year);
	},

	// Keeps the files of the previous, current and next year, which is what
	// the terms of use allow, and looks for the current and the next year
	async _checkDownloads(now = new Date(Date.now())) {
		const year = now.getFullYear();
		for (const memory of [this.years, this.unsaved, this.readErrors])
			for (const old of [...memory.keys()]) if (old < year - 1) memory.delete(old);
		try {
			for (const name of await fs.readdir(this.dataDirectory)) {
				const match = FILE_PATTERN.exec(name);
				if (!match || Number(match[1]) >= year - 1) continue;
				await fs.rm(path.join(this.dataDirectory, name), { force: true });
				console.log(`MMM-Losung: Deleted ${name}, the terms of use allow only the previous, current and next year`);
			}
		} catch (error) {
			console.error(`MMM-Losung: Old yearly files cannot be deleted: ${error.message}`);
		}
		const years = now.getMonth() >= 9 ? [year, year + 1] : [year];
		await Promise.all(years.map((each) => this._getYear(each)));
	},

	async _sendLosung(date) {
		if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
		const year = Number(date.slice(0, 4));
		try {
			// Only the previous, current and next year are shown and
			// downloaded, whatever a client asks for
			const days = Math.abs(year - new Date(Date.now()).getFullYear()) <= 1 ? await this._getYear(year) : null;
			if (!days) return this.sendSocketNotification("Error", { date, reason: "missing", year });
			const day = days.get(date);
			if (!day) return this.sendSocketNotification("Error", { date, reason: "day" });
			// In December the mirror warns when the next year is still missing
			const nextYearMissing = date.slice(5, 7) === "12" && !(await this._getYear(year + 1, false)) ? year + 1 : null;
			this.sendSocketNotification("Losung", { date, ...day, nextYearMissing });
		} catch (error) {
			console.error("MMM-Losung: " + error.message);
			this.sendSocketNotification("Error", { date, reason: "failed" });
		}
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "GetLosung") {
			this._sendLosung(payload && payload.date).catch((error) => console.error("MMM-Losung: " + error.message));
		}
	}
});
