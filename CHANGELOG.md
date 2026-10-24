# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `compact`: each reference at the end of its text, with the book in the short form of the Lutherbibel 2017, e.g. "Ps 23,1", which usually saves a line for each text

## [2.0.0] - 2026-10-23

The first release of the fork [ms-zone-41/MMM-Losung](https://github.com/ms-zone-41/MMM-Losung), which continues [Dobherrmann/MMM-Losung](https://github.com/Dobherrmann/MMM-Losung). The options stay the same; to switch, see [Update](README.md#update).

### Added

- `bibleFile`: the full verses from a Bible of the Deutsche Bibelgesellschaft that you bought as an EPUB, e.g. the BasisBibel, instead of the texts of the Losungen
- Messages if the texts cannot be loaded, and in December while the file of the next year is missing

### Changed

- The texts come from the yearly file of the publisher, which the module downloads into its directory by itself, instead of the web page of each day. The module needs no `npm install`, and it deletes the files of the years before the previous one, as the terms of use require.
- Fonts, sizes and colors follow the theme of MagicMirror². The labels "Losung:" and "Lehrtext:" and the class `moravian-header` are gone; set a `header` instead.
- `updateInterval` is 10 minutes by default instead of 10 seconds
- The node helper logs with the logger of MagicMirror², so `logLevel` applies
- The module requires MagicMirror² 2.31.0 or newer (Node.js 22 or newer)

### Fixed

- The module showed only "Data get loaded" instead of the texts
- Introductions such as "Paulus sprach:" were cut off
- New texts appeared only at the next update

## [1.0.0] - 2022-01-19

- The version of [Dobherrmann/MMM-Losung](https://github.com/Dobherrmann/MMM-Losung)
