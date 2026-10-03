var NodeHelper = require('node_helper');
var fetch = require('node-fetch');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const tls = require('node:tls');

// The text of a day does not change, so a successful response is reused for
// an hour. Failed requests are retried after a minute.
const CACHE_SUCCESS_MS = 60 * 60 * 1000;
const CACHE_ERROR_MS = 60 * 1000;

module.exports = NodeHelper.create({
    start: function () {
        console.log('MMM-Losung helper started ...');
        this.cache = null;
        this.pendingFetches = new Map();
        // www.losungen.de does not send its intermediate certificate. The
        // missing official Let's Encrypt chain is added to Node's built-in
        // CAs, so the certificate is still fully verified (see README).
        this.agent = new https.Agent({
            ca: [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, 'letsencrypt-chain.pem'), 'utf8')]
        });
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
