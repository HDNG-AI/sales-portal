import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import type { PublicTenantConfig } from '#shared/types/tenant-config';
import { shallowMountComponent } from '../../utils/component';
import DefaultLayout from '../../../app/layouts/default.vue';

const state = vi.hoisted(() => ({
  layout: undefined as PublicTenantConfig['layout'],
}));

vi.mock('../../../app/composables/useTenant', () => ({
  useTenant: () => ({ tenant: ref({ layout: state.layout }) }),
}));

describe('storefrontStyle', () => {
  beforeEach(() => {
    state.layout = undefined;
  });

  it('keeps the classic layout and omits the price notice when storefrontStyle is absent', () => {
    const wrapper = shallowMountComponent(DefaultLayout);
    expect(wrapper.attributes('data-storefront-style')).toBe('classic');
    expect(wrapper.find('storefront-price-notice-stub').exists()).toBe(false);
  });

  it('keeps the classic layout and omits the price notice when storefrontStyle is classic', () => {
    state.layout = { storefrontStyle: 'classic' };
    const wrapper = shallowMountComponent(DefaultLayout);
    expect(wrapper.attributes('data-storefront-style')).toBe('classic');
    expect(wrapper.find('storefront-price-notice-stub').exists()).toBe(false);
  });

  it('enables the editorial layout and mounts the price notice when storefrontStyle is editorial', () => {
    state.layout = { storefrontStyle: 'editorial' };
    const wrapper = shallowMountComponent(DefaultLayout);
    expect(wrapper.attributes('data-storefront-style')).toBe('editorial');
    expect(wrapper.find('storefront-price-notice-stub').exists()).toBe(true);
  });
});
