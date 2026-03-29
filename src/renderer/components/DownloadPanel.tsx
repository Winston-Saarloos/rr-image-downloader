import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  HelpCircle,
  Key,
  RefreshCcw,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { buildCdnImageUrl } from '../../shared/cdnUrl';
import { AccountInfo, RecNetSettings } from '../../shared/types';
import { Card } from '../components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import {
  DEFAULT_DOWNLOAD_SOURCE_SELECTION,
  DownloadSourceSelection,
  hasSelectedDownloadSources,
} from '../../shared/download-sources';

interface DownloadDraft {
  username: string;
  token: string;
  filePath: string;
  downloadSources: DownloadSourceSelection;
  refreshOptions: {
    forceAccountsRefresh: boolean;
    forceRoomsRefresh: boolean;
    forceEventsRefresh: boolean;
  };
}

interface DownloadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (
    username: string,
    token: string,
    filePath: string,
    downloadSources: DownloadSourceSelection,
    refreshOptions: {
      forceAccountsRefresh: boolean;
      forceRoomsRefresh: boolean;
      forceEventsRefresh: boolean;
    }
  ) => Promise<void>;
  onDraftChange?: (draft: DownloadDraft) => void;
  onCancel?: () => void;
  isDownloading?: boolean;
  settings: RecNetSettings;
}

type UsernameStatus = 'idle' | 'checking' | 'found' | 'not-found';
type TokenStatus = 'idle' | 'checking' | 'parsed' | 'verified' | 'invalid';

export const DownloadPanel: React.FC<DownloadPanelProps> = ({
  open,
  onOpenChange,
  onDownload,
  onDraftChange,
  onCancel,
  isDownloading = false,
  settings,
}) => {
  const electronAPI = (window as unknown as { electronAPI?: any }).electronAPI;
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [filePath, setFilePath] = useState(settings.outputRoot || '');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [resolvedAccount, setResolvedAccount] = useState<AccountInfo | null>(
    null
  );
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('idle');
  const [tokenStatusMessage, setTokenStatusMessage] = useState(
    'Optional. Required for profile picture history and private image downloads.'
  );
  const [tokenExpiringSoon, setTokenExpiringSoon] = useState(false);
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false);
  const [downloadSources, setDownloadSources] =
    useState<DownloadSourceSelection>(DEFAULT_DOWNLOAD_SOURCE_SELECTION);
  const [forceAccountsRefresh, setForceAccountsRefresh] = useState(false);
  const [forceRoomsRefresh, setForceRoomsRefresh] = useState(false);
  const [forceEventsRefresh, setForceEventsRefresh] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenValidationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenValidationRequestIdRef = useRef(0);
  const tokenTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setFilePath(settings.outputRoot || '');
  }, [settings.outputRoot]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (tokenValidationTimeoutRef.current) {
        clearTimeout(tokenValidationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setForceAccountsRefresh(false);
      setForceRoomsRefresh(false);
      setForceEventsRefresh(false);
      setAdvancedOpen(false);
    }
  }, [open]);

  useEffect(() => {
    onDraftChange?.({
      username,
      token,
      filePath,
      downloadSources,
      refreshOptions: {
        forceAccountsRefresh,
        forceRoomsRefresh,
        forceEventsRefresh,
      },
    });
  }, [
    downloadSources,
    filePath,
    forceAccountsRefresh,
    forceEventsRefresh,
    forceRoomsRefresh,
    onDraftChange,
    token,
    username,
  ]);

  const clearSearchTimeout = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
  };

  const clearTokenValidationTimeout = () => {
    if (tokenValidationTimeoutRef.current) {
      clearTimeout(tokenValidationTimeoutRef.current);
      tokenValidationTimeoutRef.current = null;
    }
  };

  const checkUsername = async (value: string) => {
    if (!value.trim()) {
      setUsernameStatus('idle');
      setResolvedAccount(null);
      return;
    }

    setUsernameStatus('checking');
    setResolvedAccount(null);
    try {
      if (electronAPI) {
        const result = await electronAPI.lookupAccountByUsername(
          value,
          token.trim() || undefined
        );
        if (result.success && result.data) {
          setUsernameStatus('found');
          setResolvedAccount(result.data);
        } else {
          setUsernameStatus('not-found');
          setResolvedAccount(null);
        }
      }
    } catch {
      setUsernameStatus('not-found');
      setResolvedAccount(null);
    }
  };

  const cleanToken = (tokenValue: string): string => {
    let cleaned = tokenValue.trim();
    if (cleaned.toLowerCase().startsWith('bearer ')) {
      cleaned = cleaned.substring(7).trim();
    }
    return cleaned.replace(/\s+/g, '');
  };

  const decodeJWT = (
    tokenValue: string
  ): { sub?: string; exp?: number } | null => {
    try {
      const parts = tokenValue.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = parts[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  };

  const isTokenExpired = (decoded: { exp?: number }): boolean => {
    if (!decoded.exp) {
      return false;
    }
    return decoded.exp * 1000 <= Date.now();
  };

  const checkTokenExpiration = (decoded: { exp?: number }): boolean => {
    if (!decoded.exp) {
      return false;
    }

    const expirationTime = decoded.exp * 1000;
    const currentTime = Date.now();
    const timeUntilExpiration = expirationTime - currentTime;
    const twentyMinutesInMs = 20 * 60 * 1000;
    return timeUntilExpiration <= twentyMinutesInMs && timeUntilExpiration > 0;
  };

  const validateProfileHistoryAccess = async (
    usernameValue: string,
    tokenValue: string,
    requestId: number
  ) => {
    try {
      if (!electronAPI?.validateProfileHistoryAccess) {
        throw new Error('Profile history validation is unavailable.');
      }

      const result = await electronAPI.validateProfileHistoryAccess({
        username: usernameValue,
        token: tokenValue,
      });

      if (requestId !== tokenValidationRequestIdRef.current) {
        return;
      }

      if (result.success && result.data) {
        setTokenStatus('verified');
        setTokenStatusMessage(
          `Profile picture history is available for @${result.data.username}.`
        );
      } else {
        setTokenStatus('invalid');
        setTokenStatusMessage(
          result.error || 'Token does not belong to this user.'
        );
      }
    } catch (error) {
      if (requestId !== tokenValidationRequestIdRef.current) {
        return;
      }
      setTokenStatus('invalid');
      setTokenStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not validate profile picture history access.'
      );
    }
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUsername(value);
    clearSearchTimeout();

    if (!value.trim()) {
      setUsernameStatus('idle');
      setResolvedAccount(null);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      void checkUsername(value);
    }, 1000);
  };

  const handleSelectFolder = async () => {
    setFolderError(null);
    try {
      if (electronAPI) {
        const selectedPath = await electronAPI.selectOutputFolder();
        if (selectedPath) {
          setFilePath(selectedPath);
        }
      }
    } catch {
      setFolderError(
        'Could not open folder picker. Try typing the path manually.'
      );
    }
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setToken(cleanToken(e.target.value));
  };

  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const el = tokenTextareaRef.current;
      if (el) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const combined = token.slice(0, start) + text + token.slice(end);
        const next = cleanToken(combined);
        setToken(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(next.length, next.length);
        });
      } else {
        setToken(cleanToken(token + text));
      }
    } catch {
      // Clipboard API unavailable or denied
      console.error('Clipboard API unavailable or denied');
    }
  };

  useEffect(() => {
    if (!username.trim()) {
      return;
    }

    clearSearchTimeout();
    searchTimeoutRef.current = setTimeout(() => {
      void checkUsername(username);
    }, 1000);

    return () => clearSearchTimeout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    clearTokenValidationTimeout();
    tokenValidationRequestIdRef.current += 1;

    const cleanedToken = cleanToken(token);
    if (!cleanedToken) {
      setTokenStatus('idle');
      setTokenStatusMessage(
        'A bearer token is required for profile picture history and private image downloads.'
      );
      setTokenExpiringSoon(false);
      return;
    }

    const decoded = decodeJWT(cleanedToken);
    if (!decoded) {
      setTokenStatus('invalid');
      setTokenStatusMessage('Token is invalid or could not be parsed.');
      setTokenExpiringSoon(false);
      return;
    }

    if (isTokenExpired(decoded)) {
      setTokenStatus('invalid');
      setTokenStatusMessage('Token has expired.');
      setTokenExpiringSoon(false);
      return;
    }

    setTokenExpiringSoon(checkTokenExpiration(decoded));

    if (!username.trim()) {
      setTokenStatus('parsed');
      setTokenStatusMessage(
        'Token looks valid. Enter a username to verify profile picture history access.'
      );
      return;
    }

    const requestId = tokenValidationRequestIdRef.current;
    setTokenStatus('checking');
    setTokenStatusMessage(`Verifying token for @${username.trim()}...`);
    tokenValidationTimeoutRef.current = setTimeout(() => {
      void validateProfileHistoryAccess(
        username.trim(),
        cleanedToken,
        requestId
      );
    }, 500);

    return () => clearTokenValidationTimeout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, username]);

  useEffect(() => {
    if (!downloadSources.downloadProfileHistory) {
      return;
    }
    if (tokenStatus === 'verified') {
      return;
    }

    setDownloadSources(current => ({
      ...current,
      downloadProfileHistory: false,
    }));
  }, [downloadSources.downloadProfileHistory, tokenStatus]);

  const toggleDownloadSource = (
    key: keyof DownloadSourceSelection,
    checked: boolean
  ) => {
    setDownloadSources(current => ({
      ...current,
      [key]: checked,
    }));
  };

  const handleDownload = async () => {
    if (!username.trim() || !filePath.trim()) {
      return;
    }
    if (!hasSelectedDownloadSources(downloadSources)) {
      return;
    }

    const cleanedToken = cleanToken(token);
    onOpenChange(false);
    await onDownload(username, cleanedToken, filePath, downloadSources, {
      forceAccountsRefresh,
      forceRoomsRefresh,
      forceEventsRefresh,
    });
  };

  const isFormValid =
    username.trim() !== '' &&
    filePath.trim() !== '' &&
    hasSelectedDownloadSources(downloadSources);
  const profileHistoryEnabled = tokenStatus === 'verified';
  const feedPhotosVisibilitySuffix =
    tokenStatus === 'verified' ? '(Public & Private)' : '(Public)';
  const resolvedProfilePhotoUrl =
    usernameStatus === 'found' && resolvedAccount
      ? buildCdnImageUrl(settings.cdnBase, resolvedAccount.profileImage)
      : '';

  const renderDownloadType = (params: {
    id: string;
    title: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    disabledReason?: string;
  }) => {
    const option = (
      <label
        htmlFor={params.id}
        className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
          params.checked ? 'border-primary bg-muted/40' : 'border-border'
        } ${params.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <input
          id={params.id}
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-input"
          checked={params.checked}
          disabled={params.disabled}
          onChange={event => params.onChange(event.target.checked)}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">{params.title}</p>
          <p className="text-sm text-muted-foreground">{params.description}</p>
        </div>
      </label>
    );

    if (params.disabled && params.disabledReason) {
      return (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">{option}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{params.disabledReason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return option;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download Photos
          </DialogTitle>
          <DialogDescription>
            Enter a token, username, save path, and choose what data to
            download.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="token" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                Bearer Token (Optional)
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setTokenHelpOpen(true)}
                title="How to get your token"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea
                ref={tokenTextareaRef}
                id="token"
                placeholder="Enter your access token"
                value={token}
                onChange={handleTokenChange}
                className="flex min-h-[2.5rem] max-h-[6rem] min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y overflow-y-auto"
                rows={4}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 sm:mt-0"
                onClick={() => void handlePasteToken()}
              >
                Paste Bearer Token
              </Button>
            </div>
            <p
              className={`text-sm ${
                tokenStatus === 'invalid'
                  ? 'text-red-600 dark:text-red-400'
                  : tokenStatus === 'verified'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground'
              }`}
            >
              {tokenStatus === 'checking'
                ? 'Verifying token...'
                : tokenStatusMessage}
            </p>
            {tokenExpiringSoon && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Warning: Your token is expiring in 20 minutes or less. Please
                get a fresh token.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Rec Room @ Username</Label>
            <Input
              id="username"
              placeholder="Enter your username"
              value={username}
              onChange={handleUsernameChange}
            />
            <div className="space-y-2">
              <div className="min-h-5">
                {usernameStatus === 'found' && resolvedAccount && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    Account found successfully
                  </p>
                )}
                {usernameStatus === 'not-found' && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Username not found
                  </p>
                )}
                {usernameStatus === 'checking' && (
                  <p className="text-sm text-muted-foreground">
                    Checking username...
                  </p>
                )}
              </div>
              <div className="flex min-h-[3.75rem] items-center">
                {usernameStatus === 'found' && resolvedAccount && (
                  <Card className="flex w-full flex-row items-center gap-2.5 p-2.5 shadow-none">
                    {resolvedProfilePhotoUrl ? (
                      <img
                        src={resolvedProfilePhotoUrl}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover ring-1 ring-border"
                      />
                    ) : (
                      <div
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border"
                        aria-hidden
                      >
                        <UserRound className="size-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {resolvedAccount.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{resolvedAccount.username}
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filepath">
              Where should the downloaded photos be saved?
            </Label>
            <div className="flex gap-2">
              <Input
                id="filepath"
                placeholder="/photos/2024/image.jpg"
                value={filePath}
                onChange={e => {
                  setFilePath(e.target.value);
                  setFolderError(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectFolder}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              All photos and data are saved to the selected folder.
            </p>
          </div>

          {folderError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {folderError}
            </p>
          )}

          <div className="space-y-2">
            <Label>Download Types</Label>
            <div className="space-y-2">
              {renderDownloadType({
                id: 'download-user-feed',
                title: `User Feed ${feedPhotosVisibilitySuffix}`,
                description: 'Download photos the user was tagged in.',
                checked: downloadSources.downloadUserFeed,
                onChange: checked =>
                  toggleDownloadSource('downloadUserFeed', checked),
              })}
              {renderDownloadType({
                id: 'download-user-photos',
                title: `User Photos ${feedPhotosVisibilitySuffix}`,
                description: 'Download photos the user took.',
                checked: downloadSources.downloadUserPhotos,
                onChange: checked =>
                  toggleDownloadSource('downloadUserPhotos', checked),
              })}
              {renderDownloadType({
                id: 'download-profile-history',
                title: 'Profile Picture History',
                description:
                  'Download the user profile picture history and save the raw JSON manifest.',
                checked: downloadSources.downloadProfileHistory,
                disabled: !profileHistoryEnabled,
                disabledReason:
                  tokenStatus === 'checking'
                    ? 'Verifying the bearer token for this username.'
                    : tokenStatusMessage,
                onChange: checked =>
                  toggleDownloadSource('downloadProfileHistory', checked),
              })}
            </div>
          </div>

          <div className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-3 text-left"
              onClick={() => setAdvancedOpen(value => !value)}
            >
              <div>
                <p className="text-sm font-medium">Advanced</p>
                <p className="text-sm text-muted-foreground">
                  Cache refresh options for feed and photo collection.
                </p>
              </div>
              {advancedOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {advancedOpen && (
              <div className="border-t px-3 pb-3 pt-2 space-y-2">
                <p className="text-sm text-muted-foreground">
                  User, room, and event details are reused when available.
                  Toggle below to force a fresh download.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={forceAccountsRefresh ? 'destructive' : 'outline'}
                    onClick={() => setForceAccountsRefresh(value => !value)}
                    disabled={isDownloading}
                    className="justify-start"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    {forceAccountsRefresh
                      ? 'Force user data refresh'
                      : 'Use cached user data'}
                  </Button>
                  <Button
                    type="button"
                    variant={forceRoomsRefresh ? 'destructive' : 'outline'}
                    onClick={() => setForceRoomsRefresh(value => !value)}
                    disabled={isDownloading}
                    className="justify-start"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    {forceRoomsRefresh
                      ? 'Force room data refresh'
                      : 'Use cached room data'}
                  </Button>
                  <Button
                    type="button"
                    variant={forceEventsRefresh ? 'destructive' : 'outline'}
                    onClick={() => setForceEventsRefresh(value => !value)}
                    disabled={isDownloading}
                    className="justify-start"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    {forceEventsRefresh
                      ? 'Force event data refresh'
                      : 'Use cached event data'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <p
            className={`text-sm text-muted-foreground ${isFormValid ? 'invisible' : ''}`}
            aria-hidden={isFormValid}
          >
            Enter a username, choose a save folder, and select at least one
            download type to start.
          </p>

          <div className="flex gap-2">
            <Button
              onClick={handleDownload}
              disabled={!isFormValid || isDownloading}
              className="flex-1"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            {isDownloading && onCancel && (
              <Button
                onClick={onCancel}
                variant="destructive"
                className="flex-1"
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      <Dialog open={tokenHelpOpen} onOpenChange={setTokenHelpOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How to Get Your Token</DialogTitle>
            <DialogDescription>
              Instructions for obtaining your RecNet access token.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">
                To download private photos or profile picture history, obtain an
                access token from RecNet:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Log in to your RecNet account in a web browser.</li>
                <li>
                  Open your browser&apos;s Developer Tools and go to Network.
                </li>
                <li>
                  Navigate to any RecNet page that requires authentication.
                </li>
                <li>Open one of the RecNet API requests.</li>
                <li>Find the `Authorization` header in the request headers.</li>
                <li>Copy the token value, usually after `Bearer `.</li>
                <li>Paste the token into the field above.</li>
              </ol>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Note:</strong> Tokens expire. If validation or downloads
                start failing, obtain a fresh token.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
