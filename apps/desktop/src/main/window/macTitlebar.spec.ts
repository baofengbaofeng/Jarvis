import { describe, it, expect } from 'vitest';
import {
  MAC_MENU_ICON_INSET,
  MAC_TRAFFIC_LIGHT_POSITION,
  MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN,
  MAC_TRAFFIC_LIGHT_Y,
  titleInsetFor,
  windowChromePayload,
} from './macTitlebar';

describe('macTitlebar', () => {
  it('uses the tuned native traffic-light y for windowed and fullscreen', () => {
    expect(MAC_TRAFFIC_LIGHT_Y).toBe(16);
    expect(MAC_TRAFFIC_LIGHT_POSITION.y).toBe(16);
    expect(MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN.y).toBe(16);
  });

  it('uses traffic-light offset when windowed, menu-icon inset when fullscreen', () => {
    expect(titleInsetFor(false)).toBe(80);
    expect(titleInsetFor(true)).toBe(MAC_MENU_ICON_INSET);
    expect(windowChromePayload(true).titleInset).toBe(16);
    expect(windowChromePayload(false).titleInset).toBe(80);
  });
});
