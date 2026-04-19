import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Calendar,
  Download,
  ExternalLink,
  HelpCircle,
  Key,
  Image as ImageIcon,
  RefreshCcw,
  DoorOpen,
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
import {
  AccountInfo,
  AvailableEvent,
  EventDownloadPanelPrefill,
  LibraryMode,
  RecNetSettings,
} from '../../shared/types';
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
import { EventCoverImage } from './EventCoverImage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type { RoomPhotoSort } from '../../shared/types';
import { OutputPathPickerGroup } from './OutputPathPickerGroup';

interface DownloadDraft {
  username: string;
  roomName: string;
  libraryMode: LibraryMode;
  token: string;
  filePath: string;
  downloadSources: DownloadSourceSelection;
  roomPhotoSort: RoomPhotoSort;
  eventIds?: string[];
  knownCreatorAccountId?: string;
  refreshOptions: {
    forceAccountsRefresh: boolean;
    forceRoomsRefresh: boolean;
    forceEventsRefresh: boolean;
    forceImageCommentsRefresh: boolean;
  };
}

interface DownloadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (
    identifier: string,
    token: string,
    filePath: string,
    downloadSources: DownloadSourceSelection,
    refreshOptions: {
      forceAccountsRefresh: boolean;
      forceRoomsRefresh: boolean;
      forceEventsRefresh: boolean;
      forceImageCommentsRefresh: boolean;
    },
    roomPhotoSort: RoomPhotoSort,
    eventIds?: string[],
    knownCreatorAccountId?: string
  ) => Promise<void>;
  onDraftChange?: (draft: DownloadDraft) => void;
  libraryMode?: LibraryMode;
  eventDownloadPrefill?: EventDownloadPanelPrefill | null;
  onEventDownloadPrefillConsumed?: () => void;
  onCancel?: () => void;
  isDownloading?: boolean;
  showCancel?: boolean;
  settings: RecNetSettings;
  onUpdateSettings: (partial: Partial<RecNetSettings>) => Promise<void>;
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
  showCancel = false,
  settings,
  libraryMode = 'user',
  onUpdateSettings,
  eventDownloadPrefill = null,
  onEventDownloadPrefillConsumed,
}) => {
  const electronAPI = (window as unknown as { electronAPI?: any }).electronAPI;
  const recNetTokenGuideUrl =
    'https://github.com/Winston-Saarloos/rr-image-downloader/blob/main/docs/RECNET_TOKEN_GUIDE.md';
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');
  const [token, setToken] = useState('');
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
  const [roomPhotoSort, setRoomPhotoSort] = useState<RoomPhotoSort>(0);
  const [eventCards, setEventCards] = useState<AvailableEvent[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [forceAccountsRefresh, setForceAccountsRefresh] = useState(false);
  const [forceRoomsRefresh, setForceRoomsRefresh] = useState(false);
  const [forceEventsRefresh, setForceEventsRefresh] = useState(false);
  const [forceImageCommentsRefresh, setForceImageCommentsRefresh] =
    useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [eventKnownCreatorAccountId, setEventKnownCreatorAccountId] =
    useState<string | undefined>(undefined);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenValidationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenValidationRequestIdRef = useRef(0);
  const tokenTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastDiscoveredUsernameRef = useRef('');
  const eventSelectionQueueRef = useRef<string[] | null>(null);
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const [eventListScrollTop, setEventListScrollTop] = useState(0);
  const [eventListWidth, setEventListWidth] = useState(0);

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
      setForceImageCommentsRefresh(false);
      setAdvancedOpen(false);
    } else {
      setEventKnownCreatorAccountId(undefined);
      eventSelectionQueueRef.current = null;
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || libraryMode !== 'event') {
      return;
    }

    const node = eventListRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      const w = node.clientWidth;
      // Hidden dialogs often report 0; don't clobber a good width or force 1-column layout.
      if (w > 0) {
        setEventListWidth(w);
      }
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateWidth();
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [open, eventCards.length, libraryMode]);

  useEffect(() => {
    onDraftChange?.({
      username,
      roomName,
      libraryMode,
      token,
      filePath: settings.outputRoot || '',
      downloadSources,
      roomPhotoSort,
      eventIds: selectedEventIds,
      knownCreatorAccountId: eventKnownCreatorAccountId,
      refreshOptions: {
        forceAccountsRefresh,
        forceRoomsRefresh,
        forceEventsRefresh,
        forceImageCommentsRefresh,
      },
    });
  }, [
    downloadSources,
    settings.outputRoot,
    forceAccountsRefresh,
    forceEventsRefresh,
    forceImageCommentsRefresh,
    forceRoomsRefresh,
    libraryMode,
    onDraftChange,
    roomPhotoSort,
    selectedEventIds,
    token,
    username,
    roomName,
    eventKnownCreatorAccountId,
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

  const loadEventsForUsername = async (
    value = username,
    selectEventIdsAfterLoad?: string[]
  ) => {
    const cleanedUsername = value.trim();
    if (!cleanedUsername || !settings.outputPathConfiguredForDownload) {
      return;
    }

    setEventsLoading(true);
    setEventsError(null);
    try {
      const result = await electronAPI?.discoverEventsForUsername?.({
        username: cleanedUsername,
        token: cleanToken(token) || undefined,
        persist: false,
      });
      if (result?.success && result.data) {
        const cards = result.data.events;
        setEventCards(cards);
        const allowed = new Set(cards.map(e => e.eventId));
        const queued = eventSelectionQueueRef.current;
        eventSelectionQueueRef.current = null;
        let fromParam: string[] | undefined =
          selectEventIdsAfterLoad && selectEventIdsAfterLoad.length > 0
            ? selectEventIdsAfterLoad
            : undefined;
        if (!fromParam?.length && queued?.length) {
          fromParam = queued;
        }
        const nextSelected = fromParam?.filter(id => allowed.has(id)) ?? [];
        setSelectedEventIds(nextSelected);
        lastDiscoveredUsernameRef.current = cleanedUsername.toLowerCase();
      } else {
        setEventCards([]);
        setSelectedEventIds([]);
        setEventsError(result?.error || 'Could not load events.');
      }
    } catch (error) {
      setEventCards([]);
      setSelectedEventIds([]);
      setEventsError(
        error instanceof Error ? error.message : 'Could not load events.'
      );
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    if (
      !open ||
      libraryMode !== 'event' ||
      !eventDownloadPrefill ||
      !electronAPI
    ) {
      return;
    }

    const { creatorAccountId, eventIds, usernameHint } =
      eventDownloadPrefill;

    let cancelled = false;

    const run = async () => {
      let resolvedUsername = (usernameHint || '').trim();
      if (!resolvedUsername && electronAPI.lookupAccountById) {
        try {
          const result = await electronAPI.lookupAccountById(creatorAccountId);
          if (result?.success && result.data?.username) {
            resolvedUsername = (result.data.username || '').trim();
            if (!cancelled) {
              setResolvedAccount(result.data);
              setUsernameStatus('found');
            }
          }
        } catch {
          // ignore
        }
      }

      if (!resolvedUsername) {
        onEventDownloadPrefillConsumed?.();
        return;
      }

      if (!cancelled) {
        setUsername(resolvedUsername);
        setUsernameStatus('found');
        setEventKnownCreatorAccountId(creatorAccountId);
      }

      if (!settings.outputPathConfiguredForDownload) {
        eventSelectionQueueRef.current = [...eventIds];
        if (!cancelled) {
          onEventDownloadPrefillConsumed?.();
        }
        return;
      }

      await loadEventsForUsername(resolvedUsername, eventIds);
      if (!cancelled) {
        onEventDownloadPrefillConsumed?.();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // loadEventsForUsername is stable enough per render; token read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    libraryMode,
    eventDownloadPrefill,
    electronAPI,
    settings.outputPathConfiguredForDownload,
    onEventDownloadPrefillConsumed,
  ]);

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
    const tenMinutesInMs = 10 * 60 * 1000;
    return timeUntilExpiration <= tenMinutesInMs && timeUntilExpiration > 0;
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
    if (libraryMode === 'event') {
      setEventCards([]);
      setSelectedEventIds([]);
      setEventsError(null);
      setEventKnownCreatorAccountId(undefined);
      eventSelectionQueueRef.current = null;
      lastDiscoveredUsernameRef.current = '';
    }
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

  const handleTokenChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setToken(cleanToken(e.target.value));
  };

  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const next = cleanToken(text);
      setToken(next);

      const el = tokenTextareaRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(next.length, next.length);
        });
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
    if (libraryMode !== 'event') {
      return;
    }
    const cleanedUsername = username.trim();
    if (
      usernameStatus !== 'found' ||
      !cleanedUsername ||
      !settings.outputPathConfiguredForDownload ||
      eventsLoading ||
      lastDiscoveredUsernameRef.current === cleanedUsername.toLowerCase()
    ) {
      return;
    }

    void loadEventsForUsername(cleanedUsername);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eventsLoading,
    libraryMode,
    settings.outputPathConfiguredForDownload,
    username,
    usernameStatus,
  ]);

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
    const identifier = libraryMode === 'room' ? roomName : username;
    const outputPath = settings.outputRoot || '';
    if (!outputPath.trim()) {
      return;
    }
    if (libraryMode === 'event') {
      if (
        !identifier.trim() &&
        !(eventKnownCreatorAccountId && eventKnownCreatorAccountId.trim())
      ) {
        return;
      }
    } else if (!identifier.trim()) {
      return;
    }
    if (libraryMode === 'event' && selectedEventIds.length === 0) {
      return;
    }
    if (
      libraryMode === 'user' &&
      !hasSelectedDownloadSources(downloadSources)
    ) {
      return;
    }

    const cleanedToken = cleanToken(token);
    onOpenChange(false);
    await onDownload(
      identifier,
      cleanedToken,
      outputPath,
      downloadSources,
      {
        forceAccountsRefresh,
        forceRoomsRefresh,
        forceEventsRefresh,
        forceImageCommentsRefresh,
      },
      roomPhotoSort,
      selectedEventIds,
      libraryMode === 'event'
        ? eventKnownCreatorAccountId
        : undefined
    );
  };

  const outputSavePathAllowed = Boolean(
    settings.outputPathConfiguredForDownload
  );

  const isFormValid =
    (libraryMode === 'room'
      ? roomName.trim() !== ''
      : libraryMode === 'event'
        ? username.trim() !== '' || Boolean(eventKnownCreatorAccountId)
        : username.trim() !== '') &&
    outputSavePathAllowed &&
    (libraryMode === 'event'
      ? selectedEventIds.length > 0
      : libraryMode === 'room' || hasSelectedDownloadSources(downloadSources));
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

  const toggleEventSelection = (eventId: string, checked: boolean) => {
    setSelectedEventIds(current => {
      if (checked) {
        return current.includes(eventId) ? current : [...current, eventId];
      }
      return current.filter(id => id !== eventId);
    });
  };

  const selectAllEvents = () => {
    setSelectedEventIds(eventCards.map(event => event.eventId));
  };

  const clearEventSelection = () => {
    setSelectedEventIds([]);
  };

  const formatEventDate = (event: AvailableEvent): string => {
    if (!event.startTime) {
      return 'Date unknown';
    }
    return new Date(event.startTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const EVENT_CARD_MIN_WIDTH = 260;
  const EVENT_CARD_ROW_HEIGHT = 360;
  const EVENT_CARD_GAP = 12;
  const eventCardColumns = Math.max(
    1,
    Math.floor((eventListWidth + EVENT_CARD_GAP) / (EVENT_CARD_MIN_WIDTH + EVENT_CARD_GAP))
  );
  const eventCardRows = Math.ceil(eventCards.length / eventCardColumns);
  const eventListViewportHeight = 352;
  const eventStartRow = Math.max(
    0,
    Math.floor(eventListScrollTop / (EVENT_CARD_ROW_HEIGHT + EVENT_CARD_GAP)) - 1
  );
  const eventEndRow = Math.min(
    eventCardRows,
    Math.ceil(
      (eventListScrollTop + eventListViewportHeight) /
        (EVENT_CARD_ROW_HEIGHT + EVENT_CARD_GAP)
    ) + 1
  );
  const visibleEventCards = useMemo(
    () =>
      eventCards.slice(
        eventStartRow * eventCardColumns,
        Math.min(eventCards.length, eventEndRow * eventCardColumns)
      ),
    [eventCardColumns, eventCards, eventEndRow, eventStartRow]
  );
  const eventListPaddingTop =
    eventStartRow * (EVENT_CARD_ROW_HEIGHT + EVENT_CARD_GAP);
  const eventListPaddingBottom = Math.max(
    0,
    (eventCardRows - eventEndRow) * (EVENT_CARD_ROW_HEIGHT + EVENT_CARD_GAP)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto ${
          libraryMode === 'event' ? 'max-w-6xl' : 'max-w-3xl'
        }`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {libraryMode === 'room'
              ? 'Download Room Photos'
              : libraryMode === 'event'
                ? 'Event Photos'
                : 'Download Photos'}
          </DialogTitle>
          <DialogDescription>
            {libraryMode === 'room'
              ? 'Enter a room name, token, and save path to gather room photos in batches.'
              : libraryMode === 'event'
                ? 'Enter a username, load their events, and choose which event albums to download.'
                : 'Enter a token, username, save path, and choose what data to download.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
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
                Warning: Your token is expiring in 10 minutes or less. Please
                get a fresh token.
              </p>
            )}
          </div>

          {libraryMode === 'room' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="roomname" className="flex items-center gap-2">
                  <DoorOpen className="h-4 w-4" />
                  ^Room Name
                </Label>
                <Input
                  id="roomname"
                  placeholder="Enter a room name"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-photo-sort">Room photo fetch order</Label>
                <Select
                  value={roomPhotoSort.toString()}
                  onValueChange={value =>
                    setRoomPhotoSort(value === '1' ? 1 : 0)
                  }
                  disabled={isDownloading}
                >
                  <SelectTrigger id="room-photo-sort">
                    <SelectValue placeholder="Choose fetch order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Newest first</SelectItem>
                    <SelectItem value="1">Most cheered first</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Both modes save into the same room folder and skip photos that
                  are already downloaded.
                </p>
              </div>
            </div>
          )}

          {(libraryMode === 'user' || libraryMode === 'event') && (
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
          )}

          {libraryMode === 'event' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    usernameStatus !== 'found' ||
                    !outputSavePathAllowed ||
                    eventsLoading
                  }
                  onClick={() => void loadEventsForUsername()}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  {eventsLoading ? 'Loading events...' : 'Refresh events'}
                </Button>
                {eventCards.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAllEvents}
                      disabled={isDownloading}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearEventSelection}
                      disabled={isDownloading}
                    >
                      Clear
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {selectedEventIds.length} selected
                    </span>
                  </>
                )}
              </div>

              {eventsError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {eventsError}
                </p>
              )}

              {eventsLoading ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  Loading events...
                </div>
              ) : eventCards.length > 0 ? (
                <div
                  ref={eventListRef}
                  className="max-h-[22rem] w-full min-w-0 overflow-y-auto pr-1"
                  onScroll={event =>
                    setEventListScrollTop(event.currentTarget.scrollTop)
                  }
                >
                  <div style={{ paddingTop: eventListPaddingTop, paddingBottom: eventListPaddingBottom }}>
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: `repeat(${eventCardColumns}, minmax(0, 1fr))`,
                      }}
                    >
                  {visibleEventCards.map(event => {
                    const selected = selectedEventIds.includes(event.eventId);
                    return (
                      <div
                        key={event.eventId}
                        className={`select-none overflow-hidden rounded-md border bg-card transition ${
                          event.isDownloaded
                            ? 'border-border'
                            : 'border-dashed opacity-75'
                        } ${selected ? 'ring-2 ring-primary' : ''} ${
                          isDownloading ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                        onClick={() => {
                          if (!isDownloading) {
                            toggleEventSelection(event.eventId, !selected);
                          }
                        }}
                      >
                        <div className="aspect-video bg-muted">
                          <EventCoverImage
                            event={event}
                            cdnBase={settings.cdnBase}
                            iconClassName="h-7 w-7"
                          />
                        </div>
                        <div className="space-y-3 p-3">
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-input"
                              checked={selected}
                              disabled={isDownloading}
                              onClick={e => e.stopPropagation()}
                              onChange={eventChange =>
                                toggleEventSelection(
                                  event.eventId,
                                  eventChange.target.checked
                                )
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {event.name}
                              </p>
                              {event.isDownloaded && event.photoCount > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Photos downloaded
                                </p>
                              ) : !event.isDownloaded ? (
                                <p className="text-xs text-muted-foreground">
                                  Photos not downloaded
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatEventDate(event)}
                            </span>
                            <span className="flex items-center gap-1">
                              <UserRound className="h-3.5 w-3.5" />
                              {event.attendeeCount} attending
                            </span>
                            <span className="flex items-center gap-1">
                              <ImageIcon className="h-3.5 w-3.5" />
                              {!event.isDownloaded && event.photoCount === 0
                                ? 'Photo count unknown'
                                : event.photoCount > 0
                                  ? `${event.downloadedPhotoCount}/${event.photoCount} photos`
                                  : '0 photos'}
                            </span>
                          </div>
                          {!event.isDownloaded && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="w-full"
                              disabled={isDownloading}
                              onClick={e => {
                                e.stopPropagation();
                                setSelectedEventIds([event.eventId]);
                              }}
                            >
                              {selected
                                ? 'Queued for download'
                                : 'Queue this event'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  </div>
                </div>
              ) : usernameStatus === 'found' && outputSavePathAllowed ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  No events found for this user.
                </div>
              ) : null}
            </div>
          )}

          <OutputPathPickerGroup
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            heading="Where should the downloaded photos be saved?"
            inputId="filepath"
            showConfigurationCallout={libraryMode !== 'event'}
            calloutContext="download"
            pickerDisabled={isDownloading}
            onBeforePick={() => setFolderError(null)}
            onPickerError={setFolderError}
          />

          {folderError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {folderError}
            </p>
          )}

          {libraryMode === 'user' && (
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
          )}

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
                  User, room, event, and image comment details are reused when
                  available. Toggle below to force a fresh download.
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
                  <Button
                    type="button"
                    variant={
                      forceImageCommentsRefresh ? 'destructive' : 'outline'
                    }
                    onClick={() =>
                      setForceImageCommentsRefresh(value => !value)
                    }
                    disabled={isDownloading}
                    className="justify-start"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    {forceImageCommentsRefresh
                      ? 'Force image comment refresh'
                      : 'Use cached image comments'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <p
            className={`text-sm text-muted-foreground ${isFormValid ? 'invisible' : ''}`}
            aria-hidden={isFormValid}
          >
            {libraryMode === 'room'
              ? !outputSavePathAllowed
                ? 'Enter a room name and choose an output folder with Browse to start.'
                : 'Enter a room name to start.'
              : libraryMode === 'event'
                ? !outputSavePathAllowed
                  ? 'Enter a username and choose an output folder with Browse to load events.'
                  : 'Enter a username and select at least one event to download.'
              : !outputSavePathAllowed
                ? 'Enter a username, choose an output folder with Browse, and select at least one download type to start.'
                : 'Enter a username and select at least one download type to start.'}
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
            {showCancel && onCancel && (
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
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-4 space-y-3">
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    if (electronAPI?.openExternal) {
                      void electronAPI.openExternal(recNetTokenGuideUrl);
                    }
                  }}
                >
                  Open Token Guide on GitHub
                  <ExternalLink className="ml-2 h-4 w-4" />
                </button>
              </Button>
              <p className="text-sm text-muted-foreground">
                After following the guide, return here and click
                <span className="font-medium"> {`"Paste Bearer Token"`}</span>.
              </p>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-bold italic text-red-600 dark:text-red-400">
                Keep your token private. Anyone with it may be able to access
                your account data until it expires.
              </p>
              <p>
                Tokens expire after 1 hour. If the app says the token is
                invalid, expired, or downloads stop working, repeat the steps
                above to get a fresh one. https://rec.net/ will refresh the
                token once expired, refreshing the page will refresh the token.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
