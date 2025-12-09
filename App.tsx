
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateNewsBriefing, generateBriefingAudio } from './services/geminiService';
import { sendVoiceToTelegram } from './services/telegramService';
import { TopicSelector } from './components/TopicSelector';
import { BriefingDisplay } from './components/BriefingDisplay';
import { AudioController } from './components/AudioController';
import { TelegramConfigModal } from './components/TelegramConfigModal';
import { TopicOption, LoadingState, BriefingData, TelegramConfig } from './types';

const INITIAL_TOPICS: TopicOption[] = [
  { id: 'ai', label: 'Artificial Intelligence', selected: true },
  { id: 'world', label: 'World News', selected: true },
  { id: 'tech', label: 'Technology', selected: false },
  { id: 'finance', label: 'Finance & Markets', selected: false },
  { id: 'science', label: 'Science', selected: false },
  { id: 'sports', label: 'Sports', selected: false },
];

const App: React.FC = () => {
  const [topics, setTopics] = useState<TopicOption[]>(INITIAL_TOPICS);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
  const [base64Audio, setBase64Audio] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Telegram State
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({ botToken: '', chatId: '' });

  // Refs for scheduler to access latest state without re-triggering effects
  const telegramConfigRef = useRef(telegramConfig);
  const topicsRef = useRef(topics);
  const isRunningAutoRef = useRef(false);

  // Load Config
  useEffect(() => {
    const savedConfig = localStorage.getItem('dailyPulse_telegramConfig');
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      setTelegramConfig(parsed);
      telegramConfigRef.current = parsed;
    }
  }, []);

  // Update refs when state changes
  useEffect(() => {
    telegramConfigRef.current = telegramConfig;
  }, [telegramConfig]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  const saveTelegramConfig = (config: TelegramConfig) => {
    setTelegramConfig(config);
    localStorage.setItem('dailyPulse_telegramConfig', JSON.stringify(config));
  };

  const toggleTopic = (id: string) => {
    setTopics((prev) =>
      prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t))
    );
  };

  // ----------------------------------------------------
  // Core Logic (Refactored for Automation)
  // ----------------------------------------------------

  const performBriefingGeneration = async (selectedTopics: string[]) => {
    setLoadingState(LoadingState.FETCHING_FEEDS);
    const { text, sources } = await generateNewsBriefing(selectedTopics);
    
    setLoadingState(LoadingState.GENERATING_TEXT);
    const data: BriefingData = {
      markdownText: text,
      sources,
      timestamp: new Date().toLocaleString(),
    };
    setBriefingData(data);

    setLoadingState(LoadingState.GENERATING_AUDIO);
    const audioData = await generateBriefingAudio(text);
    setBase64Audio(audioData);
    setLoadingState(LoadingState.COMPLETE);

    return { data, audioData };
  };

  const performTelegramSend = async (audio: string, timestamp: string, config: TelegramConfig) => {
    setIsSendingTelegram(true);
    const summary = `Daily Pulse Briefing\n${timestamp}`;
    await sendVoiceToTelegram(audio, summary, config);
    setIsSendingTelegram(false);
  };

  const handleGenerate = async () => {
    const selectedTopics = topics.filter((t) => t.selected).map((t) => t.label);
    
    if (selectedTopics.length === 0) {
      setErrorMsg("Please select at least one topic for your briefing.");
      return;
    }

    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      setBriefingData(null);
      setBase64Audio(null);
      
      await performBriefingGeneration(selectedTopics);

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Something went wrong while generating your briefing. Please try again.");
      setLoadingState(LoadingState.ERROR);
    }
  };

  const handleShareToTelegram = async () => {
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
      setIsTelegramModalOpen(true);
      return;
    }

    if (!base64Audio || !briefingData) return;

    try {
      setSuccessMsg(null);
      setErrorMsg(null);
      await performTelegramSend(base64Audio, briefingData.timestamp, telegramConfig);
      setSuccessMsg("Briefing sent to Telegram successfully!");
    } catch (err: any) {
      handleTelegramError(err);
    }
  };

  const handleTelegramError = (err: any) => {
      console.error("Telegram Error", err);
      const errMsg = err.message || '';
      setIsSendingTelegram(false);

      if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        setErrorMsg("Invalid Bot Token. Please check your Telegram settings.");
        setIsTelegramModalOpen(true);
      } else if (errMsg.includes('chat not found')) {
        setErrorMsg("Chat not found. Please ensure you have pressed 'Start' on your bot in Telegram and the Chat ID is correct.");
        setIsTelegramModalOpen(true);
      } else if (errMsg.includes('404')) {
         setErrorMsg("Telegram API not found. Please check your Bot Token.");
         setIsTelegramModalOpen(true);
      } else {
        setErrorMsg(`Telegram Error: ${errMsg}`);
      }
  };

  // ----------------------------------------------------
  // Scheduler Logic
  // ----------------------------------------------------

  const runAutoPilot = useCallback(async () => {
    if (isRunningAutoRef.current) return;
    const config = telegramConfigRef.current;
    
    // Check if enabled and valid
    if (!config.autoSend?.enabled || !config.botToken || !config.chatId) return;

    const now = new Date();
    const [targetHour, targetMinute] = config.autoSend.time.split(':').map(Number);
    const todayStr = now.toISOString().split('T')[0];

    // Check if already ran today
    if (config.autoSend.lastSentDate === todayStr) return;

    // Check if it's time (within the minute window)
    if (now.getHours() === targetHour && now.getMinutes() === targetMinute) {
      
      console.log("[Auto-Pilot] Starting scheduled sequence...");
      isRunningAutoRef.current = true;
      setSuccessMsg(null); 
      setErrorMsg(null);

      try {
        const selectedTopics = topicsRef.current.filter((t) => t.selected).map((t) => t.label);
        
        // 1. Generate
        const { data, audioData } = await performBriefingGeneration(selectedTopics);
        
        // 2. Send
        await performTelegramSend(audioData, data.timestamp, config);
        
        // 3. Update Last Sent Date
        const newConfig = {
          ...config,
          autoSend: {
            ...config.autoSend!,
            lastSentDate: todayStr
          }
        };
        saveTelegramConfig(newConfig);
        setSuccessMsg("Auto-Pilot: Briefing sent to Telegram successfully!");

      } catch (e: any) {
        console.error("[Auto-Pilot] Failed:", e);
        setErrorMsg(`Auto-Pilot Failed: ${e.message}`);
        setLoadingState(LoadingState.ERROR);
      } finally {
        isRunningAutoRef.current = false;
      }
    }
  }, []);

  // Timer Effect
  useEffect(() => {
    const timer = setInterval(() => {
      runAutoPilot();
    }, 10000); // Check every 10 seconds to be safe (no need for ms precision, but miss-proof)

    return () => clearInterval(timer);
  }, [runAutoPilot]);


  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const isLoading = loadingState === LoadingState.FETCHING_FEEDS || loadingState === LoadingState.GENERATING_TEXT || loadingState === LoadingState.GENERATING_AUDIO;
  const isAutoEnabled = telegramConfig.autoSend?.enabled;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
              P
            </div>
            <span className="font-bold text-slate-800 text-lg tracking-tight">Daily Pulse</span>
          </div>
          <div className="flex items-center gap-3">
             {isAutoEnabled && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100 animate-fade-in" title={`Will send at ${telegramConfig.autoSend?.time}`}>
                   <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                   Auto-Pilot On
                </div>
             )}
             <button 
                onClick={() => setIsTelegramModalOpen(true)}
                className="text-slate-400 hover:text-indigo-600 transition-colors"
                title="Telegram Settings"
             >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                   <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                </svg>
             </button>
             <div className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
               {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <section className="mb-8">
          <h1 className="text-3xl font-light text-slate-800 mb-2">
            {getGreeting()}, <span className="font-semibold">User</span>.
          </h1>
          <p className="text-slate-500">
            Ready for your personalized daily briefing? Select your interests below.
          </p>
        </section>

        <section className="mb-8">
          <TopicSelector
            topics={topics}
            toggleTopic={toggleTopic}
            disabled={isLoading}
          />
          
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className={`
              w-full sm:w-auto px-8 py-3 rounded-xl font-semibold text-white transition-all shadow-lg shadow-indigo-200
              ${
                isLoading
                  ? 'bg-indigo-400 cursor-wait'
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-0.5'
              }
            `}
          >
            {loadingState === LoadingState.FETCHING_FEEDS && 'Gathering Intel (RSS)...'}
            {loadingState === LoadingState.GENERATING_TEXT && 'Analyzing & Writing...'}
            {loadingState === LoadingState.GENERATING_AUDIO && 'Synthesizing Voice...'}
            {(loadingState === LoadingState.IDLE || loadingState === LoadingState.COMPLETE || loadingState === LoadingState.ERROR) && 'Generate Briefing'}
          </button>
        </section>

        {/* Status Messages */}
        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg mb-6 flex items-start animate-fade-in">
            <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-lg mb-6 flex items-start animate-fade-in">
            <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {successMsg}
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
           <div className="animate-pulse space-y-4 max-w-2xl">
              <div className="h-4 bg-slate-200 rounded w-3/4"></div>
              <div className="h-4 bg-slate-200 rounded w-full"></div>
              <div className="h-4 bg-slate-200 rounded w-5/6"></div>
              <div className="h-32 bg-slate-100 rounded-xl mt-6"></div>
           </div>
        )}

        {/* Content Display */}
        {briefingData && (
          <div className="animate-fade-in">
            {/* Action Bar */}
            {base64Audio && (
               <div className="mb-6 p-4 bg-gradient-to-r from-sky-50 to-indigo-50 rounded-xl border border-sky-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                 <div>
                   <h3 className="font-semibold text-sky-900">Audio Briefing Ready</h3>
                   <p className="text-sm text-sky-700/80">Listen below or send to your device.</p>
                 </div>
                 <button
                   onClick={handleShareToTelegram}
                   disabled={isSendingTelegram}
                   className={`
                     flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all shadow-sm
                     ${isSendingTelegram 
                        ? 'bg-white text-sky-400 border border-sky-200 cursor-wait'
                        : 'bg-sky-500 hover:bg-sky-600 text-white hover:shadow-md'
                     }
                   `}
                 >
                   <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 11.944 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                   </svg>
                   {isSendingTelegram ? 'Sending to Telegram...' : 'Send to Telegram'}
                 </button>
               </div>
            )}
            
            <BriefingDisplay text={briefingData.markdownText} sources={briefingData.sources} />
          </div>
        )}
      </main>

      {/* Audio Player */}
      <AudioController 
        base64Audio={base64Audio} 
        autoPlay={loadingState === LoadingState.COMPLETE} 
        onShareToTelegram={handleShareToTelegram}
        isSharing={isSendingTelegram}
      />

      {/* Modals */}
      <TelegramConfigModal 
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        onSave={saveTelegramConfig}
        initialConfig={telegramConfig}
      />
    </div>
  );
};

export default App;