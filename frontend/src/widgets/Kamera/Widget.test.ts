// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import KameraWidget from './Widget.vue'

function mountWidget(pageId?: string | null, sessionToken?: string | null) {
  return mount(KameraWidget, {
    props: {
      config: {
        url: 'http://camera.local/stream',
        useProxy: true,
      },
      datapointId: null,
      value: null,
      statusValue: null,
      editorMode: false,
      pageId,
      sessionToken,
    },
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  })
}

beforeEach(() => {
  localStorage.setItem('visu_jwt', 'jwt-1')
})

afterEach(() => {
  localStorage.clear()
})

describe('Kamera widget proxy scope', () => {
  it('adds the viewer page id to proxied camera URLs', () => {
    const wrapper = mountWidget('page-1')

    const src = wrapper.get('img').attributes('src')
    expect(src).toBeDefined()
    if (!src) return
    const params = new URLSearchParams(src.split('?')[1])

    expect(src.startsWith('/api/v1/camera/proxy?')).toBe(true)
    expect(params.get('url')).toBe('http://camera.local/stream')
    expect(params.get('_token')).toBe('jwt-1')
    expect(params.get('page_id')).toBe('page-1')
  })

  it('adds the protected page session token to proxied camera URLs', () => {
    const wrapper = mountWidget('page-1', 'session-1')

    const src = wrapper.get('img').attributes('src')
    expect(src).toBeDefined()
    if (!src) return
    const params = new URLSearchParams(src.split('?')[1])

    expect(params.get('session_token')).toBe('session-1')
  })
})
