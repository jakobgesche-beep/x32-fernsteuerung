// Erster Versuch (Sondierung): Verbindungscode wie in main.js über ECHTE UDP-Sockets gegen die Pult-Attrappe.
// Ausführen mit Node (z. B. ELECTRON_RUN_AS_NODE=1 <Electron> test/net-probe.js).
const dgram = require("dgram");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const X32Client = require(path.join(ROOT, "shared/client")), MockX32 = require("./mock-console");
const PORT = 10023, IP = "127.0.0.1";
let lastRemote = null;
const server = dgram.createSocket("udp4");
const mock = new MockX32({ deliver: (u8) => { if (lastRemote) server.send(u8, lastRemote.port, lastRemote.address); }, latency: 1 });
server.on("message", (msg, rinfo) => { lastRemote = rinfo; mock.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)); });
server.bind(PORT, IP, () => {
  const sock = dgram.createSocket("udp4");
  const states = [];
  let client = null;
  sock.on("message", (msg) => client.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)));
  sock.on("error", (e) => console.log("SOCKET-FEHLER", e.code, e.message));
  sock.bind(() => {
    client = new X32Client({
      send: (u8) => { try { sock.send(u8, PORT, IP); } catch (e) { console.log("send warf:", e.message); } },
      onStatus: (s) => { if (!states.length || states[states.length - 1] !== s.state) { states.push(s.state); console.log("Status:", s.state); } },
      onLog: (m) => console.log("LOG", m),
    });
    client.start();
    setTimeout(() => {
      console.log("Zustände:", states.join(" -> "));
      console.log("Pult-Info:", JSON.stringify(client.info));
      console.log("Statistik:", JSON.stringify(client.stats));
      client.stop(); sock.close(); server.close(); mock.shutdown(); process.exit(0);
    }, 4000);
  });
});
