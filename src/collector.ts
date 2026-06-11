import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { DecisionEvent } from './types.js';
import { DEFAULT_PORT } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/collector.js → package root → dashboard/
const DASHBOARD_DIR = join(__dirname, '..', 'dashboard');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface CollectorOptions {
  port?: number;
  /** persist events as JSONL under ~/.verdict (default true) */
  persist?: boolean;
  /** max events kept in memory */
  maxEvents?: number;
}

export class Collector {
  private events: DecisionEvent[] = [];
  private sseClients = new Set<ServerResponse>();
  private server: Server | null = null;
  private opts: Required<CollectorOptions>;
  private logFile: string;

  constructor(opts: CollectorOptions = {}) {
    this.opts = {
      port: opts.port ?? DEFAULT_PORT,
      persist: opts.persist ?? true,
      maxEvents: opts.maxEvents ?? 10_000,
    };
    const dir = join(homedir(), '.verdict');
    this.logFile = join(dir, 'events.jsonl');
    if (this.opts.persist) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.loadPersisted();
    }
  }

  private loadPersisted() {
    if (!existsSync(this.logFile)) return;
    try {
      const lines = readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
      const tail = lines.slice(-this.opts.maxEvents);
      this.events = tail
        .map((l) => { try { return JSON.parse(l) as DecisionEvent; } catch { return null; } })
        .filter((e): e is DecisionEvent => e !== null);
    } catch {
      // corrupt log is not fatal
    }
  }

  ingest(batch: DecisionEvent[]) {
    for (const e of batch) {
      if (!e || typeof e !== 'object' || !e.id || !e.decision || !e.target) continue;
      this.events.push(e);
      if (this.opts.persist) {
        try { appendFileSync(this.logFile, JSON.stringify(e) + '\n'); } catch { /* disk issues are not fatal */ }
      }
      const payload = `data: ${JSON.stringify(e)}\n\n`;
      for (const client of this.sseClients) client.write(payload);
    }
    if (this.events.length > this.opts.maxEvents) {
      this.events.splice(0, this.events.length - this.opts.maxEvents);
    }
  }

  listen(): Promise<number> {
    this.server = createServer((req, res) => this.route(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.opts.port, '127.0.0.1', () => resolve(this.opts.port));
    });
  }

  close() {
    for (const c of this.sseClients) c.end();
    this.sseClients.clear();
    this.server?.close();
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.opts.port}`);
    res.setHeader('access-control-allow-origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/events') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { events?: DecisionEvent[] } | DecisionEvent;
        const batch = Array.isArray((parsed as { events?: DecisionEvent[] }).events)
          ? (parsed as { events: DecisionEvent[] }).events
          : [parsed as DecisionEvent];
        this.ingest(batch);
        res.writeHead(202, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, accepted: batch.length }));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const session = url.searchParams.get('session');
      const list = session ? this.events.filter((e) => e.sessionId === session) : this.events;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ events: list }));
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const sessions = new Map<string, { id: string; count: number; denies: number; first: number; last: number }>();
      for (const e of this.events) {
        const s = sessions.get(e.sessionId) ?? { id: e.sessionId, count: 0, denies: 0, first: e.ts, last: e.ts };
        s.count++;
        if (e.decision !== 'allow') s.denies++;
        s.first = Math.min(s.first, e.ts);
        s.last = Math.max(s.last, e.ts);
        sessions.set(e.sessionId, s);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ sessions: [...sessions.values()].sort((a, b) => b.last - a.last) }));
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }

    // static dashboard
    if (req.method === 'GET') {
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = join(DASHBOARD_DIR, path.replace(/\.\./g, ''));
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        return createReadStream(file).pipe(res);
      }
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
