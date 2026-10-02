import { COOKIE_NAMES } from '#shared/constants/storage';

/**
 * Whether prices are shown inclusive or exclusive of VAT.
 *
 * Two things decide it, and a tenant controls both:
 *
 * - `layout.vatDisplay` is what a buyer who has never chosen sees. Absent
 *   means ex-VAT, which is the right floor for a B2B storefront.
 * - `layout.vatDisplayLocked` removes the choice. The tenant's value then
 *   applies to everyone and the switcher is hidden.
 *
 * Cookie-backed and SSR-safe: read via useCookie so the first server render
 * matches the stored choice without a hydration flash.
 *
 * The cookie deliberately has no `default`. With one, an unset cookie and a
 * buyer who actively chose ex-VAT are the same value, and a tenant defaulting
 * to inc-VAT could never show it — the default would overwrite the tenant's
 * intent before anyone had chosen anything.
 */
export function useVatDisplay() {
  const { tenant } = useTenant();
  const cookie = useCookie<'inc' | 'ex' | undefined>(COOKIE_NAMES.VAT_DISPLAY, {
    maxAge: 365 * 24 * 60 * 60,
  });

  /** What a buyer sees before choosing. Ex-VAT unless the tenant says otherwise. */
  const tenantDefault = computed<'inc' | 'ex'>(() =>
    tenant.value?.layout?.vatDisplay === 'inc' ? 'inc' : 'ex',
  );

  /** True when the tenant has taken the choice away. */
  const isLocked = computed(
    () => tenant.value?.layout?.vatDisplayLocked === true,
  );

  /** True when the buyer should see prices inclusive of VAT. */
  const showIncVat = computed(() => {
    if (isLocked.value) return tenantDefault.value === 'inc';
    if (cookie.value === 'inc') return true;
    if (cookie.value === 'ex') return false;
    return tenantDefault.value === 'inc';
  });

  function setShowIncVat(inc: boolean) {
    // A locked tenant ignores the request rather than writing a cookie that
    // showIncVat would then disregard — a stored choice that does nothing is
    // worse than no choice, because it survives the tenant unlocking later.
    if (isLocked.value) return;
    cookie.value = inc ? 'inc' : 'ex';
  }

  function toggle() {
    setShowIncVat(!showIncVat.value);
  }

  return { showIncVat, setShowIncVat, toggle, isLocked };
}
