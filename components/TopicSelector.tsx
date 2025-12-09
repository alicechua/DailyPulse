import React from 'react';
import { TopicOption } from '../types';

interface TopicSelectorProps {
  topics: TopicOption[];
  toggleTopic: (id: string) => void;
  disabled: boolean;
}

export const TopicSelector: React.FC<TopicSelectorProps> = ({ topics, toggleTopic, disabled }) => {
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      {topics.map((topic) => (
        <button
          key={topic.id}
          onClick={() => toggleTopic(topic.id)}
          disabled={disabled}
          className={`
            px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border
            ${
              topic.selected
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {topic.label}
        </button>
      ))}
    </div>
  );
};