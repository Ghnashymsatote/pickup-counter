# Pickup Counter

A self-service snack counter: the customer picks items on a screen, pays by
UPI, and collects the order from a locker. Stock, payments and pickups have to
stay correct when requests arrive at the same moment or out of order.

TypeScript throughout — Express + PostgreSQL on the backend, React (Vite) on
the screen.

---

## Running it

One command, from an empty checkout:

```bash
docker compose up --build
```

| What | Where |
| --- | --- |
| Customer screen | <http://localhost:3001> |
| API | <http://localhost:5001> |
| Health check | <http://localhost:5001/health> |
| PostgreSQL | `localhost:5434` (`pickup_user` / `dev_password` / `pickup_counter`) |

The backend applies `backend/sql/*.sql` on boot (schema, then five seed
products), so an empty volume still produces a working app. Every statement in
those files is idempotent, so restarts are harmless and a restart never resets
stock the counter has already sold.

Ports 5434 and 3001 are deliberately off the defaults so the stack does not
clash with a PostgreSQL or a dev server already running on the machine.

### Running the backend outside Docker

```bash
docker compose up -d db          # just the database
cd backend
cp .env.example .env
npm install
npm run migrate                  # optional; `npm run dev` also migrates
npm run dev
```

### Running the tests

The tests run against a **real PostgreSQL database and a live backend** —
nothing is mocked, because what is being tested (row locks, unique
constraints, transaction boundaries) only exists in the database.

```bash
docker compose up -d             # stack must be running
cd backend
cp .env.example .env             # if you have not already
npm install
npm test
```

28 tests across 5 files. If the stack is not up, the suite fails immediately
with a message saying so rather than 28 connection errors.

Each test creates its own product with a random name and deletes it
afterwards, so tests never compete for seeded stock and can run in any order
or in parallel.

### Sending a webhook by hand

```bash
cd backend

# Pay an order in full (the amount is read from the order, so it matches):
npm run send-webhook -- <order-id>

# Wrong amount -> the order goes to needs_review:
npm run send-webhook -- <order-id> --amount 1

# A failed capture:
npm run send-webhook -- <order-id> --status failed

# Replay: run this twice with the same event id and watch nothing change.
npm run send-webhook -- <order-id> --event evt_demo_1
npm run send-webhook -- <order-id> --event evt_demo_1
```

The script signs the exact bytes it sends with `WEBHOOK_SECRET`, the way the
provider would.

---

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Also returns `serverTime`, so a client can see its own clock drift |
| `GET` | `/products` | Each product with `availableStock` |
| `POST` | `/orders` | `{ items: [{ productId, quantity }] }` → 201 with `expiresInSeconds` |
| `GET` | `/orders/:id` | Current status, items, and `expiresInSeconds` |
| `POST` | `/orders/:id/pickup-claim` | 200 for the winner, 409 for everyone else |
| `POST` | `/payments/webhook` | Requires `X-Signature` |
| `POST` | `/payments/simulate/:orderId` | Stands in for the UPI app; see below |

Errors are always JSON, shaped `{ "error": "CODE", "message": "..." }` —
including malformed JSON and unknown routes, which Express would otherwise
answer with an HTML stack trace.

Money is whole paise in `INTEGER` columns from end to end. Rupees exist only
in `Intl.NumberFormat` at the last moment before display; no float ever
touches an amount.

---

## How correctness is enforced

### Stock is never oversold

A unit is **held** — not sellable to anyone else — when it belongs to either:

- a pending order whose 120-second hold has not run out, or
- a paid order that has not been collected yet.

```
availableStock = stock - held
```

`POST /orders` takes `SELECT ... FOR UPDATE` on the product rows, in `id`
order, *before* counting held units. Concurrent orders for the same product
serialise on that lock, which is what stops the availability check from being
a read-modify-write race; the consistent lock ordering is what stops two
multi-item orders from deadlocking against each other. Either every line of
an order passes or nothing is written, so a rejected order holds nothing.

`stock` itself only ever changes in one place: a successful pickup claim.
`products.stock` carries a `CHECK (stock >= 0)` as a last line of defence, so
a bug in the application would produce a failed transaction rather than
negative stock.

The brief defines available units as "stock minus units held by unpaid
orders". The second term — paid but uncollected — is mine, and it is load
bearing. Because stock is decremented at pickup rather than at payment, a paid
order's units would otherwise appear sellable again the moment its 120 seconds
elapsed, and could be sold to a second customer. There is a test for exactly
that (`holds.test.ts`, "keeps paid-but-uncollected units out of available
stock").

### Expiry is lazy, not swept

There is no background job. An order is expired the instant `expires_at`
passes, because every query that counts held units filters on
`expires_at > clock_timestamp()`. Read paths (`GET /orders/:id`,
`pickup-claim`) then settle the stored status to `expired` so the customer
sees `expired` rather than a stale `pending`.

This was chosen over a sweeper because a sweeper is a second source of truth:
if it falls behind, stock is wrong in the window before it catches up. With
the deadline in the row, there is no window. The cost is that an abandoned
order can sit at `pending` in the table until something reads it, which is
cosmetic — it holds no stock either way.

All times come from `clock_timestamp()`, the database's clock. The backend's
clock is never used for a deadline, so the two cannot disagree.

### Webhooks are safe to repeat

`webhook_events.event_id` is the primary key. The insert happens in the same
transaction as the order update, so either both land or neither does. A replay
loses the insert (`ON CONFLICT DO NOTHING`) and is answered from the outcome
recorded the first time — still `200`, because anything else would make the
provider keep retrying.

Two copies of the same event arriving at the *same instant* also work: they
race for the primary key, one inserts and one replays. There is a test that
fires both concurrently.

A replay carrying the same `event_id` but *different* data is a provider bug,
not a retry, so it is rejected with `409 EVENT_ID_CONFLICT` rather than
applied.

Signature verification is an HMAC-SHA256 over the **raw request body**, not
over a re-serialised copy of the parsed object — re-serialising reorders keys
and changes whitespace, which would make every genuine signature fail. The
comparison is `timingSafeEqual` against a length-checked hex digest.

### Exactly one pickup succeeds

`pickup-claim` takes `SELECT ... FOR UPDATE` on the order row. Two lockers
calling at the same instant both reach the lock; one wins, flips the status to
`claimed` and decrements stock; the other then reads `claimed` and gets
`409 ALREADY_CLAIMED`. The final `UPDATE ... WHERE status = 'paid'` is a
second guard, so even if the lock were somehow lost, stock could not be
decremented twice.

An unpaid order gets `409 PAYMENT_REQUIRED`; an expired one gets
`409 ORDER_EXPIRED`.

### The countdown survives a wrong clock

The counter's clock may be minutes out, so the screen never computes the
deadline from `expiresAt` against its own `Date.now()`. Every order response
carries `expiresInSeconds`, measured by the database clock as the response is
built. The screen anchors that number to `performance.now()` — a monotonic
clock — and displays it minus the time elapsed since. That is immune both to a
badly set clock and to an NTP correction landing mid-countdown. Each poll
re-anchors, which also corrects for timer drift and for time spent with the
tab suspended. See `frontend/src/hook/useHoldCountdown.ts`.

---

## Decisions

### A valid payment that arrives after the hold expired

**It is never auto-fulfilled. The order goes to `needs_review`.**

By the time a late capture lands, those units may already belong to another
customer. The three options were:

1. Honour it anyway — risks handing over stock that has been sold twice,
   which is the one failure this system exists to prevent.
2. Auto-refund — correct for stock, but silently refunding a customer who is
   standing at the counter expecting snacks is worse service than a short
   conversation, and a refund is not reversible if the units turn out to be
   free.
3. Flag it for a human — stock stays correct, the money stays captured and
   fully traceable, and a human decides between handing over and refunding.

I chose 3. At a physical counter there is always a human nearby, the volume of
late payments is tiny, and it is the only option that is never wrong. The
screen tells the customer to speak to the counter instead of leaving them
watching a spinner.

`needs_review` is also where an amount mismatch lands, for the same reason:
money we cannot match to an order is a question for a person, not something to
guess at.

### Stock is decremented at pickup, not at payment

The brief says a successful claim reduces stock permanently, so that is where
the decrement lives. Payment only moves the order from `pending` to `paid`;
the units stay held across that transition and are not released until they are
either collected (stock drops) or the order is expired/reviewed (hold drops).
This keeps a single, unambiguous meaning for `stock`: units physically still
in the machine.

### A failed capture leaves the order pending

The hold stands and the order expires on its own schedule, so a customer whose
first UPI attempt failed can simply try again inside the window instead of
rebuilding their cart.

### Payment simulation

There is no payment provider, so `POST /payments/simulate/:orderId` signs a
capture event for the order's exact total and puts it through the *same*
verification and processing path as a real webhook — the screen's "Pay with
UPI" button calls it. It is gated behind `ENABLE_PAYMENT_SIMULATION`, so it
cannot become a way to mark orders paid for free where real money exists.

### No authentication

Deliberately out of scope per the brief. In reality the webhook endpoint is
authenticated by its HMAC signature, and `pickup-claim` would need a locker
credential — right now any caller who knows an order id can claim it.

---

## Assumptions

- **One order, one product line.** `order_items` has `UNIQUE (order_id,
  product_id)`, and an order naming the same product twice is a `400`. Two
  lines for the same product would make the hold arithmetic ambiguous.
- **No customer identity.** The brief's screen has no login, so no name, phone
  or contact details are collected. An order id is the claim token.
- **Prices are fixed at order time.** `order_items.unit_price_paise` records
  the price charged, so a later price change does not alter an existing order's
  total.
- **Quantity caps.** 100 units per line, 50 lines per order, 64 KB request
  bodies — a self-service counter has no legitimate use for more, and the
  caps bound the cost of a hostile request.
- **Seed data persists.** Seeding uses `ON CONFLICT DO NOTHING` and does not
  reset stock, so `docker compose restart` does not refill the machine. Use
  `docker compose down -v` for a clean slate.
- **The hold is 120 seconds**, configurable through `HOLD_SECONDS`. The tests
  do not wait it out; they move `expires_at` into the past, which is the same
  situation as far as every query is concerned.
- **CORS is open** (`CORS_ORIGIN=*`) for local review convenience. A real
  deployment would name the screen's origin.

---

## What I would do next, with more time

1. **A staff screen for `needs_review`.** Right now that status is correct but
   it needs a human with database access to resolve. The queue, plus a
   refund-or-release action with an audit trail, is the obvious next feature.
2. **An order state machine in one place.** The transitions are correct but
   they are expressed across three services. A single table of
   `(from, event) -> to` would make an illegal transition unrepresentable
   rather than merely untested.
3. **Rate limiting and a request id.** `POST /orders` can be used to hold all
   the stock in the machine for 120 seconds at a time. Per-IP limits plus a
   cap on concurrent pending orders per client would blunt that. A request id
   threaded through the logs would make tracing a disputed order much easier.
4. **Frontend tests.** The countdown logic is the part most worth testing
   (fake timers, a deliberately skewed clock) and it currently has no
   automated coverage — I verified it by hand against a machine clock set
   minutes fast.
5. **Structured logging and metrics.** `console.log` is honest for this size
   but not greppable at volume. Counters for held/expired/reviewed orders
   would show a broken provider integration long before a customer complains.
6. **Timeout and retry on the provider side.** If the provider ever times out
   mid-capture, this system relies on it retrying. A reconciliation job that
   polls the provider for orders stuck pending would close that gap.

---

## Project layout

```
backend/
  sql/                  schema and seed, applied on boot
  src/
    config/             validated env, pg pool, transaction helper
    db/                 migration runner, the shared "held units" rule
    http/               AppError and the single error-to-response boundary
    routes/             thin: parse, delegate, serialise
    services/           all the business rules live here
  scripts/              send-webhook, migrate
  tests/                integration tests against a real database
frontend/
  src/
    lib/api.ts          one fetch wrapper; server messages reach the screen
    hook/               react-query hooks, useHoldCountdown
    pages/              store, checkout, order status
    feature/cart/       cart reducer and context
```

Also see `AI_NOTES.md` for how AI tools were used on this assignment.
