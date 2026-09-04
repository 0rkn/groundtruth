/**
 * Delete cached appraisals, so testing the same documents twice gives a fresh run.
 *
 * The cache is correct by construction — a version bump in cache.ts invalidates stale
 * entries on its own — but that is the wrong tool for "I just want to re-run this
 * upload". This is the direct one: list every appraisal key and delete it.
 *
 * TWO PREFIXES, not one. A finished run leaves two KV entries under different keys: the
 * raw appraisal `cached()` reads (`appraisal:...`) and the job record the web upload
 * flow polls and `/api/history` lists (`job:appraisal:...` — note the job key is "job:"
 * prepended to the appraisal key, so it does NOT start with "appraisal:" and a
 * single-prefix delete misses it). A first version of this script cleared only the raw
 * entry, which meant a stale run kept showing up under "Previous questionnaires" long
 * after its underlying cache was gone. Both are deleted together here for exactly the
 * reason `/api/history`'s DELETE route deletes both.
 *
 * Usage:
 *   npm run clear:cache            delete every cached appraisal and job record
 *   npm run clear:cache -- --all   also delete rate-limit entries (limit:...)
 */
import { kvListKeys, kvDelete } from "../lib/cf.ts";

const ALL = process.argv.includes("--all");
const prefixes = ALL ? [""] : ["appraisal:", "job:"];

let total = 0;
for (const prefix of prefixes) {
  const keys = await kvListKeys(prefix);
  if (keys.length === 0) {
    console.log(`No keys under "${prefix || "(everything)"}".`);
    continue;
  }
  console.log(`Deleting ${keys.length} key(s) under "${prefix || "(everything)"}"...`);
  for (const key of keys) {
    await kvDelete(key);
    console.log(`  deleted ${key}`);
    total += 1;
  }
}

console.log(total > 0 ? "Done. The next upload of any document set will run fresh." : "Nothing to delete.");
