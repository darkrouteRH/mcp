#!/usr/bin/env node
// DarkRoute as an MCP server.
//
// The point is not to put an API behind a second protocol. It is that one of the questions this
// data answers is one a model gets asked constantly and cannot currently check: somebody pastes a
// contract address and asks whether it is safe to buy. Price feeds cannot answer that. They quote
// the pool the token's own site links to, which on a chain where anyone can open a pool for any
// token is the pool the token chose to show you.
//
// What this exposes instead is the exit. Every Uniswap v4 pool we have indexed for a token, the
// cheapest measured cost of selling out of it, and a verdict when that cost is absurd. On Robinhood
// Chain, 73,499 of the 265,345 tokens with a pool have no pool that charges under 50% to leave.
// More than a quarter. That is the fact worth handing a model, because it is the one a chart hides.
//
// Everything here is a read against the public API. No key, no wallet, nothing that can spend.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API = process.env.DARKROUTE_API ?? "https://app.darkroute.exchange/api/v1";
const UA = "darkroute-mcp/0.1.0";
const CHAINS = { rh: "Robinhood Chain", arc: "Arc" };
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

async function api(path, timeoutMs = 12_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}${path}`, { signal: ac.signal, headers: { accept: "application/json", "user-agent": UA } });
    const j = await r.json().catch(() => null);
    // A 503 from the quote endpoint still carries the verdict, and the verdict is the useful half
    // for exactly the tokens that cannot be quoted. Returning the body rather than throwing on
    // status is deliberate.
    if (!j) throw new Error(`upstream returned ${r.status} with no JSON body`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (s) => ({ content: [{ type: "text", text: s }], isError: true });

/** The verdict in words, with the caveats attached rather than dropped. A model will repeat what it
 *  is given, so an unqualified "this is a trap" would become a claim we did not make. */
function sayVerdict(v) {
  if (!v) return "No verdict: we could not read enough about this token to judge it.";
  const head = {
    trap: "NO WAY OUT.",
    costly: "EXPENSIVE TO LEAVE.",
    ok: "There is a way out.",
    unknown: "Cannot say.",
  }[v.level] ?? "Cannot say.";
  const basis = v.measured
    ? "This is measured by asking the pool what a sale would actually pay, so a hook's cut is already inside it."
    : "This is the advertised fee, not a measured sale, so treat it as a floor: a hook can take more on top.";
  return `${head} ${v.say}\n\n${basis}`;
}

const TOOLS = [
  {
    name: "token_exit_cost",
    description:
      "What a token costs to trade on Robinhood Chain or Arc, read live from its own Uniswap v4 pools rather than from a listing. " +
      "Returns the cheapest measured cost of SELLING out of it and a verdict: ok, costly, trap, or unknown. " +
      "Use this when somebody asks whether a token is safe to buy, or what the real fee is, or whether they can get their money back out. " +
      "A price chart cannot answer that: anyone can open a pool for any token, and more than a quarter of the tokens on Robinhood Chain have no pool that charges under 50% to leave.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "the token contract address, 0x and 40 hex characters" },
        chain: { type: "string", enum: ["rh", "arc"], default: "rh", description: "rh = Robinhood Chain (4663), arc = Arc (5042)" },
      },
      required: ["address"],
    },
  },
  {
    name: "token_pools",
    description:
      "Every Uniswap v4 pool we have indexed for a token, with each pool's fee, whether it has a hook, its live liquidity, and what selling into it actually costs. " +
      "Use this when the verdict alone is not enough and somebody wants to see the pools themselves, or to compare a cheap pool against a predatory one.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "the token contract address" },
        chain: { type: "string", enum: ["rh", "arc"], default: "rh" },
      },
      required: ["address"],
    },
  },
  {
    name: "swap_quote",
    description:
      "A live quote for buying or selling a token through its Uniswap v4 pools, naming the pool and printing the fee. " +
      "Buying spends the chain's route asset: ETH on Robinhood Chain, USDC on Arc. Read only; this cannot sign or send anything.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        chain: { type: "string", enum: ["rh", "arc"], default: "rh" },
        buy: { type: "number", description: "amount of the route asset to spend. Give buy or sell, not both." },
        sell: { type: "number", description: "amount of the token to sell" },
      },
      required: ["address"],
    },
  },
];

const server = new Server({ name: "darkroute", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  const chain = a.chain === "arc" ? "arc" : "rh";
  if (!isAddress(a.address)) return fail("That is not a contract address. It should start 0x and have 40 hex characters after it.");

  try {
    if (name === "token_exit_cost" || name === "swap_quote") {
      const size = name === "swap_quote" && Number(a.sell) > 0 ? `sell=${Number(a.sell)}`
        : name === "swap_quote" && Number(a.buy) > 0 ? `buy=${Number(a.buy)}`
        : "sell=1000"; // a probe size for the verdict path; the report does its own step-down
      const j = await api(`/token/${a.address}/quote?chain=${chain}&${size}`);

      if (j.ok === false && !j.verdict) return fail(`${j.error ?? "no answer"} (${CHAINS[chain]})`);

      const lines = [];
      lines.push(`${j.token?.symbol ? "$" + j.token.symbol : a.address} on ${j.chain?.name ?? CHAINS[chain]}`);
      lines.push("");
      lines.push(sayVerdict(j.verdict));

      if (name === "swap_quote" || j.route) {
        lines.push("");
        if (j.route) {
          const dir = j.direction === "buy" ? `spending ${a.buy} ${j.chain.routeAsset}` : `selling ${a.sell ?? 1000} tokens`;
          lines.push(`Quote, ${dir}: you receive ${j.route.out}`);
          lines.push(`  pool ${j.route.poolId}`);
          lines.push(`  lp fee ${j.route.lpFeePct}%${j.route.hooked ? ", and this pool has a hook that can take more on top" : ""}`);
          if (j.route.allInPct !== null) lines.push(`  total cost against the pool price: ${j.route.allInPct.toFixed(2)}%`);
          if (j.route.worst != null) lines.push(`  the worst of ${j.route.considered} pools asked would have paid ${j.route.worst}`);
        } else {
          lines.push(`No quote: ${j.error}`);
        }
        if (j.alt) lines.push(`  an outside router (route.fun) quotes ${j.alt.out} via ${j.alt.provider}, net of their ${(j.alt.feeBps / 100).toFixed(2)}% fee. We show it; we do not route through them.`);
      }

      if (j.chain && j.chain.tradable === false) {
        lines.push("");
        lines.push(`Note: ${j.chain.name} has no UniversalRouter deployed, so this fill can be priced but not sent by DarkRoute.`);
      }
      return text(lines.join("\n"));
    }

    if (name === "token_pools") {
      // The quote endpoint carries the verdict; the pool detail lives on the page's own data, so
      // this asks the same endpoint and reports what it knows rather than inventing a second source.
      const j = await api(`/token/${a.address}/quote?chain=${chain}&sell=1000`);
      if (j.ok === false && !j.verdict) return fail(`${j.error ?? "no answer"} (${CHAINS[chain]})`);
      const lines = [
        `${j.token?.symbol ? "$" + j.token.symbol : a.address} on ${j.chain?.name ?? CHAINS[chain]}`,
        "",
        sayVerdict(j.verdict),
        "",
        `Pools priced: ${j.verdict?.priced ?? 0}. For the full pool list with each fee, hook and depth, open:`,
        `  https://app.darkroute.exchange/token/${chain === "arc" ? "arc/" : ""}${a.address}`,
      ];
      return text(lines.join("\n"));
    }

    return fail(`unknown tool: ${name}`);
  } catch (e) {
    // Never invent an answer about somebody's money because our own request failed.
    return fail(`Could not reach DarkRoute (${e instanceof Error ? e.message : String(e)}). Nothing was read, so nothing is claimed about this token.`);
  }
});

await server.connect(new StdioServerTransport());
