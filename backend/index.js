/**
 * The deployment entry, deliberately plain JavaScript.
 *
 * Everything else in this package is TypeScript, compiled to `dist/` by
 * `npm run build`. This file is the one thing the platform has to resolve
 * *before* it builds anything, so it is committed as-is: no compile step, no
 * imports of its own, nothing that can be missing at that moment.
 *
 * It requires the compiled app and, if that fails, answers with the reason.
 * That split matters: a module that cannot load is a crash the platform reports
 * as a bare `FUNCTION_INVOCATION_FAILED` - no route, no log line, no
 * `x-request-id` header - which is unanswerable from a browser. `require` in a
 * try/catch turns the same failure into a JSON body that names the missing
 * module, so the next deploy explains itself instead of needing a dashboard.
 */
let app;

try {
  app = require("./dist/index.js");
} catch (e) {
  const message = e && e.message ? e.message : String(e);
  console.error(
    JSON.stringify({ level: "error", msg: "backend.init.failed", message })
  );

  app = (req, res) => {
    const body = JSON.stringify({
      error: { code: "BACKEND_INIT_FAILED", message },
    });
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  };
}

module.exports = app;
