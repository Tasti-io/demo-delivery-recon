/**
 * GET /api/recon: the reconciliation as JSON.
 *
 * No model in this path and no third party: fixtures in, arithmetic out. An open
 * demo link therefore costs nothing per visitor and cannot break because some other
 * service is down. On a real account the three sources are the POS API, the payout
 * reports each app lets you download, and the bank feed; reconcile() does not care
 * which, because it only ever sees rows.
 */
import { reconcile } from "../lib/shape.js";
import * as fixtures from "../lib/sources/fixtures.js";

export default async function handler(req, res) {
  const data = fixtures.load({});
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).end(JSON.stringify(reconcile(data)));
}
