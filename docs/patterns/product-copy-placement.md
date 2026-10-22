# Tenant-specific product text placement

**Scope:** Storefront presentation only. No PIM value, Geins parameter or document is changed.

The legacy PIM box mapping `GEINS_ADMIN_TEXT_FIELD_MAP` is unchanged and
continues to apply to tenants that have not opted into semantic placement.

A tenant that wants Geins Management `ShortTexts / LongTexts / TechTexts`
presented by meaning can set the optional tenant setting:

```json
{ "layout": { "productTextPlacement": "semantic" } }
```

The default is `legacy`. The setting is included in the public tenant
configuration and read by both ordinary and configurable product views.

| Merchant API | Meaning | Semantic location |
| --- | --- | --- |
| `texts.text1` | Short text | Beneath the product price (plain text) |
| `texts.text2` | Long text | Product details tab (HTML) |
| `texts.text3` | Technical text | Start of specifications tab (HTML, before parameters) |

**Sanitization:** The product GET route runs `sanitizeProductTexts` with
`sanitizeWidgetHtml` for all three fields before they are serialized into
Nuxt SSR. The text-placement components consume that server-sanitized HTML.
The short text is stripped to plain text for display below the price.

**Testing:** product 1044 in Odelco with all three fields:
1. With semantic mode enabled, short is below price, long is in
   Product details, technical is in Specifications.
2. Print (Ladda ner som datablad) includes the Specifications pane and
   technical HTML.
3. A tenant without the opt-in retains the original order and layout.
4. Technical text alone triggers a Specifications tab.
5. Configurator product pages use the same semantic long/technical rules.

**Rollout:** Code merges can happen independently from tenant config, but
Odelco's `layout.productTextPlacement` must be set through the approved
tenant configuration workflow. Do not edit tenant configuration in Geins
or production as part of this PR.

**Follow-up work in a separate PR:** Document links in configurator views,
Swedish ProductSpec/Manual labels, and shared Documents-panel rendering.
The accepted Odelco spec A contains these, but this PR intentionally handles
only text presentation to keep review and rollback isolated.
