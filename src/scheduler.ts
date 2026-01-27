// Clock-aligned scheduler for periodic tasks

import { formatError } from './api-utils.js';

// Calculate milliseconds until the next scheduled minute
export function getDelayUntilNextMinute(scheduledMinutes: number[]): number {
  if (scheduledMinutes.length === 0) {
    throw new Error('scheduledMinutes must not be empty');
  }

  const now = new Date();
  const currentMinute = now.getMinutes();
  const currentSeconds = now.getSeconds();
  const currentMs = now.getMilliseconds();

  // Find the next scheduled minute
  const nextMinute = scheduledMinutes.find(m => m > currentMinute);

  if (nextMinute === undefined) {
    // Next scheduled time is in the next hour
    const firstMinute = scheduledMinutes[0]!;
    const minutesUntil = 60 - currentMinute + firstMinute;
    return (minutesUntil * 60 - currentSeconds) * 1000 - currentMs;
  }

  const minutesUntil = nextMinute - currentMinute;
  return (minutesUntil * 60 - currentSeconds) * 1000 - currentMs;
}

// Scheduler class to manage clock-aligned scheduling with graceful shutdown
export class ClockAlignedScheduler {
  private timeout: NodeJS.Timeout | null = null;
  private cancelled = false;

  constructor(
    private scheduledMinutes: number[],
    private callback: () => Promise<void>,
    private name: string
  ) {}

  start(): void {
    this.cancelled = false;
    this.scheduleNext();
  }

  stop(): void {
    this.cancelled = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private scheduleNext(): void {
    if (this.cancelled) return;

    const delay = getDelayUntilNextMinute(this.scheduledMinutes);
    const nextTime = new Date(Date.now() + delay);
    console.log(`  Next ${this.name} scheduled for ${nextTime.toISOString().replace('T', ' ').substring(0, 19)}`);

    this.timeout = setTimeout(async () => {
      if (this.cancelled) return;
      try {
        await this.callback();
      } catch (error) {
        console.error(`Error in ${this.name} callback: ${formatError(error)}`);
      }
      this.scheduleNext();
    }, delay);
  }
}
