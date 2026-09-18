export function usePriceVisibility() {
  const { features, isFeatureConfigured, hasFeature } = useTenant();
  const { canAccess } = useFeatureAccess();

  const showPrice = computed(() => {
    if (!isFeatureConfigured('priceVisibility')) return true;
    if (!hasFeature('priceVisibility')) return false;
    return canAccess('priceVisibility');
  });

  // True only when authentication itself is the missing requirement.
  // A denied role/group/accountType/permission rule must not show a login
  // CTA: logging in again cannot guarantee that access will change.
  const canUnlockByAuth = computed(() => {
    if (!isFeatureConfigured('priceVisibility')) return false;
    if (!hasFeature('priceVisibility')) return false;
    if (features.value?.priceVisibility?.access !== 'authenticated') {
      return false;
    }
    return !canAccess('priceVisibility');
  });

  return { showPrice, canUnlockByAuth };
}
