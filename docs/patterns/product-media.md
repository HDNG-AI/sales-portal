# Product Media — videos and documents on a PDP

Products carry videos and documents (manuals, spec sheets, drawings) as
ordinary Geins **product parameters**. The storefront pulls those
parameters out of the spec table and renders them as players and download
links instead of raw URL rows.

This page is the contract between whatever writes those parameters and the
storefront that reads them.

## Ownership

| Thing                     | Owner                                    | Why                                                                 |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| The files themselves      | The external file store                  | Large binaries don't belong in a product catalog                    |
| The URLs pointing at them | Geins, as product parameters             | One source of truth per product, alongside name/price/images        |
| Name → kind mapping       | Tenant config, when it's needed          | A merchant's PIM may not use the canonical names (see escape hatch) |
| Rendering                 | `app/components/product/ProductTabs.vue` | —                                                                   |

The deliberate consequence: **adding a video to a product is a catalog
edit, never a configuration change.** Nothing in tenant config moves when
a product gains or loses media.

## The contract for whoever writes the parameters

### 1. Use the canonical parameter names

| Parameter name | Kind       | Renders as      |
| -------------- | ---------- | --------------- |
| `VideoURL`     | `video`    | Embedded player |
| `Manual`       | `document` | Download link   |
| `ProductSpec`  | `document` | Download link   |

Matching is on the parameter's technical `name`, case-insensitive, never
its localized `label`. These are the keys in
`PRODUCT_MEDIA_PARAMETER_DEFAULTS` (`shared/constants/product-media.ts`),
which every tenant inherits.

**A writer that uses these names needs no tenant configuration at all, for
any tenant, ever.** Conform here and the escape hatch below stays unused.

### 2. Values are absolute `http(s)` URLs

A value that isn't URL-shaped is left in the spec table as a normal text
row rather than being rendered as media. Relative paths, bare filenames and
prose are all treated as "not media".

### 3. Several files go in one parameter, separated by `|`

```
Manual = https://files.example/manual-en.pdf|https://files.example/manual-sv.pdf
```

`|` is excluded by RFC 3986 from the characters a URL may carry unencoded
(it must appear as `%7C`), so splitting on it can never cut a well-formed
URL in half. That's why it's used rather than a comma or semicolon.

Rules the storefront applies when splitting:

- Each piece is trimmed and validated on its own.
- Invalid pieces are dropped; the valid ones still render. A value that's
  half URLs and half prose contributes the URLs it has.
- Empty segments (`a||b`, a trailing `|`) are ignored.
- Every entry from one parameter shares that parameter's label.

**Do not** number parameters to express "several" (`Video1`, `Video2`,
`Video3`). Each numbered name would need its own entry in every tenant's
mapping, which puts a configuration change in the path of adding a fourth
video — exactly what this design avoids.

### 4. Video URLs: emit an embeddable form

`resolveVideoEmbedUrl` currently recognizes these, and turns them into an
iframe embed:

| Form                            | Recognized                         |
| ------------------------------- | ---------------------------------- |
| `youtube.com/watch?v=<id>`      | yes                                |
| `youtu.be/<id>`                 | yes                                |
| `youtube.com/embed/<id>`        | yes                                |
| `vimeo.com/<id>`                | yes                                |
| `youtube.com/shorts/<id>`       | **no**                             |
| A direct file (`.mp4`, `.webm`) | n/a — plays in a `<video>` element |

Anything not recognized falls through to a `<video>` element, which only
works for a direct video file. A YouTube _page_ URL in that branch renders
a player that silently plays nothing — so a writer emitting YouTube links
should normalize to the `watch?v=` form rather than passing a Shorts URL
through.

### 5. Absent means absent

No parameter, an empty value, or a value with no usable URL all produce
zero media entries, and the storefront renders nothing — no empty player,
no placeholder, no broken link. There is no "null" sentinel to write; just
omit the parameter.

## Escape hatch — `tenant.productMediaParameters`

For a tenant whose PIM already names these fields something else
(`Datasheet` instead of `Manual`, say) and can't be changed, tenant config
can map that tenant's own names onto the same two kinds:

```json
{
  "productMediaParameters": {
    "datasheet": "document",
    "produktvideo": "video"
  }
}
```

Keys are lowercase parameter names; values are `video` or `document`.
Entries merge **over** `PRODUCT_MEDIA_PARAMETER_DEFAULTS`, so a tenant that
adds `datasheet` still gets `Manual`/`ProductSpec`/`VideoURL` for free.

This is a one-time onboarding accommodation for non-conforming data, not
the normal path. A writer under our control should conform to the
canonical names instead.

## How the mapping resolves

1. `PRODUCT_MEDIA_PARAMETER_DEFAULTS` (`shared/constants/product-media.ts`)
   is the base layer.
2. `appSettings.productMediaParameters` from the merchant API, or a
   KV-stored override, merges over it per key in `server/utils/tenant.ts`.
3. The resolved table travels to the client on `PublicTenantConfig` (see
   `server/services/tenant-config.ts`) and is read via
   `useTenant().productMediaParameters`.

A server-side consumer that needs the resolved table — the webhook handlers
under `server/api/internal/webhook/` included — should read it from the
tenant config rather than importing the defaults directly, so a tenant's
overrides are respected.

## Rendering

`classifyMediaParameter(param, table)` turns one parameter into 0-n
entries. Each entry carries:

- `kind` — `video` or `document`
- `label` — the parameter name, spaced (`ProductSpec` → `Product Spec`)
- `url` — one URL
- `embedUrl` — an iframe src for recognized providers (YouTube, Vimeo),
  otherwise `null`

A `video` entry with an `embedUrl` renders in an iframe; one without is a
direct file and renders in a `<video>` element. `document` entries render
as download links.

Parameters that produced media are removed from the spec table, so a URL
never appears twice on the page.

## Related files

- `shared/constants/product-media.ts` — defaults, classifier, embed resolution
- `shared/types/tenant-config.ts` — `productMediaParameters` on `TenantConfig`
- `server/utils/tenant.ts` — merges defaults under the tenant's table
- `server/schemas/store-settings.ts` — merchant API validation for the block
- `app/composables/useTenant.ts` — client-side accessor
- `app/components/product/ProductTabs.vue` — the consumer
- [cms-config.md](./cms-config.md) — the sibling name-mapping pattern for CMS slots and menus
