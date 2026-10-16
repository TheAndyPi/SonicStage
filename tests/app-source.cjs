// The app is a set of classic scripts that share one global scope. Tests read
// them in the same order index.html loads them, so extracted code sees the same
// declarations it would in the browser.
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.resolve(__dirname, '..', 'public');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const appScripts = [...indexHtml.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(match => match[1]);

function readPublic(relativePath) {
    return fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
}

function appSource() {
    return appScripts.map(readPublic).join('\n');
}

module.exports = { appScripts, appSource, readPublic, publicDir };
