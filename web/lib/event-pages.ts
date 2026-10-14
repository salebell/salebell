/** Reject the whole export on any failed page; callers must not download incomplete data. */
export async function collectPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 1000): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error instanceof Error ? error : new Error(
      typeof error === "object" && "message" in error ? String(error.message) : "Couldn't load export data.",
    );
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) return all;
  }
}

/** Matches descending occurred_at, id ordering, retaining rows with the same timestamp. */
export function eventCursor(last: { occurred_at: string; id: string }) {
  return `occurred_at.lt."${last.occurred_at}",and(occurred_at.eq."${last.occurred_at}",id.lt.${last.id})`;
}
