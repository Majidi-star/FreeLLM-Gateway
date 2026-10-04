import { contextBridge, ipcRenderer } from 'electron';

export interface UpdateStatusPayload {
  stage: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: any;
  progress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  };
  message?: string;
}

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstall: () => void;
  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void;
}

const electronAPI: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => {
    const handler = (_event: any, payload: UpdateStatusPayload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => {
      ipcRenderer.removeListener('update-status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
