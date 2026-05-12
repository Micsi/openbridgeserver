/**
 * Tests for #433 — DataPointsView uses <PathLabel> for node-filter display
 * so leaves with the same name under different parent paths are
 * disambiguated (e.g. "Gebäude › EG › Küche" vs "Gebäude › OG › Küche").
 *
 * We unit-test the segment construction the template uses, rather than
 * mounting the full DataPointsView (which pulls in Pinia store, websocket,
 * etc.). The template snippets under test are:
 *   <PathLabel :segments="n.path && n.path.length ? n.path : [n.node_name]" />
 *   <PathLabel :segments="[n.tree_name, ...(n.path && n.path.length ? n.path : [n.node_name])]" />
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PathLabel from '@/components/ui/PathLabel.vue'

function renderedText(wrapper) {
  // Container width is 0 in jsdom → PathLabel renders all segments.
  // Strip the small separator chars to compare against the bare segment list.
  return wrapper.text().replace(/\s*›\s*/g, ' › ').trim()
}

describe('DataPointsView node filter — PathLabel segment selection (#433)', () => {
  it('uses the full ancestor path when available', () => {
    const node = {
      node_id: 'a',
      node_name: 'Küche',
      tree_id: 't1',
      tree_name: 'Gebäude',
      path: ['Hauptgebäude', 'EG', 'Küche'],
    }
    const segments = node.path && node.path.length ? node.path : [node.node_name]
    const wrapper = mount(PathLabel, { props: { segments } })
    expect(renderedText(wrapper)).toBe('Hauptgebäude › EG › Küche')
  })

  it('falls back to node_name when path is missing or empty', () => {
    const node = { node_id: 'b', node_name: 'Küche', tree_id: 't1', tree_name: 'Gebäude' }
    const segments = node.path && node.path.length ? node.path : [node.node_name]
    expect(segments).toEqual(['Küche'])
    const wrapper = mount(PathLabel, { props: { segments } })
    expect(renderedText(wrapper)).toBe('Küche')
  })

  it('disambiguates two same-named leaves under different paths', () => {
    const eg = { node_name: 'Küche', path: ['Hauptgebäude', 'EG', 'Küche'] }
    const og = { node_name: 'Küche', path: ['Hauptgebäude', 'OG', 'Küche'] }
    const egSegs = eg.path && eg.path.length ? eg.path : [eg.node_name]
    const ogSegs = og.path && og.path.length ? og.path : [og.node_name]
    const egWrapper = mount(PathLabel, { props: { segments: egSegs } })
    const ogWrapper = mount(PathLabel, { props: { segments: ogSegs } })
    const egText = renderedText(egWrapper)
    const ogText = renderedText(ogWrapper)
    expect(egText).not.toBe(ogText)
    expect(egText).toContain('EG')
    expect(ogText).toContain('OG')
  })

  it('summary chip prepends tree_name for single selection', () => {
    const n = {
      node_name: 'Küche',
      tree_name: 'Gebäude',
      path: ['Hauptgebäude', 'EG', 'Küche'],
    }
    const segments = [n.tree_name, ...(n.path && n.path.length ? n.path : [n.node_name])]
    const wrapper = mount(PathLabel, { props: { segments } })
    expect(renderedText(wrapper)).toBe('Gebäude › Hauptgebäude › EG › Küche')
  })
})
