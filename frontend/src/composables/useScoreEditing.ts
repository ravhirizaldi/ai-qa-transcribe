export const hasScoreChanges = (
  rows: Array<{ id: string; score: number }>,
  edits: Record<string, { score: number; note: string }>,
) => {
  return rows.some((row) => {
    const draft = edits[row.id];
    return Boolean(draft && Number(draft.score) !== Number(row.score));
  });
};

export const hasMissingScoreNotes = (
  rows: Array<{ id: string; score: number }>,
  edits: Record<string, { score: number; note: string }>,
) => {
  return rows.some((row) => {
    const draft = edits[row.id];
    if (!draft || Number(draft.score) === Number(row.score)) return false;
    return !String(draft.note || "").trim();
  });
};
