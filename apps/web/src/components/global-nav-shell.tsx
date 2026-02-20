'use client';

import { usePathname } from 'next/navigation';
import { GlobalNav } from './global-nav';

/**
 * Shell wrapper that reads the current pathname from Next.js router
 * and passes it to the testable GlobalNav component.
 */
export function GlobalNavShell() {
  const pathname = usePathname();
  return <GlobalNav currentPath={pathname} />;
}
