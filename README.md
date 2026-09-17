# DarkRoute MCP

Ask what a token costs to **get out of**, from any MCP client.

No key. No wallet. Nothing here can sign or spend.

> Not on npm yet. Clone this repo and point your client at it, as below. When
> `darkroute-mcp` is published the `npx` one-liner will appear here and not before,
> because an install command that does not work is worse than none.

## Why this exists

Somebody pastes a contract address and asks whether it is safe to buy. A price feed cannot answer
that. It quotes the pool the token's own site links to, and on a chain where anyone can open a pool
for any token, that is the pool the token chose to show you.

So this answers the other question. Every Uniswap v4 pool we have indexed for that token, the
cheapest **measured** cost of selling out of it, and a plain verdict when that cost is absurd.

Measured matters. A pool can advertise a 0% fee and sit behind a hook that takes 90%, and the fee
column cannot see that. These numbers come from asking the quoter what a sale would actually pay,
so a hook's cut is already inside them.

On Robinhood Chain, **73,499 of the 265,345 tokens with a pool have no pool that charges under 50%
to leave** (measured 17 September 2026). More than a quarter. That is the fact a chart hides.

## Tools

| Tool | What it answers |
|---|---|
| `token_exit_cost` | The cheapest measured cost of selling out, and a verdict: `ok`, `costly`, `trap`, `unknown` |
| `token_pools` | The pools behind that verdict, and where to see them all |
| `swap_quote` | A live buy or sell quote, naming the pool and printing the fee |

Chains: `rh` (Robinhood Chain, 4663) and `arc` (Arc, 5042).

## Install

```bash
git clone https://github.com/darkrouteRH/mcp darkroute-mcp
cd darkroute-mcp && npm install
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "darkroute": { "command": "node", "args": ["/absolute/path/to/darkroute-mcp/src/index.js"] }
  }
}
```

Claude Code:

```bash
claude mcp add darkroute -- node /absolute/path/to/darkroute-mcp/src/index.js
```

Check it works before wiring it in:

```bash
node test/smoke.mjs
```

Point it somewhere else with `DARKROUTE_API`, which defaults to
`https://app.darkroute.exchange/api/v1`.

## What it will not do

**It will not call a token a trap on a partial index.** We are still walking backwards through Arc,
and "every pool charges 90%" would really mean "every pool we have read so far". In that case the
verdict is `unknown` and says which. A token is not a trap for being old.

**It judges the cheapest pool, never the worst.** One predatory pool beside one honest pool is an
ordinary token on these chains. The question is whether a way out exists at all.

**It will not invent an answer when our own request fails.** A timeout returns an error saying
nothing was read, rather than a reassuring number. The failure mode of a tool a model quotes from
has to be silence.

**It cannot trade.** Read-only, and on Arc we say so twice: Arc has no UniversalRouter deployed, so
a fill there can be priced and not sent.

## Where the numbers come from

The public API at `app.darkroute.exchange/api/v1`, documented at
[darkrouteRH/api](https://github.com/darkrouteRH/api). Uniswap v4 publishes no registry of pools, so
we index every `Initialize` event on both chains and read the pools ourselves. The same numbers are
on the web pages, at `app.darkroute.exchange/token/<address>`.

MIT.
