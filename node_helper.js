var NodeHelper = require('node_helper');
var fetch = require('node-fetch');
const https = require('node:https');

// The text of a day does not change, so a successful response is reused for
// an hour. Failed requests are retried after a minute.
const CACHE_SUCCESS_MS = 60 * 60 * 1000;
const CACHE_ERROR_MS = 60 * 1000;

module.exports = NodeHelper.create({
    start: function () {
        console.log('MMM-Losung helper started ...');
        this.cache = null;
        this.pendingFetches = new Map();
        // The certificate of www.losungen.de is not verified, on purpose:
        // - The server sends only its own certificate, not the intermediate
        //   certificate of Let's Encrypt. Browsers fill it in, Node.js does
        //   not, so every verified request fails with "unable to verify the
        //   first certificate".
        // - Shipping the missing certificate breaks whenever Let's Encrypt
        //   signs with another intermediate, and downloading it needs a lot
        //   of code for a single server.
        // - The texts are public and nothing secret is sent. Without the
        //   check, someone in the network path could change the texts, but
        //   the frontend shows them as plain text only (see _toText in
        //   MMM-Losung.js), so they cannot add HTML or scripts to the mirror.
        // Only the requests of this module skip the check, unlike
        // NODE_TLS_REJECT_UNAUTHORIZED=0, which would affect all modules.
        // Verify again as soon as the server sends its full chain (see README).
        this.agent = new https.Agent({ rejectUnauthorized: false });
    },

    stop: function () {
        this.agent.destroy();
    },

    _getWebData(webURL) {
        if (this.cache && this.cache.url === webURL && Date.now() < this.cache.expiresAt) {
            this.sendSocketNotification(this.cache.notification, this.cache.payload);
            return Promise.resolve();
        }
        // Several module instances or browsers share one request
        if (this.pendingFetches.has(webURL)) return this.pendingFetches.get(webURL);

        const request = (async () => {
            try {
                const response = await fetch(webURL, { agent: this.agent, timeout: 15000 });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const html = await response.text();
                this.cache = { url: webURL, notification: 'WebData', payload: { url: webURL, html }, expiresAt: Date.now() + CACHE_SUCCESS_MS };
                this.sendSocketNotification('WebData', this.cache.payload);
            } catch (error) {
                console.error('MMM-Losung: Fetch error: ' + error.message);
                this.cache = { url: webURL, notification: 'Error', payload: { url: webURL, message: error.message }, expiresAt: Date.now() + CACHE_ERROR_MS };
                this.sendSocketNotification('Error', this.cache.payload);
            } finally {
                this.pendingFetches.delete(webURL);
            }
        })();
        this.pendingFetches.set(webURL, request);
        return request;
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === 'GetDataFromWeb') {
            this._getWebData(payload);
        }
    }
});
