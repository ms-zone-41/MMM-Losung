Module.register("MMM-Losung", {
	defaults: {
		updateInterval: 10 * 60 * 1000, // 10 minutes
		showDailyText: true,
		showTeachingText: true
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
	 * A text with its reference below. Running text is light, like the
	 * news and alerts of MagicMirror; the text is bright, the reference
	 * has the normal color.
	 * @param {{text: string, reference: string}} verse The text and the reference
	 * @param {string} clases The prefix of the class names
	 * @returns {HTMLElement} The element
	 */
	_createElement(verse, clases) {
		let element = document.createElement("div");
		let elementText = document.createElement("div");
		let elementVers = document.createElement("div");
		element.classList.add(`moravian-${clases}`, "light");
		elementText.classList.add(`${clases}-text`, "bright");
		elementVers.classList.add(`${clases}-vers`);
		this._appendText(elementText, verse.text, clases);
		elementVers.textContent = verse.reference;

		element.appendChild(elementText);
		element.appendChild(elementVers);

		return element;
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
