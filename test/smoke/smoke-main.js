// Rauchtest im ECHTEN Electron (nur für Tests): echtes main.js, echtes Fenster (unsichtbar), echte Sockets, Pult-Attrappe auf 127.0.0.1:10023.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "smoke-config.json"), "utf8"));
app.setPath("userData", cfg.userData);
if (app.dock) app.dock.hide();
const MockX32 = require("./test/mock-console");
let remote = null;
const server = dgram.createSocket("udp4");
const mock = new MockX32({ deliver: (u8) => { if (remote) server.send(u8, remote.port, remote.address); }, latency: 1 });
server.on("message", (m, r) => { remote = r; mock.receive(new Uint8Array(m.buffer, m.byteOffset, m.byteLength)); });
server.bind(10023, "127.0.0.1");
app.on("browser-window-created", (e, win) => {
  win.setOpacity(0); win.hide();
  win.webContents.once("did-finish-load", async () => {
    let res;
    try { res = await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, "smoke-renderer.js"), "utf8").replace(/__GATEWAY__/g, cfg.gateway || ""), true); } catch (err) { res = { error: String((err && err.stack) || err) }; }
    try { res.fileLog = fs.readFileSync(path.join(cfg.userData, "verbindung.log"), "utf8"); } catch (err) { res.fileLog = null; }
    fs.writeFileSync(cfg.out, JSON.stringify(res, null, 1));
    app.quit();
  });
});
require("./main.js");
