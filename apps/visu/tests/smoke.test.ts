import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

describe('apps/visu smoke', () => {
  it('runs in a jsdom DOM environment', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement);
  });

  it('can mount a Vue component with @vue/test-utils', () => {
    const Probe = defineComponent({
      render() {
        return h('span', { class: 'probe' }, 'obs Visu shell');
      },
    });
    const wrapper = mount(Probe);
    expect(wrapper.find('.probe').text()).toBe('obs Visu shell');
  });
});
