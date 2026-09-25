const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// When packaged with pkg, __dirname points inside the virtual snapshot.
// The real index.html/styles.css/app.js are copied next to the .exe by the
// build workflow, so serve from there instead.
const root = process.pkg ? path.dirname(process.execPath) : __dirname;
const port = Number(process.env.PORT || 8790);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`CounselNote is running at ${url}`);
  if (process.pkg && process.platform === "win32") {
    exec(`start ${url}`);
  }
});

