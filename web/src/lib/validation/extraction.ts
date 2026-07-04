// Validation for what n8n reports back after the LLM extraction step.
//
// The LLM's output is untrusted input, exactly like a user's form submit:
// Gemini is *asked* for this shape (via responseSchema), but the app must
// verify independently — models occasionally return out-of-range values,
// and the n8n workflow itself could have a bug. Zod at the boundary is
// the second half of "structured outputs".
import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .nullable();

/** A money amount as extracted — validated finite and non-negative. */
const money = z.number().finite().nonnegative().nullable();

export const extractedFieldsSchema = z.object({
  vendorName: z.string().min(1).nullable(),
  invoiceNumber: z.string().min(1).nullable(),
  invoiceDate: isoDate,
  dueDate: isoDate,
  currency: z.string().length(3).toUpperCase().nullable(),
  subtotal: money,
  tax: money,
  total: money,
});

export const extractionReportSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("success"),
    data: extractedFieldsSchema,
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()).default([]),
    // 768-dim embedding of the canonical invoice text, computed in n8n.
    // Nullable: an embedding failure should not sink the whole extraction.
    embedding: z.array(z.number()).length(768).nullable().optional(),
    // n8n execution id — links the WorkflowRun record to n8n's own log.
    n8nExecutionId: z.string().optional(),
  }),
  z.object({
    outcome: z.literal("failure"),
    error: z.string().min(1),
    n8nExecutionId: z.string().optional(),
  }),
]);

export type ExtractedFields = z.infer<typeof extractedFieldsSchema>;
export type ExtractionReport = z.infer<typeof extractionReportSchema>;
