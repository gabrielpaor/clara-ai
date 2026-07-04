// Shell for all authenticated pages. The session check here is the REAL
// gate (proxy.ts is only the optimistic redirect).
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { getSession } from "@/lib/session";

export const metadata = { title: "Clara AI" };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-semibold text-zinc-900">
              Clara <span className="text-zinc-400">AI</span>
            </Link>
            <nav className="flex gap-5 text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">
                Dashboard
              </Link>
              <Link href="/invoices" className="hover:text-zinc-900">
                Invoices
              </Link>
              <Link
                href="/invoices?status=NEEDS_REVIEW"
                className="hover:text-zinc-900"
              >
                Review queue
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">{session.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
