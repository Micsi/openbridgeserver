/**
 * app/shell/roomDivider — the per-group divider seam (#116).
 *
 * The AppShell advertises a `#roomDivider` named slot ({ room, count }) so a skin
 * can replace the per-group label wholesale. The room grouping itself is iterated
 * deep in the body (SkinHost turns the ordered groups into one grid per room), so
 * the shell can't render the divider beside its grid directly. Instead the shell
 * `provide`s a *renderer* — the `#roomDivider` slot content, or the default
 * RoomDivider component as the fallback — and SkinHost calls it above each room
 * block. This makes the documented slot API real (it was never invoked before)
 * while keeping the grouping iteration where it already lives.
 *
 * Goldene Regel 4: the shell owns the grouping chrome (the divider), the skin
 * only fills the slot — it holds no state.
 */

import type { InjectionKey, VNode } from 'vue';

/** Render the per-group divider for a room block. */
export type RoomDividerRenderer = (props: { room: string; count?: number }) => VNode | VNode[];

/** Inject key for the shell-provided room divider renderer. */
export const ROOM_DIVIDER_KEY: InjectionKey<RoomDividerRenderer> = Symbol('obs-visu-room-divider');
