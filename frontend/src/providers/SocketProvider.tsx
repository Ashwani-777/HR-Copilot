import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

type SocketState = { socket: Socket | null; connected: boolean };
const SocketContext = createContext<SocketState>({ socket: null, connected: false });

/** One Socket.IO connection per session: `io({ auth: { token } })`, server joins us to `company:<id>`. */
export function SocketProvider({ token, children }: { token: string; children: ReactNode }) {
  const [state, setState] = useState<SocketState>({ socket: null, connected: false });

  useEffect(() => {
    const socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
    setState({ socket, connected: socket.connected });
    const onConnect = () => setState({ socket, connected: true });
    const onDisconnect = () => setState({ socket, connected: false });
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.disconnect();
    };
  }, [token]);

  return <SocketContext.Provider value={state}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
