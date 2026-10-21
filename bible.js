// A Bible translation from an EPUB of the Deutsche Bibelgesellschaft that
// the user bought, e.g. "BasisBibel. Die Kompakte". The module shows its
// verses for the references of the Losungen.
const { decodeEntities, filesFromZip } = require("./losungen-data");

// The book names of the Losungen and the book codes of the EPUB files
const BOOKS = {
	"1. Mose": "gen", "2. Mose": "exo", "3. Mose": "lev", "4. Mose": "num", "5. Mose": "deu",
	"Josua": "jos", "Richter": "jdg", "Rut": "rut", "1. Samuel": "1sa", "2. Samuel": "2sa",
	"1. Könige": "1ki", "2. Könige": "2ki", "1. Chronik": "1ch", "2. Chronik": "2ch",
	"Esra": "ezr", "Nehemia": "neh", "Ester": "est", "Hiob": "job", "Psalm": "psa",
	"Sprüche": "pro", "Prediger": "ecc", "Hohelied": "sng", "Jesaja": "isa", "Jeremia": "jer",
	"Klagelieder": "lam", "Hesekiel": "ezk", "Daniel": "dan", "Hosea": "hos", "Joel": "jol",
	"Amos": "amo", "Obadja": "oba", "Jona": "jon", "Micha": "mic", "Nahum": "nam",
	"Habakuk": "hab", "Zefanja": "zep", "Haggai": "hag", "Sacharja": "zec", "Maleachi": "mal",
	"Matthäus": "mat", "Markus": "mrk", "Lukas": "luk", "Johannes": "jhn",
	"Apostelgeschichte": "act", "Römer": "rom", "1. Korinther": "1co", "2. Korinther": "2co",
	"Galater": "gal", "Epheser": "eph", "Philipper": "php", "Kolosser": "col",
	"1. Thessalonicher": "1th", "2. Thessalonicher": "2th", "1. Timotheus": "1ti",
	"2. Timotheus": "2ti", "Titus": "tit", "Philemon": "phm", "1. Petrus": "1pe",
	"2. Petrus": "2pe", "1. Johannes": "1jn", "2. Johannes": "2jn", "3. Johannes": "3jn",
	"Hebräer": "heb", "Jakobus": "jas", "Judas": "jud", "Offenbarung": "rev"
};
const CODES = new Set(Object.values(BOOKS));

// A chapter, a verse number, a heading with its text, another tag or text.
// Headings are not part of the verses, and the text of a book before its
// first chapter is its introduction.
const TOKENS = /<div[^>]*\bid="cref-(\d+)"[^>]*>[\s\S]*?<\/div>|<span[^>]*\bclass="bvn"[^>]*>\s*<a[^>]*>(\d+)<\/a>\s*<\/span>|<(h\d)\b[^>]*>[\s\S]*?<\/\3>|<[^>]*>|[^<]+/g;

/**
 * Reads the verses of all books.
 * @param {Buffer} epub The EPUB file
 * @returns {{name: string, verses: Map<string, string>}} The name of the
 * translation and the verses by "book.chapter.verse"
 */
function readBible(epub) {
	const files = filesFromZip(epub, (name) => /\.(xhtml|opf)$/.test(name));
	const verses = new Map();
	// The titles of psalms, which are part of their first verses
	const titles = new Map();
	let name = null;
	for (const [fileName, content] of files) {
		let text = content.toString("utf8");
		if (fileName.endsWith(".opf")) {
			const title = /<dc:title[^>]*>([^<]*)</.exec(text);
			if (title) name = decodeEntities(title[1]).split(".")[0].trim();
			continue;
		}
		const book = /(?:^|\/)([a-z0-9]+)(?:_\d+)?\.xhtml$/.exec(fileName);
		if (!book || !CODES.has(book[1])) continue;
		// The divine name, which the book sets in small capitals
		text = text.replace(/<span class="nd">([^<]*)<\/span>/g, (span, divineName) => divineName.toUpperCase());
		let chapter = 0;
		let verse = 0;
		let title = false;
		// Verses are only in paragraphs. Text elsewhere, e.g. the invisible
		// watermark of the shop at the end of a book, is left out.
		let paragraph = false;
		const append = (piece) => {
			const target = title ? titles : verses;
			const key = `${book[1]}.${chapter}.${verse}`;
			target.set(key, (target.get(key) || "") + piece);
		};
		for (const [token, chapterNumber, verseNumber] of text.matchAll(TOKENS)) {
			if (chapterNumber) {
				chapter = Number(chapterNumber);
				verse = 0;
			} else if (verseNumber) {
				verse = Number(verseNumber);
			} else if (token[0] === "<") {
				if (/^<\/?p\b/.test(token)) paragraph = token[1] !== "/";
				if (/^<p\b/.test(token)) title = /\bclass="qd"/.test(token);
				// A new paragraph or line of poetry continues the verse after a space
				if (chapter && verse && /^<\/?(p|br)\b/.test(token)) append(" ");
			} else if (chapter && verse && paragraph) {
				append(decodeEntities(token));
			}
		}
	}
	// A title is shown only for a verse that has no other text. A single
	// asterisk refers to an explanation in the book. Brackets mark text that
	// was added later, and "[...]" a verse that the translation leaves out,
	// so that the text of the Losungen is shown for it.
	const tidy = (text) => (text || "").replace(/(^|\s)\*(?=\s|$)/g, " ").replace(/\s*\[(?:\.\.\.|…)\]|[[\]]/g, "").replace(/\s+/g, " ").trim();
	const result = new Map();
	for (const key of new Set([...verses.keys(), ...titles.keys()]))
		result.set(key, tidy(verses.get(key)) || tidy(titles.get(key)));
	if (!name || result.size < 20000) throw new Error("Not a complete Bible of the Deutsche Bibelgesellschaft");
	return { name, verses: result };
}

/**
 * The full verses of a reference of the Losungen, e.g. "2. Mose 32,31.32".
 * @param {{verses: Map<string, string>}} bible The Bible
 * @param {string} reference The reference
 * @returns {string|null} The text, or null if a verse is missing
 */
function versesFor(bible, reference) {
	const match = /^(.+?) (\d+),(\d+(?:[-.]\d+)*)$/.exec(reference);
	const book = match && BOOKS[match[1]];
	if (!book) return null;
	const numbers = [];
	for (const part of match[3].split(".")) {
		const [first, last = first] = part.split("-").map(Number);
		for (let verse = first; verse <= last && numbers.length < 50; verse++) numbers.push(verse);
	}
	const texts = [];
	for (const [index, verse] of numbers.entries()) {
		const text = bible.verses.get(`${book}.${match[2]}.${verse}`);
		if (!text) return null;
		// Verses that are left out between two are marked
		texts.push(index && verse !== numbers[index - 1] + 1 ? `… ${text}` : text);
	}
	return texts.length ? texts.join(" ") : null;
}

module.exports = { readBible, versesFor };
