import { Delay } from '../BackgroundTimers';

export class RateLimit {

    private static bypassProvider: () => boolean = () => false;

    /**
     * Configure a function that decides whether all rate limits and throttling delays shall be skipped.
     * It is evaluated on every access, so changes (e.g. from the settings) apply immediately.
     */
    public static SetBypass(provider: () => boolean): void {
        RateLimit.bypassProvider = provider;
    }

    /**
     * Determine if rate limits and throttling delays are currently skipped.
     */
    public static get Bypassed(): boolean {
        try {
            return RateLimit.bypassProvider() === true;
        } catch {
            return false;
        }
    }

    /**
     * Create a new {@link RateLimit} instance.
     * @param amount - Maximum number of units within the given {@link interval}.
     * @param interval - Related timespan [sec] for the given {@link amount}.
     */
    constructor(private readonly amount: number, private readonly interval: number = 1) {
    }

    /**
     * The minimal cycle time [ms] between each unit to prevent exceeding the given {@link amount} per {@link interval},
     * e.g. a rate limit of 5 units per 1 second would require throttling of at least 200 milliseconds per unit.
     */
    public get Throttle() {
        return !RateLimit.Bypassed && this.amount > 0 && this.interval > 0 ? this.interval * 1000 / this.amount : 0;
    }

    /**
     * Create a new {@link RateLimit} instance.
     * @param amount - Maximum number of units within an interval of 60 seconds.
     */
    public static PerMinute(amount: number) {
        return new RateLimit(amount, 60);
    }
}

export const Unlimited = new RateLimit(0, 0);

/**
 * Wait for the given time [ms] to avoid exceeding the rate limit of a website (e.g., between paginated requests).
 * The delay is skipped when rate limits are bypassed, so this must only be used for throttling, not for waiting on a required condition.
 */
export async function ThrottleDelay(ms: number, variance = 0): Promise<void> {
    if(RateLimit.Bypassed) {
        return;
    }
    return Delay(ms, variance);
}
