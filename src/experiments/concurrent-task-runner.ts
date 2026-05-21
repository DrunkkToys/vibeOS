/**
 * @experiment 20260521T120000Z-systems-concurrent-task-runner
 */

type Task<T> = () => Promise<T>;

interface RunnerStatus {
  running: number;
  pending: number;
  completed: number;
  failed: number;
}

class TaskRunner<T> {
  private tasks: Task<T>[];
  private concurrency: number;
  private results: T[];
  private running = 0;
  private completed = 0;
  private failed = 0;
  private nextIdx = 0;
  private firstError: unknown = null;
  private _cancelled = false;
  private _started = false;
  private _finishPromise!: Promise<T[]>;
  private _resolve!: (value: T[]) => void;
  private _reject!: (err: unknown) => void;
  private controller = new AbortController();

  constructor(tasks: Task<T>[], concurrency: number, signal?: AbortSignal) {
    this.tasks = tasks;
    this.concurrency = Math.max(1, concurrency);
    this.results = new Array(tasks.length);

    if (signal) {
      if (signal.aborted) this._cancelled = true;
      signal.addEventListener('abort', () => this.cancel(), { once: true });
    }

    this._finishPromise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  status(): RunnerStatus {
    return {
      running: this.running,
      pending: Math.max(0, this.tasks.length - this.completed - this.failed - this.running),
      completed: this.completed,
      failed: this.failed,
    };
  }

  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this.controller.abort();
  }

  run(): Promise<T[]> {
    if (this._started) throw new Error('TaskRunner already started');
    this._started = true;

    if (this.tasks.length === 0) return Promise.resolve([]);
    if (this._cancelled) return Promise.reject(new Error('Cancelled'));

    const slots = Math.min(this.concurrency, this.tasks.length);
    for (let i = 0; i < slots; i++) this._schedule();

    return this._finishPromise;
  }

  private _schedule(): void {
    if (this._cancelled) return;
    const idx = this.nextIdx++;
    if (idx >= this.tasks.length) return;

    this.running++;

    this.tasks[idx]()
      .then((value) => {
        if (!this._cancelled) {
          this.results[idx] = value;
          this.completed++;
        }
        this.running--;
        if (!this._cancelled) this._schedule();
        this._checkDone();
      })
      .catch((err) => {
        if (!this._cancelled) {
          if (this.firstError === null) this.firstError = err;
          this.cancel();
        }
        this.running--;
        this.failed++;
        this._checkDone();
      });
  }

  private _checkDone(): void {
    if (this.running > 0) return;
    if (this._cancelled) {
      if (this.firstError !== null) {
        this._reject(this.firstError);
      } else {
        this._reject(new Error('Cancelled'));
      }
      return;
    }
    const total = this.completed + this.failed;
    if (total < this.tasks.length) return;
    this._resolve(this.results);
  }
}

export { TaskRunner };
export type { Task, RunnerStatus };

// ----- tests (run: npx tsx src/experiments/concurrent-task-runner.ts) -----

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn();
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

await test('empty task array', async () => {
  const runner = new TaskRunner<number>([], 3);
  const results = await runner.run();
  return results.length === 0;
});

await test('single task succeeds', async () => {
  const runner = new TaskRunner<string>([() => Promise.resolve('done')], 2);
  const results = await runner.run();
  return results.length === 1 && results[0] === 'done';
});

await test('results in order', async () => {
  const runner = new TaskRunner<number>(
    [
      () => delay(30).then(() => 0),
      () => delay(10).then(() => 1),
      () => delay(20).then(() => 2),
    ],
    3,
  );
  const results = await runner.run();
  return results[0] === 0 && results[1] === 1 && results[2] === 2;
});

await test('semaphore — runs at most N concurrently', async () => {
  let maxConcurrent = 0;
  let current = 0;
  const tasks = Array.from({ length: 6 }, (_, i) => () => {
    current++;
    if (current > maxConcurrent) maxConcurrent = current;
    return delay(10).then(() => { current--; return i; });
  });
  const runner = new TaskRunner<number>(tasks, 2);
  await runner.run();
  return maxConcurrent === 2;
});

await test('concurrency greater than task count', async () => {
  const runner = new TaskRunner<number>(
    [() => Promise.resolve(10), () => Promise.resolve(20)],
    5,
  );
  const results = await runner.run();
  return results[0] === 10 && results[1] === 20;
});

await test('concurrency = 1 runs sequentially', async () => {
  const order: number[] = [];
  const runner = new TaskRunner<number>(
    [
      () => delay(20).then(() => { order.push(0); return 0; }),
      () => delay(10).then(() => { order.push(1); return 1; }),
      () => delay(5).then(() => { order.push(2); return 2; }),
    ],
    1,
  );
  await runner.run();
  return order[0] === 0 && order[1] === 1 && order[2] === 2;
});

await test('task failure cancels remaining', async () => {
  const started: number[] = [];
  const runner = new TaskRunner<number>(
    [
      () => { started.push(0); return delay(200).then(() => 0); },
      () => { started.push(1); return Promise.reject(new Error('boom')); },
      () => { started.push(2); return Promise.resolve(2); },
    ],
    2,
  );
  try {
    await runner.run();
    return false;
  } catch (e) {
    return (e as Error).message === 'boom' && !started.includes(2);
  }
});

await test('task failure error is the first error', async () => {
  const runner = new TaskRunner<number>(
    [
      () => Promise.reject(new Error('first')),
      () => Promise.reject(new Error('second')),
    ],
    2,
  );
  try {
    await runner.run();
    return false;
  } catch (e) {
    return (e as Error).message === 'first';
  }
});

await test('cancel() before run rejects', async () => {
  const runner = new TaskRunner<number>([() => Promise.resolve(1)], 1);
  runner.cancel();
  try {
    await runner.run();
    return false;
  } catch {
    return true;
  }
});

await test('cancel() during execution', async () => {
  const runner = new TaskRunner<number>(
    [
      () => delay(500).then(() => 0),
      () => delay(500).then(() => 1),
    ],
    2,
  );
  const p = runner.run();
  await delay(10);
  runner.cancel();
  try {
    await p;
    return false;
  } catch {
    return true;
  }
});

await test('external AbortSignal cancels', async () => {
  const controller = new AbortController();
  const runner = new TaskRunner<number>(
    [
      () => delay(500).then(() => 0),
      () => delay(500).then(() => 1),
    ],
    2,
    controller.signal,
  );
  const p = runner.run();
  await delay(10);
  controller.abort();
  try {
    await p;
    return false;
  } catch {
    return true;
  }
});

await test('external AbortSignal already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = new TaskRunner<number>([() => Promise.resolve(1)], 1, controller.signal);
  try {
    await runner.run();
    return false;
  } catch {
    return true;
  }
});

await test('status() during execution', async () => {
  let snapshot: RunnerStatus | null = null;
  const runner = new TaskRunner<number>(
    [
      () => delay(15).then(() => { snapshot = runner.status(); return 1; }),
      () => delay(5).then(() => 2),
      () => delay(5).then(() => 3),
      () => delay(5).then(() => 4),
    ],
    2,
  );
  await runner.run();
  return snapshot !== null && snapshot.running >= 1 && snapshot.pending >= 0;
});

await test('status() after all tasks complete', async () => {
  const runner = new TaskRunner<number>(
    [() => Promise.resolve(1), () => Promise.resolve(2)],
    2,
  );
  await runner.run();
  const s = runner.status();
  return s.running === 0 && s.pending === 0 && s.completed === 2 && s.failed === 0;
});

await test('run() called twice throws', async () => {
  const runner = new TaskRunner<number>([() => Promise.resolve(1)], 1);
  runner.run();
  try {
    await runner.run();
    return false;
  } catch (e) {
    return (e as Error).message === 'TaskRunner already started';
  }
});

await test('TaskRunner<string> with strings', async () => {
  const runner = new TaskRunner<string>(
    [() => Promise.resolve('a'), () => Promise.resolve('b'), () => Promise.resolve('c')],
    2,
  );
  const results = await runner.run();
  return results[0] === 'a' && results[1] === 'b' && results[2] === 'c';
});
