// Seed data for local development: three known vendors so the extraction
// pipeline has master data to match against. Run with: npx prisma db seed
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const vendors = [
    {
      name: "Acme Office Supplies Inc.",
      email: "billing@acme-office.example.com",
      taxId: "US-84-1234567",
      iban: "DE89370400440532013000",
    },
    {
      name: "CloudHost Solutions Ltd.",
      email: "invoices@cloudhost.example.com",
      taxId: "GB-987654321",
      iban: "GB29NWBK60161331926819",
    },
    {
      name: "Metro Logistics PH",
      email: "accounting@metrologistics.example.ph",
      taxId: "PH-008-123-456-000",
      iban: null,
    },
  ];

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { email: vendor.email },
      update: {},
      create: vendor,
    });
  }

  // Dashboard login for local development. CHANGE THE PASSWORD before any
  // non-local deployment — or better, replace with your own user row.
  const adminEmail = "admin@clara.local";
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Gabriel",
      role: "ADMIN",
      passwordHash: await bcrypt.hash("clara-admin-2026", 12),
    },
  });

  const count = await prisma.vendor.count();
  console.log(`Seed complete — ${count} vendors in database.`);
  console.log(`Dashboard login: ${adminEmail} / clara-admin-2026`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
