import { describe, it, expect } from 'vitest';
import { mountComponent } from '../../utils/component';
import ProductSpecificationsPanel from '../../../app/components/product/ProductSpecificationsPanel.vue';
import type { ParameterGroupType } from '#shared/types/commerce';

/**
 * The configurator page's spec panel. It renders the same parameter rows as
 * the two tables inside ProductTabs, and used to disagree with them about
 * which field wins: this one preferred `name`, they preferred `label`.
 */
function mountWith(param: Record<string, unknown>) {
  return mountComponent(ProductSpecificationsPanel, {
    props: {
      groups: [
        {
          name: 'Mått',
          parameterGroupId: 1,
          parameters: [param],
        },
      ] as unknown as ParameterGroupType[],
    },
  });
}

describe('ProductSpecificationsPanel parameter labels', () => {
  it('prefers the label over the name when both are present', () => {
    const wrapper = mountWith({
      name: 'Weight',
      label: 'Vikt',
      value: '500 g',
      show: true,
    });

    expect(wrapper.find('[data-testid="spec-table"]').text()).toContain('Vikt');
    expect(wrapper.find('[data-testid="spec-table"]').text()).not.toContain(
      'Weight',
    );
  });

  it('falls back to the name when the label is an empty string', () => {
    // An unfilled Label arrives as "" rather than a missing key, so a nullish
    // fallback renders a blank cell for most parameters on most tenants.
    const wrapper = mountWith({
      name: 'Weight',
      label: '',
      value: '500 g',
      show: true,
    });

    expect(wrapper.find('[data-testid="spec-table"]').text()).toContain(
      'Weight',
    );
  });
});
