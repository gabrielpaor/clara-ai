// Single shared PrismaClient for the whole app.
//
// Next.js dev mode hot-reloads modules on every change; without this
// global cache each reload would open a new connection pool and Postgres
// would eventually refuse connections. In production the module is
// evaluated once, so the global is never reused.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
