import { WidgetRegistry } from '@/widgets/registry'
import Widget from './Widget.vue'
import Config from './Config.vue'

WidgetRegistry.register({
  type: 'Fenster',
  label: 'Fenster / Türe',
  icon: '🚪',
  minW: 2, minH: 2,
  defaultW: 2, defaultH: 3,
  component: Widget,
  configComponent: Config,
  defaultConfig: {
    label: '',
    mode: 'fenster',        // 'fenster' | 'fenster_2' | 'tuere' | 'schiebetuer' | 'dachfenster'
    dp_contact: '',
    dp_tilt: '',
    dp_contact_left: '',
    dp_tilt_left: '',
    dp_contact_right: '',
    dp_tilt_right: '',
    dp_position: '',
  },
  compatibleTypes: ['*'],
  noDatapoint: true,
  getExtraDatapointIds: (config) => {
    return [
      config.dp_contact       as string,
      config.dp_tilt          as string,
      config.dp_contact_left  as string,
      config.dp_tilt_left     as string,
      config.dp_contact_right as string,
      config.dp_tilt_right    as string,
      config.dp_position      as string,
    ].filter(Boolean) as string[]
  },
})
