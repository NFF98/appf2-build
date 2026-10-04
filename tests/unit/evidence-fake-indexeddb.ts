import type {
  EvidenceIdbDatabase,
  EvidenceIdbFactory,
  EvidenceIdbObjectStore,
  EvidenceIdbOpenRequest,
  EvidenceIdbRequest,
  EvidenceIdbTransaction
} from "../../src/platform/evidence/evidence-queue-store.js";

// In-process IndexedDB model of the transaction rules the evidence queue relies on: every
// connection to a database name shares one record set; readwrite transactions with overlapping
// scope never run concurrently (FIFO across all connections); a transaction is only active while
// it is being created or one of its request callbacks runs; it auto-commits once no request is
// pending and rolls back on abort. Requests resolve on later microtasks, so work split across
// separate transactions really does interleave between connections.

type Handler = (() => void) | null;
type TransactionMode = "readonly" | "readwrite";

interface FakeObjectStoreState {
  readonly keyPath: string;
  records: Map<string, unknown>;
}

class FakeRequest<T> implements EvidenceIdbRequest<T> {
  public result!: T;
  public error: DOMException | null = null;
  public onsuccess: Handler = null;
  public onerror: Handler = null;
}

class FakeOpenRequest extends FakeRequest<FakeConnection> implements EvidenceIdbOpenRequest {
  public onupgradeneeded: Handler = null;
  public onblocked: Handler = null;
}

interface PendingOperation {
  readonly write: boolean;
  readonly request: FakeRequest<unknown>;
  readonly run: () => unknown;
}

function keyOf(value: unknown, keyPath: string): string {
  const key: unknown = typeof value === "object" && value !== null
    ? Reflect.get(value, keyPath)
    : undefined;
  if (typeof key !== "string") {
    throw new DOMException("Fake store only supports string keys.", "DataError");
  }
  return key;
}

class FakeObjectStore implements EvidenceIdbObjectStore {
  public constructor(
    private readonly transaction: FakeTransaction,
    private readonly state: FakeObjectStoreState
  ) {}

  public getAll(): FakeRequest<unknown[]> {
    return this.transaction.enqueue(false, () =>
      Array.from(this.state.records.values(), value => structuredClone(value))
    );
  }

  public put(value: unknown): FakeRequest<unknown> {
    return this.transaction.enqueue(true, () => {
      const key = keyOf(value, this.state.keyPath);
      this.state.records.set(key, structuredClone(value));
      return key;
    });
  }

  public delete(key: string): FakeRequest<unknown> {
    return this.transaction.enqueue(true, () => {
      this.state.records.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction implements EvidenceIdbTransaction {
  public error: DOMException | null = null;
  public oncomplete: Handler = null;
  public onabort: Handler = null;
  private readonly operations: PendingOperation[] = [];
  private active = true;
  private state: "waiting" | "running" | "finished" = "waiting";
  private rollback: Map<FakeObjectStoreState, Map<string, unknown>> | null = null;

  public constructor(
    private readonly database: FakeDatabaseState,
    public readonly scope: readonly string[],
    public readonly mode: TransactionMode
  ) {
    queueMicrotask(() => {
      this.active = false;
    });
  }

  public objectStore(name: string): FakeObjectStore {
    const store = this.database.stores.get(name);
    if (store === undefined || !this.scope.includes(name)) {
      throw new DOMException(`Object store ${name} is not in scope.`, "NotFoundError");
    }
    return new FakeObjectStore(this, store);
  }

  public enqueue<T>(write: boolean, run: () => T): FakeRequest<T> {
    if (!this.active || this.state === "finished") {
      throw new DOMException("Transaction is not active.", "TransactionInactiveError");
    }
    if (write && this.mode === "readonly") {
      throw new DOMException("Transaction is read-only.", "ReadOnlyError");
    }
    const request = new FakeRequest<T>();
    this.operations.push({ write, request, run });
    return request;
  }

  public start(): void {
    this.state = "running";
    if (this.mode === "readwrite") {
      this.rollback = new Map(this.scope.map(name => {
        const store = this.database.stores.get(name);
        if (store === undefined) {
          throw new DOMException(`Object store ${name} is missing.`, "NotFoundError");
        }
        return [store, new Map(store.records)];
      }));
    }
    queueMicrotask(() => this.step());
  }

  private step(): void {
    if (this.state !== "running") {
      return;
    }
    const operation = this.operations.shift();
    if (operation === undefined) {
      this.commit();
      return;
    }
    try {
      if (operation.write ? this.database.factory.failWrites : this.database.factory.failReads) {
        throw new DOMException("Injected storage failure.", "QuotaExceededError");
      }
      operation.request.result = operation.run();
    } catch (error) {
      operation.request.error = error instanceof DOMException ? error : new DOMException(String(error), "UnknownError");
      this.runCallback(operation.request.onerror);
      this.abortWith(operation.request.error);
      return;
    }
    if (this.runCallback(operation.request.onsuccess)) {
      queueMicrotask(() => this.step());
    }
  }

  private runCallback(handler: Handler): boolean {
    this.active = true;
    try {
      handler?.();
      return true;
    } catch (error) {
      this.abortWith(error instanceof DOMException ? error : new DOMException(String(error), "AbortError"));
      return false;
    } finally {
      this.active = false;
    }
  }

  private commit(): void {
    this.state = "finished";
    this.database.committed(this);
    this.oncomplete?.();
    this.database.release(this);
  }

  private abortWith(error: DOMException): void {
    if (this.state === "finished") {
      return;
    }
    this.rollback?.forEach((records, store) => {
      store.records = records;
    });
    this.state = "finished";
    this.error = error;
    this.onabort?.();
    this.database.release(this);
  }
}

function conflicts(left: FakeTransaction, right: FakeTransaction): boolean {
  return (left.mode === "readwrite" || right.mode === "readwrite") &&
    left.scope.some(name => right.scope.includes(name));
}

class FakeDatabaseState {
  public version = 0;
  public readonly stores = new Map<string, FakeObjectStoreState>();
  public peakOpenTransactions = 0;
  private readonly waiting: FakeTransaction[] = [];
  private readonly running = new Set<FakeTransaction>();

  public constructor(public readonly factory: FakeIndexedDbFactory) {}

  public schedule(transaction: FakeTransaction): void {
    this.waiting.push(transaction);
    this.peakOpenTransactions = Math.max(this.peakOpenTransactions, this.waiting.length + this.running.size);
    queueMicrotask(() => this.pump());
  }

  public committed(transaction: FakeTransaction): void {
    if (transaction.mode === "readwrite") {
      this.factory.commitListeners.forEach(listener => listener(this));
    }
  }

  public release(transaction: FakeTransaction): void {
    this.running.delete(transaction);
    this.pump();
  }

  public records(storeName: string): Map<string, unknown> {
    const store = this.stores.get(storeName);
    if (store === undefined) {
      throw new Error(`Fake object store ${storeName} does not exist.`);
    }
    return store.records;
  }

  private pump(): void {
    const blocked: FakeTransaction[] = [];
    for (const transaction of [...this.waiting]) {
      if ([...this.running, ...blocked].some(other => conflicts(transaction, other))) {
        blocked.push(transaction);
        continue;
      }
      this.waiting.splice(this.waiting.indexOf(transaction), 1);
      this.running.add(transaction);
      transaction.start();
    }
  }
}

class FakeConnection implements EvidenceIdbDatabase {
  public onversionchange: Handler = null;
  public upgrading = false;
  private closed = false;

  public constructor(private readonly database: FakeDatabaseState) {}

  public get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: name => this.database.stores.has(name) };
  }

  public createObjectStore(name: string, options: { keyPath: string }): void {
    if (!this.upgrading) {
      throw new DOMException("createObjectStore outside an upgrade.", "InvalidStateError");
    }
    this.database.stores.set(name, { keyPath: options.keyPath, records: new Map() });
  }

  public transaction(storeNames: string | string[], mode: TransactionMode): FakeTransaction {
    if (this.closed) {
      throw new DOMException("Connection is closed.", "InvalidStateError");
    }
    const scope = typeof storeNames === "string" ? [storeNames] : [...storeNames];
    const transaction = new FakeTransaction(this.database, scope, mode);
    this.database.schedule(transaction);
    return transaction;
  }

  public close(): void {
    this.closed = true;
  }
}

export type FakeCommitListener = (database: FakeDatabaseState) => void;

export class FakeIndexedDbFactory implements EvidenceIdbFactory {
  public failWrites = false;
  public failReads = false;
  public failOpen = false;
  public readonly commitListeners: FakeCommitListener[] = [];
  private readonly databases = new Map<string, FakeDatabaseState>();

  public open(name: string, version: number): FakeOpenRequest {
    const request = new FakeOpenRequest();
    queueMicrotask(() => {
      if (this.failOpen) {
        request.error = new DOMException("Injected open failure.", "UnknownError");
        request.onerror?.();
        return;
      }
      const database = this.database(name);
      if (version < database.version) {
        request.error = new DOMException("Requested version is older.", "VersionError");
        request.onerror?.();
        return;
      }
      const connection = new FakeConnection(database);
      request.result = connection;
      if (version > database.version) {
        connection.upgrading = true;
        request.onupgradeneeded?.();
        connection.upgrading = false;
        database.version = version;
      }
      request.onsuccess?.();
    });
    return request;
  }

  public database(name: string): FakeDatabaseState {
    let database = this.databases.get(name);
    if (database === undefined) {
      database = new FakeDatabaseState(this);
      this.databases.set(name, database);
    }
    return database;
  }
}
