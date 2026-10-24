# AI notes

## What I used

**Claude Code** (Anthropic's CLI agent, driven from VS Code) for most of this
assignment, in two distinct modes:

- **Writing code I had already decided on.** The schema, the Express routes,
  the React screen, the cart reducer, the webhook signing script. I knew what
  I wanted; it typed faster than I do.
- **Reviewing my own work against the brief.** Late on, I asked it to read the
  brief and the repository together and tell me what was still missing or
  wrong. That pass is where most of the value was — it caught that
  `docker compose up` created no schema at all (the `sql/` files were copied
  into the image but nothing ran them), so a fresh clone would have started
  and then failed on the first request. It also caught that I had never
  returned `expiresInSeconds` from `GET /orders/:id`, which meant the payment
  screen had no countdown.

I did not use it to decide anything. The design calls — where the stock
decrement lives, what happens to a late payment, lazy expiry instead of a
background sweeper, and treating paid-but-uncollected units as held — are
mine, and the reasoning for each is in `README.md`.

## A prompt that worked well

> Read the assignment brief and then the repository. List only the places
> where the code does not do what the brief asks, or where two concurrent
> requests could produce a wrong result. For each, tell me the specific
> interleaving that breaks it. Do not fix anything yet.

Forbidding the fix is the part that made it useful. Asked to "improve the
code", it reformats and adds comments. Asked to name a concrete failing
interleaving and nothing else, it produced a short list where every item was
real, including the missing migration step and the fact that my availability
query counted only pending orders — which, given that stock is decremented at
pickup, would have let a paid order's units be sold a second time once its 120
seconds elapsed. That is now `holds.test.ts`, "keeps paid-but-uncollected
units out of available stock".

## Two things it got wrong

**1. A data-modifying CTE that silently did nothing visible.** For the lazy
expiry on `GET /orders/:id` it wrote:

```sql
WITH settled AS (
  UPDATE orders SET status = 'expired'
  WHERE id = $1 AND status = 'pending' AND expires_at <= clock_timestamp()
  RETURNING id
)
SELECT ... FROM orders WHERE id = $1
```

This looks right and passes a casual manual test. It is wrong: in PostgreSQL
every part of a statement sees the same snapshot, so the `SELECT` reads the
row as it was *before* the `UPDATE` and returns `pending` even though the
write did happen. The customer screen would have shown a stale status for one
whole poll cycle. I caught it because I had written the test first — the
assertion was `expect(status).toBe("expired")` and it came back `pending`. The
fix reads the result back out of the CTE with a `UNION ALL` branch for the
"nothing needed expiring" case.

**2. A rollback that ate its own write.** In `pickup-claim`, the expired
branch updated the order to `expired` and then threw an `AppError` to produce
the 409 — from *inside* the transaction wrapper. The throw rolled the
transaction back, so the status update was discarded and the order stayed
`pending` forever. Same symptom, found by the same kind of assertion. The
claim path now returns a typed outcome from the transaction and maps it to an
HTTP error *after* the commit.

Both bugs are the same lesson, and it is why I wrote the concurrency and
expiry tests before trusting any of this: AI-written database code is
plausible at a glance and the failure modes are invisible without a real
PostgreSQL behind the assertions. Reading the code was not enough to find
either one. A test that asserted on the stored status was.

## Honest summary

The volume of code here is larger than I would have written by hand in the
time, and the comments explaining *why* each lock and constraint exists are
mostly mine, dictated and then tightened. The tests are where I spent my own
judgement, because they are the only thing that distinguishes code that looks
concurrent-safe from code that is.
