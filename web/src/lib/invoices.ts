// The invoice state machine. This module is the ONLY sanctioned way to
// change an invoice's status: every transition is validated against the
// allowed graph and atomically recorded in the append-only AuditLog.
import { prisma } from "@/lib/db";
import {
  ActorType,
  InvoiceStatus,
  type Prisma,
} from "@/generated/prisma/client";

const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  RECEIVED: [InvoiceStatus.EXTRACTING, InvoiceStatus.FAILED],
  EXTRACTING: [
    InvoiceStatus.NEEDS_REVIEW,
    InvoiceStatus.APPROVED, // auto-approval path (Phase 3 rules)
    InvoiceStatus.FAILED,
  ],
  NEEDS_REVIEW: [InvoiceStatus.APPROVED, InvoiceStatus.REJECTED],
  APPROVED: [InvoiceStatus.SCHEDULED],
  SCHEDULED: [InvoiceStatus.PAID],
  PAID: [],
  REJECTED: [],
  FAILED: [InvoiceStatus.EXTRACTING], // failed invoices may be retried
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: InvoiceStatus,
    public readonly to: InvoiceStatus,
  ) {
    super(`Invalid invoice transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface TransitionInput {
  invoiceId: string;
  to: InvoiceStatus;
  actor: ActorType;
  /** Machine-readable event name, e.g. "EXTRACTION_COMPLETED" */
  action: string;
  /** Human-readable explanation shown in the audit trail */
  reason?: string;
  userId?: string;
  metadata?: Prisma.InputJsonValue;
}

export async function transitionInvoice(input: TransitionInput) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      select: { status: true },
    });

    if (!VALID_TRANSITIONS[invoice.status].includes(input.to)) {
      throw new InvalidTransitionError(invoice.status, input.to);
    }

    const updated = await tx.invoice.update({
      where: { id: input.invoiceId },
      data: { status: input.to },
    });

    await tx.auditLog.create({
      data: {
        invoiceId: input.invoiceId,
        actor: input.actor,
        userId: input.userId,
        action: input.action,
        fromStatus: invoice.status,
        toStatus: input.to,
        reason: input.reason,
        metadata: input.metadata,
      },
    });

    return updated;
  });
}
