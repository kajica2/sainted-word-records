// scripts/lib/mini-resp.mjs  -  tiny stdlib-only ServerResponse mock.
//
// The api/_lib/http.js helpers only use res.setHeader() and res.end(),
// so the mock only needs those. The "headers" map records every header
// set (later calls overwrite earlier ones  -  matches Node's behaviour for
// the same header name, which http.js relies on for Vary / Allow-Origin).
//
// Keep this script tiny and free of deps so it loads in a few ms and is
// easy to mock-thrash during tests.

export function makeRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    removeHeader(name) {
      delete headers[String(name).toLowerCase()];
    },
    writeHead(status, h) {
      this.statusCode = status;
      if (h) {
        for (const k of Object.keys(h)) this.setHeader(k, h[k]);
      }
    },
    end() {},
  };
}
