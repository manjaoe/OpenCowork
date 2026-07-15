import { createContext, useContext } from 'react'
import type { Point } from './graph-geometry'

export interface PendingConnection {
  sourceId: string
  cursor: Point
}

interface ConnectionValue {
  pending: PendingConnection | null
  setPending: (value: PendingConnection | null) => void
}

export const ConnectionState = createContext<ConnectionValue>({
  pending: null,
  setPending: () => {}
})

export function useConnection(): ConnectionValue {
  return useContext(ConnectionState)
}
