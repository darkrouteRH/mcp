// Bicara ke server lewat stdio persis seperti klien MCP sungguhan.
import { spawn } from "node:child_process";
const p = spawn("node", ["src/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
p.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
p.stderr.on("data", (d) => process.stderr.write("[server] " + d));
let id = 0;
const send = (method, params) => new Promise((res, rej) => {
  const myId = ++id;
  pending.set(myId, res);
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
  setTimeout(() => rej(new Error(`timeout on ${method}`)), 25000);
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

const init = await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
ok(init.result?.serverInfo?.name === "darkroute", `initialize: ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await send("tools/list", {});
const names = (tools.result?.tools ?? []).map((t) => t.name);
ok(names.length === 3, `tools/list returns 3 tools: ${names.join(", ")}`);

const call = async (name, args) => (await send("tools/call", { name, arguments: args })).result;

console.log("\n--- token_exit_cost, $DARK (harus ok) ---");
let r = await call("token_exit_cost", { address: "0xebB4C5B97E4117e30EC82ce025E6f21dded05436" });
console.log(r.content[0].text.split("\n").slice(0, 3).join("\n"));
ok(!r.isError && /There is a way out/.test(r.content[0].text), "$DARK verdict is 'a way out'");

console.log("\n--- token_exit_cost, token jebakan ---");
r = await call("token_exit_cost", { address: "0x6c9329f0b4d92d5017a6963db53fb2351670f00e" });
console.log(r.content[0].text.split("\n").slice(0, 3).join("\n"));
ok(/NO WAY OUT/.test(r.content[0].text), "predatory token reads NO WAY OUT");
ok(/measured/.test(r.content[0].text), "the basis of the number is stated");

console.log("\n--- token_exit_cost, Arc ---");
r = await call("token_exit_cost", { address: "0x01d776dc060f5a0a7296ac60a2222c992e284f01", chain: "arc" });
console.log(r.content[0].text.split("\n").slice(0, 3).join("\n"));
ok(/Arc/.test(r.content[0].text), "Arc is named");
ok(/no UniversalRouter/.test(r.content[0].text), "Arc says it cannot send the fill");

console.log("\n--- swap_quote ---");
r = await call("swap_quote", { address: "0xebB4C5B97E4117e30EC82ce025E6f21dded05436", buy: 0.01 });
ok(/you receive/.test(r.content[0].text), "swap_quote prints a fill");

console.log("\n--- alamat ngawur ditolak, bukan ditebak ---");
r = await call("token_exit_cost", { address: "bukan-alamat" });
ok(r.isError === true, "a malformed address is an error, not a guess");

console.log(`\n${pass} passed, ${fail} failed`);
p.kill();
process.exit(fail ? 1 : 0);
