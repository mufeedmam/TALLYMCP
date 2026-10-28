'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconLayoutDashboard, IconArrowDownRight, IconArrowUpRight, IconBuildingWarehouse,
  IconReceipt, IconSettings, IconArrowsExchange,
} from '@tabler/icons-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar';

const items = [
  { href: '/overview', label: 'Overview', icon: IconLayoutDashboard },
  { href: '/receivables', label: 'Receivables', icon: IconArrowDownRight },
  { href: '/payables', label: 'Payables', icon: IconArrowUpRight },
  { href: '/inventory', label: 'Inventory', icon: IconBuildingWarehouse },
  { href: '/expenses', label: 'Expenses', icon: IconReceipt },
  { href: '/cashflow', label: 'Cashflow', icon: IconArrowsExchange },
];

export function AppSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            T
          </span>
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Tally Analytics
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.href}>
                  <SidebarMenuButton isActive={isActive(it.href)} tooltip={it.label} render={<Link href={it.href} />}>
                    <it.icon />
                    <span>{it.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={isActive('/settings')} tooltip="Settings" render={<Link href="/settings" />}>
              <IconSettings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
