// Internal: n8n's Gmail workflow delivers email attachments here.
// The app owns the policy decisions: who may send us invoices (allowlist),
// and whether we've already ingested this message (sourceRef dedup).
// Rejections return 200 with ignored:true — from n8n's perspective the
// delivery succeeded; the *business* chose to decline it.
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ALLOWED_MIME_TYPES,
  createAndDispatchInvoice,
  MAX_FILE_BYTES,
} from "@/lib/dispatch";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";

const ingestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string(),
  data: z.string().min(1), // base64
  sender: z.string().email(),
  subject: z.string().max(500).nullish(),
  messageId: z.string().min(1),
});

async function isAllowedSender(email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const extra = (process.env.INGEST_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(normalized)) return true;
  const vendor = await prisma.vendor.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
  });
  return vendor !== null;
}

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized();

  const parsed = ingestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { fileName, mimeType, data, sender, subject, messageId } = parsed.data;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return Response.json({ ignored: true, reason: `unsupported type ${mimeType}` });
  }

  // Unknown senders are declined outright — an inbox is an open door, and
  // processing unsolicited attachments through an LLM pipeline is how you
  // get prompt-injected or spammed into API bills.
  if (!(await isAllowedSender(sender))) {
    return Response.json({ ignored: true, reason: `sender ${sender} not allowlisted` });
  }

  // Same Gmail message + same attachment already ingested? The poller
  // re-delivering (restart, overlap) must not create a second invoice.
  const existing = await prisma.invoice.findFirst({
    where: { sourceRef: messageId, fileName },
    select: { id: true },
  });
  if (existing) {
    return Response.json({
      ignored: true,
      reason: `message ${messageId} already ingested as ${existing.id}`,
    });
  }

  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_FILE_BYTES) {
    return Response.json({ ignored: true, reason: "file exceeds 10MB" });
  }

  const invoice = await createAndDispatchInvoice({
    source: "EMAIL",
    fileName,
    mimeType,
    bytes,
    sourceRef: messageId,
    receivedVia: `Emailed by ${sender} — "${subject ?? "(no subject)"}" (${fileName}, ${bytes.length} bytes)`,
  });

  return Response.json(
    { id: invoice.id, status: invoice.status },
    { status: 201 },
  );
}
