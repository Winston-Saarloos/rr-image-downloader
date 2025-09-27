import React, { useState, useEffect } from 'react';
import { Download, X, Trash2 } from 'lucide-react';
import { AccountInfo } from '../../shared/types';

interface ControlsPanelProps {
  onLog: (
    message: string,
    type?: 'info' | 'success' | 'error' | 'warning'
  ) => void;
  onResult: (operation: string, data: any, type: 'success' | 'error') => void;
  onProgressChange: (progress: any) => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  onLog,
  onResult,
  onProgressChange,
}) => {
  const [accountId, setAccountId] = useState('');
  const [recNetToken, setRecNetToken] = useState('');
  const [incremental, setIncremental] = useState(true);
  const [downloadFeed, setDownloadFeed] = useState(true);
  const [isOperationActive, setIsOperationActive] = useState(false);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [isLookingUpAccount, setIsLookingUpAccount] = useState(false);
  const [searchResults, setSearchResults] = useState<AccountInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(
    null
  );
  const [progressMonitor, setProgressMonitor] = useState<NodeJS.Timeout | null>(
    null
  );

  // Cleanup progress monitor and search timeout on unmount
  useEffect(() => {
    return () => {
      if (progressMonitor) {
        clearInterval(progressMonitor);
      }
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [progressMonitor, searchTimeout]);

  const searchAccounts = async (username: string) => {
    if (!username.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.searchAccounts(username);
      if (result.success && result.data) {
        setSearchResults(result.data);
        onLog(
          `Found ${result.data.length} account(s) matching "${username}"`,
          'info'
        );
      } else {
        setSearchResults([]);
        onLog('No accounts found', 'warning');
      }
    } catch (error) {
      setSearchResults([]);
      onLog(`Error searching accounts: ${error}`, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleUsernameSearch = (username: string) => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      searchAccounts(username);
    }, 1000);

    setSearchTimeout(timeout);
  };

  const selectAccount = (account: AccountInfo) => {
    setAccountId(account.accountId.toString());
    setAccountInfo(account);
    setSearchResults([]);
    onLog(
      `Selected account: ${account.displayName}, @${account.username}`,
      'success'
    );
  };

  const lookupAccount = async (id: string) => {
    if (!id.trim()) {
      setAccountInfo(null);
      return;
    }

    setIsLookingUpAccount(true);
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.lookupAccount(id);
      if (result.success && result.data && result.data.length > 0) {
        setAccountInfo(result.data[0]);
        onLog(
          `Found account: ${result.data[0].displayName}, @${result.data[0].username}`,
          'success'
        );
      } else {
        setAccountInfo(null);
        onLog('Account not found', 'warning');
      }
    } catch (error) {
      setAccountInfo(null);
      onLog(`Error looking up account: ${error}`, 'error');
    } finally {
      setIsLookingUpAccount(false);
    }
  };

  const setOperationActive = (active: boolean) => {
    setIsOperationActive(active);
    if (active) {
      // Clear progress monitor
      if (progressMonitor) {
        clearInterval(progressMonitor);
        setProgressMonitor(null);
      }

      // Reset progress
      onProgressChange({
        isRunning: true,
        currentStep: 'Starting...',
        progress: 0,
        current: 0,
        total: 0,
      });

      // Start progress monitoring
      const monitor = setInterval(async () => {
        try {
          if (window.electronAPI) {
            const progress = await window.electronAPI.getProgress();
            onProgressChange(progress);

            // Log progress updates occasionally
            if (progress.isRunning && progress.currentStep) {
              // Only log every few updates to avoid spam
              const shouldLog = Math.random() < 0.1; // 10% chance to log
              if (shouldLog) {
                onLog(
                  `  → ${progress.currentStep} (${progress.current}/${progress.total})`,
                  'info'
                );
              }
            }
          }
        } catch (error) {
          // Ignore progress monitoring errors
        }
      }, 1000);

      setProgressMonitor(monitor);
    } else {
      // Clear progress monitor
      if (progressMonitor) {
        clearInterval(progressMonitor);
        setProgressMonitor(null);
      }
    }
  };

  const handleOperation = async (
    operation: () => Promise<any>,
    operationName: string
  ) => {
    if (!accountId.trim()) {
      onLog('Please enter a Rec Room account ID', 'error');
      return;
    }

    setOperationActive(true);
    onLog(
      `Starting ${operationName.toLowerCase()} for account: ${accountId}`,
      'info'
    );

    try {
      const result = await operation();
      if (result.success) {
        onLog(`${operationName} completed successfully`, 'success');
        onResult(operationName, result.data, 'success');
      } else {
        onLog(`${operationName} failed: ${result.error}`, 'error');
        onResult(operationName, result.error, 'error');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      onLog(`${operationName} failed: ${errorMessage}`, 'error');
      onResult(operationName, errorMessage, 'error');
    } finally {
      setOperationActive(false);
    }
  };

  const downloadAll = async () => {
    if (!window.electronAPI)
      return { success: false, error: 'Electron API not available' };

    // Step 1: Collect metadata (photos and feed in parallel)
    onLog('Step 1: Collecting metadata...', 'info');
    onLog(
      '  → Starting parallel collection of photos and feed metadata...',
      'info'
    );
    onLog('  → Fetching photo information from RecNet API...', 'info');
    if (downloadFeed) {
      onLog('  → Fetching feed photo information from RecNet API...', 'info');
    }
    onLog(`  → Processing all pages (150 photos per page)...`, 'info');
    onLog(
      '  → This may take a few minutes for accounts with many photos...',
      'info'
    );
    onLog(
      '  → Progress updates will appear below as we process each page...',
      'info'
    );

    // Start both collections in parallel
    const photosPromise = window.electronAPI.collectPhotos({
      accountId: accountId.trim(),
      token: recNetToken.trim() || undefined,
    });

    const feedPromise = downloadFeed
      ? window.electronAPI.collectFeedPhotos({
          accountId: accountId.trim(),
          token: recNetToken.trim() || undefined,
          incremental,
        })
      : Promise.resolve({ success: true, data: null });

    // Wait for both to complete
    const [photosResult, feedResult] = await Promise.all([
      photosPromise,
      feedPromise,
    ]);

    if (!photosResult.success) {
      return {
        success: false,
        error: `Failed to collect photos metadata: ${photosResult.error}`,
      };
    }

    if (downloadFeed && !feedResult.success) {
      return {
        success: false,
        error: `Failed to collect feed metadata: ${feedResult.error}`,
      };
    }

    // Log photos results
    const totalPhotos = photosResult.data?.totalPhotos || 0;
    const newPhotos = photosResult.data?.totalNewPhotosAdded || 0;
    const existingPhotos = photosResult.data?.existingPhotos || 0;
    const totalFetched = photosResult.data?.totalFetched || 0;
    const iterationsCompleted = photosResult.data?.iterationsCompleted || 0;

    onLog(
      `  Photos metadata collected: ${totalPhotos} total photos found`,
      'success'
    );
    onLog(
      `  → Processed ${iterationsCompleted} pages, fetched ${totalFetched} photos from API`,
      'info'
    );
    if (existingPhotos > 0) {
      onLog(
        `  → ${existingPhotos} existing photos, ${newPhotos} new photos added`,
        'info'
      );
    } else {
      onLog(`  → All ${totalPhotos} photos are new`, 'info');
    }

    // Log feed results
    if (downloadFeed && feedResult.data) {
      const totalFeedPhotos = feedResult.data?.totalPhotos || 0;
      const newFeedPhotos = feedResult.data?.totalNewPhotosAdded || 0;
      const existingFeedPhotos = feedResult.data?.existingPhotos || 0;
      const totalFeedFetched = feedResult.data?.totalFetched || 0;
      const feedIterationsCompleted = feedResult.data?.iterationsCompleted || 0;

      onLog(
        `  Feed metadata collected: ${totalFeedPhotos} total feed photos found`,
        'success'
      );
      onLog(
        `  → Processed ${feedIterationsCompleted} pages, fetched ${totalFeedFetched} feed photos from API`,
        'info'
      );
      if (existingFeedPhotos > 0) {
        onLog(
          `  → ${existingFeedPhotos} existing feed photos, ${newFeedPhotos} new feed photos added`,
          'info'
        );
      } else {
        onLog(`  → All ${totalFeedPhotos} feed photos are new`, 'info');
      }
    } else if (!downloadFeed) {
      onLog('  → Feed metadata collection skipped (disabled)', 'info');
    }

    // Step 2: Download photos
    onLog('Step 2: Downloading photos...', 'info');
    onLog('  → Starting download of all photos...', 'info');

    const downloadResult = await window.electronAPI.downloadPhotos({
      accountId: accountId.trim(),
    });

    if (!downloadResult.success) {
      return {
        success: false,
        error: `Failed to download photos: ${downloadResult.error}`,
      };
    }

    const downloadStats = downloadResult.data?.downloadStats || {};
    const newDownloads = downloadStats.newDownloads || 0;
    const alreadyDownloaded = downloadStats.alreadyDownloaded || 0;
    const failedDownloads = downloadStats.failedDownloads || 0;

    onLog(
      `  Photos download completed: ${newDownloads} new photos downloaded`,
      'success'
    );
    if (alreadyDownloaded > 0) {
      onLog(`  → ${alreadyDownloaded} photos were already downloaded`, 'info');
    }
    if (failedDownloads > 0) {
      onLog(`  → ${failedDownloads} photos failed to download`, 'warning');
    }

    // Step 3: Download feed photos (if enabled and limited)
    let feedDownloadResult: any = null;
    if (downloadFeed) {
      onLog('Step 3: Downloading feed photos...', 'info');
      onLog('  → Starting download of all feed photos...', 'info');

      feedDownloadResult = await window.electronAPI.downloadFeedPhotos({
        accountId: accountId.trim(),
      });

      if (!feedDownloadResult.success) {
        return {
          success: false,
          error: `Failed to download feed photos: ${feedDownloadResult.error}`,
        };
      }

      const feedDownloadStats = feedDownloadResult.data?.downloadStats || {};
      const newFeedDownloads = feedDownloadStats.newDownloads || 0;
      const alreadyDownloadedFeed = feedDownloadStats.alreadyDownloaded || 0;
      const failedFeedDownloads = feedDownloadStats.failedDownloads || 0;

      onLog(
        `  Feed photos download completed: ${newFeedDownloads} new feed photos downloaded`,
        'success'
      );
      if (alreadyDownloadedFeed > 0) {
        onLog(
          `  → ${alreadyDownloadedFeed} feed photos were already downloaded`,
          'info'
        );
      }
      if (failedFeedDownloads > 0) {
        onLog(
          `  → ${failedFeedDownloads} feed photos failed to download`,
          'warning'
        );
      }
    } else {
      onLog('Step 3: Skipping feed photos download (disabled)', 'info');
    }

    // Summary
    onLog(`Summary: ${newDownloads} photos downloaded`, 'info');
    if (downloadFeed && feedDownloadResult?.data) {
      const feedDownloadStats = feedDownloadResult.data?.downloadStats || {};
      const newFeedDownloads = feedDownloadStats.newDownloads || 0;
      onLog(`Summary: ${newFeedDownloads} feed photos downloaded`, 'info');
    }

    return {
      success: true,
      data: {
        photos: photosResult.data,
        feed: feedResult?.data || null,
        downloads: downloadResult.data,
        feedDownloads: feedDownloadResult?.data || null,
      },
    };
  };

  const clearData = async () => {
    if (!window.electronAPI)
      return { success: false, error: 'Electron API not available' };

    if (!accountId) {
      return { success: false, error: 'Account ID is required' };
    }

    onLog('Clearing account data...', 'info');
    onLog(`  → Removing JSON files for account: ${accountId}`, 'info');

    try {
      const result = await window.electronAPI.clearAccountData(
        accountId.trim()
      );

      if (result.success) {
        onLog('Account data cleared successfully', 'success');
        onLog(`  → Removed ${result.data?.filesRemoved || 0} files`, 'info');
        return { success: true, data: result.data };
      } else {
        onLog(`Failed to clear account data: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      onLog(`Failed to clear account data: ${errorMessage}`, 'error');
      return { success: false, error: errorMessage };
    }
  };

  const cancelOperation = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.cancelOperation();
        onLog('Operation cancelled', 'warning');
        setOperationActive(false);
      }
    } catch (error) {
      onLog(`Failed to cancel operation: ${error}`, 'error');
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title font-mono">CONTROLS</h2>
      <div className="space-y-4">
        {/* Username Search */}
        <div>
          <label className="form-label font-mono">SEARCH_BY_USERNAME:</label>
          <input
            type="text"
            onChange={e => handleUsernameSearch(e.target.value)}
            placeholder="Enter username to search"
            className="form-input font-mono w-full"
            disabled={isOperationActive}
          />
          {isSearching && (
            <p className="text-sm text-terminal-textMuted mt-1 font-mono">
              &gt; Searching accounts...
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1">
              {searchResults.slice(0, 5).map((account, index) => (
                <button
                  key={index}
                  onClick={() => selectAccount(account)}
                  className="w-full text-left p-2 bg-terminal-surface border border-terminal-border rounded hover:bg-terminal-textDim transition-colors"
                >
                  <div className="font-mono text-sm">
                    <span className="text-terminal-text">
                      {account.displayName}
                    </span>
                    <span className="text-terminal-textMuted">
                      {' '}
                      @{account.username}
                    </span>
                    <span className="text-terminal-textMuted text-xs">
                      {' '}
                      (ID: {account.accountId})
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Account ID Input */}
        <div>
          <label className="form-label font-mono">ACCOUNT_ID:</label>
          <input
            type="text"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            onBlur={() => lookupAccount(accountId)}
            placeholder="Enter Rec Room account ID"
            className="form-input font-mono w-full"
            disabled={isOperationActive}
          />
          {isLookingUpAccount && (
            <p className="text-sm text-terminal-textMuted mt-1 font-mono">
              &gt; Looking up account...
            </p>
          )}
          {accountInfo && (
            <p className="text-sm text-terminal-success mt-1 font-mono">
              &gt; Found: {accountInfo.displayName}, @{accountInfo.username}
            </p>
          )}
        </div>

        {/* RecNet Token Input */}
        <div>
          <label className="form-label font-mono">(Bearer) AUTH_TOKEN:</label>
          <input
            type="password"
            value={recNetToken}
            onChange={e => setRecNetToken(e.target.value)}
            placeholder="Enter rec.net token for higher rate limits"
            className="form-input font-mono w-full"
            disabled={isOperationActive}
          />
          <p className="text-sm text-terminal-textMuted mt-2 font-mono text-center">
            &gt; If you enter your authentication token, the app will be able to
            fetch public, private, and unlisted photos.
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={incremental}
              onChange={e => setIncremental(e.target.checked)}
              className="w-5 h-5 text-terminal-accent rounded focus:ring-terminal-accent"
              disabled={isOperationActive}
            />
            <span className="font-medium text-terminal-text font-mono">
              INCREMENTAL_MODE (only new photos)
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={downloadFeed}
              onChange={e => setDownloadFeed(e.target.checked)}
              className="w-5 h-5 text-terminal-accent rounded focus:ring-terminal-accent"
              disabled={isOperationActive}
            />
            <span className="font-medium text-terminal-text font-mono">
              INCLUDE_FEED_PHOTOS
            </span>
          </label>
        </div>

        {/* Main Download Button */}
        <div>
          <button
            onClick={() => handleOperation(downloadAll, 'Download All')}
            disabled={isOperationActive}
            className="btn btn-primary w-full flex items-center justify-center gap-2 font-mono text-lg py-4"
          >
            <Download size={20} />
            DOWNLOAD_ALL
          </button>
          <p className="text-sm text-terminal-textMuted mt-2 font-mono text-center">
            &gt; Collects photo metadata first, then downloads all photos. This
            is done in a gentle way as to avoid a potential 24 hour IP bans.
          </p>
        </div>

        {/* Clear Data Button */}
        <div>
          <button
            onClick={() => handleOperation(clearData, 'Clear Data')}
            disabled={isOperationActive || !accountId}
            className="btn w-full flex items-center justify-center gap-2 font-mono text-sm py-2 bg-transparent text-red-500 border border-red-500 hover:bg-red-500 hover:text-white transition-colors"
          >
            <Trash2 size={16} />
            CLEAR_ACCOUNT_DATA
          </button>
          <p className="text-sm text-terminal-textMuted mt-1 font-mono text-center">
            &gt; Removes all JSON metadata files for this account
          </p>
        </div>

        {/* Cancel Button */}
        {isOperationActive && (
          <button
            onClick={cancelOperation}
            className="btn btn-danger w-full flex items-center justify-center gap-2 font-mono"
          >
            <X size={16} />
            ABORT_OPERATION
          </button>
        )}
      </div>
    </div>
  );
};
