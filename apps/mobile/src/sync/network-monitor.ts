// ────────────────────────────────────────────────────────────────────────────
// Network Monitor — online/offline detection via NetInfo
//
// Simple wrapper that tracks connectivity state and notifies listeners
// when the device goes online or offline. The sync manager subscribes
// to trigger a sync cycle on reconnection.
// ────────────────────────────────────────────────────────────────────────────

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

type NetworkListener = (isOnline: boolean) => void;

let _isOnline = true;
const listeners: Set<NetworkListener> = new Set();

/**
 * Start listening to network state changes.
 * Returns an unsubscribe function.
 */
export function startNetworkMonitor(): () => void {
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOnline = _isOnline;
    _isOnline = !!state.isConnected;

    if (!wasOnline && _isOnline) {
      // Network restored
      listeners.forEach((fn) => fn(true));
    } else if (wasOnline && !_isOnline) {
      // Network lost
      listeners.forEach((fn) => fn(false));
    }
  });

  return unsubscribe;
}

/** Current connectivity state. */
export function isOnline(): boolean {
  return _isOnline;
}

/**
 * Register a listener for network state changes.
 * Returns an unsubscribe function.
 */
export function onNetworkChange(fn: NetworkListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
