// Credit https://dev.to/thegravityguy/understanding-semaphores-a-typescript-guide-2blb

export class Semaphore {
  private count: number;
  private waiters: Array<() => void> = [];

  constructor(count: number) {
    if (count < 1) {
      throw new Error("Semaphore count must be at least 1");
    }
    this.count = count;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    // If there are waiters, give the permit immediately.
    if (this.waiters.length > 0) {
      const nextResolve = this.waiters.shift();
      if (nextResolve) nextResolve();
    } else {
      // No waiting acquire requests, so increment available count.
      this.count++;
    }
  }
}