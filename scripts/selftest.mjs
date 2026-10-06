#!/usr/bin/env node
/**
 * The claims this demo makes about itself, checked.
 *
 * A reconciliation is only worth anything if it can tell a problem from a near
 * miss. So the near misses come first: a partial refund, a refund handled
 * properly, a payout still in the banking lag, a deposit one cent off. If any of
 * those ever shows up as a finding, the page is crying wolf and every other number
 * on it stops being believed.
 */
import { readFileSync } from "node:fs";
import { reconcile, refundedCommission, matchDeposits, RULES } from "../lib/shape.js";
import * as fixtures from "../lib/sources/fixtures.js";
import handler from "../api/recon.js";

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}`); failed += 1; }
};

const order = (x = {}) => ({ subtotalCents: 4000, taxCents: 200, commissionCents: 1000, refundCents: 0, commissionReversedCents: 0, ...x });
const payout = (x = {}) => ({ id: "P1", channel: "doordash", site: "a", paidOn: "2026-09-10", statedCents: 100000, ...x });
const deposit = (x = {}) => ({ id: "D1", channel: "doordash", site: "a", date: "2026-09-11", amountCents: 100000, ...x });
const status = (ps, ds, asOf = "2026-10-01") => matchDeposits(ps, ds, asOf).byPayout.get("P1");

console.log("near misses are not findings");
check("an order with no refund", refundedCommission(order()) === 0);
check("a partial refund", refundedCommission(order({ refundCents: 1000 })) === 0);
check("a full refund with the commission reversed", refundedCommission(order({ refundCents: 4200, commissionReversedCents: 1000 })) === 0);
check("a payout two days old with no deposit yet is in transit, not missing", status([payout({ paidOn: "2026-09-29" })], []).status === "in-transit");
check("a deposit one cent off is a match", status([payout()], [deposit({ amountCents: 99999 })]).status === "matched");
check("a deposit from another app is not this payout's",
  status([payout({ paidOn: "2026-09-29" })], [deposit({ channel: "skip", date: "2026-09-30" })]).status === "in-transit");
check("a deposit from another site is not this payout's",
  status([payout({ paidOn: "2026-09-29" })], [deposit({ site: "b", date: "2026-09-30" })]).status === "in-transit");
check("a deposit before the payout was issued is not its match",
  status([payout()], [deposit({ date: "2026-09-09" })]).status === "missing");
check("a short deposit cannot take the exact one that belongs to its neighbour", (() => {
  const ps = [payout({ id: "P1", statedCents: 50000 }), payout({ id: "P2", statedCents: 60000 })];
  const ds = [deposit({ id: "D1", amountCents: 60000 }), deposit({ id: "D2", amountCents: 49000 })];
  const m = matchDeposits(ps, ds, "2026-10-01").byPayout;
  return m.get("P2").status === "matched" && m.get("P1").status === "different" && m.get("P1").differenceCents === -1000;
})());

console.log("\nreal problems are findings");
check("a full refund with the commission kept", refundedCommission(order({ refundCents: 4200 })) === 1000);
check("a full refund with half the commission reversed keeps the other half", refundedCommission(order({ refundCents: 4200, commissionReversedCents: 500 })) === 500);
check("a payout past the lag with no deposit is missing", status([payout()], []).status === "missing");
check("the lag is the stated rule, not a guess", status([payout({ paidOn: "2026-09-26" })], [], "2026-09-30").status === "in-transit"
  && status([payout({ paidOn: "2026-09-25" })], [], "2026-09-30").status === "missing" && RULES.depositLagDays === 4);
check("a short deposit is different, with the difference stated", (() => {
  const m = status([payout()], [deposit({ amountCents: 96260 })]);
  return m.status === "different" && m.differenceCents === -3740;
})());

console.log("\nthe sample data finds exactly what was planted");
const data = fixtures.load({ asOf: new Date("2026-10-06T12:00:00Z") });
const r = reconcile(data);
const kinds = (k) => r.aside.filter((a) => a.kind === k).length;
check("seven refunded orders with commission kept", r.findings.refundedCommission.items.length === 7);
check("the two properly reversed refunds are not among them",
  data.orders.filter((o) => o.commissionReversedCents > 0).every((o) => !r.findings.refundedCommission.items.some((i) => i.orderId === o.id)));
check("no partial refund is among them",
  r.findings.refundedCommission.items.every((i) => {
    const o = data.orders.find((x) => x.id === i.orderId);
    return o.refundCents >= o.subtotalCents + o.taxCents;
  }));
check("one payout missing", r.findings.missingPayouts.items.length === 1 && r.findings.missingPayouts.items[0].channel === "skip");
check("one deposit short by $37.40", r.findings.shortDeposits.items.length === 1 && r.findings.shortDeposits.totalCents === 3740);
check("one statement that does not add up, by $12.00", kinds("statement-does-not-add-up") === 1
  && r.aside.find((a) => a.kind === "statement-does-not-add-up").amountCents === 1200);
check("two orders on a statement only", kinds("app-only") === 2);
check("one ticket on the POS only", kinds("pos-only") === 1);
check("the newest payouts are in transit, not missing", kinds("in-transit") >= 1
  && r.findings.missingPayouts.items.every((m) => m.overdueDays > 0));
check("no stray deposits", kinds("deposit-without-statement") === 0);

console.log("\nthe totals are the sum of their rows");
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
check("refund total is the sum of its rows", r.findings.refundedCommission.totalCents === sum(r.findings.refundedCommission.items, (i) => i.commissionKeptCents));
check("by-app orders add up to all orders", sum(r.channels, (c) => c.orders) === data.orders.length);
check("statements say = in the bank + in transit + missing + short",
  r.totals.statedCents === r.totals.depositedCents + r.totals.inTransitCents + r.findings.missingPayouts.totalCents + r.findings.shortDeposits.totalCents);
check("to chase is the three findings and nothing else",
  r.totals.toLookAtCents === r.findings.refundedCommission.totalCents + r.findings.missingPayouts.totalCents + r.findings.shortDeposits.totalCents);
check("set-aside rows are not in any finding total", (() => {
  const ids = new Set(r.aside.map((a) => a.ref));
  return r.findings.refundedCommission.items.every((i) => !ids.has(i.orderId))
    && r.findings.missingPayouts.items.every((i) => !ids.has(i.payoutId));
})());

console.log("\nit is deterministic");
const again = reconcile(fixtures.load({ asOf: new Date("2026-10-06T12:00:00Z") }));
check("the same day gives the same page", JSON.stringify(again) === JSON.stringify(r));
const later = reconcile(fixtures.load({ asOf: new Date("2026-11-20T12:00:00Z") }));
check("another day slides the dates and keeps the findings",
  later.findings.refundedCommission.totalCents === r.findings.refundedCommission.totalCents
  && later.findings.shortDeposits.totalCents === r.findings.shortDeposits.totalCents
  && later.findings.missingPayouts.items.length === 1 && later.periodTo !== r.periodTo);

console.log("\nthe endpoint");
let out;
await handler({ method: "GET", query: {} }, { setHeader() {}, status: (code) => ({ end: (b) => { out = { code, body: JSON.parse(b) }; } }) });
check("answers 200 with findings", out.code === 200 && out.body.findings.refundedCommission.items.length === 7);

console.log("\nno model, no network, no storage in the request path");
const files = ["api/recon.js", "lib/shape.js", "lib/sources/fixtures.js"];
const src = files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
check("no network calls", !/fetch\(|https?:\/\/api\.|anthropic/i.test(src));
check("no file writes or databases", !/writeFile|node:fs|supabase|redis|@vercel\/(kv|blob|postgres)/i.test(src));
check("no randomness that is not seeded", !/Math\.random/.test(src));

console.log("\nthe words");
const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("no em dashes anywhere a visitor reads", ![page, app, src, JSON.stringify(r)].some((s) => s.includes("\u2014")));
check("the page says the data is invented", /fictional/i.test(page) && /not a claim about any app/i.test(page));
check("Harbour & Co is the operator", r.group === "Harbour & Co");

console.log(failed ? `\n${failed} failure(s)` : "\nall passed");
process.exit(failed ? 1 : 0);
