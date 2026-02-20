// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlobalNav } from '../src/components/global-nav';

describe('GlobalNav', () => {
  describe('navigation links', () => {
    it('renders Dashboard link pointing to /', () => {
      render(<GlobalNav currentPath="/" />);
      const link = screen.getByRole('link', { name: /dashboard/i });
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/');
    });

    it('renders Packs link pointing to /packs', () => {
      render(<GlobalNav currentPath="/" />);
      const link = screen.getByRole('link', { name: /packs/i });
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/packs');
    });

    it('renders Marketplace link pointing to /marketplace', () => {
      render(<GlobalNav currentPath="/" />);
      const link = screen.getByRole('link', { name: /marketplace/i });
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/marketplace');
    });

    it('renders Evidence link pointing to /evidence', () => {
      render(<GlobalNav currentPath="/" />);
      const link = screen.getByRole('link', { name: /evidence/i });
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/evidence');
    });

    it('highlights the active link based on currentPath', () => {
      render(<GlobalNav currentPath="/packs" />);
      const packsLink = screen.getByRole('link', { name: /packs/i });
      expect(packsLink.getAttribute('aria-current')).toBe('page');

      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      expect(dashboardLink.getAttribute('aria-current')).toBeNull();
    });

    it('highlights Dashboard for root path', () => {
      render(<GlobalNav currentPath="/" />);
      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      expect(dashboardLink.getAttribute('aria-current')).toBe('page');
    });

    it('highlights Dashboard for /dashboard/* paths', () => {
      render(<GlobalNav currentPath="/dashboard/task-123" />);
      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      expect(dashboardLink.getAttribute('aria-current')).toBe('page');
    });
  });

  describe('dark mode toggle', () => {
    beforeEach(() => {
      // Clean up any class modifications from previous tests
      document.documentElement.classList.remove('dark');
      localStorage.clear();
    });

    afterEach(() => {
      document.documentElement.classList.remove('dark');
      localStorage.clear();
    });

    it('renders a dark mode toggle button', () => {
      render(<GlobalNav currentPath="/" />);
      const toggle = screen.getByRole('button', { name: /toggle.*mode/i });
      expect(toggle).toBeDefined();
    });

    it('toggles dark class on document element when clicked', () => {
      render(<GlobalNav currentPath="/" />);
      const toggle = screen.getByRole('button', { name: /toggle.*mode/i });

      expect(document.documentElement.classList.contains('dark')).toBe(false);

      fireEvent.click(toggle);
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      fireEvent.click(toggle);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('persists dark mode preference to localStorage', () => {
      render(<GlobalNav currentPath="/" />);
      const toggle = screen.getByRole('button', { name: /toggle.*mode/i });

      fireEvent.click(toggle);
      expect(localStorage.getItem('lumenflow-theme')).toBe('dark');

      fireEvent.click(toggle);
      expect(localStorage.getItem('lumenflow-theme')).toBe('light');
    });

    it('reads initial dark mode from localStorage', () => {
      localStorage.setItem('lumenflow-theme', 'dark');
      render(<GlobalNav currentPath="/" />);
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  describe('branding', () => {
    it('displays LumenFlow text or logo', () => {
      render(<GlobalNav currentPath="/" />);
      expect(screen.getByText(/lumenflow/i)).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('uses a nav element with aria-label', () => {
      const { container } = render(<GlobalNav currentPath="/" />);
      const nav = container.querySelector('nav');
      expect(nav).not.toBeNull();
      expect(nav?.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
