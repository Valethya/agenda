export interface ScheduleSaveGuard {
  current: boolean;
}

export interface ScheduleSaveGuardResult<T> {
  acquired: boolean;
  value?: T;
}

export const runWithScheduleSaveGuard = async <T>(
  guard: ScheduleSaveGuard,
  operation: () => Promise<T>
): Promise<ScheduleSaveGuardResult<T>> => {
  if (guard.current) return { acquired: false };

  guard.current = true;
  try {
    return {
      acquired: true,
      value: await operation()
    };
  } finally {
    guard.current = false;
  }
};
