/**
 * Keyed async mutex for synchronizing access to account balances and reservations.
 * Accounts are sorted in lexicographical order before locking to prevent deadlocks.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = this.queue.shift();
        if (next) {
          next();
        } else {
          this.locked = false;
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const next = this.queue.shift();
          if (next) {
            next();
          } else {
            this.locked = false;
          }
        });
      });
    });
  }
}

export class AccountLockManager {
  private readonly locks = new Map<string, AsyncMutex>();

  private getLock(account: string): AsyncMutex {
    let lock = this.locks.get(account);
    if (!lock) {
      lock = new AsyncMutex();
      this.locks.set(account, lock);
    }
    return lock;
  }

  async withAccountLocks<T>(accounts: string[], fn: () => Promise<T>): Promise<T> {
    const sortedDistinctAccounts = [...new Set(accounts)].sort();
    const releaseFns: Array<() => void> = [];

    try {
      for (const acc of sortedDistinctAccounts) {
        const lock = this.getLock(acc);
        const release = await lock.acquire();
        releaseFns.push(release);
      }
      return await fn();
    } finally {
      // Release in reverse order of acquisition
      for (let i = releaseFns.length - 1; i >= 0; i--) {
        const release = releaseFns[i];
        if (release) {
          release();
        }
      }
    }
  }
}

export const defaultLockManager = new AccountLockManager();

export async function withAccountLocks<T>(
  accounts: string[],
  fn: () => Promise<T>,
  manager: AccountLockManager = defaultLockManager,
): Promise<T> {
  return await manager.withAccountLocks(accounts, fn);
}
