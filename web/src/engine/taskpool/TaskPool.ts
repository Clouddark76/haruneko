import { Delay } from '../BackgroundTimers';
import { DeferredTask, type Priority } from './DeferredTask';
export { Priority } from './DeferredTask';
import { RateLimit, Unlimited } from './RateLimit';

export class TaskPool {

    private running = false;
    private activeWorkersCount = 0;
    private delay = Promise.resolve();
    private queueTransactionLock = false;
    private readonly queue: DeferredTask<unknown>[] = [];

    /**
     * Create a new task pool.
     * @param Workers - The number of workers for processing tasks (maximum number of tasks processed at the same time). Default: 4
     * @param RateLimit - The maximum throughput for processing tasks. Default: infinite
     */
    constructor(workers: number | (() => number) = 4, public RateLimit = Unlimited) {
        this.workers = workers;
    }

    private workers: number | (() => number);

    /**
     * The maximum number of tasks processed at the same time.
     * Can be assigned with a fixed number, or with a function that is re-evaluated whenever a slot is requested (e.g., to follow a setting).
     */
    public get Workers(): number {
        const value = Math.floor(typeof this.workers === 'function' ? this.workers() : this.workers);
        return Number.isFinite(value) && value > 0 ? value : 4;
    }

    public set Workers(value: number | (() => number)) {
        this.workers = value;
    }

    /**
     * Add a new (awaitable) {@link action} to this task pool and start processing the task pool (if not already started).
     * @returns A promise that will be completed with the final result of the {@link action} after it was processed.
     */
    public Add<T>(action: () => Promise<T>, priority: Priority, signal?: AbortSignal): Promise<T> {
        const task = new DeferredTask<T>(action, priority, signal);
        this.AddTask(task);
        return task.Promise;
    }

    private async AddTask<T>(task: DeferredTask<T>) {
        await this.InvokeQueueTransaction(queue => queue.push(task));
        this.Process();
    }

    /**
     * Perform a thread/concurrency safe operation on {@link queue}
     */
    private async InvokeQueueTransaction<R>(transaction: (queue: DeferredTask<unknown>[]) => R): Promise<R> {
        try {
            while(this.queueTransactionLock) await Delay(5);
            this.queueTransactionLock = true;
            return transaction(this.queue);
        } finally {
            this.queueTransactionLock = false;
        }
    }

    /**
     * Find and return the next task with highest priority in the {@link queue} and removes it.
     * @returns The found task, or `undefined` in case the {@link queue} is empty or an internal error occured.
     */
    private async TakeNextTask(): Promise<DeferredTask<unknown>> {
        return await this.InvokeQueueTransaction(queue => {
            try {
                let index = 0;
                for(let i = 0; i < queue.length; i++) {
                    if(queue[index].Priority < queue[i].Priority) {
                        index = i;
                    }
                }
                // NOTE: Will return undefined in case the queue is empty
                return queue.splice(index, 1)[0];
            } catch {
                return undefined;
            }
        });
    }

    private async Throttle() {
        if(RateLimit.Bypassed) {
            // NOTE: Also discard a delay that is still pending from before the bypass was enabled
            this.delay = Promise.resolve();
            return;
        }
        await this.delay;
        this.delay = Delay(this.RateLimit.Throttle);
    }

    private async ConcurrencySlotAvailable() {
        while(this.activeWorkersCount >= this.Workers) {
            await Delay(50);
        }
    }

    private async Process() {
        if(this.running) {
            return;
        }
        this.running = true;
        try {
            let task: DeferredTask<unknown>;
            while((task = await this.TakeNextTask()) !== undefined) {
                if(task.RejectWhenAborted()) {
                    continue;
                }
                await this.Throttle();
                if(task.RejectWhenAborted()) {
                    continue;
                }
                await this.ConcurrencySlotAvailable();
                if(task.RejectWhenAborted()) {
                    continue;
                }
                this.Run(task);
            }
        } finally {
            this.running = false;
        }
    }

    private async Run(task: DeferredTask<unknown>) {
        try {
            this.activeWorkersCount++;
            await task.Run();
        } finally {
            this.activeWorkersCount--;
        }
    }
}
