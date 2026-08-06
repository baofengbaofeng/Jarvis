import { assertAllowedEvent, assertAllowedInvoke } from '@jarvis/protocol';

export function gateInvokeChannel(channel: string): void {
  assertAllowedInvoke(channel);
}

export function gateEventChannel(channel: string): void {
  assertAllowedEvent(channel);
}
