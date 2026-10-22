import type { StockLevelBasis } from '#shared/types/commerce';

export function useStockVisibility() {
  const { tenant, isFeatureConfigured, hasFeature } = useTenant();
  const { canAccess } = useFeatureAccess();

  const showStock = computed(() => {
    if (!isFeatureConfigured('stockStatus')) return true;
    if (!hasFeature('stockStatus')) return false;
    return canAccess('stockStatus');
  });

  const stockLevelBasis = computed<StockLevelBasis>(() =>
    tenant.value?.layout?.stockLevelBasis === 'available'
      ? 'available'
      : 'total',
  );

  return { showStock, stockLevelBasis };
}
