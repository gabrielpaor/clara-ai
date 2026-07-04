// Invoice file storage. Local disk for development; the interface is
// deliberately narrow (save/read by relative path) so swapping in S3 or
// Supabase Storage later only touches this file.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "invoices");

function sanitizeFileName(fileName: string): string {
  // basename strips directory components; the regex strips anything that
  // isn't a safe filename character — defends against path traversal
  // through user-controlled upload names.
  return path.basename(fileName).replace(/[^\w.\-]+/g, "_");
}

/** Saves the file and returns the relative storagePath persisted on the Invoice row. */
export async function saveInvoiceFile(
  invoiceId: string,
  fileName: string,
  data: Buffer,
): Promise<string> {
  const relativePath = path.join(invoiceId, sanitizeFileName(fileName));
  const absolutePath = path.join(STORAGE_ROOT, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
  return relativePath;
}

export async function readInvoiceFile(storagePath: string): Promise<Buffer> {
  const absolutePath = path.resolve(STORAGE_ROOT, storagePath);
  if (!absolutePath.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    throw new Error("storagePath escapes the storage root");
  }
  return readFile(absolutePath);
}
