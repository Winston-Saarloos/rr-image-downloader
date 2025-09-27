import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
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
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Set new timeout for debouncing
    const timeout = setTimeout(() => {
      searchAccounts(username);
    }, 1000); // 1 second debounce

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
    if (!active) {
      // Clear progress monitor
      if (progressMonitor) {
        clearInterval(progressMonitor);
        setProgressMonitor(null);
      }
      onProgressChange({
        isRunning: false,
        currentStep: 'Ready',
        current: 0,
        total: 0,
        progress: 0,
      });
    } else {
      // Start progress monitoring
      const monitor = setInterval(async () => {
        if (window.electronAPI) {
          try {
            const progress = await window.electronAPI.getProgress();
            onProgressChange(progress);

            // Log progress updates for long operations
            if (progress.isRunning && progress.currentStep) {
              if (
                progress.currentStep.includes('Fetching page') ||
                progress.currentStep.includes('Collecting')
              ) {
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
        }
      }, 2000); // Check every 2 seconds
      setProgressMonitor(monitor);
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
        onLog(`${operationName} completed successfully!`, 'success');
        onResult(operationName, result.data, 'success');
      } else {
        onLog(`${operationName} failed: ${result.error}`, 'error');
        onResult(operationName, { error: result.error }, 'error');
      }
    } catch (error) {
      onLog(`${operationName} error: ${error}`, 'error');
      onResult(operationName, { error: String(error) }, 'error');
    } finally {
      setOperationActive(false);
    }
  };

  // const collectPhotos = async () => {
  //   if (!window.electronAPI)
  //     return { success: false, error: 'Electron API not available' };

  //   return await window.electronAPI.collectPhotos({
  //     accountId: accountId.trim(),
  //     token: recNetToken.trim() || undefined,
  //     incremental,
  //     maxIterations,
  //   });
  // };

  // const collectFeedPhotos = async () => {
  //   if (!window.electronAPI)
  //     return { success: false, error: 'Electron API not available' };

  //   return await window.electronAPI.collectFeedPhotos({
  //     accountId: accountId.trim(),
  //     token: recNetToken.trim() || undefined,
  //     incremental,
  //     maxIterations,
  //   });
  // };

  // const downloadPhotos = async () => {
  //   if (!window.electronAPI)
  //     return { success: false, error: 'Electron API not available' };

  //   return await window.electronAPI.downloadPhotos({
  //     accountId: accountId.trim(),
  //     limit: downloadLimit,
  //   });
  // };

  // const downloadFeedPhotos = async () => {
  //   if (!window.electronAPI)
  //     return { success: false, error: 'Electron API not available' };

  //   return await window.electronAPI.downloadFeedPhotos({
  //     accountId: accountId.trim(),
  //     limit: downloadLimit,
  //   });
  // };

  const downloadAll = async () => {
    if (!window.electronAPI)
      return { success: false, error: 'Electron API not available' };

    // Step 1: Collect photos metadata
    onLog('Step 1: Collecting photos metadata...', 'info');
    onLog('  → Fetching photo information from RecNet API...', 'info');
    onLog(`  → Processing all pages (150 photos per page)...`, 'info');
    onLog(
      '  → This may take a few minutes for accounts with many photos...',
      'info'
    );
    onLog(
      '  → Progress updates will appear below as we process each page...',
      'info'
    );

    const photosResult = await window.electronAPI.collectPhotos({
      accountId: accountId.trim(),
      token: recNetToken.trim() || undefined,
    });

    if (!photosResult.success) {
      return {
        success: false,
        error: `Failed to collect photos metadata: ${photosResult.error}`,
      };
    }

    const totalPhotos = photosResult.data?.totalPhotos || 0;
    const newPhotos = photosResult.data?.totalNewPhotosAdded || 0;
    const existingPhotos = photosResult.data?.existingPhotos || 0;
    const totalFetched = photosResult.data?.totalFetched || 0;
    const iterationsCompleted = photosResult.data?.iterationsCompleted || 0;

    onLog(
      `  ✅ Photos metadata collected: ${totalPhotos} total photos found`,
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

    // Step 2: Collect feed metadata (if enabled)
    let feedResult: any = null;
    if (downloadFeed) {
      onLog('Step 2: Collecting feed metadata...', 'info');
      onLog('  → Fetching feed photo information from RecNet API...', 'info');
      onLog(`  → Processing all pages (150 photos per page)...`, 'info');
      onLog(
        '  → This may take a few minutes for accounts with many feed photos...',
        'info'
      );
      onLog(
        '  → Progress updates will appear below as we process each page...',
        'info'
      );

      feedResult = await window.electronAPI.collectFeedPhotos({
        accountId: accountId.trim(),
        token: recNetToken.trim() || undefined,
        incremental,
      });

      if (!feedResult.success) {
        return {
          success: false,
          error: `Failed to collect feed metadata: ${feedResult.error}`,
        };
      }

      const totalFeedPhotos = feedResult.data?.totalPhotos || 0;
      const newFeedPhotos = feedResult.data?.totalNewPhotosAdded || 0;
      const existingFeedPhotos = feedResult.data?.existingPhotos || 0;
      const totalFeedFetched = feedResult.data?.totalFetched || 0;
      const feedIterationsCompleted = feedResult.data?.iterationsCompleted || 0;

      onLog(
        `  ✅ Feed metadata collected: ${totalFeedPhotos} total feed photos found`,
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
    } else {
      onLog('Step 2: Skipping feed metadata collection (disabled)', 'info');
    }

    // Step 3: Download photos
    onLog('Step 3: Downloading photos...', 'info');
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
    const newDownloads = (downloadStats as any).newDownloads || 0;
    const alreadyDownloaded = (downloadStats as any).alreadyDownloaded || 0;
    const failedDownloads = (downloadStats as any).failedDownloads || 0;

    onLog(
      `  ✅ Photos download completed: ${newDownloads} new photos downloaded`,
      'success'
    );
    if (alreadyDownloaded > 0) {
      onLog(`  → ${alreadyDownloaded} photos were already downloaded`, 'info');
    }
    if (failedDownloads > 0) {
      onLog(`  → ${failedDownloads} photos failed to download`, 'warning');
    }

    // Step 4: Download feed photos (if enabled and limited)
    let feedDownloadResult: any = null;
    if (downloadFeed) {
      onLog('Step 4: Downloading feed photos...', 'info');
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
      const newFeedDownloads = (feedDownloadStats as any).newDownloads || 0;
      const alreadyDownloadedFeed =
        (feedDownloadStats as any).alreadyDownloaded || 0;
      const failedFeedDownloads =
        (feedDownloadStats as any).failedDownloads || 0;

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
      onLog('Step 4: Skipping feed photos download (disabled)', 'info');
    }

    // Final summary
    onLog('', 'info'); // Empty line for separation
    onLog('DOWNLOAD_ALL operation completed successfully!', 'success');
    onLog(`Summary: ${newDownloads} photos downloaded`, 'info');
    if (downloadFeed && feedDownloadResult) {
      const feedDownloadStats = feedDownloadResult.data?.downloadStats || {};
      const newFeedDownloads = (feedDownloadStats as any).newDownloads || 0;
      if (newFeedDownloads > 0) {
        onLog(`📊 Summary: ${newFeedDownloads} feed photos downloaded`, 'info');
      }
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
      <h2 className="text-2xl font-bold text-terminal-text mb-6 pb-3 border-b-2 border-terminal-border font-mono">
        ADVANCED_OPTIONS
      </h2>

      <div className="space-y-6">
        {/* Username Search */}
        <div>
          <label className="form-label font-mono">SEARCH_BY_@USERNAME:</label>
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

        {/* Account ID */}
        <div>
          <label className="form-label font-mono">TARGET_ACCOUNT:</label>
          <input
            type="text"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            onBlur={e => lookupAccount(e.target.value)}
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

        {/* RecNet Token */}
        <div>
          <label className="form-label font-mono">(Bearer) AUTH_TOKEN:</label>
          <input
            type="password"
            value={recNetToken}
            onChange={e => setRecNetToken(e.target.value)}
            placeholder="Enter RecNet token for higher rate limits"
            className="form-input font-mono w-full"
            disabled={isOperationActive}
          />
          <p className="text-sm text-terminal-textMuted mt-1 font-mono">
            &gt; Optional: Higher rate limits
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer">
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

          <label className="flex items-center space-x-3 cursor-pointer">
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
            &gt; Collects metadata first, then downloads all photos
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
