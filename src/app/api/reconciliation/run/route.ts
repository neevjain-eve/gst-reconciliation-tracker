import { apiRoute, parseJson } from "@/lib/api";
import { runReconciliation } from "@/lib/reconcile/run";
import { runSchema } from "@/lib/schemas";

export const maxDuration = 60;

export const POST = apiRoute(async (req, ctx) => {
  const input = await parseJson(req, runSchema);
  const { runId, stats } = await runReconciliation({ orgId: ctx.orgId, userId: ctx.userId }, input);
  return { runId, stats };
});
