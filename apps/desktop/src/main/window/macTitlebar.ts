/**
 * macOS traffic-light + titlebar inset.
 *
 * - Windowed: collapse sits just to the right of the traffic lights.
 * - Fullscreen: collapse uses the same left inset as sidebar menu icons
 *   (New Chat / nav) — not the traffic-light cluster width.
 *
 * Renderer aligns vertically with flex only (no top / margin-top).
 */

export const MAC_TOPBAR_HEIGHT = 48;
export const MAC_TRAFFIC_LIGHT_SIZE = 12;
/** 3×12px buttons + 2×8px gaps. */
export const MAC_TRAFFIC_CLUSTER_WIDTH = 52;
/** Gap between green light and collapse (windowed only). */
export const MAC_TRAFFIC_TO_COLLAPSE_GAP = 14;

/**
 * Left edge of sidebar menu icons (matches .sidebar-quick padding + btn pad:
 * space-1 + space-3 = 4 + 12). Used for collapse in fullscreen only.
 */
export const MAC_MENU_ICON_INSET = 16;

/**
 * Native y for traffic lights (tuned against the 12×12 collapse glyph).
 * Increased from 14 → 16 after lights read ~2px high.
 */
export const MAC_TRAFFIC_LIGHT_Y = 16;

export const MAC_TRAFFIC_LIGHT_POSITION = {
  x: 14,
  y: MAC_TRAFFIC_LIGHT_Y,
} as const;

export const MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN = {
  x: 0,
  y: MAC_TRAFFIC_LIGHT_Y,
} as const;

export type WindowChromePayload = {
  fullscreen: boolean;
  trafficLight: { x: number; y: number };
  /**
   * Titlebar padding-left for the collapse control.
   * Windowed: after traffic lights. Fullscreen: menu-icon column.
   */
  titleInset: number;
};

export function trafficLightPositionFor(fullscreen: boolean): { x: number; y: number } {
  return fullscreen
    ? { ...MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN }
    : { ...MAC_TRAFFIC_LIGHT_POSITION };
}

export function titleInsetFor(fullscreen: boolean): number {
  if (fullscreen) return MAC_MENU_ICON_INSET;
  return (
    MAC_TRAFFIC_LIGHT_POSITION.x
    + MAC_TRAFFIC_CLUSTER_WIDTH
    + MAC_TRAFFIC_TO_COLLAPSE_GAP
  );
}

export function windowChromePayload(fullscreen: boolean): WindowChromePayload {
  return {
    fullscreen,
    trafficLight: trafficLightPositionFor(fullscreen),
    titleInset: titleInsetFor(fullscreen),
  };
}
