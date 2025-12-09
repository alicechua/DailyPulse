
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { decodeBase64, decodeAudioData } from '../utils/audioUtils';

interface AudioControllerProps {
  base64Audio: string | null;
  autoPlay?: boolean;
  onShareToTelegram?: () => void;
  isSharing?: boolean;
}

export const AudioController: React.FC<AudioControllerProps> = ({ 
  base64Audio, 
  autoPlay = false,
  onShareToTelegram,
  isSharing = false
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize Audio Context and Decode
  useEffect(() => {
    if (!base64Audio) return;

    const initAudio = async () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const context = new Ctx({ sampleRate: 24000 }); // Gemini TTS usually 24k
        audioContextRef.current = context;

        const rawData = decodeBase64(base64Audio);
        const buffer = await decodeAudioData(rawData, context, 24000, 1);
        
        audioBufferRef.current = buffer;
        setDuration(buffer.duration);
        setIsReady(true);
        
        if (autoPlay) {
           playAudio();
        }
      } catch (e) {
        console.error("Failed to decode audio", e);
      }
    };

    initAudio();

    return () => {
      stopAudio();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64Audio]);

  const updateProgress = () => {
    if (!audioContextRef.current) return;
    
    // Calculate current time based on how long it's been running
    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
    
    if (elapsed >= duration) {
        setIsPlaying(false);
        setCurrentTime(duration);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    } else {
        setCurrentTime(elapsed);
        animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const playAudio = useCallback(async () => {
    if (!audioContextRef.current || !audioBufferRef.current) return;

    // Resume context if suspended (browser policy)
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.connect(audioContextRef.current.destination);
    
    const startOffset = pauseTimeRef.current % audioBufferRef.current.duration;
    
    source.start(0, startOffset);
    sourceNodeRef.current = source;
    
    startTimeRef.current = audioContextRef.current.currentTime - startOffset;

    setIsPlaying(true);
    source.onended = () => {
       // Only stop if we didn't manually stop
    };

    updateProgress();
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseAudio = () => {
    if (sourceNodeRef.current && isPlaying) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
      
      if (audioContextRef.current) {
         pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore if already stopped */ }
    }
    pauseTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  if (!base64Audio) return null;

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50">
      <div className="max-w-3xl mx-auto flex items-center gap-4">
        <button
          onClick={togglePlay}
          disabled={!isReady}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center text-white shadow-md transition-all flex-shrink-0
            ${isReady ? 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105' : 'bg-slate-300 cursor-not-allowed'}
          `}
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </button>

        <div className="flex-1 flex flex-col gap-1">
            <div className="flex justify-between text-xs text-slate-500 font-medium">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden relative">
                <div 
                    className="absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-100 ease-linear"
                    style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                />
            </div>
        </div>

        {onShareToTelegram && (
          <button
            onClick={onShareToTelegram}
            disabled={isSharing}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0
              ${isSharing 
                ? 'bg-sky-100 text-sky-400 cursor-wait' 
                : 'bg-sky-50 text-sky-600 hover:bg-sky-100 hover:text-sky-700'
              }
            `}
            title="Send to Telegram"
          >
             <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 11.944 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
             </svg>
             <span className="hidden sm:inline">{isSharing ? 'Sending...' : 'Telegram'}</span>
          </button>
        )}
      </div>
    </div>
  );
};