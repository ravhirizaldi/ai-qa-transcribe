export const runWithConcurrency = async <T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
) => {
  const limit = Math.max(1, Math.floor(concurrency || 1));
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await task(items[index] as T, index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
};
