
import React, { useState, useEffect } from 'react';
import { TelegramConfig } from '../types';

interface TelegramConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: TelegramConfig) => void;
  initialConfig: TelegramConfig;
}

export const TelegramConfigModal: React.FC<TelegramConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialConfig,
}) => {
  const [botToken, setBotToken] = useState(initialConfig.botToken);
  const [chatId, setChatId] = useState(initialConfig.chatId);
  
  // Auto-send state
  const [autoEnabled, setAutoEnabled] = useState(initialConfig.autoSend?.enabled || false);
  const [autoTime, setAutoTime] = useState(initialConfig.autoSend?.time || "08:00");

  useEffect(() => {
    if (isOpen) {
      setBotToken(initialConfig.botToken);
      setChatId(initialConfig.chatId);
      setAutoEnabled(initialConfig.autoSend?.enabled || false);
      setAutoTime(initialConfig.autoSend?.time || "08:00");
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ 
      botToken: botToken.trim(), 
      chatId: chatId.trim(),
      autoSend: {
        enabled: autoEnabled,
        time: autoTime,
        lastSentDate: initialConfig.autoSend?.lastSentDate // Preserve history
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-scale-in max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Telegram Settings</h2>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-6 text-sm text-blue-800 space-y-2">
            <p><strong>Step 1:</strong> Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline">@BotFather</a> to get your <b>Bot Token</b>.</p>
            <p><strong>Step 2:</strong> <span className="text-red-600 font-bold">IMPORTANT:</span> Open your new bot in Telegram and click <b>Start</b>.</p>
            <p><strong>Step 3:</strong> Message <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="underline">@userinfobot</a> to get your numerical <b>ID</b>.</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Bot Token
            </label>
            <input
              type="text"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjkl..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Chat ID
            </label>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="12345678"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Your numerical User ID (e.g. 12345678)</p>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="relative">
                  <input 
                    type="checkbox" 
                    checked={autoEnabled}
                    onChange={(e) => setAutoEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </div>
                <span className="text-sm font-medium text-slate-700">Daily Auto-Send</span>
              </label>
              
              <input 
                 type="time" 
                 value={autoTime}
                 onChange={(e) => setAutoTime(e.target.value)}
                 disabled={!autoEnabled}
                 className="px-2 py-1 border border-slate-300 rounded-md text-sm disabled:opacity-50"
              />
            </div>
            
            {autoEnabled && (
               <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg flex gap-3 text-xs text-yellow-800">
                  <svg className="w-5 h-5 flex-shrink-0 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p>
                    <strong>Browser Requirement:</strong> For auto-send to work, this website must remain open in a tab on your device at {autoTime}.
                  </p>
               </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 font-medium text-sm hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};