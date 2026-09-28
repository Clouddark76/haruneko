import { describe, it, expect, afterEach } from 'vitest';
import { RateLimit, ThrottleDelay, Unlimited } from './RateLimit';

describe('RateLimit', () => {

    describe('Throttle', () => {

        it.each([
            [-7, -7, 0],
            [-7, 0, 0],
            [0, -7, 0],
            [0, 0, 0],
            [0, 7, 0],
            [7, 0, 0],
            [1, 7, 7000],
            [7, 7, 1000],
            [10, 7, 700]
        ])('Should calculate expected delay', async (count, span, expected) => {
            const testee = new RateLimit(count, span);
            expect(testee.Throttle).toBe(expected);
        });
    });

    describe('Unlimited', () => {

        it('Should provide expected pre-defined value', async () => {
            const testee = Unlimited;
            expect(testee.Throttle).toBe(0);
        });
    });

    describe('Bypass', () => {

        afterEach(() => RateLimit.SetBypass(() => false));

        it('Should not be bypassed by default', async () => {
            expect(RateLimit.Bypassed).toBe(false);
        });

        it('Should skip throttling when bypassed', async () => {
            const testee = new RateLimit(1, 7);
            expect(testee.Throttle).toBe(7000);
            RateLimit.SetBypass(() => true);
            expect(RateLimit.Bypassed).toBe(true);
            expect(testee.Throttle).toBe(0);
        });

        it('Should re-evaluate the provider on every access', async () => {
            let bypass = false;
            RateLimit.SetBypass(() => bypass);
            const testee = new RateLimit(1, 2);
            expect(testee.Throttle).toBe(2000);
            bypass = true;
            expect(testee.Throttle).toBe(0);
            bypass = false;
            expect(testee.Throttle).toBe(2000);
        });

        it('Should not be bypassed when the provider fails', async () => {
            RateLimit.SetBypass(() => { throw new Error('boom'); });
            expect(RateLimit.Bypassed).toBe(false);
        });
    });

    describe('ThrottleDelay', () => {

        afterEach(() => RateLimit.SetBypass(() => false));

        it('Should wait when not bypassed', async () => {
            const start = Date.now();
            await ThrottleDelay(120);
            expect(Date.now() - start).toBeGreaterThanOrEqual(100);
        });

        it('Should return immediately when bypassed', async () => {
            RateLimit.SetBypass(() => true);
            const start = Date.now();
            await ThrottleDelay(2000);
            expect(Date.now() - start).toBeLessThan(200);
        });
    });
});
