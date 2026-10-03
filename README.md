# MMM-Losung - German Losung for MagicMirror²

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/). It will fetch and display the daily verse of the day from  www.losungen.de 

![Exemple ](/Example.JPG)

## Installation

```shell
cd ~/MagicMirror/modules
git clone https://github.com/Dobherrmann/MMM-Losung.git
cd MMM-Losung
npm install
```

## Using the module

To use this module, add the following configuration block to the modules array in the `config/config.js` file:

```js
  modules: [
    {
      module: "MMM-Losung",
      position: "top_bar",
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
| `updateInterval` | *Optional* - How often (in ms) the module checks for the text of the current day. Default: `600000` (10 minutes). The helper caches the text of a day, so shorter intervals do not cause more requests to www.losungen.de.
| `showDailyText` | *Optional* - Show daily bible verse
| `showTeachingText` |  *Optional* - Show additional teaching text

## HTTPS certificate chain

The server www.losungen.de currently does not send its intermediate certificate. Browsers usually load it automatically, but Node.js does not, so every request failed with `unable to verify the first certificate`.

The module therefore ships the missing official Let's Encrypt certificates in `letsencrypt-chain.pem` and adds them to Node's built-in certificate authorities for its own requests only. The certificate of the server is still fully verified, and no system-wide settings are changed. Sources:

- https://letsencrypt.org/certs/gen-y/int-yr1.pem
- https://letsencrypt.org/certs/gen-y/int-yr2.pem
- https://letsencrypt.org/certs/gen-y/root-yr-by-x1.pem

## Tests

The tests use Node's test runner and jsdom from MagicMirror. Run them from the MagicMirror root directory:

```shell
node --test modules/MMM-Losung/tests/losung.test.js
```

## Additional informations 
Have fun with your daily input :)
