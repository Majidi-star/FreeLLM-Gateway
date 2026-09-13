import React, { useState } from 'react';
import { Search, Plus, Trash2, Edit2, Check, X, MessageSquare, Clock } from 'lucide-react';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface ChatHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onDeleteSession: (id: string) => void;
}

export const ChatHistoryDrawer: React.FC<ChatHistoryDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onRenameSession,
  onDeleteSession,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState('');

  if (!isOpen) return null;

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEditing = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitleDraft(session.title);
  };

  const saveEditing = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitleDraft.trim()) {
      onRenameSession(id, editTitleDraft.trim());
    }
    setEditingId(null);
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-[var(--bg-rail)] border-l border-[var(--border-subtle)] h-full flex flex-col p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-5 h-5 text-[var(--accent-primary)]" />
            <h2 className="font-bold text-base text-[var(--text-bright)]">Chat History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action & Search Bar */}
        <div className="space-y-3">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Start New Chat</span>
          </button>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search chat history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] text-xs text-[var(--text-primary)] rounded-xl focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {filteredSessions.length === 0 ? (
            <div className="text-center py-10 text-xs text-[var(--text-muted)] space-y-1">
              <MessageSquare className="w-8 h-8 mx-auto opacity-30 mb-2" />
              <p>No chat history found</p>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isEditing = session.id === editingId;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                  className={`group relative p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isActive
                      ? 'bg-[var(--bg-card-active)] border-[var(--border-hover)] text-[var(--text-bright)] shadow-sm'
                      : 'bg-[var(--bg-card)]/60 border-[var(--border-subtle)] hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-bright)]'
                  }`}
                >
                  <div className="flex items-center justify-between space-x-2">
                    {isEditing ? (
                      <div className="flex items-center space-x-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editTitleDraft}
                          onChange={(e) => setEditTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditing(session.id, e as any);
                            if (e.key === 'Escape') cancelEditing(e as any);
                          }}
                          autoFocus
                          className="flex-1 px-2 py-1 bg-[var(--bg-well)] border border-[var(--accent-primary)] text-xs font-semibold rounded text-[var(--text-bright)] focus:outline-none"
                        />
                        <button
                          onClick={(e) => saveEditing(session.id, e)}
                          className="p-1 text-[var(--signal-mint)] hover:bg-white/10 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1 text-[var(--signal-coral)] hover:bg-white/10 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="font-semibold text-xs truncate flex-1 leading-tight">
                          {session.title || 'Untitled Session'}
                        </h3>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 transition-opacity">
                          <button
                            onClick={(e) => startEditing(session, e)}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-white/10"
                            title="Rename chat"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession(session.id);
                            }}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--signal-coral)] hover:bg-white/10"
                            title="Delete chat"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mt-2 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(session.updatedAt)}
                    </span>
                    <span>{session.messageCount} msg{session.messageCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
