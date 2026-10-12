# MMM-Losung - German Losung for MagicMirror²

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/). It displays the daily texts of the Herrnhuter Brüdergemeine, the Losung and the Lehrtext, from the yearly file that the publisher offers on [www.losungen.de](https://www.losungen.de/download/).

![Exemple ](/Example.JPG)

## Installation

```shell
cd ~/MagicMirror/modules
git clone https://github.com/Dobherrmann/MMM-Losung.git
```

The module needs no `npm install`. It downloads the texts of the year by itself, see [The yearly file](#the-yearly-file).

## Using the module

To use this module, add the following configuration block to the modules array in the `config/config.js` file:

```js
  modules: [
    {
      module: "MMM-Losung",
      position: "top_bar",
      header: "Losung des Tages",
      config: {
        updateInterval: 10 * 60 * 1000,
        showDailyText: true,
        showTeachingText: true,
      },
    },
  ],
```
## Configuration options

| Option                | Description
|-----------------------|-----------
| `updateInterval` | *Optional* - How often (in ms) the module checks for the text of the current day, so the new text appears at the latest this long after midnight. Default: `600000` (10 minutes). The texts come from a file on the mirror; a check uses the network only while the file of the year is missing or broken, at most once an hour.
| `showDailyText` | *Optional* - Show daily bible verse
| `showTeachingText` |  *Optional* - Show additional teaching text

The terms of use of the publisher say that the Losung and the Lehrtext are always shown together.

## The yearly file

The publisher offers the texts of a year as the file `Losungen Free YYYY.xml`, for example `Losungen Free 2026.xml`, in a zip file. The module keeps this file in its own folder and reads the texts of the day from there:

- If the file of the current year is missing, the module downloads it when the texts are requested, at most once an hour. It shows and downloads only the previous, current and next year.
- From October on, it looks once a day for the file of the next year. The publisher puts it online between October and November. In December, the module shows a dimmed note under the texts while the file of the next year is still missing.
- The files come from `https://www.ebu.de/fileadmin/media-losungen/download/Losung_YYYY_XML.zip` or, if that fails, from `https://www.brueder-unitaet.de/download/Losung_YYYY_XML.zip`. Both belong to the publisher and serve the same files. The module only keeps a file that contains the texts of the requested year.
- The download needs write access to the folder of the module for the user that runs MagicMirror. Without it, the module keeps the downloaded texts only until MagicMirror restarts and logs a hint.

Without internet access, or if no download works, download `Losung_YYYY_XML.zip` from https://www.losungen.de/download/ yourself and put `Losungen Free YYYY.xml` from it into the folder of the module. The module uses it at the next check, within `updateInterval` and without a restart. A broken file is replaced by a download.

The terms of use allow only the texts of the previous, current and next year. So the files are not part of the repository, and once a day the module deletes the files of older years.

## Development

The tests use Node's test runner and the development dependencies of the module. Run them and ESLint in the folder of the module:

```shell
npm install
node --run test
node --run lint
```

## Additional informations 
Have fun with your daily input :)
