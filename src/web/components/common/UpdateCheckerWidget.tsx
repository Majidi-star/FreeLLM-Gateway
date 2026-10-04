import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, ArrowUpCircle } from 'lucide-react';
import type { UpdateStatusPayload } from '../../electron.d';

export const UpdateCheckerWidget: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('0.1.0');
  const [isElectron, setIsElectron] = useState<boolean>(false);
  const [status, setStatus] = useState<UpdateStatusPayload>({ stage: 'not-available' });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.getVersion().then(setAppVersion).catch(() => {});

      const unsubscribe = window.electronAPI.onUpdateStatus((payload) => {
        setStatus(payload);
        if (payload.stage === 'checking' || payload.stage === 'downloading') {
          setIsLoading(true);
        } else {
          setIsLoading(false);
        }
      });

      return () => {
        unsubscribe();
      };
    }
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI) return;
    setIsLoading(true);
    setStatus({ stage: 'checking' });
    const res = await window.electronAPI.checkForUpdates();
    setIsLoading(false);
    if (!res.success && res.error) {
      setStatus({ stage: 'error', message: res.error });
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI) return;
    setIsLoading(true);
    setStatus({ stage: 'downloading', progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 } });
    const res = await window.electronAPI.downloadUpdate();
    if (!res.success && res.error) {
      setIsLoading(false);
      setStatus({ stage: 'error', message: res.error });
    }
  };

  const handleQuitAndInstall = () => {
    if (window.electronAPI) {
      window.electronAPI.quitAndInstall();
    }
  };

  if (!isElectron) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
        <div className="flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 text-[var(--signal-mint)]" />
          <span>GoalRoute Version {appVersion} (Web Mode)</span>
        </div>
      </div>
    );
  }

  const percent = Math.round(status.progress?.percent || 0);

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <ArrowUpCircle className="w-4 h-4 text-[var(--accent-primary)]" />
          <span className="font-semibold text-[var(--text-primary)]">Desktop App Updater</span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] font-mono text-[10px]">
            v{appVersion}
          </span>
        </div>

        {status.stage === 'not-available' && (
          <button
            onClick={handleCheckForUpdates}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] text-white font-medium flex items-center space-x-1.5 hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Check for Updates</span>
          </button>
        )}
      </div>

      {status.stage === 'checking' && (
        <div className="flex items-center space-x-2 text-[var(--text-muted)] animate-pulse">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Checking update servers...</span>
        </div>
      )}

      {status.stage === 'available' && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-400">
          <div>
            <p className="font-bold">New Version Available! {status.info?.version ? `(v${status.info.version})` : ''}</p>
            <p className="text-[11px] text-emerald-300/80">Click download to fetch the update automatically in the background.</p>
          </div>
          <button
            onClick={handleDownloadUpdate}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-all flex items-center space-x-1 cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Update</span>
          </button>
        </div>
      )}

      {status.stage === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
            <span>Downloading release update...</span>
            <span className="font-mono font-bold">{percent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-[var(--signal-mint)] transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {status.stage === 'downloaded' && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-mint-950/30 border border-[var(--signal-mint)]/40 text-[var(--signal-mint)]">
          <div>
            <p className="font-bold">Update Downloaded & Ready!</p>
            <p className="text-[11px] text-[var(--text-muted)]">Restart GoalRoute now to apply the new version.</p>
          </div>
          <button
            onClick={handleQuitAndInstall}
            className="px-3 py-1.5 rounded-lg bg-[var(--signal-mint)] text-slate-950 font-bold hover:opacity-90 transition-all flex items-center space-x-1 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Restart & Install</span>
          </button>
        </div>
      )}

      {status.stage === 'error' && (
        <div className="flex items-center space-x-2 text-rose-400 p-2 rounded-lg bg-rose-950/30 border border-rose-500/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-[11px] truncate">Update check failed: {status.message || 'Server unavailable'}</span>
        </div>
      )}
    </div>
  );
};
