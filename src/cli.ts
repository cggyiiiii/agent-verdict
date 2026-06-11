#!/usr/bin/env node
import { exec } from 'node:child_process';
import { Collector } from './collector.js';
import { runDemo } from './demo.js';
import { tailFile } from './tail.js';
import { DEFAULT_PORT } from './types.js';

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) ?? 'start';
const portFlag = args.indexOf('--port');
const port = portFlag !== -1 ? Number(args[portFlag + 1]) : DEFAULT_PORT;
const noOpen = args.includes('--no-open');

function openBrowser(url: string) {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start ""'
    : 'xdg-open';
  exec(`${opener} ${url}`, () => { /* best effort */ });
}

async function main() {
  if (cmd === 'tail') {
    const file = args.filter((a) => !a.startsWith('-'))[1];
    if (!file) {
      console.error('usage: verdict tail <logfile> [--map map.json] [--from-start] [--port N]');
      process.exit(1);
    }
    const mapIdx = args.indexOf('--map');
    const stop = tailFile(file, {
      url: `http://127.0.0.1:${port}`,
      mapFile: mapIdx !== -1 ? args[mapIdx + 1] : undefined,
      fromStart: args.includes('--from-start'),
      onEvent: (e) => console.log(`  ${e.decision.padEnd(5)} ${e.target}${e.reason ? ` — ${e.reason.code}` : ''}`),
    });
    console.log(`tailing ${file} → http://127.0.0.1:${port}  (ctrl-c to stop)`);
    process.on('SIGINT', () => { stop(); process.exit(0); });
    return;
  }

  if (cmd !== 'start' && cmd !== 'demo') {
    console.log(`verdict — DevTools for agent authorization

Usage:
  verdict start [--port ${DEFAULT_PORT}] [--no-open]    start the collector + dashboard
  verdict demo  [--port ${DEFAULT_PORT}] [--no-open]    start it and replay a sample agent session
  verdict tail <logfile> [--map map.json] [--from-start]
                                          follow a gateway/agent JSONL log and
                                          convert lines into decision events

Then wrap your MCP client:

  import { observe } from 'agent-verdict';
  const client = observe(mcpClient, { agent: 'my-agent' });
`);
    process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
  }

  const collector = new Collector({ port });
  try {
    await collector.listen();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      if (cmd === 'demo') {
        // a collector is already running — just feed it the demo
        console.log(`collector already running on :${port}, sending demo session…`);
        await runDemo(`http://127.0.0.1:${port}`);
        console.log('demo session sent.');
        return;
      }
      console.error(`port ${port} is already in use (another verdict running?). Try --port ${port + 1}`);
      process.exit(1);
    }
    throw err;
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(`
  ⚖  Verdict is watching.

  dashboard  ${url}
  ingest     POST ${url}/api/events
  `);
  if (!noOpen) openBrowser(url);

  if (cmd === 'demo') {
    console.log('replaying demo agent session…');
    await runDemo(url);
    console.log('demo session sent — watch the timeline.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
