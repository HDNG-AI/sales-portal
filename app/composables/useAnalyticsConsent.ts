import { useStorage } from '@vueuse/core';
import { LOCAL_STORAGE_KEYS } from '#shared/constants/storage';
import { clearTrackingCookies } from '~/utils/tracking-cookies';

type ConsentState = 'accepted' | 'declined' | null;

/**
 * Per-tenant analytics consent state backed by localStorage.
 * Tri-state: `null` (no interaction), `'accepted'`, or `'declined'`.
 * The `consent` computed stays boolean for `useScriptTriggerConsent` compatibility.
 *
 * `reopen()` exists because withdrawing consent has to be as easy as giving it
 * (GDPR Art. 7(3)), and the banner hides itself for good once a choice is
 * stored — which left `revoke()` with no caller a visitor could reach.
 */
export function useAnalyticsConsent() {
  const { tenantId } = useTenant();
  const key = `${LOCAL_STORAGE_KEYS.ANALYTICS_CONSENT_PREFIX}${tenantId.value}`;

  const state = useStorage<ConsentState>(key, null);
  // Not persisted, and deliberately not a reset of `state`: reopening must not
  // discard the stored choice, or closing the banner without picking again
  // would turn a settled "declined" back into an unanswered prompt.
  const reopened = useState('analytics-consent-reopened', () => false);

  const consent = computed(() => state.value === 'accepted');
  const hasInteracted = computed(() => state.value !== null);
  /** Whether the banner should be on screen: unanswered, or reopened since. */
  const isPrompting = computed(() => !hasInteracted.value || reopened.value);

  function reopen() {
    reopened.value = true;
  }

  function accept() {
    state.value = 'accepted';
    reopened.value = false;
  }

  function revoke() {
    state.value = 'declined';
    reopened.value = false;
    // Withdrawal has to stop the processing that is already happening, not
    // only the next page's. The consent trigger keeps the scripts from being
    // injected again, but the identifiers they already dropped would outlive
    // the decision by up to two years otherwise.
    clearTrackingCookies();
  }

  return { consent, hasInteracted, isPrompting, accept, revoke, reopen };
}
