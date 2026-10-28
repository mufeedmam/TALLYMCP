// Shared UI primitives, built on shadcn's semantic theme tokens (bg-card,
// text-muted-foreground, border, bg-primary, …) so the whole app follows the
// selected shadcn theme and dark mode from one place. Richer shadcn components
// (Button, Tabs, Table, Badge…) live in components/ui/*; these are the thin
// app-specific helpers (money formatting, stat tiles, section chrome).
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------- money & numbers ---------- */

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatFull(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tnum', className)}>{formatFull(value)}</span>;
}

/* ---------- layout ---------- */

export function PageHeader({
  eyebrow,
  title,
  actions,
  description,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  padded = true,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/* ---------- stats ---------- */

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: 'default' | 'warn' | 'danger' | 'good';
}) {
  const valueTone =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'good'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-foreground';
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tracking-tight', valueTone)}>{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ---------- table ---------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b pb-2 text-xs font-medium text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  muted = false,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  muted?: boolean;
}) {
  return (
    <td
      className={cn(
        'border-b border-border/60 py-2.5',
        align === 'right' ? 'text-right' : 'text-left',
        muted ? 'text-muted-foreground' : 'text-foreground',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-muted/50">{children}</tr>;
}

/* ---------- badges & misc ---------- */

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'info';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-secondary text-secondary-foreground',
    good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-primary/10 text-primary',
  };
  return (
    <span className={cn('ml-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium align-middle', tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Proportion bar used inline in tables to make magnitude scannable. */
export function MiniBar({ value, max, tone = 'primary' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  const colors: Record<string, string> = {
    primary: 'bg-primary',
    red: 'bg-destructive',
    amber: 'bg-amber-500',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', colors[tone] ?? colors.primary)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Chevron() {
  return (
    <svg
      className="chevron h-3.5 w-3.5 shrink-0 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
