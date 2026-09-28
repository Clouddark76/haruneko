import { vi, describe, it, expect } from 'vitest';
import { DownloadManager } from './DownloadManager';
import { type MediaContainer, StoreableMediaContainer, type MediaChild, type MediaItem } from './providers/MediaPlugin';
import type { SettingsManager } from './SettingsManager';
import type { StorageController } from './StorageController';

function MockContainer(identifier: string, parent: MediaContainer<MediaChild> = undefined) {
    const mockMediaContainer = {};
    Object.defineProperty(mockMediaContainer, 'Parent', { get: () => parent });
    Object.defineProperty(mockMediaContainer, 'Identifier', { get: () => identifier });
    Object.defineProperty(mockMediaContainer, 'IsSameAs', { value: vi.fn(StoreableMediaContainer.prototype.IsSameAs.bind(mockMediaContainer)) });
    return mockMediaContainer as StoreableMediaContainer<MediaItem>;
}

class TestFixture {

    public readonly StorageControllerMock = {} as StorageController;
    public readonly SettingsManagerMock = {} as SettingsManager;

    public CreateTestee(concurrency?: () => number) {
        return new DownloadManager(this.StorageControllerMock, concurrency);
    }
}

/**
 * Create a container that stays in the 'downloading' state until it is released, and records how many were active at the same time.
 */
function MockBlockingContainer(identifier: string, probe: { active: number, peak: number }) {
    let release: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const container = MockContainer(identifier) as unknown as Record<string, unknown>;
    Object.defineProperty(container, 'Entries', { get: () => ({ Value: [] }) });
    Object.defineProperty(container, 'Update', {
        value: async () => {
            probe.active++;
            probe.peak = Math.max(probe.peak, probe.active);
            await gate;
            probe.active--;
            // NOTE: Empty media entries make the task fail right after, which is irrelevant for measuring concurrency
        }
    });
    return { container: container as unknown as StoreableMediaContainer<MediaItem>, release };
}

describe('DownloadManager', () => {

    describe('Constructor', () => {

        it('Should correctly initialize', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            expect(testee).toBeInstanceOf(DownloadManager);
        });
    });

    describe('GetTasks', () => {

        it('Should be empty by default', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const tasks = testee.Queue.Value;

            expect(tasks.length).toBe(0);
        });

        it('Should get all enqueued tasks', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            await testee.Enqueue(MockContainer('①'), MockContainer('②'));
            await testee.Enqueue(MockContainer('③'));
            const tasks = testee.Queue.Value;

            expect(tasks.length).toBe(3);
        });
    });

    describe('Enqueue', () => {

        it('Should add distinct containers', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const expected = [ '①', '②', '③' ].map(id => MockContainer(id));
            await testee.Enqueue(...expected);

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual(expected);
        });

        it('Should only add first unique containers', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const expected = [ '①', '②', '③' ].map(id => MockContainer(id));
            await testee.Enqueue(...expected, MockContainer('②'), MockContainer('③'), MockContainer('①'));

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual(expected);
        });

        it('Should not add duplicate containers', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const expected = [ '①', '②', '③' ].map(id => MockContainer(id));
            await testee.Enqueue(...expected);
            await testee.Enqueue(MockContainer('②'), MockContainer('③'), MockContainer('①'));

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual(expected);
        });

        it('Should add containers with different root nodes', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const first = MockContainer('②', MockContainer('①', MockContainer('x')));
            const second = MockContainer('②', MockContainer('①', MockContainer('o')));
            await testee.Enqueue(first);
            await testee.Enqueue(second);

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual([ first, second ]);
        });

        it('Should not add containers with subsequent parent equality', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const first = MockContainer('③', MockContainer('②'));
            const second = MockContainer('③', MockContainer('②', MockContainer('①')));
            await testee.Enqueue(first);
            await testee.Enqueue(second);

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual([ first ]);
        });

        it('Should not add containers with subsequent parent equality', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const first = MockContainer('③', MockContainer('②', MockContainer('①')));
            const second = MockContainer('③', MockContainer('②'));
            await testee.Enqueue(first);
            await testee.Enqueue(second);

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual([ first ]);
        });

        it('Should not add containers with equivalent parents', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const first = MockContainer('③', MockContainer('②', MockContainer('①')));
            const second = MockContainer('③', MockContainer('②', MockContainer('①')));
            await testee.Enqueue(first);
            await testee.Enqueue(second);

            const queued = testee.Queue.Value.map(task => task.Media);
            expect(queued).toStrictEqual([ first ]);
        });

    });

    describe('Dequeue', () => {

        it('Should remove tasks from download queue', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            await testee.Enqueue(MockContainer('①'), MockContainer('②'), MockContainer('③'), MockContainer('④'));
            const tasks = testee.Queue.Value;
            await testee.Dequeue(tasks[1], tasks[2]);

            const queued = testee.Queue.Value;
            expect(queued).toStrictEqual([ tasks[0], tasks[3] ]);
        });
    });

    describe('Queue', () => {

        it('Should invoke expected event when adding tasks', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const callback = vi.fn();
            const containers = [ '①', '②', '③' ].map(id => MockContainer(id));
            await testee.Enqueue(MockContainer('②'), MockContainer('x'), MockContainer('o'));
            testee.Queue.Subscribe(callback);
            await testee.Enqueue(containers[2], containers[1], containers[0]);

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(testee.Queue.Value, testee);
        });

        it('Should invoke expected event when removing tasks', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            const callback = vi.fn();
            const containers = [ '①', '②', '③', '④' ].map(id => MockContainer(id));
            await testee.Enqueue(...containers);
            testee.Queue.Subscribe(callback);
            await testee.Dequeue(testee.Queue.Value[1], testee.Queue.Value[2]);

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(testee.Queue.Value, testee);
        });
    });

    describe('Concurrency', () => {

        const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

        it('Should have a default of 6 simultaneous tasks', async () => {
            expect(DownloadManager.DefaultConcurrency).toBe(6);
        });

        it('Should process multiple tasks at the same time up to the limit', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee(() => 3);
            const probe = { active: 0, peak: 0 };
            const items = [ '①', '②', '③', '④', '⑤' ].map(id => MockBlockingContainer(id, probe));

            await testee.Enqueue(...items.map(item => item.container));
            await wait(400);

            expect(probe.peak).toBe(3);
            items.forEach(item => item.release());
        });

        it('Should process tasks one after another with a limit of 1', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee(() => 1);
            const probe = { active: 0, peak: 0 };
            const items = [ '①', '②', '③' ].map(id => MockBlockingContainer(id, probe));

            await testee.Enqueue(...items.map(item => item.container));
            await wait(400);

            expect(probe.peak).toBe(1);
            items.forEach(item => item.release());
        });

        it('Should start further tasks when a running task has finished', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee(() => 2);
            const probe = { active: 0, peak: 0 };
            const items = [ '①', '②', '③' ].map(id => MockBlockingContainer(id, probe));

            await testee.Enqueue(...items.map(item => item.container));
            await wait(400);
            expect(probe.active).toBe(2);

            items[0].release();
            await wait(500);
            expect(probe.active).toBe(2);

            items.forEach(item => item.release());
        });

        it('Should fall back to the default for invalid limits', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee(() => Number.NaN);
            const probe = { active: 0, peak: 0 };
            const items = Array.from({ length: 9 }, (_, index) => MockBlockingContainer(`#${index}`, probe));

            await testee.Enqueue(...items.map(item => item.container));
            await wait(600);

            expect(probe.peak).toBe(DownloadManager.DefaultConcurrency);
            items.forEach(item => item.release());
        });
    });
});
