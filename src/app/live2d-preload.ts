import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('athenaPetAPI', {
  hide: () => ipcRenderer.invoke('avatar:desktop:hide'),
  ready: () => ipcRenderer.send('avatar:desktop:ready'),
  sendInteraction: (prompt: string, hotZoneId: string) => {
    ipcRenderer.send('avatar:desktop:interaction', { prompt, hotZoneId });
  },
  onAvatarEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: unknown, event: Record<string, unknown>) => callback(event);
    ipcRenderer.on('avatar:desktop:event:renderer', handler);
    return () => ipcRenderer.removeListener('avatar:desktop:event:renderer', handler);
  },
});
