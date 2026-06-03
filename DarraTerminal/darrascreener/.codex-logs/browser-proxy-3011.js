const http = require("http");
const targetHost = "127.0.0.1";
const targetPort = 3000;
const server = http.createServer((req, res) => {
  const options = {
    hostname: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(error && error.message ? error.message : error));
  });
  req.pipe(proxyReq);
});
server.listen(3011, "127.0.0.1", () => console.log("proxy-3011-ready"));
