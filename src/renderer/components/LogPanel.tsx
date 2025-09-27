import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: string;
}

interface LogPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogPanel: React.FC<LogPanelProps> = ({ logs, onClearLogs }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = React.useState(false);

  // Prevent document scroll when terminal is focused
  useEffect(() => {
    const preventDocumentScroll = (e: Event) => {
      if (isFocused) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    if (isFocused) {
      // Prevent all scroll events on the document when terminal is focused
      document.addEventListener('wheel', preventDocumentScroll, {
        passive: false,
      });
      document.addEventListener('touchmove', preventDocumentScroll, {
        passive: false,
      });
      document.addEventListener('scroll', preventDocumentScroll, {
        passive: false,
      });

      // Also prevent keyboard scroll events
      document.addEventListener(
        'keydown',
        e => {
          if (
            isFocused &&
            (e.key === 'ArrowUp' ||
              e.key === 'ArrowDown' ||
              e.key === 'PageUp' ||
              e.key === 'PageDown' ||
              e.key === 'Home' ||
              e.key === 'End')
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        { passive: false }
      );
    }

    return () => {
      document.removeEventListener('wheel', preventDocumentScroll);
      document.removeEventListener('touchmove', preventDocumentScroll);
      document.removeEventListener('scroll', preventDocumentScroll);
    };
  }, [isFocused]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Prevent scroll event from bubbling up to parent elements
    e.stopPropagation();
    e.preventDefault();
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Prevent wheel events from bubbling up
    e.stopPropagation();
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const handleClick = () => {
    scrollContainerRef.current?.focus();
  };

  // const scrollToBottom = () => {
  //   if (scrollContainerRef.current) {
  //     scrollContainerRef.current.scrollTop =
  //       scrollContainerRef.current.scrollHeight;
  //   }
  // };

  const getLogColor = (type: 'info' | 'success' | 'error' | 'warning') => {
    switch (type) {
      case 'success':
        return 'text-green-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      default:
        return 'text-blue-400';
    }
  };

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-terminal-border">
        <h2 className="text-2xl font-bold text-terminal-text font-mono">
          TERMINAL_CONSOLE
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearLogs}
            className="btn btn-small flex items-center gap-2 font-mono"
          >
            <Trash2 size={14} />
            CLEAR_CONSOLE
          </button>
        </div>
      </div>

      <div
        className="relative"
        style={{
          contain: 'layout style paint',
          isolation: 'isolate',
        }}
      >
        <div
          ref={scrollContainerRef}
          className="bg-terminal-bg border border-terminal-border text-terminal-text rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-sm relative focus:outline-none cursor-pointer"
          onScroll={handleScroll}
          onWheel={handleWheel}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={handleClick}
          tabIndex={0}
          style={{
            scrollBehavior: 'smooth',
            overscrollBehavior: 'contain',
            isolation: 'isolate',
            contain: 'strict',
            height: '230px',
          }}
        >
          {logs.length === 0 ? (
            <div className="text-center py-8 text-terminal-textMuted">
              <p className="text-xs mt-1 font-mono">
                &gt; Console output will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-1" style={{ contain: 'layout style' }}>
              {logs.map((log, index) => (
                <div
                  key={index}
                  className={`log-entry ${log.type} flex items-start gap-2`}
                >
                  <span className="text-terminal-textMuted text-xs mt-0.5 flex-shrink-0 font-mono">
                    &gt; [{log.timestamp}]
                  </span>
                  <span
                    className={`flex-1 break-words font-mono ${getLogColor(
                      log.type
                    )}`}
                  >
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
