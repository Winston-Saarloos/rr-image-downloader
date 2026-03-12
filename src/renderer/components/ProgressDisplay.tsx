import React, { useEffect, useRef, useState } from 'react';
import { Progress } from '../components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Progress as ProgressType } from '../../shared/types';
import { Loader2, CheckCircle2, X } from 'lucide-react';
import { Button } from '../components/ui/button';

interface ProgressDisplayProps {
  progress: ProgressType;
  onClose?: () => void;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progress,
  onClose,
}) => {
  const percent = Math.min(
    Math.max(Math.round(progress.progress ?? 0), 0),
    100
  );
  const hasTotals = progress.total > 0;
  const isComplete = !progress.isRunning && percent >= 100;
  const [indeterminateValue, setIndeterminateValue] = useState(15);
  const directionRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (!progress.isRunning || hasTotals) {
      setIndeterminateValue(15);
      directionRef.current = 1;
      return;
    }

    const interval = setInterval(() => {
      setIndeterminateValue(prev => {
        const next = prev + directionRef.current * 6;

        if (next >= 85) {
          directionRef.current = -1;
          return 85;
        }

        if (next <= 15) {
          directionRef.current = 1;
          return 15;
        }

        return next;
      });
    }, 120);

    return () => clearInterval(interval);
  }, [progress.isRunning, hasTotals]);

  const isIdle =
    !progress.isRunning &&
    percent === 0 &&
    (!progress.currentStep || progress.currentStep === 'Ready');
  const barValue = hasTotals
    ? percent
    : progress.isRunning
      ? indeterminateValue
      : percent;

  if (isIdle) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {progress.isRunning && <Loader2 className="h-5 w-5 animate-spin" />}
            {isComplete && !progress.isRunning && (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            )}
            Download Progress
          </span>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide download info"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {progress.currentStep || (isComplete ? 'Complete' : 'Ready')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span
            className={
              progress.isRunning ? 'text-primary' : 'text-muted-foreground'
            }
          >
            {progress.isRunning
              ? 'In progress'
              : isComplete
                ? 'Complete'
                : 'Idle'}
          </span>
        </div>

        {hasTotals && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-muted-foreground">
                {progress.current} / {progress.total} ({percent}%)
              </span>
            </div>
            <Progress value={barValue} className="h-2" />
          </>
        )}

        {!hasTotals && (
          <>
            <Progress value={barValue} className="h-2" />
            <div className="text-sm text-muted-foreground">
              {progress.currentStep || 'Waiting to start'}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
