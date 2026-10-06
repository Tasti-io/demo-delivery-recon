/**
 * Three sources that should agree, and the one function that checks whether they do.
 *
 *   POS tickets        what the restaurant rang up for each app order
 *   payout statements  what each app says it is paying, order by order
 *   bank deposits      what actually arrived
 *
 * Everything here is ordinary arithmetic and exact matching. There is no model in
 * this path and no estimate anywhere: every dollar on the page is a sum of rows
 * the visitor can expand and read.
 *
 * Three findings, because they are the three a person doing this by hand finds
 * last, if at all:
 *
 *   1. Commission still deducted on an order that was refunded in full.
 *   2. A payout statement with no deposit behind it, past the normal banking lag.
 *   3. A deposit that arrived, but for less than its statement says.
 *
 * Anything that does not fit cleanly (an order on one side only, a statement that
 * does not add up to itself, a payout still inside the lag, a deposit with no
 * statement) goes to a visible "set aside" list, never into a finding total. A
 * reconciliation that quietly drops the rows it cannot place is a reconciliation
 * that agrees with itself and nobody else.
 */

/** Tunables, in one place, so they are arguable instead of buried. */
export const RULES = {
  // A payout is expected in the bank within this many days of being issued. Past
  // it, a missing deposit is a finding; inside it, it is simply in transit.
  depositLagDays: 4,
  // How far after the payout date a deposit may land and still be its match.
  depositWindowDays: 6,
  // Rounding tolerance between a statement and a deposit, in cents.
  toleranceCents: 1,
};

const DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const on = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** Finding 1: the order was refunded in full and the commission was not given back. */
export function refundedCommission(order) {
  const fullRefund = order.refundCents >= order.subtotalCents + order.taxCents;
  const kept = order.commissionCents - order.commissionReversedCents;
  return fullRefund && kept > 0 ? kept : 0;
}

/**
 * Match payouts to deposits. Exact matches first, across everything, so a short
 * deposit can never steal the deposit that belongs to a neighbouring payout. Then
 * whatever is left, by app, site and date window.
 */
export function matchDeposits(payouts, deposits, asOf) {
  const free = new Set(deposits.map((d) => d.id));
  const byId = new Map(deposits.map((d) => [d.id, d]));
  const result = new Map();

  const candidates = (p) =>
    deposits.filter((d) =>
      free.has(d.id) && d.channel === p.channel && d.site === p.site &&
      days(p.paidOn, d.date) >= 0 && days(p.paidOn, d.date) <= RULES.depositWindowDays);

  for (const p of payouts) {
    const exact = candidates(p).find((d) => Math.abs(d.amountCents - p.statedCents) <= RULES.toleranceCents);
    if (exact) { free.delete(exact.id); result.set(p.id, { status: "matched", deposit: exact }); }
  }
  for (const p of payouts) {
    if (result.has(p.id)) continue;
    const near = candidates(p).sort((a, b) => days(p.paidOn, a.date) - days(p.paidOn, b.date))[0];
    if (near) {
      free.delete(near.id);
      result.set(p.id, { status: "different", deposit: near, differenceCents: near.amountCents - p.statedCents });
    } else if (days(p.paidOn, asOf) > RULES.depositLagDays) {
      result.set(p.id, { status: "missing", overdueDays: days(p.paidOn, asOf) - RULES.depositLagDays });
    } else {
      result.set(p.id, { status: "in-transit" });
    }
  }

  return { byPayout: result, unclaimed: [...free].map((id) => byId.get(id)) };
}

export function reconcile({ orders, posTickets, payouts, deposits, meta }) {
  const label = (ch) => meta.agreements[ch].label;
  const siteName = (id) => meta.sites.find((s) => s.id === id)?.name ?? id;
  const aside = [];

  // Orders against tickets, by the app's order number.
  const tickets = new Map(posTickets.map((t) => [t.appOrderId, t]));
  const onStatement = new Set(payouts.flatMap((p) => p.orderIds));
  for (const o of orders) {
    if (!tickets.has(o.id)) {
      aside.push({ kind: "app-only", channel: o.channel, ref: o.id, amountCents: o.subtotalCents,
        text: `${label(o.channel)} order ${o.id} on ${on(o.date)} (${siteName(o.site)}) is on the statement but was never rung up at the POS` });
    }
  }
  for (const t of posTickets) {
    if (!orders.some((o) => o.id === t.appOrderId) || !onStatement.has(t.appOrderId)) {
      aside.push({ kind: "pos-only", channel: t.channel, ref: t.ticket, amountCents: t.subtotalCents,
        text: `POS ticket ${t.ticket} on ${on(t.date)} (${siteName(t.site)}) names ${label(t.channel)} order ${t.appOrderId}, which is on no statement` });
    }
  }

  // Each statement against its own orders. The bank pays what the statement
  // states, so a statement that does not add up is not caught by the deposit match.
  const orderById = new Map(orders.map((o) => [o.id, o]));
  for (const p of payouts) {
    const own = sum(p.orderIds, (id) => orderById.get(id)?.netCents ?? 0);
    if (Math.abs(own - p.statedCents) > RULES.toleranceCents) {
      aside.push({ kind: "statement-does-not-add-up", channel: p.channel, ref: p.id, amountCents: p.statedCents - own,
        text: `${label(p.channel)} statement ${p.id} states ${fmt(p.statedCents)}, but its own orders net to ${fmt(own)}` });
    }
  }

  // Finding 1.
  const refunds = orders
    .map((o) => ({ o, kept: refundedCommission(o) }))
    .filter((r) => r.kept > 0)
    .map(({ o, kept }) => ({
      channel: o.channel, channelLabel: label(o.channel), site: siteName(o.site),
      orderId: o.id, date: o.date, refundedCents: o.refundCents, commissionKeptCents: kept, note: o.refundNote ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Findings 2 and 3.
  const { byPayout, unclaimed } = matchDeposits(payouts, deposits, meta.asOf);
  const missing = [];
  const different = [];
  for (const p of payouts) {
    const m = byPayout.get(p.id);
    const row = { channel: p.channel, channelLabel: label(p.channel), site: siteName(p.site), payoutId: p.id,
      periodFrom: p.periodFrom, periodTo: p.periodTo, paidOn: p.paidOn, statedCents: p.statedCents };
    if (m.status === "missing") missing.push({ ...row, overdueDays: m.overdueDays });
    if (m.status === "different") different.push({ ...row, depositId: m.deposit.id, depositDate: m.deposit.date, depositedCents: m.deposit.amountCents, differenceCents: m.differenceCents });
    if (m.status === "in-transit") {
      aside.push({ kind: "in-transit", channel: p.channel, ref: p.id, amountCents: p.statedCents,
        text: `${label(p.channel)} payout ${p.id} (${siteName(p.site)}) was issued ${on(p.paidOn)} and is still inside the normal ${RULES.depositLagDays} day lag` });
    }
  }
  for (const d of unclaimed) {
    aside.push({ kind: "deposit-without-statement", channel: d.channel, ref: d.id, amountCents: d.amountCents,
      text: `Deposit ${d.id} of ${fmt(d.amountCents)} on ${on(d.date)} (${d.descriptor}) matches no statement` });
  }

  // The by-app grid. Every column is a plain sum over rows shown elsewhere.
  const channels = Object.keys(meta.agreements).map((ch) => {
    const os = orders.filter((o) => o.channel === ch);
    const ps = payouts.filter((p) => p.channel === ch);
    const ds = ps.map((p) => byPayout.get(p.id)).filter((m) => m.deposit).map((m) => m.deposit);
    return {
      channel: ch, label: label(ch), commissionRate: meta.agreements[ch].commission,
      orders: os.length,
      subtotalCents: sum(os, (o) => o.subtotalCents),
      commissionCents: sum(os, (o) => o.commissionCents - o.commissionReversedCents),
      refundsCents: sum(os, (o) => o.refundCents),
      statedCents: sum(ps, (p) => p.statedCents),
      depositedCents: sum(ds, (d) => d.amountCents),
      inTransitCents: sum(ps.filter((p) => byPayout.get(p.id).status === "in-transit"), (p) => p.statedCents),
      payouts: ps.length,
    };
  });

  const findings = {
    refundedCommission: { items: refunds, totalCents: sum(refunds, (r) => r.commissionKeptCents) },
    missingPayouts: { items: missing, totalCents: sum(missing, (r) => r.statedCents) },
    shortDeposits: { items: different, totalCents: sum(different, (r) => -r.differenceCents) },
  };

  return {
    ...meta,
    rules: RULES,
    findings,
    channels,
    aside,
    totals: {
      orders: orders.length,
      subtotalCents: sum(channels, (c) => c.subtotalCents),
      statedCents: sum(channels, (c) => c.statedCents),
      depositedCents: sum(channels, (c) => c.depositedCents),
      inTransitCents: sum(channels, (c) => c.inTransitCents),
      payouts: payouts.length,
      deposits: deposits.length,
      toLookAtCents: findings.refundedCommission.totalCents + findings.missingPayouts.totalCents + findings.shortDeposits.totalCents,
    },
  };
}

function fmt(c) {
  return `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
