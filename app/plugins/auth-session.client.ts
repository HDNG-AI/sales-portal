import { useAuthStore } from '~/stores/auth';

/**
 * A tab can stay open after the backend refresh token expires. Revalidate
 * while visible, on return from another tab and after client navigation.
 * The store deduplicates concurrent checks per Nuxt app/SSR request.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuthStore();
  let lastCheckAt = 0;
  const minGapMs = 15_000;

  const revalidate = () => {
    // No need to poll anonymous visitors or race the initial auth request.
    if (!auth.isInitialized || !auth.isAuthenticated) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheckAt < minGapMs) return;
    lastCheckAt = Date.now();
    void auth.fetchUser();
  };

  window.addEventListener('focus', revalidate);
  document.addEventListener('visibilitychange', revalidate);
  const interval = window.setInterval(revalidate, 60_000);
  nuxtApp.hook('page:finish', revalidate);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      window.clearInterval(interval);
    });
  }
});
