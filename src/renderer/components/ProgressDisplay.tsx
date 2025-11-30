import React from 'react';
import { Progress } from '../../components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress as ProgressType } from '../../shared/types';
import { Loader2 } from 'lucide-react';

interface ProgressDisplayProps {
  progress: ProgressType;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ progress }) => {
  if (!progress.isRunning && progress.progress === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {progress.isRunning && <Loader2 className="h-5 w-5 animate-spin" />}
          Download Progress
        </CardTitle>
        <CardDescription>{progress.currentStep || 'Ready'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress.total > 0 && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-muted-foreground">
                {progress.current} / {progress.total} ({Math.round(progress.progress)}%)
              </span>
            </div>
            <Progress value={progress.progress} className="h-2" />
          </>
        )}
        {progress.total === 0 && progress.isRunning && (
          <div className="text-sm text-muted-foreground">
            {progress.currentStep}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

