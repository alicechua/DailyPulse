import React from 'react';
import ReactMarkdown from 'react-markdown'; // Assuming standard markdown rendering or simple text
import { NewsSource } from '../types';

interface BriefingDisplayProps {
  text: string;
  sources: NewsSource[];
}

export const BriefingDisplay: React.FC<BriefingDisplayProps> = ({ text, sources }) => {
  
  // Simple markdown-like rendering for the text content
  const renderText = (content: string) => {
    return content.split('\n').map((line, index) => {
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-xl font-bold text-slate-800 mt-6 mb-3">{line.replace('## ', '')}</h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={index} className="text-lg font-semibold text-slate-700 mt-4 mb-2">{line.replace('### ', '')}</h3>;
      }
      if (line.startsWith('* ') || line.startsWith('- ')) {
        return <li key={index} className="ml-4 list-disc text-slate-600 mb-2">{line.replace(/^[\*\-] /, '')}</li>;
      }
      if (line.trim() === '') {
        return <div key={index} className="h-2"></div>;
      }
      return <p key={index} className="text-slate-600 leading-relaxed mb-3">{line}</p>;
    });
  };

  return (
    <div className="animate-fade-in">
      <div className="prose prose-slate max-w-none mb-8 bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
        {renderText(text)}
      </div>

      {sources.length > 0 && (
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
          <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Sources & References</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sources.map((source, idx) => (
              <a
                key={idx}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all text-sm text-slate-700 truncate group"
              >
                <span className="w-2 h-2 rounded-full bg-indigo-400 mr-3 flex-shrink-0 group-hover:bg-indigo-600"></span>
                <span className="truncate">{source.title || source.uri}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};