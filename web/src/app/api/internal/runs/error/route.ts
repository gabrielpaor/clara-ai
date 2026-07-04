// Called by the n8n Error Workflow whenever ANY workflow execution crashes.
// Records the failure as a WorkflowRun and alerts the admin — this is how
// a silent 2 AM crash becomes a morning email instead of a mystery.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";
import { notifySystemAlert } from "@/lib/notify";

const errorReportSchema = z.object({
  workflowName: z.string().min(1),
  executionId: z.string().optional(),
  error: z.string().min(1),
  lastNode: z.string().optional(),
});

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized();

  const parsed = errorReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload" }, { status: 422 });
  }
  const { workflowName, executionId, error, lastNode } = parsed.data;

  await prisma.workflowRun.create({
    data: {
      workflowName,
      n8nExecutionId: executionId,
      status: "FAILED",
      error: `${lastNode ? `[${lastNode}] ` : ""}${error}`.slice(0, 1000),
      finishedAt: new Date(),
    },
  });

  // Loop guard: if the NOTIFICATION workflow is what crashed, emailing
  // about it would crash again and re-trigger this endpoint forever.
  // Its failures are recorded above and surface on the health panel.
  if (!workflowName.toLowerCase().includes("notification")) {
    notifySystemAlert(
      `Workflow failed: ${workflowName}`,
      [
        `<p>n8n workflow <strong>${workflowName}</strong> crashed.</p>`,
        lastNode ? `<p>Failed node: <strong>${lastNode}</strong></p>` : "",
        `<p>${error.slice(0, 500)}</p>`,
        executionId
          ? `<p>Execution id ${executionId} — open n8n → Executions for the full node-by-node trace.</p>`
          : "",
      ].join("\n"),
    );
  }

  return Response.json({ ok: true });
}
