import { z } from 'zod';
import {
  GeinsSettingsSchema,
  BrandingConfigSchema,
  ThemeTypographySchema,
  ThemeColorsSchema,
  TenantModeSchema,
  TimezoneSchema,
} from './store-settings';

/**
 * Input for the one-off tenant onboarding endpoint
 * (server/api/admin/tenants.post.ts). Composed from the same schemas the
 * merchant-API ingestion path uses (store-settings.ts) rather than
 * hand-duplicating their fields — a validation rule or field added there
 * (e.g. the OKLCH color coercion, the catalog/catalogue normalisation)
 * reaches this endpoint automatically instead of needing a second,
 * independently-maintained copy.
 */
export const CreateTenantSchema = z
  .object({
    // Real browser Host headers arrive lowercase; resolveTenant()'s KV
    // lookup is an exact match. Without normalising here, an admin
    // submitting "MyStore.com" creates a tenant that real traffic
    // ("Host: mystore.com") can never resolve to.
    hostname: z.string().min(1).trim().toLowerCase(),
    tenantId: z.string().min(1).optional(),
    // Additional hostnames that resolve to the same tenant — e.g. a
    // .localhost dev domain alongside the production one.
    aliases: z.array(z.string().min(1).trim().toLowerCase()).optional(),
    // Required when `hostname` already resolves to an existing tenant —
    // makes an intentional update explicit instead of a typo'd hostname
    // silently overwriting an unrelated live tenant's config. Ignored
    // (has no effect) when the hostname doesn't exist yet.
    allowUpdate: z.boolean().optional(),
    theme: z
      .object({
        name: z.string(),
        // The endpoint's own precedent (see git history) is accepting just
        // the 6 core colors and deriving the rest — ThemeColorsSchema's
        // required fields are exactly those 6, with the remaining 26 as
        // optional overrides, and it coerces any CSS color format
        // (hex/rgb/hsl/named) to OKLCH rather than accepting an arbitrary
        // string that downstream derivation would silently fall back to
        // gray on if it isn't already the literal `oklch(...)` format.
        colors: ThemeColorsSchema,
        radius: z.string().optional(),
        typography: ThemeTypographySchema.optional(),
      })
      .optional(),
    branding: BrandingConfigSchema.partial({ watermark: true }).optional(),
    geinsSettings: GeinsSettingsSchema.omit({
      availableLocales: true,
      availableMarkets: true,
    })
      .extend({
        // Overrides the accountName-derived image CDN host — set this when
        // the tenant's image subdomain doesn't match its Geins account name.
        imageBaseUrl: z.string().optional(),
      })
      .optional(),
    mode: TenantModeSchema.optional(),
    checkoutMode: z.enum(['custom', 'hosted']).optional(),
    // Omitted → createTenant() defaults to 'UTC', not a guessed value.
    timezone: TimezoneSchema.optional(),
  })
  // An unrecognized field (a typo, or a value from a different schema
  // entirely) should fail loudly, not be silently dropped — the caller
  // gets no other signal that what they sent wasn't applied.
  .strict();

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
