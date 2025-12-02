import React, { useState, useEffect } from 'react';
import { Download, FolderOpen, Key, HelpCircle, X, RefreshCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { RecNetSettings } from '../../shared/types';

interface DownloadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (
    username: string,
    token: string,
    filePath: string,
    refreshOptions: {
      forceAccountsRefresh: boolean;
      forceRoomsRefresh: boolean;
    }
  ) => Promise<void>;
  onCancel?: () => void;
  isDownloading?: boolean;
  settings: RecNetSettings;
}

export const DownloadPanel: React.FC<DownloadPanelProps> = ({
  open,
  onOpenChange,
  onDownload,
  onCancel,
  isDownloading = false,
  settings,
}) => {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [filePath, setFilePath] = useState(settings.outputRoot || '');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [tokenExpiringSoon, setTokenExpiringSoon] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [tokenTimeout, setTokenTimeout] = useState<NodeJS.Timeout | null>(null);
  const [forceAccountsRefresh, setForceAccountsRefresh] = useState(false);
  const [forceRoomsRefresh, setForceRoomsRefresh] = useState(false);

  useEffect(() => {
    setFilePath(settings.outputRoot || '');
  }, [settings.outputRoot]);

  useEffect(() => {
    // Cleanup timeout on unmount
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      if (tokenTimeout) {
        clearTimeout(tokenTimeout);
      }
    };
  }, [searchTimeout, tokenTimeout]);

  useEffect(() => {
    if (open) {
      setForceAccountsRefresh(false);
      setForceRoomsRefresh(false);
    }
  }, [open]);

  // Re-validate token when accountId changes
  useEffect(() => {
    if (token.trim() && accountId) {
      // Clear existing timeout
      if (tokenTimeout) {
        clearTimeout(tokenTimeout);
      }
      const timeout = setTimeout(() => {
        validateToken(token, accountId);
      }, 300);
      setTokenTimeout(timeout);
    } else if (!accountId && token.trim()) {
      setTokenStatus('invalid');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const checkUsername = async (value: string) => {
    if (!value.trim()) {
      setUsernameStatus('idle');
      setAccountId(null);
      return;
    }

    setUsernameStatus('checking');
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.searchAccounts(value);
        if (result.success && result.data && result.data.length > 0) {
          setUsernameStatus('found');
          const account = result.data[0];
          const foundAccountId = account.accountId.toString();
          setAccountId(foundAccountId);
          // Re-validate token if it exists (useEffect will also handle this, but this provides immediate feedback)
          if (token.trim()) {
            const cleaned = cleanToken(token);
            if (cleaned !== token) {
              setToken(cleaned);
            }
            validateToken(cleaned, foundAccountId);
          }
        } else {
          setUsernameStatus('not-found');
          setAccountId(null);
        }
      }
    } catch (error) {
      setUsernameStatus('not-found');
      setAccountId(null);
    }
  };

  const cleanToken = (tokenValue: string): string => {
    // Remove "Bearer " prefix if present (case insensitive)
    let cleaned = tokenValue.trim();
    if (cleaned.toLowerCase().startsWith('bearer ')) {
      cleaned = cleaned.substring(7).trim();
    }
    // Remove any extra spaces
    cleaned = cleaned.replace(/\s+/g, '');
    return cleaned;
  };

  const decodeJWT = (token: string): { sub?: string; exp?: number } | null => {
    try {
      // JWT tokens have three parts: header.payload.signature
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      // Decode the payload (second part)
      const payload = parts[1];
      // Base64URL decode
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const decoded = atob(padded);
      return JSON.parse(decoded);
    } catch (error) {
      return null;
    }
  };

  const checkTokenExpiration = (decoded: { exp?: number }): boolean => {
    if (!decoded.exp) {
      return false;
    }

    // exp is in seconds since Unix epoch
    const expirationTime = decoded.exp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const timeUntilExpiration = expirationTime - currentTime;
    const twentyMinutesInMs = 20 * 60 * 1000; // 20 minutes in milliseconds

    // Return true if token expires in 20 minutes or less (and hasn't already expired)
    return timeUntilExpiration <= twentyMinutesInMs && timeUntilExpiration > 0;
  };

  const validateToken = (tokenValue: string, expectedAccountId: string | null) => {
    if (!tokenValue.trim()) {
      setTokenStatus('idle');
      setTokenExpiringSoon(false);
      return;
    }

    if (!expectedAccountId) {
      setTokenStatus('invalid');
      setTokenExpiringSoon(false);
      return;
    }

    setTokenStatus('checking');
    setTokenExpiringSoon(false);

    try {
      // Clean the token
      const cleaned = cleanToken(tokenValue);
      
      // Decode the JWT
      const decoded = decodeJWT(cleaned);
      
      if (!decoded || !decoded.sub) {
        setTokenStatus('invalid');
        setTokenExpiringSoon(false);
        return;
      }

      // Check if token is expiring soon
      const isExpiringSoon = checkTokenExpiration(decoded);
      setTokenExpiringSoon(isExpiringSoon);

      // Compare 'sub' with account ID
      const tokenSub = decoded.sub.toString();
      const accountIdStr = expectedAccountId.toString();

      if (tokenSub === accountIdStr) {
        setTokenStatus('valid');
      } else {
        setTokenStatus('invalid');
      }
    } catch (error) {
      setTokenStatus('invalid');
      setTokenExpiringSoon(false);
    }
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUsername(value);

    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Reset status if empty
    if (!value.trim()) {
      setUsernameStatus('idle');
      return;
    }

    // Debounce the search
    const timeout = setTimeout(() => {
      checkUsername(value);
    }, 1000);

    setSearchTimeout(timeout);
  };

  const handleSelectFolder = async () => {
    try {
      if (window.electronAPI) {
        const selectedPath = await window.electronAPI.selectOutputFolder();
        if (selectedPath) {
          setFilePath(selectedPath);
        }
      }
    } catch (error) {
      // Failed to select folder
    }
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    
    // Clean the token immediately
    const cleaned = cleanToken(value);
    
    // Update state with cleaned value
    setToken(cleaned);

    // Clear existing timeout
    if (tokenTimeout) {
      clearTimeout(tokenTimeout);
    }

    // Reset status if empty
    if (!cleaned.trim()) {
      setTokenStatus('idle');
      return;
    }

    // Debounce the validation
    const timeout = setTimeout(() => {
      validateToken(cleaned, accountId);
    }, 500);

    setTokenTimeout(timeout);
  };

  const handleDownload = async () => {
    if (!username.trim() || !filePath.trim()) {
      return;
    }
    // Clean the token before passing it
    const cleanedToken = cleanToken(token);
    // Close the dialog before starting download
    onOpenChange(false);
    await onDownload(username, cleanedToken, filePath, {
      forceAccountsRefresh,
      forceRoomsRefresh,
    });
  };

  const isFormValid = username.trim() !== '' && filePath.trim() !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download Photos
          </DialogTitle>
          <DialogDescription>
            Enter your credentials and file path to download photos
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="Enter your username"
              value={username}
              onChange={handleUsernameChange}
            />
            {usernameStatus === 'found' && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Username found successfully
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

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="token" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                Token (Optional)
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
            <textarea
              id="token"
              placeholder="Enter your access token"
              value={token}
              onChange={handleTokenChange}
              className="flex min-h-[2.5rem] max-h-[6rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y overflow-y-auto"
              rows={4}
            />
            {tokenStatus === 'valid' && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Token validated successfully - Account ID matches
              </p>
            )}
            {tokenStatus === 'invalid' && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Token validation failed - Account ID does not match or token is invalid
              </p>
            )}
            {tokenStatus === 'checking' && (
              <p className="text-sm text-muted-foreground">
                Validating token...
              </p>
            )}
            {tokenStatus === 'idle' && (
              <p className="text-sm text-muted-foreground">
                Required if you want to download private photos as well as public ones
              </p>
            )}
            {tokenExpiringSoon && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Warning: Your token is expiring in 20 minutes or less. Please get a fresh token (tokens last 1 hour).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="filepath">File Path</Label>
            <div className="flex gap-2">
              <Input
                id="filepath"
                placeholder="/photos/2024/image.jpg"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
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
          </div>

          <div className="space-y-2">
            <Label>Metadata Refresh</Label>
            <p className="text-sm text-muted-foreground">
              User and room details are reused when available. Toggle below to force a fresh download.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant={forceAccountsRefresh ? 'destructive' : 'outline'}
                onClick={() => setForceAccountsRefresh(value => !value)}
                disabled={isDownloading}
                className="justify-start"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {forceAccountsRefresh ? 'Force user data refresh' : 'Use cached user data'}
              </Button>
              <Button
                type="button"
                variant={forceRoomsRefresh ? 'destructive' : 'outline'}
                onClick={() => setForceRoomsRefresh(value => !value)}
                disabled={isDownloading}
                className="justify-start"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {forceRoomsRefresh ? 'Force room data refresh' : 'Use cached room data'}
              </Button>
            </div>
          </div>

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

      {/* Token Help Dialog */}
      <Dialog open={tokenHelpOpen} onOpenChange={setTokenHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How to Get Your Token</DialogTitle>
            <DialogDescription>
              Instructions for obtaining your RecNet access token
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">
                To download private photos, you need to obtain an access token from RecNet:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Log in to your RecNet account in a web browser</li>
                <li>Open your browser&apos;s Developer Tools (F12 or right-click → Inspect)</li>
                <li>Go to the Network tab</li>
                <li>Navigate to any page on RecNet that requires authentication</li>
                <li>Look for requests to the RecNet API</li>
                <li>Find the Authorization header in the request headers</li>
                <li>Copy the token value (it usually starts with &quot;Bearer &quot;)</li>
                <li>Paste the token (without &quot;Bearer &quot;) into the token field above</li>
              </ol>
              <p className="text-sm text-muted-foreground mt-4">
                <strong>Note:</strong> Tokens may expire after some time. If downloads fail, you may need to obtain a new token.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
