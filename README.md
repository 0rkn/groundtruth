# Groundtruth — board effectiveness appraisal tool

Reads a client's governance documents (corporate plan, risk register, board pack extract,
board calendar, previous effectiveness review), computes figures in code, selects 44–48
questions across four fixed themes, retrieves evidence, and returns a questionnaire where
each question carries either a verbatim quotation from the documents or an honest "no
evidence found".

Next.js 16, React 19, TypeScript, Tailwind 4. Cloudflare Workers AI
(`@cf/openai/gpt-oss-120b` for generation, `@cf/baai/bge-base-en-v1.5` for embeddings,
`@cf/baai/bge-reranker-base` for reranking), Vectorize, KV.

## Running it

```bash
npm install
npm run dev              # http://localhost:3000, behind a passcode (see below)
```

Environment (`.env`, loaded by every script with `--env-file=.env`):

```
CF_ACCOUNT_ID=...
CF_API_TOKEN=...
CF_VECTORIZE_INDEX=groundtruth-index      # optional, defaults to groundtruth-index
CF_KV_NAMESPACE_ID=...            # optional; caching and rate limiting degrade gracefully without it
APP_PASSCODE=...                  # required in production — see "Access control" below
```

Useful scripts:

```bash
npm run check:pick               # the live pipeline, end to end, 48 rows printed
npm run check:retrieval          # chunking + reranker sweep (see "Retrieval" below)
npm run check:appraisal -- --assert   # full pipeline gate, twice, asserts caching works
npm run clear:cache              # delete every cached appraisal, for repeat testing
```

## Access control

The app spends Workers AI credits on every run, so it sits behind a passcode rather than
being open to the internet. `proxy.ts` — Next 16 renamed Middleware to Proxy, and a file
still called `middleware.ts` is silently ignored, which would look like a working gate
while leaving the app open — checks every request for a cookie set by `/gate`. An
unauthenticated visitor is redirected to `/gate?next=<original path>`, and on the correct
passcode is sent straight back to whatever they were trying to reach, including a
finished questionnaire mid-appraisal. `APP_PASSCODE` unset fails closed (503), not open.

**Rate limiting only applies on an actual Vercel deployment.** `/api/analyse` checks
`process.env.VERCEL` — a variable Vercel sets automatically on its own runtime and
nowhere else — before enforcing the 3-appraisals-per-hour cap, so local development and
any environment short of a real deployment is unlimited, with nothing to remember to
flip later. Re-uploading documents that are already cached never counts against the
limit either way: the cache is checked before the limiter runs, so revisiting a finished
result costs nothing.

## Architecture

```
extract → type documents → compute figures → select questions → retrieve → pick → summarise
```

Deterministic stages first, model stages last. Only the last two call a model, and each
does one small, narrow thing rather than one large one.

**Extraction** (`lib/extract.ts`) turns each PDF into markdown-ish text, page by page.
Page numbers come from the extractor, never inferred, because every citation in the
product traces through one.

**Document typing** (`lib/classify.ts`) reads each document's own title on its first
page — "Board and Committee Calendar 2026/27", "Board Effectiveness Review 2023" — rather
than trusting the filename. A prefix map (`01-corporate-plan.pdf` → corporate plan) exists
for this project's own fixtures, which are named that way; a real upload falls back to the
classifier. Two genuinely common alternate titles are recognised (a "governance health
check" as a review, a multi-year "operating plan" as a corporate plan) because they recur
across organisations. Deliberately not chased further: a title the classifier misses
returns `null`, and the document is still searched — an honest gap, not a guess.

**Figures** (`lib/figures.ts`) are counted from the documents in code — pack length,
notice given for papers, risks with an unmoved score, and so on. A figure the documents
don't support returns `null`, never `0`: a zero would read as a finding ("no items were
deferred") when the truth is "that could not be told", and those must never be confused.

**Selection** (`lib/select.ts`) detects signals in the text (charity status, equity
investors, debt covenants, a subsidiary, service users, ...) and uses them to choose
44–48 questions from a pool of 64 across four themes — the client's own worded questions
always included, then questions that match a detected signal, then universal ones to
fill each theme's cap. This is where bespokeness actually happens; see the section below.

**Retrieval** (`lib/run-appraisal.ts`, `lib/retrieve.ts`) embeds each question (with the
word "board" stripped — see below) and takes the 8 nearest passages from a per-run
Vectorize namespace.

**Picking** (`lib/pick.ts`) and **summarising** (`lib/summarise.ts`) are the two model
steps. See "Generation" below for what each does and why they are separate.

## Generation

**Step one — picking (`lib/pick.ts`).** One question at a time. Given the question and its
retrieved passages — plus every computed figure and every accepted recommendation from
the previous review, each rendered as a numbered candidate line — the model returns which
numbers answer it, or `NONE`. Code lifts the chosen text out of the source verbatim.
There is nothing to verify at this step: a model that only ever emits numbers cannot
misquote, invent a figure, or draw a conclusion, and a question with nothing to answer it
produces `NONE` rather than a plausible guess, because omitting is the whole task on that
call rather than one option among several.

**Step two — summarising (`lib/summarise.ts`).** A short paraphrase — "what a consultant
drew from it" — sitting above the verbatim quotes, restating what they say without a
verdict attached. It runs strictly after picking, sees only the quotes already chosen,
and cannot select different evidence. Every number in its output is checked against the
source quotes; if it states one that isn't there, the paraphrase is dropped and only the
verbatim evidence remains — a bad sentence never costs the fact underneath it. Two real
bugs lived in that check before this was written up: the number-matching regex was
swallowing an ordinary sentence's trailing full stop into the number itself (so a
paraphrase that correctly restated "...in 2027." never matched a source's "2027"), and
comparing "78%" against a paraphrase's "78 percent" as literally different strings. Both
silently dropped correct paraphrases and are now fixed.

Two smaller defects, both in the code that turns a chosen line into text a director
reads, were found by reading output rather than by any checker:

- **Collapsed table columns.** PDF extraction sometimes transposes a table into one cell
  per column, so an agenda's Lead and Purpose columns arrive as one run-on string with no
  row boundaries. A regex catches a run of four or more bare integers (the numeric form of
  this); a second check measures the share of function words in a candidate line (real
  prose runs 20–50%, a jammed column of names or roles measured 2–14% on the cases this
  was built against) and drops anything below 15%.
- **A missing per-item breakdown.** Once collapsed rows are correctly dropped, a question
  about agenda time or page allocation had nothing specific left to select and fell back
  to the document's cover page. `agendaRowUnits` rebuilds one clean line per agenda item —
  "Agenda item 4, 42 pages, scheduled at 10.45" — positionally from the table's own item,
  page and time columns, which stay aligned even when the item *names* collapse.

What this buys: every quotation on the page is a slice of a real document taken by code,
with its own citation — two quotations under one question, from two different documents,
read as a contradiction or a corroboration rather than a garbled run-on, because they are
never concatenated and stamped with one source. What it does not buy: relevance.
Retrieval still returns its 8 nearest passages for a question the documents cannot
answer, exactly as confidently as for one they can, and nothing here decides "none of
this actually bears on the question" — see "What is not solved" below.

## Retrieval: what was tested and what shipped

Two clients are labelled at **page** level (a page is the same unit under every chunking
strategy, and it's what the questionnaire cites): a housing association (39 answerable
questions, 9 abstention) and a payments company (46 answerable, 2 abstention).
Configurations are chosen on the first client and confirmed once, unchanged, on the
second — the only thing preventing a configuration from being fitted to its own test set.

With ~40 questions a single rate carries a 95% interval of roughly ±15 points, so every
comparison is **paired** (the same questions, every configuration) and reported as a
difference with a bootstrap interval. Where the interval spans zero, the finding is "no
measurable difference" — a result, not a failure to find one. That rule was fixed before
any number existed.

### Chunking: seven strategies compared, single client, dense retrieval only

Every row below is the same passages, the same probe, no reranker — the only thing varying
is where the chunk boundary falls.

| chunking | passages | median words | hit@1 | hit@5 | MRR | Δ MRR vs baseline | rec@5 (2+) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| semantic (sentence-topic boundary) | 105 | 24 | 51% | 77% | 0.625 | +0.029 [−0.091, 0.148] | 52% |
| **fixed 140 words + headings (shipped)** | 51 | 65 | 41% | 82% | 0.596 | baseline | 57% |
| packed 140 words, headings off | 34 | 143 | 38% | 82% | 0.570 | −0.026 [−0.106, 0.058] | 52% |
| whole page | 19 | 210 | 38% | 79% | 0.556 | −0.040 [−0.157, 0.073] | 53% |
| structure-aware (splits on the documents' own bold headings) | 49 | 63 | 38% | 74% | 0.549 | −0.047 [−0.148, 0.051] | 47% |
| packed 80 words, headings off | 45 | 95 | 38% | 79% | 0.548 | −0.048 [−0.141, 0.046] | 52% |
| packed 250 words, headings off | 26 | 189 | 33% | 90% | 0.547 | −0.049 [−0.162, 0.065] | 56% |

**Every interval spans zero.** Semantic ranks highest on paper and wins 8 questions while
losing 4 on hit@1 against the baseline — a coin flip, not a finding. The fixed-140 chunker
was kept: nothing beat it, and the alternatives cost more — semantic means twice the
chunks and an embedding call per sentence at ingest, for a difference that cannot be
measured; structure-aware and whole-page both look worse and gain nothing in return.

**Note: heading-splitting has been silently inert since the PDF extraction library was
replaced.** `@firecrawl/pdf-inspector` shipped a compiled native binary that could not be
made to load inside Vercel's bundled serverless function — confirmed present on disk,
still failing to load, across several distinct fix attempts — so it was replaced with
`unpdf`, which has no native dependency and cannot hit that class of failure at all.
The tradeoff: `pdf-inspector` produced real markdown (`#` headings, tables); `unpdf`
produces plain text. `toPassages` (`lib/passages.ts`) splits a passage on a markdown
heading line as well as on the 140-word target, but with no real `#` syntax left in the
extracted text, that half of the rule no longer fires — chunking today is effectively
140-word splitting alone, "packed 140 words, headings off" in the table above, not the
shipped "fixed 140 words + headings" row it's still labelled as. Content is unaffected —
verified byte-identical facts and figures across both libraries on all 5 real documents,
and every stage gate still passes — only the exact chunk boundaries differ. The table
above already measured this exact comparison and found the difference statistically
indistinguishable from noise, so this is a known, silent side effect rather than a
regression, but it is real and worth fixing properly rather than leaving mislabelled.

One measurement trap this table exists partly to document: **a word-target sweep only
means something with heading-splitting turned off.** `toPassages` breaks on headings as
well as on the word target, and on these documents headings dominate so completely that a
target of 250 words is byte-identical to a target of infinity. The "packed" rows above
have splitting off for exactly this reason — sweeping 80/140/250 with it on would vary a
parameter that never actually moves.

### The reranker

A cross-encoder reranker (`bge-reranker-base`) was the strongest effect in the whole study
on the development client, and it is **worse than no reranker on every configuration**
tested on the held-out one. Split by evidence type on the held-out client:

| evidence type | dense MRR | after reranking | change |
| --- | --- | --- | --- |
| absence ("there is no skills matrix") | 0.582 | **0.483** | −0.099 |
| positive ("the board receives X quarterly") | 0.549 | 0.540 | −0.009 |

An eleven-fold difference in harm. Absence is most of the evidence here too: 44% of one
client's labelled questions and 61% of the other's are recorded absences, so this is not an
edge case the reranker mishandles occasionally — it is most of what it is being asked to
judge.

My reading of why: `bge-reranker-base` is trained for **web search** — given a query and a
candidate passage, it learns whether the passage answers the query from data where a page
saying "there is no X" is essentially never the right search result for "what is X," a
non-answer, correctly demoted. I am using it for the opposite task. Asked "does the board
assess its own skills?", the single best possible answer this corpus can contain is a
passage reading "there is no skills matrix" — that sentence *is* the finding, not a miss.
The reranker was never trained to recognise that, because search engines don't reward
absence the way a governance review does. This is why absence is never something the model
writes freely either — `pick.ts` returns `NONE` rather than composing a sentence asserting
nothing exists, which is exactly the claim a reranker would otherwise be trusted to demote.

### There is no usable abstention threshold

A similarity floor would let the tool say "there is nothing here" instead of always
returning its 8 nearest passages:

| | with evidence | without evidence |
| --- | --- | --- |
| mean top-1 cosine | 0.657 | 0.654 |
| AUC (client 1 / client 2) | 0.64 | 0.62 |

Ranking *shape*, not just magnitude, was tested too (top1−top2, top1−top5, and so on): every
dispersion statistic scored at or below 0.5, some strongly anti-predictive.

My reading of why: an AUC that low makes sense once you notice what it would need to
separate. It is not just weak — it is close to the coin-flip floor of 0.5, and the reason is
structural rather than a modelling shortcoming: **every document here is a governance
document, and every question is a governance question.** A similarity cutoff works when the
corpus contains things that are genuinely off-topic for a given question, so an unrelated
passage scores low and a relevant one stands out. Here, nothing is off-topic — a risk
register page is topically close to a question about risk appetite whether or not it
actually answers it, so the passage that merely mentions the right subject and the passage
that actually evidences it can score nearly identically. The dispersion result fits the same
story: a question **with** evidence usually has two or three relevant pages (several
passages score alike, the head is flat) while a question **without** has one accidental
nearest neighbour standing alone — the opposite of the peaked-vs-flat pattern a working
cutoff would need. This is exactly the failure `pick.ts` inherits today: nothing stops it
being handed 8 confidently-ranked passages for a question none of them answer.

One robust, low-cost finding survived everything above: every appraisal question opens
"The board...", and that stem dominated the embedding — one passage about how many seats
the board has topped three unrelated questions. Stripping "board"/"the board's" from the
probe moved a covenants question from outside the top 32 to rank 2, worth +3 questions
across every index variant tested. This is the one retrieval change that survives in
`lib/run-appraisal.ts` today (`stripBoard`).

### Limitations

- **Two clients, ~40 questions each.** Most differences are unmeasurable at this size;
  consistency of direction across both clients is doing more work than any single interval.
- **The fixtures are cut down** — roughly 4,400 words per client against a real pack of
  200–300 pages. Dense retrieval returns 20 of 51 chunks on these fixtures, so there is
  little room for a method to distinguish itself, and the reranker's rejection is specific
  to this scale, not a general claim about rerankers.
- **Labels were drafted by an earlier pass of this work from the documents themselves**,
  not independently sourced, and are the foundation of every retrieval number above.

## Graceful handling of a partial document set

A real submission may supply three documents rather than five. The pipeline never treats
a missing document type as a reason to skip a question:

1. Every selected question is still searched, against whatever was supplied. Figures
   that need a document type not present simply return `null`, as they always do.
2. A question that comes back with no evidence is captioned with which document type
   would usually have covered it — **only when it already has no evidence**, never used
   to decide not to search it. An earlier design used this same per-question mapping to
   skip searching before trying, and was measured wrong 7 times out of 11 against real
   evidence, because the other supplied documents frequently answered the question
   anyway. Captioning a genuine blank is a much smaller and safer claim than that.
3. Every theme is kept, in full, regardless of how thin its evidence is. A run with three
   documents simply carries more unanswered rows than one with five — nothing is dropped.

## Export

The finished questionnaire downloads as a `.docx` (`lib/export-docx.ts`,
`/api/export?id=...`) — one section per question, its evidence quotations with citations
or an honest "no evidence found", and the five scale labels to circle. Deliberately
separate from the web view rather than a printout of it: the web view is where a
consultant checks the evidence before sending it out; the document is what a director
actually marks up, without the consultant's own working notes (computed figures, detected
signals) mixed in.

## Previous questionnaires

`/previous` lists every finished run from cache, with a delete button per row — for
testing repeatedly without asking anyone to clear a cache by hand. No separate index is
kept: a finished run's job id already is its cache key, so the list is read straight off
the same records the running page writes. Deleting a row removes both the job record and
the underlying cached appraisal, so a re-upload of the same documents genuinely
recomputes rather than silently reappearing.

## Evidence truthfulness check

Ten evidence lines were sampled from a generated questionnaire, spread across all four
themes, and each was checked against the actual PDF page it cites — independently, by
re-extracting that page's raw text and confirming the quoted words appear in it verbatim,
not by trusting the pipeline's own claim.

**10 of 10 verified.**

| theme | question | document | page | verbatim on page |
| --- | --- | --- | --- | --- |
| Resources | Reports to the board carry what residents and service users are actually saying | Corporate plan | 3 | yes |
| Resources | Reports distinguish what the board must decide from what it is merely being told | Previous effectiveness review | 3 | yes* |
| Resources | The board has sufficient access to independent advice and assurance | Corporate plan | 4 | yes |
| Resources | Risk information reaching the board is current and shows movement over time | Risk register | 1 | yes |
| Competency | The board understands what its regulator expects it to evidence, not just what it does | Corporate plan | 4 | yes |
| Competency | The board has the mix of skills and experience its current strategy demands | Corporate plan | 4 | yes |
| Competency | The board understands the organisation's principal risks well enough to challenge on them | Board calendar | 3 | yes |
| Execution | Service changes can be traced back to something the people served actually said | Corporate plan | 5 | yes |
| Execution | Performance reporting shows direction of travel against target, not a point in time | Corporate plan | 4 | yes |
| Behaviour | Committee chairs report candidly to the board, including what has gone badly | Board pack extract | 5 | yes |

\* This citation is a recommendation from the previous review, and the field it is quoted
from carries a short code-added label — "Recommendation 1 of the board's 2023
effectiveness review: " — in front of the verbatim text, because a recommendation has no
single page span of its own text to lift the way a passage does. A naive substring check
against the raw page fails on the label; the recommendation's actual words, after the
colon, are confirmed verbatim on the cited page.

This is expected to hold at 10 of 10 by construction rather than by luck: every quotation
is a slice of the source text lifted by code once the model has chosen which lines answer
a question — see "Generation" above. The model never types the words that appear as
evidence, so there is no step where a quotation could drift from its source. What this
check actually tests, then, is whether that guarantee holds in practice against real
extracted PDF text, not whether the model can be trusted to quote accurately — it was
never asked to.

## Bespokeness: two clients, two different questionnaires

Both fixture clients — a housing association and a venture-backed payments company —
were run through the identical pipeline, same code, same prompt, same day, and produced
questionnaires that differ in ways that would matter to whoever read them, not merely in
wording.

**Different signals detected, from the documents alone:**

| | housing association | payments company |
| --- | --- | --- |
| signals | service users, subsidiary, development, debt covenants, charity, regulated, committees | equity investors, regulated, committees |

**Which questions get asked follows from that.** Of the 48 selected per client, 40 are the
same question on both sides and 8 per client come from a different part of the pool —
Jaccard similarity of the two selected sets is 40 / (40 + 8 + 8) = **0.71**. Given both sets
are the same size (48 of the same 64-question pool), the overlap coefficient and cosine
similarity over the same binary selection vectors work out to the same figure here (40/48 =
0.83) — they're not independent measures at this particular shape of data, so Jaccard alone
is enough to characterise it; a genuinely different signal would need something like
per-question evidence overlap rather than another way to count the same set difference.

All 8 differing pairs, one per theme's two signal-matched slots:

| theme | the housing association got | the payments company got instead |
| --- | --- | --- |
| Resources | Reports carry what residents and service users are actually saying, not only what was done for them | The board receives the information it needs on runway, burn and investor commitments |
| Resources | The board receives adequate reporting on the subsidiary's activity and risk | Induction and ongoing development for board members are adequate |
| Competency | The board can draw on lived experience of the communities it serves | The board has the commercial and financing experience its funding stage demands |
| Competency | The board understands the covenants it is bound by and what would breach them | Individual board member contributions are appraised and acted on |
| Execution | The board oversees the development programme against cost, time and risk together | The board treats preparation for the next funding round as a strategic project, not a finance task |
| Execution | Service changes can be traced back to something the people served actually said | The board distinguishes its role from that of the executive in practice, not only in principle |
| Behaviour | The board hears directly from residents and service users, not only about them | The board can challenge founders and major shareholders when it needs to |
| Behaviour | The board keeps its charitable purpose in view when commercial pressure pushes against it | Bad news reaches the board early and unfiltered |

A housing association's regulator, subsidiary and residents produce one questionnaire; a
venture-backed payments company's investors and funding stage produce a different one —
each from the same 64-question pool and the same selection code, reacting to what its
own documents actually say about it.

**The figures computed differ too**, both in which ones exist and in scale:

| figure | housing association | payments company |
| --- | --- | --- |
| pack length | 247 pages | 61 pages |
| notice given for papers | 4 working days (7 required) | 1 working day (5 required) |
| months since last external review | 30 | 12 |
| pages per paper, attributed to which paper | computed (42 pages, the Q1 performance report) | not computed — no item-number column survives extraction on this pack |
| papers stating a purpose and a recommendation | not computed on this client | 1 of 3 |

**And the same question, asked of both, is answered from each client's own facts — not a
template with numbers swapped in:**

> *Board and committee packs are concise, timely and decision ready.*
>
> **Housing association:** "Your board pack states that it contains 247 pages... papers
> were issued four working days before the meeting, whereas the required lead time is
> seven days."
>
> **Payments company:** "In the last seven meetings papers were circulated on average 1.4
> business days before the meeting (with two sent the morning of the meeting), the board
> pack was 61 pages long, and one of three papers in the extract stated a purpose and a
> recommendation."

Same question, same pipeline, same day — different numbers, a different standard cited
(five days against seven), a different unit of measurement (an average over seven
meetings against a single instance), and a fact ("one of three papers stated a purpose
and a recommendation") that has no equivalent on the other side at all, because it comes
from what that client's own documents happen to make countable.

## Director responses and scoring

The questionnaire the pipeline produces is only half the product — a consultant reads it,
then directors score it. That flow is a separate layer with its own access model, deliberately
not reusing the consultant's own view.

**A token, not the appraisal id, is the access credential** (`/api/respond`). The appraisal
id is a cache key a consultant pastes around freely; a director's link needs to be something
that cannot be guessed or reconstructed from it. Minting a link (`POST /api/respond`)
generates a random 24-byte token stored against the appraisal id; opening it
(`GET /api/respond?token=...`) reads the questionnaire back; submitting
(`PUT /api/respond`) writes that token's own answers, one 1–5 score per question, validated
as whole numbers on the way in.

**`/respond` and `/api/respond` are the only routes open to the internet without the
consultant's passcode** (`proxy.ts`'s `OPEN` list) — a director never has it and was never
meant to. Access is controlled entirely by possessing the unguessable token; nothing under
either path can start a new appraisal or spend a model call, only read one already-finished
questionnaire and write that token's own answers.

**`showAbsence` is a per-link choice, not a global one.** The default a director sees for an
unanswered question is nothing at all — the question isn't skipped, but nothing explains why,
because telling a director "no evidence was found for this" before they've answered reads as
the tool arguing a case rather than asking one. A consultant can opt a specific link into the
plain statement instead when minting it. The consultant's own view always shows the "no
evidence found" note regardless — this only controls what a director sees.

`app/respond/[token]/page.tsx` is a deliberately separate, narrower page from the
consultant's `AppraisalView` — no computed figures, no detected signals, no export link, just
the question, its evidence exactly as the consultant would see it, and the scale.

## Consultant report

Once at least one director has responded, `/report/[id]` (built fresh from
`lib/aggregate.ts` on every request, not cached — a report opened while directors are still
answering should reflect whoever has answered by then) aggregates their scores into an
executive summary, a per-theme position, strengths, areas for attention, progress against the
previous review, an action plan, and a method appendix.

**Nothing on this page is a new model call.** Every sentence is either arithmetic (a mean, a
count, a spread) or an already-generated, already-checked evidence line from `pick.ts`/
`summarise.ts` reused as-is. The one genuinely new thing on this page is a consensus note —
"scores ranged from 1 to 4 across 3 respondents" — which is exactly as far as arithmetic over
existing numbers can honestly go without inferring a reason.

**Report links use an obfuscated id, not the raw cache key** (`lib/report-id.ts`). The
appraisal cache key contains colons by design (see "Architecture"), and putting that directly
in a Next.js dynamic route segment caused real navigation bugs. `toReportId`/`fromReportId`
base64url-encode the key for the URL only; `/api/report` still takes and stores the real key.

## Manual evidence

A consultant can add a quotation by hand where the pipeline found nothing
(`/api/manual-evidence`) — but never on trust. The route takes a document, a page, and a
quotation, and checks that the quotation genuinely appears on that page of that document
(the exact text `run-appraisal.ts` stored under `documents:<appraisalId>` when the run
finished) before it is added anywhere, tolerant only of markdown/table-pipe/whitespace
extraction noise. A quote that fails is refused with a specific reason, not saved with a
warning label — the guarantee this whole product rests on is that a displayed quote is
provably real, and a free-text box that could render identically whether checked or not would
break that silently. Accepted quotes are flagged `manual: true` and shown with an "Added by
consultant" badge, so a reader can always tell the two kinds apart.

## Commitment citation: four prompt configurations tested

A previous review's numbered recommendation is offered to every question as a candidate
line in `pick.ts`, the same way a computed figure is. Early on this was selected as
evidence in only 2 of 288 question-instances across six full runs — shapes (c) and (d),
and the report's "progress since the previous review" section, all depend on this firing
at all. Four configurations of `pick.ts`'s prompt were tested against the same 48-question
set, three real runs each (144 question-instances per configuration):

| Configuration | Citations | Rate |
| --- | --- | --- |
| Instruction only (a sentence stating a recommendation is valid evidence for a present-tense question) | 8 / 144 | 5.6% |
| **Few-shot examples** (two worked examples added to the prompt, one showing a recommendation correctly selected, one showing a correct NONE) | **16 / 144** | **11.1%** |
| Feature tagging alone (each recommendation candidate labelled `[Recommendation]` inline in the numbered list, instruction removed) | 1 / 144 | 0.7% |
| Feature tagging + few-shot combined | 11 / 144 | 7.6% |

Few-shot examples alone produced the highest rate, and adding the inline tag on top of it
made the result worse (16 to 11), not better. Feature tagging alone performed no better
than the original 2-in-288 baseline. The few-shot-only configuration is what shipped;
the tag field was implemented, tested, and removed.

## AI Gateway

Every Workers AI call carries a `cf-aig-gateway-id: default` header on the same endpoint
and token used elsewhere — the whole of the required integration, per spec. Vectorize
calls do not carry it; Vectorize has no gateway of its own.

## Testing reference

```
npm run check:extract       # extraction is stable and page numbers are real
npm run check:figures       # figures are stable and null rather than wrong when unsupported
npm run check:pick          # the live generation path, 48 rows printed, read by hand
npm run check:retrieval     # chunking + reranker sweep, against fixtures/relevance-*.json
npm run check:appraisal     # full pipeline twice — caching, structural invariants
npm run clear:cache         # delete cached appraisals for repeat testing
```

There is no automated pass/fail gate for generation quality. The one that existed
(hand-labelled relevance fixtures scoring individual lines) was retired deliberately:
labels for a task with several equally valid correct answers turn into a target the
moment they're used to score iteration on the same output. What remains is `check:pick`'s
printed output, read end to end by a person before anything ships — the practice that
found every real defect described in this document, and that no fixture-based score did.
