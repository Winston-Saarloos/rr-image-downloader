import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { FolderOpen } from 'lucide-react';
import type {
  LibraryMovePhase,
  LibraryMoveProgress,
  RecNetSettings,
} from '../../shared/types';

interface LibraryMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: RecNetSettings;
  onCompleted: () => void | Promise<void>;
}

export const LibraryMoveDialog: React.FC<LibraryMoveDialogProps> = ({
  open,
  onOpenChange,
  settings,
  onCompleted,
}) => {
  const api = window.electronAPI;
  const [destPath, setDestPath] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LibraryMoveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [resultLogLines, setResultLogLines] = useState<string[] | null>(null);
  const progressHandlerRef = useRef<
    ((event: unknown, p: LibraryMoveProgress) => void) | null
  >(null);

  useEffect(() => {
    if (open) {
      setDestPath('');
      setRunning(false);
      setProgress(null);
      setError(null);
      setDoneMessage(null);
      setResultLogLines(null);
    }
  }, [open]);

  const handleSelectFolder = async () => {
    if (!api?.selectOutputFolder) {
      return;
    }
    const picked = await api.selectOutputFolder();
    if (picked) {
      setDestPath(picked);
      setError(null);
    }
  };

  const handleCancelMove = () => {
    void api?.cancelLibraryMove();
  };

  const handleStart = async () => {
    if (!api?.startLibraryMove || !destPath.trim()) {
      setError('Choose an empty destination folder.');
      return;
    }
    setError(null);
    setDoneMessage(null);
    setRunning(true);
    setProgress(null);

    const handler = (_event: unknown, p: LibraryMoveProgress) => {
      setProgress(p);
    };
    progressHandlerRef.current = handler;
    api.onLibraryMoveProgress(handler);

    try {
      const res = await api.startLibraryMove(destPath.trim());
      if (res.success && res.data) {
        const warn = res.data.sourceDeleteWarning;
        setDoneMessage(
          warn
            ? `Move finished. ${warn}`
            : `Library is now at ${res.data.newRoot}.`
        );
        if (res.data.operationLog?.length) {
          setResultLogLines(res.data.operationLog);
        }
        await onCompleted();
      } else {
        setError(res.error ?? 'Library move failed.');
        setResultLogLines(res.data?.operationLog ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (progressHandlerRef.current) {
        api.removeLibraryMoveProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
      setRunning(false);
    }
  };

  const handleClose = useCallback(() => {
    if (running) {
      return;
    }
    onOpenChange(false);
  }, [running, onOpenChange]);

  const pct =
    progress && progress.bytesTotal > 0
      ? Math.min(100, Math.round((100 * progress.bytesDone) / progress.bytesTotal))
      : 0;

  const resolved = (settings.resolvedOutputRoot ?? '').trim();
  const isSuccessComplete = Boolean(doneMessage && !error && !running);

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next === false && running) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={e => {
          if (running) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Move photo library</DialogTitle>
          <DialogDescription>
            Copies your entire library to a new folder, verifies every file, updates
            settings, then removes the old folder. The destination must be{' '}
            <strong>empty</strong>. Large libraries can take a long time across disks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">Current library (resolved)</p>
            <p className="break-all font-mono text-xs mt-1 rounded border bg-muted/40 px-2 py-1.5">
              {resolved || '(not configured)'}
            </p>
          </div>

          {!isSuccessComplete && (
            <div className="space-y-2">
              <Label htmlFor="lib-move-dest">Empty destination folder</Label>
              <div className="flex gap-2">
                <Input
                  id="lib-move-dest"
                  value={destPath}
                  onChange={e => setDestPath(e.target.value)}
                  placeholder="D:\RecRoomLibrary"
                  disabled={running}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={running}
                  onClick={() => void handleSelectFolder()}
                  aria-label="Choose empty destination folder"
                  title="Choose folder"
                >
                  <FolderOpen className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive break-words">{error}</p>
          )}
          {doneMessage && (
            <p className="text-sm text-green-700 dark:text-green-400 break-words">
              {doneMessage}
            </p>
          )}

          {running && progress && (
            <div className="space-y-2">
              <Progress value={pct} />
              <p className="text-xs text-muted-foreground break-all">
                <span className="font-medium text-foreground/80">
                  {libraryMovePhaseLabel(progress.phase)}
                </span>
                : {progress.currentLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                Files {progress.filesDone} / {progress.filesTotal} —{' '}
                {formatBytes(progress.bytesDone)} / {formatBytes(progress.bytesTotal)}
              </p>
              {progress.operationLog && progress.operationLog.length > 0 && (
                <div className="rounded border bg-muted/30 px-2 py-1.5 max-h-36 overflow-y-auto">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Operation log
                  </p>
                  <ul className="space-y-0.5 font-mono text-[11px] leading-snug text-foreground/90">
                    {progress.operationLog.map((line, i) => (
                      <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!running && resultLogLines && resultLogLines.length > 0 && (
            <div className="rounded border bg-muted/30 px-2 py-1.5 max-h-36 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Operation log
              </p>
              <ul className="space-y-0.5 font-mono text-[11px] leading-snug text-foreground/90">
                {resultLogLines.map((line, i) => (
                  <li key={`done-${i}-${line.slice(0, 24)}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {running ? (
            <Button type="button" variant="destructive" onClick={handleCancelMove}>
              Cancel move
            </Button>
          ) : isSuccessComplete ? (
            <Button type="button" onClick={handleClose}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => void handleStart()}
                disabled={!destPath.trim() || !resolved}
              >
                Start move
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function libraryMovePhaseLabel(phase: LibraryMovePhase): string {
  switch (phase) {
    case 'validating':
      return 'Validating';
    case 'preflight':
      return 'Scanning';
    case 'copy':
      return 'Copying';
    case 'verify':
      return 'Verifying';
    case 'verified':
      return 'Verified';
    case 'saving_settings':
      return 'Updating settings';
    case 'removing_old':
      return 'Removing old library';
    case 'complete':
      return 'Complete';
    default:
      return phase;
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '0 B';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
