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

The server www.losungen.de currently does not send its intermediate certificate. Browsers fill it in (Chrome and Safari download it, Firefox ships it), but Node.js does not, so every request failed with `unable to verify the first certificate`.

The module therefore does not verify the certificate of www.losungen.de. Only its own requests skip the check; other modules and system-wide settings are not affected. The texts are public and nothing secret is sent, so what is lost is the protection against someone in the network path who changes the texts. To keep such a change from adding HTML or scripts to the mirror, the module shows the texts as plain text only.

Shipping the missing certificate would break whenever Let's Encrypt signs with another intermediate certificate, and downloading it automatically needs a lot of code for a single server. Once the server sends its full chain, the check should be turned on again. You can test that with:

```shell
openssl s_client -connect www.losungen.de:443 -servername www.losungen.de -showcerts </dev/null
```

It is fixed when the output shows more than one certificate and `Verify return code: 0 (ok)`.

## Tests

The tests use Node's test runner and jsdom from MagicMirror. Run them from the MagicMirror root directory:

```shell
node --test modules/MMM-Losung/tests/losung.test.js
```

## Additional informations 
Have fun with your daily input :)
