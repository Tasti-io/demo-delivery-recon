# Delivery reconciliation

Live at **[delivery.tasti.io](https://delivery.tasti.io)**. Part of the
[Tasti.io demos](https://demo.tasti.io).

DoorDash, Uber Eats and SkipTheDishes each send a payout statement. The point of
sale knows what was ordered, the bank knows what arrived, and nobody puts the
three side by side. This does, order by order, for four weeks of a two-site
group, and lists every row behind every dollar it asks you to chase.

## The one rule

**Every dollar on the page is a sum of rows you can read. No model, no estimate.**

`lib/shape.js` is ordinary arithmetic and exact matching over three sources:

- POS tickets: what the restaurant rang up for each app order
- payout statements: what each app says it is paying, order by order
- bank deposits: what actually arrived

It reports three findings, because they are the three a person reconciling by
hand finds last, if at all:

1. Commission still deducted on an order that was refunded in full.
2. A payout statement with no deposit behind it, past the normal banking lag.
3. A deposit that arrived, but for less than its statement says.

Anything that does not fit cleanly goes to a visible **set aside** list, never
into a finding total: an order on one side only, a statement whose printed total
is not the sum of its own orders, a payout still inside the lag, a deposit with no
statement. A reconciliation that quietly drops the rows it cannot place agrees
with itself and nobody else.

Two matching choices are deliberate:

- Statements are checked against their own orders, not only against the bank.
  The bank pays what the statement states, so a statement that is wrong about
  its own orders is never caught by looking at deposits.
- Deposits are matched exact amounts first, across everything, and only then
  by app, site and date window. A short deposit therefore cannot take the
  deposit that belongs to the payout next to it.

The tunables (`depositLagDays`, `depositWindowDays`, `toleranceCents`) sit in one
`RULES` object at the top of `lib/shape.js`, so they are arguable instead of
buried.

## How it stays correct

The demo has to tell a problem from a near miss, or the page cries wolf and stops
being believed. So the sample data plants both, and the self-test checks each by
count:

- **Found:** full refunds where the commission stayed deducted, a payout with no
  deposit, a deposit short of its statement, a statement that does not add up,
  two app orders the POS never saw and one ticket the other way round.
- **Left alone:** full refunds where the commission was reversed, partial
  refunds, the newest payouts still inside the banking lag, a deposit one cent off.

The self-test also checks that the totals are the sums of their rows (what the
statements say equals what is in the bank plus in transit plus missing plus
short), that the same day always gives the same page, and that the request path
contains no network calls, no storage and no unseeded randomness.

**What is simulated.** Harbour & Co (see
[harbour-data](https://github.com/Tasti-io/harbour-data)) and every number here
are invented. `lib/sources/fixtures.js` generates four weeks of orders, tickets,
statements and deposits from a fixed seed; only the dates slide, so the period
always ends last week. The app names are real, but the commission rates are
assumptions stated for a fictional operator, not a description of what any app
charges anyone. There is no connection to any delivery app, POS or bank.
Statements are simplified to subtotal, tax, commission and refunds; real ones
also carry marketing fees, tax on those fees and tips, and reconcile the same way
with more columns.

On a real account the three sources would be the POS API, the payout reports
each app lets a restaurant download, and the bank feed. `reconcile()` does not
care which, because it only ever sees rows.

## Layout

```
api/recon.js             Vercel function: load the data, reconcile, respond
lib/shape.js             matching rules, the three findings, the set-aside list
lib/sources/fixtures.js  four weeks of seeded sample data with planted problems
public/index.html        the page: the check, and how it works
public/app.js            fetches the reconciliation and lays it out, no arithmetic
scripts/dev.mjs          local server using the same handler
scripts/selftest.mjs     38 checks, no network
```

## Run

```bash
npm run check   # self-test, no network or API key needed
npm run dev     # local server on http://localhost:3040
```

No npm dependencies.
