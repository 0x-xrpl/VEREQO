// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../apps/web/src/App';

describe('English-first boot language', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  async function mount(url: string) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<App />));
  }

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete document.documentElement.dataset.language;
    document.documentElement.lang = 'en';
  });

  it('starts in English without a query or saved preference, and keeps DOM language in sync on switch', async () => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await mount('http://127.0.0.1:5173/');

    expect(document.documentElement.lang).toBe('en');
    expect(host!.querySelector('[data-testid="language-en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host!.querySelector('main')?.textContent).toContain('A proposal is not permission.');

    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="language-ja"]')!.click());
    expect(document.documentElement.lang).toBe('ja');
    expect(document.documentElement.dataset.language).toBe('ja');
    expect(window.localStorage.getItem('vereqo.language')).toBe('ja');

    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="language-en"]')!.click());
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('vereqo.language')).toBe('en');
  });

  it('honors an explicit URL language over a saved preference and restores a saved JP choice without a query', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    window.localStorage.setItem('vereqo.language', 'ja');
    await mount('http://127.0.0.1:5173/?lang=en');
    expect(host!.querySelector('[data-testid="language-en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.lang).toBe('en');
    await act(async () => root!.unmount());
    root = undefined;
    host!.remove();
    host = undefined;
    delete document.documentElement.dataset.language;

    await mount('http://127.0.0.1:5173/');
    expect(host!.querySelector('[data-testid="language-ja"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.lang).toBe('ja');
  });
});
