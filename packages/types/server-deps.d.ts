/**
 * Offline ambient declarations for the Express server + persistence layer
 * (used by @trace/server). Stubbed so the monorepo type-checks without
 * node_modules; real build installs express/pg/bullmq/ioredis.
 */
declare module "express" {
  export interface Request { body: any; params: Record<string, string>; query: Record<string, unknown> }
  export interface Response { status(code: number): Response; json(body: unknown): Response; }
  type Handler = (req: Request, res: Response) => unknown;
  export interface Express {
    use(...mw: unknown[]): void;
    get(path: string, ...handlers: Handler[]): void;
    post(path: string, ...handlers: Handler[]): void;
    listen(port: number, cb?: () => void): unknown;
    [key: string]: unknown;
  }
  // Mirror of the real default export: a callable that returns an app, with the
  // middleware factories (e.g. express.json) attached as properties.
  interface ExpressFactory {
    (): Express;
    json(opts?: unknown): unknown;
  }
  const express: ExpressFactory;
  export default express;
}
declare module "pg" {
  // Mirrors real pg: query is generic over the row type (defaults to any), so
  // callers like `pool.query<{ id: string }>(...)` narrow .rows without casts.
  export interface QueryResult<T = any> { rows: T[]; rowCount: number }
  export class Pool {
    constructor(cfg?: Record<string, unknown>);
    query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
  export class PoolClient {
    query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }
}
declare module "bullmq" {
  export class Queue {
    constructor(name: string, opts?: Record<string, unknown>);
    add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  }
  export class Worker<T = unknown> {
    constructor(name: string, handler: (job: WorkerJob<T>) => unknown, opts?: Record<string, unknown>);
    on(event: string, cb: (job: WorkerJob<T>, err: Error) => unknown): void;
  }
  export class QueueEvents {
    constructor(name: string, opts?: Record<string, unknown>);
  }
  interface WorkerJob<T> { data: T; id?: string; }
}
declare module "ioredis" {
  export class Redis {
    constructor(url?: string);
    quit(): Promise<void>;
  }
}
declare var process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  argv: string[];
  pid: number;
};
