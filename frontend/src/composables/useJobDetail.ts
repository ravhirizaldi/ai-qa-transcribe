export const runWithConcurrency = async <T,>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
) => {
  const limit = Math.max(1, Math.floor(concurrency || 1));
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await task(items[idx] as T, idx);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
};

export const toTranscriptSegments = (segments: any[]) =>
  segments.map((seg: any) => ({
    start: seg.startSec,
    end: seg.endSec,
    text: seg.rawText,
    speakerId: seg.speakerId,
    role: seg.role,
    cleaned_text: seg.cleanedText,
    words: seg.wordsJson || [],
  }));
