import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(
    process.cwd(),
    'app/components/layout/header/LayoutHeaderActionButtons.vue',
  ),
  'utf-8',
);

describe('LayoutHeaderActionButtons anonymous conversion actions', () => {
  it('promotes login into the main header', () => {
    expect(source).toContain('data-testid="header-login"');
    expect(source).toContain("@click=\"authStore.openSheet('login')\"");
    expect(source).toContain("{{ $t('auth.login') }}");
  });

  it('promotes account application when the tenant enables it', () => {
    expect(source).toContain("hasFeature('applyForAccount')");
    expect(source).toContain('data-testid="header-apply"');
    expect(source).toContain("{{ $t('layout.apply_for_account') }}");
  });

  it('keeps both actions hidden once the user is authenticated', () => {
    const matches = source.match(/!authStore\.isAuthenticated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps login visually primary and account application outlined', () => {
    const applyIndex = source.indexOf('data-testid="header-apply"');
    const applyStart = source.lastIndexOf('<Button', applyIndex);
    const applyContext = source.slice(applyStart, applyIndex);
    expect(applyContext).toContain('variant="outline"');

    const loginIndex = source.indexOf('data-testid="header-login"');
    const loginStart = source.lastIndexOf('<Button', loginIndex);
    const loginContext = source.slice(loginStart, loginIndex);
    expect(loginContext).not.toContain('variant="outline"');
  });
});
