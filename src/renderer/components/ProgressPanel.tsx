import React, { useState, useEffect } from 'react';
import { Progress, RecNetSettings } from '../../shared/types';

interface ProgressPanelProps {
  progress: Progress;
  settings?: RecNetSettings;
}

export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  progress,
  settings,
}) => {
  const [eta, setEta] = useState<string>('');
  const [startTime, setStartTime] = useState<number | null>(null);

  // Calculate ETA based on progress and request delay
  useEffect(() => {
    if (progress.isRunning && progress.total > 0 && progress.current > 0) {
      if (!startTime) {
        setStartTime(Date.now());
        return;
      }

      const elapsed = Date.now() - startTime;
      const rate = progress.current / elapsed; // items per millisecond
      const remaining = progress.total - progress.current;

      if (rate > 0) {
        const estimatedRemainingMs = remaining / rate;

        // Add request delay overhead based on operation type
        const requestDelay = settings?.interPageDelayMs || 500;
        let estimatedDelayOverhead = 0;

        // For metadata collection operations, add delay per page
        if (
          progress.currentStep.includes('Fetching page') ||
          progress.currentStep.includes('Collecting')
        ) {
          estimatedDelayOverhead = remaining * requestDelay;
        }

        const totalEstimatedMs = estimatedRemainingMs + estimatedDelayOverhead;

        if (totalEstimatedMs > 0) {
          const minutes = Math.floor(totalEstimatedMs / 60000);
          const seconds = Math.floor((totalEstimatedMs % 60000) / 1000);

          if (minutes > 0) {
            setEta(`${minutes}m ${seconds}s`);
          } else if (seconds > 0) {
            setEta(`${seconds}s`);
          } else {
            setEta('< 1s');
          }
        }
      }
    } else if (!progress.isRunning) {
      setEta('');
      setStartTime(null);
    }
  }, [progress, settings, startTime]);
  return (
    <div className="panel">
      <h2 className="text-2xl font-bold text-terminal-text mb-6 pb-3 border-b-2 border-terminal-border font-mono">
        SYSTEM_STATUS
      </h2>

      <div className="space-y-4">
        {/* Current Operation */}
        <div>
          <label className="form-label font-mono text-sm">
            CURRENT_OPERATION:
          </label>
          <div className="bg-terminal-bg border border-terminal-border rounded p-3 font-mono text-sm">
            <div className="flex items-center gap-2 mb-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  progress.isRunning
                    ? 'bg-terminal-warning animate-pulse'
                    : progress.progress === 100
                      ? 'bg-terminal-success'
                      : 'bg-terminal-textDim'
                }`}
              />
              <span className="text-terminal-text">
                {progress.isRunning
                  ? 'OPERATION_ACTIVE'
                  : progress.progress === 100
                    ? 'OPERATION_COMPLETE'
                    : 'SYSTEM_READY'}
              </span>
            </div>
            <div className="text-terminal-textDim">
              {progress.currentStep || 'Ready'}
            </div>
          </div>
        </div>

        {/* Progress Details */}
        {progress.isRunning && (
          <div>
            <label className="form-label font-mono text-sm">
              PROGRESS_DETAILS:
            </label>
            <div className="bg-terminal-bg border border-terminal-border rounded p-3 font-mono text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-terminal-textDim">Progress:</span>
                <span className="text-terminal-accent">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-textDim">Percentage:</span>
                <span className="text-terminal-accent">
                  {Math.round(progress.progress)}%
                </span>
              </div>
              {eta && (
                <div className="flex justify-between">
                  <span className="text-terminal-textDim">ETA:</span>
                  <span className="text-terminal-accent">{eta}</span>
                </div>
              )}
              {progress.total > 0 && (
                <div className="w-full bg-terminal-surface rounded-full h-2">
                  <div
                    className="bg-terminal-accent h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
