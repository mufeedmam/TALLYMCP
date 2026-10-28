'use client';

import { useTheme } from 'next-themes';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      <IconSun className="h-4 w-4 dark:hidden" />
      <IconMoon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
