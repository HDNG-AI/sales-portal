import type { TenantConfig } from '#shared/types/tenant-config';
import type { ResolvedLocaleMarket } from '#shared/utils/locale-market';

declare module 'h3' {
  interface H3EventContext {
    tenant: {
      /** The tenant client hostname. */
      hostname: string;
      /** The resolved tenant ID (may differ from hostname for multi-hostname tenants). */
      tenantId?: string;
      /** Full resolved tenant config (set by 02.tenant-context plugin). */
      config?: TenantConfig;
    };
    /** Raw market/locale parsed from URL prefix by plugin 00. */
    localeMarket: { market: string; locale: string } | undefined;
    /** Validated locale/market with BCP-47 expansion, set by plugin 01. */
    resolvedLocaleMarket: ResolvedLocaleMarket | undefined;
    /**
     * Set by server/plugins/02.tenant-context.ts when a page-route request
     * has no tenant attached (missing Host header, or hostname doesn't
     * resolve). That plugin's `request` hook fires before Nitro applies
     * route-rule headers (see server/utils/tenant-error-response.ts), so it
     * can't safely send the response itself — it only flags the failure
     * here. server/middleware/00.locale-market.ts (which runs after
     * route-rules) is what actually responds.
     */
    tenantResolutionError?: { statusCode: number; message: string };
  }
}

export {};
