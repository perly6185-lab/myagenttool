export const PROTOCOL_NAMESPACE = "com.myagenttool" as const;
export const PROTOCOL_VERSION = "0.0.0" as const;

export type ProtocolNamespace = typeof PROTOCOL_NAMESPACE;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface ProtocolNamespaced {
  namespace: ProtocolNamespace;
  protocolVersion: ProtocolVersion;
}
