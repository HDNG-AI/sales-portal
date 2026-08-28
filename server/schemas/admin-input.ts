import { z } from 'zod';

/**
 * Input for the one-off tenant onboarding endpoint
 * (server/api/admin/tenants.post.ts). Intentionally thinner than the
 * external-ingestion schemas in store-settings.ts — this is an
 * authenticated internal tool fed known-good values (a style guide's
 * colors, a Geins account's own credentials), not an untrusted public
 * surface, so it validates shape/presence rather than re-deriving the
 * full OKLCH color-coercion pipeline that already runs downstream in
 * createTenant()/buildDerivedTheme().
 */
export const CreateTenantSchema = z.object({
  hostname: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  // Additional hostnames that resolve to the same tenant — e.g. a
  // .localhost dev domain alongside the production one.
  aliases: z.array(z.string().min(1)).optional(),
  theme: z
    .object({
      name: z.string(),
      colors: z.record(z.string(), z.string()),
      radius: z.string().optional(),
      typography: z
        .object({
          fontFamily: z.string(),
          headingFontFamily: z.string().optional(),
          monoFontFamily: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  branding: z
    .object({
      name: z.string(),
      watermark: z.enum(['full', 'minimal', 'none']).optional(),
    })
    .optional(),
  geinsSettings: z
    .object({
      apiKey: z.string(),
      accountName: z.string(),
      channel: z.string(),
      tld: z.string(),
      locale: z.string(),
      market: z.string(),
      environment: z.enum(['production', 'staging']).optional(),
      // Overrides the accountName-derived image CDN host — set this when
      // the tenant's image subdomain doesn't match its Geins account name.
      imageBaseUrl: z.string().optional(),
    })
    .optional(),
  mode: z.enum(['commerce', 'catalog']).optional(),
  checkoutMode: z.enum(['custom', 'hosted']).optional(),
  // IANA identifier, e.g. 'Europe/Stockholm' — never a raw UTC offset.
  // Omitted → createTenant() defaults to 'UTC', not a guessed value.
  timezone: z.string().optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
