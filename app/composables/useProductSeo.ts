import type { DetailProduct } from '#shared/types/commerce';
import { buildGeinsRawUrl } from '#shared/utils/image';
import { firstMetaDescription } from '#shared/utils/meta-description';

/**
 * The head every product page publishes: canonical and hreflang, the meta
 * description and og tags, and the Schema.org Product + BreadcrumbList.
 *
 * One implementation for every product type, because a second one drifts: the
 * canonical is the address the page answers at, category segments included,
 * which is the kind of detail a copy loses. `offers` is the one part that is not
 * universal — a configured product has no single price until it is committed,
 * so the configurator page publishes the product without one.
 */
export interface ProductSeoOptions {
  product: () => DetailProduct;
  /**
   * Locale-free path the page answers at, e.g. `/p/<category>/<alias>`. A bare
   * `/p/<alias>` answers 301, so it cannot be the canonical.
   */
  path: () => string;
  breadcrumbs: () => { label: string; href?: string }[];
  localeAlternates: MaybeRefOrGetter<Record<string, string>>;
  /** The sku the page has resolved, when it resolves one. */
  sku?: () => string;
  /**
   * Whether to publish an `offers` block. A getter where the answer is
   * reactive — this fork gates prices on the buyer's auth state, so a plain
   * boolean captured at setup would pin the first render's answer.
   */
  withOffers: boolean | (() => boolean);
}

export function useProductSeo(options: ProductSeoOptions): void {
  const { product, path, breadcrumbs, localeAlternates, sku, withOffers } =
    options;

  const { imageBaseUrl } = useTenant();

  // The short text when there is one, otherwise the long one: most catalogues
  // fill only one of them, and a missing description tag is the worse outcome.
  const plainDescription = computed(() =>
    firstMetaDescription(product().texts?.text1, product().texts?.text2),
  );

  // The product queries return images by `fileName`; `url` is only present
  // when a query asks for it. Search engines need an absolute address either way.
  function imageUrl(image: { url?: string | null; fileName?: string | null }) {
    if (image.url) return image.url;
    if (!image.fileName || !imageBaseUrl.value) return '';
    return buildGeinsRawUrl(imageBaseUrl.value, 'product', image.fileName);
  }

  const imageUrls = computed(() =>
    (product().productImages ?? []).map(imageUrl).filter(Boolean),
  );

  const primaryImageUrl = computed(() => {
    const images = product().productImages ?? [];
    const primary = images.find((i) => i.isPrimary) ?? images[0];
    return primary ? imageUrl(primary) : '';
  });

  const { seoLinks } = useSeoLinks(path, localeAlternates);

  useHead({
    title: () => product().name ?? '',
  });

  useSeoMeta({
    description: () => plainDescription.value,
    ogTitle: () => product().name ?? '',
    ogDescription: () => plainDescription.value,
    ogImage: () => primaryImageUrl.value || undefined,
    ogUrl: () => seoLinks.value.find((l) => l.rel === 'canonical')?.href ?? '',
  });

  useSchemaOrg([
    defineProduct({
      name: () => product().name ?? '',
      description: () => plainDescription.value,
      image: () => imageUrls.value,
      brand: () =>
        product().brand?.name
          ? { '@type': 'Brand', name: product().brand!.name }
          : undefined,
      sku: () => sku?.() ?? '',
      offers: () =>
        (typeof withOffers === 'function' ? withOffers() : withOffers) &&
        product().unitPrice
          ? {
              '@type': 'Offer' as const,
              price: product().unitPrice!.sellingPriceIncVat ?? 0,
              priceCurrency: product().unitPrice!.currency?.code ?? 'SEK',
              availability: product().totalStock?.inStock
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
              itemCondition: 'https://schema.org/NewCondition',
            }
          : undefined,
      aggregateRating: () =>
        product().rating?.reviewCount
          ? {
              '@type': 'AggregateRating' as const,
              ratingValue: product().rating?.averageRating ?? 0,
              reviewCount: product().rating!.reviewCount,
            }
          : undefined,
    }),
    defineBreadcrumb({
      itemListElement: () =>
        breadcrumbs().map((bc, i) => ({
          '@type': 'ListItem' as const,
          position: i + 1,
          name: bc.label,
          item: bc.href,
        })),
    }),
  ]);
}
