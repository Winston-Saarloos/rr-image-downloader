import React, { useEffect, useRef } from 'react';
import { Trash2, Terminal } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

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

  const getLogColor = (type: 'info' | 'success' | 'error' | 'warning') => {
    switch (type) {
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-blue-600 dark:text-blue-400';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Console Logs
            </CardTitle>
            <CardDescription>View operation logs and messages</CardDescription>
          </div>
          <Button
            onClick={onClearLogs}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="relative"
          style={{
            contain: 'layout style paint',
            isolation: 'isolate',
          }}
        >
          <div
            ref={scrollContainerRef}
            className="bg-muted border rounded-lg p-4 max-h-64 overflow-y-auto text-sm relative focus:outline-none cursor-pointer font-mono"
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
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Console output will appear here</p>
              </div>
            ) : (
              <div className="space-y-1" style={{ contain: 'layout style' }}>
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className={`flex items-start gap-2 ${getLogColor(log.type)}`}
                  >
                    <span className="text-muted-foreground text-xs mt-0.5 flex-shrink-0">
                      [{log.timestamp}]
                    </span>
                    <span className="flex-1 break-words">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
