/**
 * Four weeks of delivery-app money for the fictional Harbour & Co, from three
 * places that never agree on their own: the point of sale, the payout statements
 * the apps publish, and the bank feed.
 *
 * Invented and deterministic. The numbers are drawn once from a fixed seed, so the
 * page reads the same today as it did in the screenshot in somebody's inbox; only
 * the dates slide, so the period always ends last week.
 *
 * Deliberately not clean. A reconciliation demo where everything matches proves
 * nothing, and one where only bad things happen proves nothing either. So this set
 * plants problems the rules must find AND near misses the rules must leave alone:
 *
 *   found     full refunds where the commission stayed deducted
 *             a payout statement with no deposit behind it
 *             a deposit that arrived short of its statement
 *             a statement whose total is not the sum of its own orders
 *             two app orders the POS never saw, and one the other way round
 *   ignored   full refunds where the commission WAS reversed
 *             partial refunds
 *             the newest payouts, which are still inside the normal banking lag
 *
 * The self-test checks every one of those by count.
 *
 * Statements here are simplified to subtotal, tax, commission and refunds. Real
 * ones also carry marketing fees, tax on those fees and tips; they reconcile the
 * same way, with more columns.
 */

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Harbour & Co's agreements, as stated for this demo. These are assumptions about a
 * fictional operator, not a description of what any app charges anyone.
 */
export const AGREEMENTS = {
  doordash: { label: "DoorDash", commission: 0.25, paysDaysAfterWeekEnd: 3, bank: "DOORDASH CANADA" },
  ubereats: { label: "Uber Eats", commission: 0.3, paysDaysAfterWeekEnd: 4, bank: "UBER EATS CA" },
  skip: { label: "SkipTheDishes", commission: 0.2, paysDaysAfterWeekEnd: 5, bank: "SKIPTHEDISHES" },
};

export const SITES = [
  { id: "harbour", name: "Harbour Street" },
  { id: "lonsdale", name: "Lonsdale" },
];

const ORDERS_PER_DAY = { doordash: [9, 16], ubereats: [6, 12], skip: [2, 6] };
const TAX = 0.05; // GST on prepared food in BC
const WEEKS = 4;

export function load({ asOf = new Date() } = {}) {
  // Midnight UTC of the given day, so dates do not wobble with the server's clock.
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  // The newest week ended five days ago: its first payouts have landed, its last
  // are still inside the banking lag. That is the state a real Tuesday is in.
  const lastWeekEnd = today - 5 * DAY;
  const firstDay = lastWeekEnd - (WEEKS * 7 - 1) * DAY;

  const rnd = seeded(20261006);
  const orders = [];
  let seq = 0;

  for (let d = 0; d < WEEKS * 7; d += 1) {
    const date = firstDay + d * DAY;
    const week = Math.floor(d / 7);
    for (const site of SITES) {
      for (const [channel, [lo, hi]] of Object.entries(ORDERS_PER_DAY)) {
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        for (let i = 0; i < n; i += 1) {
          seq += 1;
          const subtotalCents = Math.round((1800 + rnd() * 4700) / 5) * 5;
          const taxCents = Math.round(subtotalCents * TAX);
          orders.push({
            id: `${channel.slice(0, 2).toUpperCase()}-${String(700000 + seq * 7)}`,
            channel, site: site.id, date: iso(date), week,
            subtotalCents, taxCents,
            commissionCents: Math.round(subtotalCents * AGREEMENTS[channel].commission),
            refundCents: 0,
            commissionReversedCents: 0,
          });
        }
      }
    }
  }

  // Refunds. Picked by the same seeded draw, so the same orders every time.
  const pick = () => orders[Math.floor(rnd() * orders.length)];
  const used = new Set();
  const pickFresh = (filter = () => true) => {
    for (;;) {
      const o = pick();
      if (!used.has(o.id) && filter(o)) { used.add(o.id); return o; }
    }
  };
  const full = (o) => o.subtotalCents + o.taxCents;

  // Seven full refunds where the commission stayed deducted: the finding.
  for (const ch of ["doordash", "doordash", "doordash", "ubereats", "ubereats", "ubereats", "skip"]) {
    const o = pickFresh((x) => x.channel === ch && x.week < WEEKS - 1);
    o.refundCents = full(o);
    o.refundNote = ["missing items", "order never arrived", "wrong order delivered", "cold on arrival"][Math.floor(rnd() * 4)];
  }
  // Two full refunds where the commission was reversed, as it should read.
  for (const ch of ["doordash", "ubereats"]) {
    const o = pickFresh((x) => x.channel === ch && x.week < WEEKS - 1);
    o.refundCents = full(o);
    o.commissionReversedCents = o.commissionCents;
    o.refundNote = "order never arrived";
  }
  // Four partial refunds: an item missing, not the whole order. Not a finding.
  for (const ch of ["doordash", "ubereats", "skip", "doordash"]) {
    const o = pickFresh((x) => x.channel === ch);
    o.refundCents = Math.round(o.subtotalCents * 0.25 / 5) * 5;
    o.refundNote = "one item missing";
  }

  for (const o of orders) o.netCents = o.subtotalCents + o.taxCents - o.commissionCents + o.commissionReversedCents - o.refundCents;

  // The POS side. Each delivery ticket carries the app's order number, which the
  // tablet integration writes onto it; that number is the join key.
  const appOnly = [pickFresh((x) => x.channel === "ubereats"), pickFresh((x) => x.channel === "doordash")];
  const posTickets = orders
    .filter((o) => !appOnly.includes(o))
    .map((o, i) => ({ ticket: `T${String(40000 + i)}`, site: o.site, channel: o.channel, appOrderId: o.id, date: o.date, subtotalCents: o.subtotalCents }));
  // A ticket rung up for an app order that never reached a statement: cancelled
  // before pickup, most likely, and never voided at the till.
  posTickets.push({ ticket: "T49990", site: "harbour", channel: "skip", appOrderId: "SK-999901", date: iso(lastWeekEnd - 9 * DAY), subtotalCents: 4250 });

  // Payout statements: one per site, per app, per week.
  const payouts = [];
  for (let w = 0; w < WEEKS; w += 1) {
    const weekEnd = firstDay + (w * 7 + 6) * DAY;
    for (const site of SITES) {
      for (const [channel, terms] of Object.entries(AGREEMENTS)) {
        const inWeek = orders.filter((o) => o.week === w && o.site === site.id && o.channel === channel);
        const sum = inWeek.reduce((a, o) => a + o.netCents, 0);
        const paidOn = weekEnd + terms.paysDaysAfterWeekEnd * DAY;
        if (paidOn > today) continue; // not issued yet
        payouts.push({
          id: `${channel.slice(0, 2).toUpperCase()}P-${site.id.slice(0, 3).toUpperCase()}-${iso(weekEnd).replaceAll("-", "")}`,
          channel, site: site.id,
          periodFrom: iso(weekEnd - 6 * DAY), periodTo: iso(weekEnd),
          paidOn: iso(paidOn),
          orderIds: inWeek.map((o) => o.id),
          statedCents: sum,
        });
      }
    }
  }

  // One statement whose printed total is $12.00 more than its own orders add up to.
  const odd = payouts.find((p) => p.channel === "doordash" && p.site === "lonsdale" && p.periodFrom === iso(firstDay));
  odd.statedCents += 1200;

  // The bank feed. Each payout lands one or two days after it is issued, for the
  // amount the statement states, except where noted.
  const deposits = [];
  const missing = payouts.find((p) => p.channel === "skip" && p.site === "lonsdale" && p.periodFrom === iso(firstDay + 7 * DAY));
  const short = payouts.find((p) => p.channel === "ubereats" && p.site === "harbour" && p.periodFrom === iso(firstDay + 14 * DAY));
  payouts.forEach((p, i) => {
    if (p === missing) return;
    const lands = Date.parse(p.paidOn) + (1 + (i % 2)) * DAY;
    if (lands > today) return; // still in transit
    deposits.push({
      id: `BNK-${String(88100 + i)}`,
      date: iso(lands),
      descriptor: `${AGREEMENTS[p.channel].bank} ${p.site === "harbour" ? "HRB" : "LON"}`,
      channel: p.channel,
      site: p.site,
      amountCents: p.statedCents - (p === short ? 3740 : 0),
    });
  });

  return {
    orders,
    posTickets,
    payouts,
    deposits,
    meta: {
      source: "fixtures",
      sourceLabel: "Sample data",
      group: "Harbour & Co",
      sites: SITES,
      periodFrom: iso(firstDay),
      periodTo: iso(lastWeekEnd),
      asOf: iso(today),
      agreements: AGREEMENTS,
    },
  };
}
