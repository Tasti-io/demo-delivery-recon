/**
 * The page: fetch the reconciliation, lay it out. No arithmetic beyond formatting;
 * every figure comes from lib/shape.js, which the self-test checks.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (c) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (c) => `$${Math.round(c / 100).toLocaleString("en-CA")}`;
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

/* ---------- tabs ---------- */

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab(id) {
  for (const t of tabs) {
    const on = t.id === id;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}
for (const t of tabs) t.addEventListener("click", () => showTab(t.id));
document.addEventListener("keydown", (e) => {
  if (!tabs.includes(document.activeElement)) return;
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = tabs[(tabs.indexOf(document.activeElement) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  showTab(next.id);
});

/* ---------- the check ---------- */

const KIND = {
  "app-only": ["on statement only", true],
  "pos-only": ["on POS only", true],
  "statement-does-not-add-up": ["statement does not add up", true],
  "deposit-without-statement": ["deposit with no statement", true],
  "in-transit": ["in transit", false],
};

function render(d) {
  const f = d.findings;
  const n = (k) => f[k].items.length;

  const finding = (title, total, line, head, rows) => `
    <div class="find">
      <div class="find-top"><span class="find-name">${title}</span><span class="find-money">${money(total)}</span></div>
      <p class="find-line">${line}</p>
      ${rows.length ? `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : ""}
    </div>`;

  const refunds = finding(
    "Commission kept on orders refunded in full",
    f.refundedCommission.totalCents,
    `${n("refundedCommission")} orders were refunded to the customer in full, and the commission on each stayed deducted. The restaurant gave back the whole sale and still paid for it. Each is listed with its order number, ready to raise.`,
    `<th>Date</th><th>App</th><th class="hide-sm">Site</th><th>Order</th><th class="hide-sm">Reason given</th><th class="num">Refunded</th><th class="num">Commission kept</th>`,
    f.refundedCommission.items.map((r) => `<tr><td>${day(r.date)}</td><td>${esc(r.channelLabel)}</td><td class="hide-sm">${esc(r.site)}</td><td class="code">${esc(r.orderId)}</td><td class="hide-sm muted">${esc(r.note ?? "")}</td><td class="num">${money(r.refundedCents)}</td><td class="num warn">${money(r.commissionKeptCents)}</td></tr>`),
  );

  const missing = finding(
    "Payouts that did not arrive",
    f.missingPayouts.totalCents,
    n("missingPayouts")
      ? `A statement was issued and no matching deposit has landed, ${d.rules.depositLagDays} days being the normal lag. Often a hold, a reserve or a changed bank detail, and the kind of thing nobody notices for a month.`
      : "Every statement past the normal lag has a deposit behind it.",
    `<th>App</th><th class="hide-sm">Site</th><th>Statement</th><th class="hide-sm">Period</th><th>Issued</th><th class="num">Stated</th><th class="num">Overdue</th>`,
    f.missingPayouts.items.map((r) => `<tr><td>${esc(r.channelLabel)}</td><td class="hide-sm">${esc(r.site)}</td><td class="code">${esc(r.payoutId)}</td><td class="hide-sm">${day(r.periodFrom)} to ${day(r.periodTo)}</td><td>${day(r.paidOn)}</td><td class="num warn">${money(r.statedCents)}</td><td class="num">${r.overdueDays} days</td></tr>`),
  );

  const short = finding(
    "Deposits short of their statement",
    f.shortDeposits.totalCents,
    n("shortDeposits")
      ? "The money arrived, but less of it than the statement says was sent."
      : "Every deposit that arrived matches its statement to the cent.",
    `<th>App</th><th class="hide-sm">Site</th><th>Statement</th><th class="num">Statement says</th><th class="num">Bank received</th><th class="num">Difference</th>`,
    f.shortDeposits.items.map((r) => `<tr><td>${esc(r.channelLabel)}</td><td class="hide-sm">${esc(r.site)}</td><td class="code">${esc(r.payoutId)}</td><td class="num">${money(r.statedCents)}</td><td class="num">${money(r.depositedCents)} <span class="muted hide-sm">on ${day(r.depositDate)}</span></td><td class="num warn">${money(r.differenceCents)}</td></tr>`),
  );

  const t = d.totals;
  const grid = `
    <div class="grid-wrap">
      <h3>By app, for the whole period</h3>
      <p>Commission at the rates in Harbour &amp; Co's agreements, as stated for this demo. Every column is a sum of rows used above.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>App</th><th class="num">Orders</th><th class="num hide-sm">Sales</th><th class="num hide-sm">Commission</th><th class="num hide-sm">Refunds</th><th class="num">Statements say</th><th class="num">In the bank</th><th class="num">In transit</th></tr></thead>
        <tbody>${d.channels.map((c) => `<tr><td>${esc(c.label)} <span class="muted">${Math.round(c.commissionRate * 100)}%</span></td><td class="num">${c.orders}</td><td class="num hide-sm">${whole(c.subtotalCents)}</td><td class="num hide-sm">${whole(c.commissionCents)}</td><td class="num hide-sm">${whole(c.refundsCents)}</td><td class="num">${money(c.statedCents)}</td><td class="num">${money(c.depositedCents)}</td><td class="num muted">${c.inTransitCents ? money(c.inTransitCents) : ""}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>All apps</td><td class="num">${t.orders}</td><td class="num hide-sm">${whole(t.subtotalCents)}</td><td class="num hide-sm"></td><td class="num hide-sm"></td><td class="num">${money(t.statedCents)}</td><td class="num">${money(t.depositedCents)}</td><td class="num muted">${money(t.inTransitCents)}</td></tr></tfoot>
      </table></div>
    </div>`;

  const doubts = d.aside.filter((a) => KIND[a.kind]?.[1]);
  const transit = d.aside.filter((a) => !KIND[a.kind]?.[1]);
  const li = (a) => `<li><span class="kind ${KIND[a.kind]?.[1] ? "doubt" : ""}">${esc(KIND[a.kind]?.[0] ?? a.kind)}</span><span>${esc(a.text)}.</span></li>`;
  const aside = `
    <div class="aside">
      <h3>Set aside, ${doubts.length}</h3>
      <p>Rows that do not fit cleanly. None of them is counted in the totals above; each needs a person to look once.</p>
      <ul>${doubts.map(li).join("")}</ul>
      ${transit.length ? `<h3 style="margin-top:18px">Still in transit, ${transit.length}</h3>
      <p>Issued inside the normal ${d.rules.depositLagDays} day lag. Nothing to do yet; they become a finding only if they are still missing after it.</p>
      <ul>${transit.map(li).join("")}</ul>` : ""}
    </div>`;

  $("sheet").innerHTML = `
    <div class="sheet-head"><h2>${esc(d.group)}, ${d.sites.length} sites, three apps</h2><span class="stamp">${esc(d.sourceLabel.toLowerCase())} &middot; ${day(d.periodFrom)} to ${day(d.periodTo)}</span></div>
    <div class="headline">
      Four weeks, ${t.orders.toLocaleString("en-CA")} delivery orders, ${t.payouts} payout statements, ${t.deposits} deposits.
      <b class="flag">${money(t.toLookAtCents)} to chase</b>, in three kinds. ${d.aside.filter((a) => KIND[a.kind]?.[1]).length} rows set aside for a person to look at, and ${d.aside.filter((a) => !KIND[a.kind]?.[1]).length} payouts still in transit.
    </div>
    <div class="tiles">
      <div class="tile"><span>Commission on refunds</span><b>${money(f.refundedCommission.totalCents)}</b><small>${n("refundedCommission")} orders</small></div>
      <div class="tile"><span>Payouts not arrived</span><b>${money(f.missingPayouts.totalCents)}</b><small>${n("missingPayouts")} statement${n("missingPayouts") === 1 ? "" : "s"}</small></div>
      <div class="tile"><span>Deposits short</span><b>${money(f.shortDeposits.totalCents)}</b><small>${n("shortDeposits")} deposit${n("shortDeposits") === 1 ? "" : "s"}</small></div>
    </div>
    ${refunds}${missing}${short}${grid}${aside}`;
}

fetch("/api/recon")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then(render)
  .catch((err) => { $("sheet").innerHTML = `<div class="loading">The reconciliation could not load (${esc(err.message)}). Reload to try again.</div>`; });
