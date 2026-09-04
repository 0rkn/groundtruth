# Handover — Groundtruth

For whoever picks this up next. `README.md` is the reference for what the code does and how
it's built; this is the shorter, rougher note for someone taking over the project itself —
what's actually done, what's known to be shaky, and what to do about it next.

## What it does, in one paragraph

A consultant uploads a client's governance documents. The tool reads them, computes some
figures in code (page counts, notice periods, risk scores — never guessed, `null` when the
documents don't support one), picks 44–48 questions from a fixed pool based on signals it
detects in the text, and finds verbatim evidence for each — or an honest "no evidence found."
The consultant reviews it, sends unguessable links to directors, and once at least one has
scored it, a report page aggregates their answers against the same evidence. Nothing a
director or consultant reads is ever composed prose describing what the evidence means — it's
either a real quotation lifted by code, or arithmetic over numbers already in hand.

## How to run it

```bash
npm install
cp .env.example .env    # fill in real values — see below
npm run dev
```

Needs four Cloudflare credentials in `.env`: `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`CF_VECTORIZE_INDEX`, `CF_KV_NAMESPACE_ID` — Workers AI, Vectorize and KV all live on one
Cloudflare account. `APP_PASSCODE` gates the whole app behind `/gate`; there's no bill to
protect locally, so it can be anything for development, but a real value is required before
anything goes further than your own machine — see "Before deploying" below.

`npm run check:pick` is the fastest way to see the whole generation pipeline working end to
end without going through the UI — prints all 48 questions with their evidence, ~10 minutes
against real documents.

## What's actually done

- Full generation pipeline: extract → type → figures → select questions → retrieve → pick →
  summarise. Tested against two real fixture client sets, genuinely different questionnaires
  produced from the same code (see README's "Bespokeness" section).
- Director-response flow: unguessable per-link tokens, a narrower read-only view, a per-link
  choice about whether directors see an absence flagged.
- Consultant report: aggregates director scores against the pipeline's own evidence, zero new
  model calls, tested against real simulated responses.
- Manual evidence-add: a consultant can add a quotation the pipeline missed, checked against
  the real document text before it's accepted, never taken on trust.
- `/previous`: lists and deletes cached runs, for repeat testing without touching KV by hand.
- Rate limiting: real, in `lib/limit.ts`, gated off in local development — unlimited there,
  nothing to remember to flip once it's live. Activates automatically on Vercel specifically
  (checks `process.env.VERCEL`, which only Vercel's own runtime sets) — on any other host it
  would stay off, the same as local dev.
- `/present`: a small keyboard-navigable slideshow for presenting the project, linked only
  from a footer link on the home page, gated behind the same passcode as everything else.
- Consultant and director questionnaire views share the same design tokens and component
  styling (`gt-*` CSS variables) — they were built at different times and had drifted apart
  visually before being brought back in line.
- Checked for and fixed mobile layout breakage on the home, previous-questionnaires,
  consultant questionnaire, and director questionnaire pages: two real horizontal-overflow
  bugs (an untruncated filename list, a `whitespace-nowrap` label) and one uneven-wrap bug
  in the five-point scale, which now stacks to one column below `sm:`.

## What's known to be shaky

- **Contradiction detection (shape a)** exists as a candidate but doesn't reliably get
  selected — tested two different fixes (a prompt nudge, a larger selection cap), neither
  moved it.
- **Commitment citation (shapes c/d, "progress since previous review")** was firing in only
  2 of 288 real question-instances originally. Four prompt configurations were tested (see
  README's "Commitment citation" section for the full numbers); two worked examples added
  to the prompt shipped as the fix, raising it to 16 of 144 — still not guaranteed on every
  run, but a real, measured improvement, confirmed live: a full run with 5 simulated
  director responses populated 5 "progress since previous review" questions.
- **General commitment detection / cross-commitment contradiction-checking** was explicitly
  scoped out — what exists only covers the previous review's own numbered recommendations.

## Before deploying

If this is not done yet:

1. **`APP_PASSCODE` is still whatever placeholder is in your local `.env`.** Set a real value
   in wherever this ends up hosted, not committed anywhere.
2. **The hosting environment needs its own copy of the same environment variables**:
   `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_VECTORIZE_INDEX`, `CF_KV_NAMESPACE_ID`,
   `APP_PASSCODE`.
3. **No git repository exists yet.** Most hosting platforms want one connected for deploys
   and rollbacks; deploying without one works but loses that safety net.
4. **Decide on the KV namespace**: does production share the same Cloudflare KV namespace as
   local development, or does it get its own?

## If something breaks

- **A questionnaire looks stale after a code change to `pick.ts`/`summarise.ts`/`figures.ts`
  didn't take effect**: check `PROMPT_VERSION`/`RETRIEVAL_VERSION`/`METHOD_VERSION` in
  `lib/cache.ts` were bumped. Every one of those constants exists because forgetting to bump
  it serves a stale cached result forever, silently, which is the single failure mode this
  file's whole design exists to prevent.
- **`Set CF_ACCOUNT_ID and CF_API_TOKEN` in the browser console**: something imported
  `lib/cf.ts` (directly or via `lib/aggregate.ts`, which pulls it in for its KV helpers) into
  client-side code. `lib/cf.ts` is server-only and throws at import time without real
  credentials, which a browser never has. Check for a value (not type-only) import of a
  server module in a `"use client"` file.
- **A `/report/[id]` or similar link fails to load**: the report id in the URL should be a
  base64url string from `lib/report-id.ts`, never the raw colon-delimited cache key directly
  — see "Consultant report" in the README for why that matters.
- **A run gets permanently stuck at `"running"` with every step showing done**: this happened
  once — the dev server restarted (from an unrelated file edit triggering Next's hot reload)
  while `runAppraisal` was mid-flight, killing the in-memory promise. The job's KV record
  keeps its last-known progress forever, since nothing is left to write the final `"ready"`
  state. Fix is to delete that specific job (`clear:cache`, or a targeted KV delete) and
  re-run; avoid editing files while a real run is in progress if this needs to not happen
  again.
