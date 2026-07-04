import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "email and password required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  // Same response for "no such user" and "wrong password" — never reveal
  // which one it was (prevents account enumeration).
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  return Response.json({
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
  });
}
