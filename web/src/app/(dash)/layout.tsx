import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/AppSidebar";
import LastSynced from "@/components/LastSynced";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCompanyName } from "@/lib/company";

// Every page here reads live data (sync status, receivables, …) straight from
// Postgres — must render per-request, never be frozen at build time.
export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: ReactNode }) {
  const company = await getCompanyName();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <span className="truncate text-sm font-medium text-muted-foreground">
            {company ?? "Not connected"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <LastSynced />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
