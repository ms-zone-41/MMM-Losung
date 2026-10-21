// Tests for reading the verses of a Bible from an EPUB

const assert = require("node:assert/strict");
const test = require("node:test");
const { readBible, versesFor } = require("../bible");
const { bibleEpub, zipOf } = require("./support");

// Made-up verses and headings in the markup of the EPUBs of the Deutsche
// Bibelgesellschaft
const books = {
	exo_8: `<h1 class="bible_book_title">Titel des Buches</h1>
<p class="ip">Die Einleitung nennt <a class="ref" href="#">2. Mose 32,1</a>.</p>
<div id="cref-32" class="bcn"><a href="exo_1.xhtml#top_of_book"><span class="cb">Kapitel </span>32</a></div>
<h2 class="s1"> Eine Überschrift</h2>
<h2 class="r">(<a class="ref" href="#">1. Mose 1,1</a>)</h2>
<p class="m"> <span class="bvn"><a href="#cref-32">31</a></span> Vers 31 mit H<span class="nd">ERRN</span>: »Erste Zeile.</p>
<p class="q1"> Zweite Zeile mit einem <span class="k"><a href="notes_exo_8.xhtml#fn-1" epub:type="noteref">Stichwort</a></span>. <span id="vref-32-32" class="bvn"><a href="#cref-32">32</a></span> <span class="k"><a href="notes_exo_8.xhtml#fn-2" epub:type="noteref">*</a></span> Vers 32 &amp; mehr.«</p>
<p class="m"> <span class="bvn"><a href="#cref-32">33</a></span> Vers 33 mit H<span class="nd">ERR</span>. <span class="k"><a href="notes_exo_8.xhtml#fn-3" epub:type="noteref">[</a></span><span class="bvn"><a href="#cref-32">34</a></span> Vers 34 mit <span class="nd">Herrn </span>danach.] <span class="bvn"><a href="#cref-32">35</a></span> [...]</p>
</div><div style="color:white;opacity:0.0">Wasserzeichen mit der Kaufnummer 1234567</div>`,
	psa_5: `<div id="cref-23" class="bcn"><a href="#top"><span class="cb">Kapitel </span>23</a></div>
<h2 class="d"> Noch eine Überschrift</h2>
<p class="qd"> <span class="bvn"><a href="#cref-23">1</a></span> TITEL DES PSALMS.</p>
<p class="q1"> Erster Vers.</p>
<p class="q1"> <span class="bvn"><a href="#cref-23">2</a></span> Zweiter Vers.</p>
<p class="q1"> <span class="bvn"><a href="#cref-23">3</a></span> Dritter Vers,</p><p class="q2">zweite Zeile.</p>
<div id="cref-24" class="bcn"><a href="#top"><span class="cb">Kapitel </span>24</a></div>
<p class="qd"> <span class="bvn"><a href="#cref-24">1</a></span> NUR EIN TITEL.</p>
</div><div style="color:white;opacity:0.0">Wasserzeichen mit der Kaufnummer 1234567</div>`
};

test("reads the verses of an EPUB of the Deutsche Bibelgesellschaft", () => {
	const bible = readBible(bibleEpub(books));
	assert.equal(bible.name, "Testbibel");
	// Lines are joined, headings and the introduction left out, the divine name kept whole
	assert.equal(bible.verses.get("exo.32.31"), "Vers 31 mit HERRN: »Erste Zeile. Zweite Zeile mit einem Stichwort.");
	// The asterisk refers to an explanation in the book
	assert.equal(bible.verses.get("exo.32.32"), "Vers 32 & mehr.«");
	assert.equal(bible.verses.get("exo.32.1"), undefined);
	// Brackets of later additions are left out, the divine name is in capitals
	assert.equal(bible.verses.get("exo.32.33"), "Vers 33 mit HERR.");
	assert.equal(bible.verses.get("exo.32.34"), "Vers 34 mit HERRN danach.");
});

test("leaves out the invisible watermark of the shop", () => {
	const bible = readBible(bibleEpub(books));
	assert(![...bible.verses.values()].some((text) => text.includes("Wasserzeichen")));
});

test("shows the title of a psalm only for a verse without other text", () => {
	const bible = readBible(bibleEpub(books));
	assert.equal(bible.verses.get("psa.23.1"), "Erster Vers.");
	assert.equal(bible.verses.get("psa.24.1"), "NUR EIN TITEL.");
});

test("finds the full verses of a reference of the Losungen", () => {
	const bible = readBible(bibleEpub(books));
	assert.equal(versesFor(bible, "2. Mose 32,31.32"), "Vers 31 mit HERRN: »Erste Zeile. Zweite Zeile mit einem Stichwort. Vers 32 & mehr.«");
	// Lines are joined with a space even without one in the markup
	assert.equal(versesFor(bible, "Psalm 23,1-3"), "Erster Vers. Zweiter Vers. Dritter Vers, zweite Zeile.");
	// Verses that are left out between two are marked
	assert.equal(versesFor(bible, "Psalm 23,1.3"), "Erster Vers. … Dritter Vers, zweite Zeile.");
	// 2. Mose 32,35 is a verse that the translation leaves out
	for (const reference of ["2. Mose 32,35", "2. Mose 32,36", "2. Mose 32,34-36", "Psalm 23", "Hohes Lied 1,1", "Psalm 23,3-1"])
		assert.equal(versesFor(bible, reference), null, reference);
});

test("rejects files that are not a complete Bible", () => {
	assert.throws(() => readBible(zipOf([{ name: "OPS/content.opf", data: "<dc:title>Ein Roman</dc:title>" }])), /Not a complete Bible/);
	assert.throws(() => readBible(Buffer.from("Kein E-Book")), /Not a zip file/);
});
