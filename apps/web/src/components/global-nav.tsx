'use client';

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Store,
  ShieldCheck,
  Moon,
  Sun,
} from 'lucide-react';

const THEME_STORAGE_KEY = 'lumenflow-theme';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ReactNode;
  /** Path prefixes that should mark this item as active */
  readonly matchPrefixes: readonly string[];
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: <LayoutDashboard size={18} />,
    matchPrefixes: ['/', '/dashboard'],
  },
  {
    label: 'Packs',
    href: '/packs',
    icon: <Package size={18} />,
    matchPrefixes: ['/packs'],
  },
  {
    label: 'Marketplace',
    href: '/marketplace',
    icon: <Store size={18} />,
    matchPrefixes: ['/marketplace'],
  },
  {
    label: 'Evidence',
    href: '/evidence',
    icon: <ShieldCheck size={18} />,
    matchPrefixes: ['/evidence'],
  },
] as const;

function isActiveItem(item: NavItem, currentPath: string): boolean {
  // Exact match for root
  if (item.href === '/' && currentPath === '/') {
    return true;
  }

  // For non-root items, check if currentPath starts with any match prefix
  // For root item, also check /dashboard/* paths
  return item.matchPrefixes.some((prefix) => {
    if (prefix === '/') {
      return false; // Root exact match handled above
    }
    return currentPath === prefix || currentPath.startsWith(`${prefix}/`);
  });
}

interface GlobalNavProps {
  readonly currentPath: string;
}

export function GlobalNav({ currentPath }: GlobalNavProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark') {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  function handleToggleTheme() {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
  }

  return (
    <nav
      aria-label="Global navigation"
      className="flex items-center justify-between border-b border-border bg-background px-6 py-3"
    >
      <div className="flex items-center gap-8">
        <a href="/" className="text-lg font-semibold text-foreground">
          LumenFlow
        </a>
        <ul className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActiveItem(item, currentPath);
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  ].join(' ')}
                >
                  {item.icon}
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={handleToggleTheme}
        aria-label="Toggle dark mode"
        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </nav>
  );
}
