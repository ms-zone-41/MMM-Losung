Module.register("MMM-Losung", {
	defaults: {
		updateInterval: 10 * 60 * 1000, // 10 minutes
		showDailyText: true,
		showTeachingText: true,
		compact: false
	},

	// The short forms of the book names for compact, as the Lutherbibel 2017
	// abbreviates them. It keeps a few names whole, e.g. "1. Mose".
	shortBookNames: {
		"1. Mose": "1. Mose", "2. Mose": "2. Mose", "3. Mose": "3. Mose", "4. Mose": "4. Mose", "5. Mose": "5. Mose",
		"Josua": "Jos", "Richter": "Ri", "Rut": "Rut", "1. Samuel": "1. Sam", "2. Samuel": "2. Sam",
		"1. Könige": "1. Kön", "2. Könige": "2. Kön", "1. Chronik": "1. Chr", "2. Chronik": "2. Chr",
		"Esra": "Esra", "Nehemia": "Neh", "Ester": "Est", "Hiob": "Hiob", "Psalm": "Ps",
		"Sprüche": "Spr", "Prediger": "Pred", "Hohelied": "Hld", "Jesaja": "Jes", "Jeremia": "Jer",
		"Klagelieder": "Klgl", "Hesekiel": "Hes", "Daniel": "Dan", "Hosea": "Hos", "Joel": "Joel",
		"Amos": "Am", "Obadja": "Obd", "Jona": "Jona", "Micha": "Mi", "Nahum": "Nah",
		"Habakuk": "Hab", "Zefanja": "Zef", "Haggai": "Hag", "Sacharja": "Sach", "Maleachi": "Mal",
		"Matthäus": "Mt", "Markus": "Mk", "Lukas": "Lk", "Johannes": "Joh",
		"Apostelgeschichte": "Apg", "Römer": "Röm", "1. Korinther": "1. Kor", "2. Korinther": "2. Kor",
		"Galater": "Gal", "Epheser": "Eph", "Philipper": "Phil", "Kolosser": "Kol",
		"1. Thessalonicher": "1. Thess", "2. Thessalonicher": "2. Thess", "1. Timotheus": "1. Tim",
		"2. Timotheus": "2. Tim", "Titus": "Tit", "Philemon": "Phlm", "1. Petrus": "1. Petr",
		"2. Petrus": "2. Petr", "1. Johannes": "1. Joh", "2. Johannes": "2. Joh", "3. Johannes": "3. Joh",
		"Hebräer": "Hebr", "Jakobus": "Jak", "Judas": "Jud", "Offenbarung": "Offb"
	},

	/**
	 * Start function init update Dom + Get Data from xml File
	 */
	start: function () {
		let self = this;
		Log.info("Starting module!: " + self.name + ", identifier: " + self.identifier);

		self.DailyVerse = null;
		self.DailyTeachingText = null;
		self.nextYearMissing = null;
		self.loadedDate = null;
		self.error = null;
		self.getData(self);
		// The display is updated when the helper answers
		setInterval(function () {
			self.getData(self);
		}, self.config.updateInterval);
	},

	getStyles: function () {
		return ["MMM-Losung.css"];
	},

	getScripts: function () {
		return [];
	},

	/**
	 * Asks the helper for the texts of the local day of the mirror. The
	 * loaded texts stay visible until the answer arrives.
	 * @param {object} self The module
	 */
	getData: function (self) {
		const actDate = new Date();
		const pad = (number) => String(number).padStart(2, "0");
		self.requestedDate = `${actDate.getFullYear()}-${pad(actDate.getMonth() + 1)}-${pad(actDate.getDate())}`;
		self.sendSocketNotification("GetLosung", { date: self.requestedDate });
	},

	getDom: function () {
		let self = this;
		let wrapper = document.createElement("div");
		// Size, colors and fonts come from the classes of MagicMirror
		wrapper.className = "moravian-container small";

		if ((self.DailyVerse === null || self.DailyVerse === undefined)
			&& (self.DailyTeachingText === null || self.DailyTeachingText === undefined))
			wrapper.textContent = self.error || "Losung wird geladen ...";
		else {
			if (self.config.showDailyText)
				wrapper.appendChild(self._createElement(self.DailyVerse, "moravian"));
			if (self.config.showTeachingText)
				wrapper.appendChild(self._createElement(self.DailyTeachingText, "teaching"));
			// A problem that needs attention before New Year
			if (self.nextYearMissing) {
				let warning = document.createElement("div");
				warning.className = "moravian-warning xsmall dimmed";
				warning.textContent = `Die Losungen für ${self.nextYearMissing} fehlen noch.`;
				wrapper.appendChild(warning);
			}
		}
		return wrapper;
	},

	/**
	 * A text with its reference below. With compact, the short form of the
	 * reference follows the text instead. Running text is light, like the
	 * news and alerts of MagicMirror; the text is bright, the reference has
	 * the normal color.
	 * @param {{text: string, reference: string}} verse The text and the reference
	 * @param {string} clases The prefix of the class names
	 * @returns {HTMLElement} The element
	 */
	_createElement(verse, clases) {
		let element = document.createElement("div");
		let elementText = document.createElement("div");
		let elementVers = document.createElement(this.config.compact ? "span" : "div");
		element.classList.add(`moravian-${clases}`, "light");
		elementText.classList.add(`${clases}-text`, "bright");
		elementVers.classList.add(`${clases}-vers`);
		this._appendText(elementText, verse.text, clases);
		element.appendChild(elementText);

		if (this.config.compact) {
			// A no-break space keeps the reference with the last word, so it
			// does not stand alone on a line
			elementVers.classList.add("normal");
			elementVers.textContent = this._shortReference(verse.reference);
			elementText.append("\u00a0", elementVers);
		} else {
			elementVers.textContent = verse.reference;
			element.appendChild(elementVers);
		}

		return element;
	},

	/**
	 * The short form of a reference, e.g. "Ps 23,1" for "Psalm 23,1". A
	 * reference with a book name that is not known stays as it is.
	 * @param {string} reference The reference of the Losungen
	 * @returns {string} The short form
	 */
	_shortReference(reference) {
		const match = /^(.+?) (\d+,\d+(?:[-.]\d+)*)$/.exec(reference);
		const book = match && Object.hasOwn(this.shortBookNames, match[1]) && this.shortBookNames[match[1]];
		return book ? `${book} ${match[2]}` : reference;
	},

	/**
	 * Adds a text of the yearly file as plain text. Words between slashes
	 * introduce the quotation and are not part of it, e.g. "/Paulus
	 * sprach:/". losungen.de shows them in normal weight before the bold
	 * quotation, the module in the normal color before the bright one.
	 * Words between hash signs are emphasized.
	 * @param {HTMLElement} element The element of the text
	 * @param {string} text The text with its marks
	 * @param {string} clases The prefix of the class names
	 */
	_appendText(element, text, clases) {
		for (const part of text.split(/(\/[^/]*\/)/)) {
			if (part.length > 2 && part.startsWith("/") && part.endsWith("/")) {
				let intro = document.createElement("span");
				intro.classList.add(`${clases}-intro`, "normal");
				intro.textContent = part.slice(1, -1);
				element.appendChild(intro);
				continue;
			}
			for (const piece of part.split(/(#[^#]*#)/)) {
				if (piece.length > 2 && piece.startsWith("#") && piece.endsWith("#")) {
					let emphasis = document.createElement("em");
					emphasis.textContent = piece.slice(1, -1);
					element.appendChild(emphasis);
				} else if (piece)
					element.appendChild(document.createTextNode(piece));
			}
		}
	},

	socketNotificationReceived: function (notification, payload) {
		let self = this;
		// Ignore answers for another day, e.g. a request from before midnight
		if (!payload || payload.date !== self.requestedDate)
			return;

		if (notification === "Error") {
			console.error(self.name, "Error in helper Module", payload.reason);
			if (payload.reason === "missing")
				self._showError(`Die Losungen für ${payload.year} fehlen.`);
			else if (payload.reason === "day")
				self._showError("Für heute gibt es keine Losung.");
			else
				self._showError("Losung konnte nicht geladen werden.");
		} else if (notification === "Losung") {
			const nextYearMissing = payload.nextYearMissing || null;
			if (self.loadedDate === payload.date && self.nextYearMissing === nextYearMissing)
				return; // already shown
			self.DailyVerse = payload.losung;
			self.DailyTeachingText = payload.lehrtext;
			self.nextYearMissing = nextYearMissing;
			self.loadedDate = payload.date;
			self.error = null;
			self.updateDom();
		} else {
			console.error(self.name, "Undefined Function", payload);
		}
	},

	// #region private functions

	/**
	 * Shows an error unless the text of today is already loaded. Texts of
	 * a previous day are removed, so they are not shown as today's texts.
	 * @param {string} message The error message
	 */
	_showError: function (message) {
		if (this.loadedDate === this.requestedDate || (this.loadedDate === null && this.error === message))
			return;
		this.DailyVerse = null;
		this.DailyTeachingText = null;
		this.nextYearMissing = null;
		this.loadedDate = null;
		this.error = message;
		this.updateDom();
	}

	// #endregion
});
