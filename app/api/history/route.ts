/**
 * Previous questionnaires: list them, or delete one.
 *
 * NO SEPARATE INDEX. A finished appraisal's job id already IS its cache key — see
 * `appraisalKey` and `app/api/analyse/route.ts` — so the list of previous runs is
 * exactly the `job:*` entries in KV, read back and filtered to the ones that finished.
 * Keeping a second index in sync with the first is a bug waiting to happen; reading the
 * one source of truth twice, for two different questions, is not.
 *
 * DELETE removes both halves of a run: the job record this route lists, and the raw
 * appraisal cache entry `cached()` reads by the same key. Removing only the job record
 * would clear it from this list while the appraisal itself kept silently reappearing —
 * re-uploading the same documents would still hit the cache — which defeats the entire
 * point of a delete button for someone testing repeatedly.
 */
import { kvDelete, kvGet, kvListKeys } from "@/lib/cf";
import type { AppraisalStatus } from "@/lib/appraisal";

export const runtime = "nodejs";

interface HistoryEntry {
  id: string;
  startedAt: number;
  asOf: string | null;
  documents: string[];
  questionCount: number;
  evidenced: number;
  respondentCount: number;
}

/**
 * Every appraisal's respondent count, in one pass over `respond:*` rather than one list
 * scan per row — the same records `lib/aggregate.ts` reads per-appraisal, grouped here
 * instead of filtered, because this route needs the count for every row at once.
 *
 * A count of RESPONSES, not of tokens — a single link shared with a whole board (see
 * `app/api/respond/route.ts`) can hold more than one respondent, each its own
 * `answers:<token>:<response>` entry, so the token itself is no longer what's counted.
 */
async function respondentCounts(): Promise<Map<string, number>> {
  const keys = await kvListKeys("respond:");
  const counts = new Map<string, number>();

  await Promise.all(
    keys.map(async (key) => {
      const raw = await kvGet(key);
      if (!raw) return;
      const record = JSON.parse(raw) as { appraisalId: string };
      const token = key.slice("respond:".length);
      const responseKeys = await kvListKeys(`answers:${token}:`);
      if (responseKeys.length === 0) return;
      counts.set(record.appraisalId, (counts.get(record.appraisalId) ?? 0) + responseKeys.length);
    }),
  );
  return counts;
}

export async function GET(): Promise<Response> {
  const [keys, counts] = await Promise.all([kvListKeys("job:"), respondentCounts()]);

  const entries: HistoryEntry[] = [];
  for (const key of keys) {
    const raw = await kvGet(key);
    if (!raw) continue;

    let record: (AppraisalStatus & { startedAt?: number }) | undefined;
    try {
      record = JSON.parse(raw);
    } catch {
      continue; // a record that fails to parse is not a run worth showing
    }

    if (record?.state !== "ready") continue;

    const id = key.slice("job:".length);
    entries.push({
      id,
      startedAt: record.startedAt ?? 0,
      asOf: record.appraisal.asOf,
      documents: record.appraisal.documents.map((d) => d.filename),
      questionCount: record.appraisal.questionCount,
      evidenced: record.appraisal.counts.evidenced,
      respondentCount: counts.get(id) ?? 0,
    });
  }

  entries.sort((a, b) => b.startedAt - a.startedAt);
  return Response.json({ entries });
}

export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  await Promise.all([kvDelete(`job:${id}`), kvDelete(id)]);
  return Response.json({ ok: true });
}
