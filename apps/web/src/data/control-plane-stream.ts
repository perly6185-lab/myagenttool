let connected = false;
const listeners = new Set<(value: boolean) => void>();

export function isControlPlaneStreamConnected() {
  return connected;
}

export function setControlPlaneStreamConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  listeners.forEach((listener) => listener(value));
}

export function subscribeControlPlaneStream(listener: (value: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
