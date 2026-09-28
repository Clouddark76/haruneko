import { DownloadTask, Status } from './DownloadTask';
import { ObservableArray, type IObservable } from './Observable';
import type { StoreableMediaContainer, MediaItem } from './providers/MediaPlugin';
import type { StorageController } from './StorageController';
import { Delay, SetTimeout } from './BackgroundTimers';

export class DownloadManager {

    private processing = false;
    private queue = new ObservableArray<DownloadTask, DownloadManager>([], this);
    private queueTransactionLock = false;

    /**
     * The number of chapters/episodes that are processed at the same time when no other limit is provided.
     */
    public static readonly DefaultConcurrency = 6;

    private readonly running = new Set<DownloadTask>();

    /**
     * @param storageController - The storage used by the download tasks for temporary resources
     * @param concurrency - A function that provides the maximum number of tasks which may run at the same time.
     *                      It is evaluated repeatedly, so changes (e.g. from the settings) apply to any not yet started task.
     */
    constructor(private readonly storageController: StorageController, private readonly concurrency: () => number = () => DownloadManager.DefaultConcurrency) {}

    /**
     * The (sanitized) maximum number of tasks that may run at the same time, always at least 1.
     */
    private get MaxConcurrency(): number {
        try {
            const value = Math.floor(this.concurrency());
            return Number.isFinite(value) && value > 0 ? value : DownloadManager.DefaultConcurrency;
        } catch {
            return DownloadManager.DefaultConcurrency;
        }
    }

    public get Queue(): IObservable<DownloadTask[], DownloadManager> {
        return this.queue;
    }

    /**
     * Perform an (almost) thread/concurrency safe operation on {@link queue}
     */
    private async InvokeQueueTransaction<R>(transaction: () => R): Promise<R> {
        try {
            while(this.queueTransactionLock) await Delay(5);
            this.queueTransactionLock = true;
            return transaction();
        } finally {
            this.queueTransactionLock = false;
        }
    }

    /**
     * Add the given {@link containers} to the download queue.
     * Only containers that are not present in the download queue will be added.
     */
    public async Enqueue(...containers: StoreableMediaContainer<MediaItem>[]): Promise<void> {
        await this.InvokeQueueTransaction(() => {
            const tasks = containers.distinct()
                .filter(container => this.queue.Value.none(task => task.Media.IsSameAs(container)))
                .map(container => new DownloadTask(container, this.storageController));
            this.queue.Push(...tasks);
        });
        this.Process();
    }

    /**
     * Remove the given {@link tasks} from the download queue.
     * Only tasks that are present in the download queue will be removed.
     */
    public async Dequeue(...tasks: DownloadTask[]): Promise<void> {
        await this.InvokeQueueTransaction(() => {
            this.queue.Value = this.queue.Value.filter(task => {
                if(tasks.includes(task)) {
                    task.Abort();
                    return false;
                } else {
                    return true;
                }
            });
        });
    }

    private async Process() {
        if(this.processing) {
            return;
        }
        this.processing = true;

        while(this) {
            try {
                if(this.running.size >= this.MaxConcurrency) {
                    await new Promise<void>(resolve => SetTimeout(resolve, 250));
                    continue;
                }
                const task = await this.InvokeQueueTransaction(() => this.queue.Value.find(task => task.Status.Value === Status.Queued && !this.running.has(task)));
                if(task) {
                    this.Launch(task);
                } else {
                    await new Promise<void>(resolve => SetTimeout(resolve, 750));
                }
            } catch { /* IGNORE */ }
        }

        this.processing = false;
    }

    /**
     * Start the given {@link task} without waiting for it, so the next one can be started immediately (up to the concurrency limit).
     */
    private Launch(task: DownloadTask) {
        this.running.add(task);
        task.Run()
            .catch(() => { /* IGNORE: errors are tracked by the task itself */ })
            .finally(() => this.running.delete(task));
    }
}
