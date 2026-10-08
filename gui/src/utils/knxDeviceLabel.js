// Chip text of a KNX device as KnxDeviceCombobox items carry it (`id` = physical
// address, `label` = name): the KNX monitor's filter editor and the datapoint
// picker's device lens show devices the same way (#1266).

export function knxDeviceChipLabel(item) {
  if (!item) return ''
  const pa = item.id ?? item.pa
  const label = item.label ?? item.name
  return label && label !== pa ? `${pa} ${label}` : String(pa ?? '')
}

export function knxDeviceChipTitle(item) {
  if (!item) return ''
  return [item.id ?? item.pa, item.label ?? item.name, item.manufacturer, item.order_number]
    .filter(Boolean)
    .join(' · ')
}
