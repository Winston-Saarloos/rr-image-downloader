import React from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';

interface Result {
  operation: string;
  data: any;
  type: 'success' | 'error';
  timestamp: string;
}

interface ResultsPanelProps {
  results: Result[];
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({ results }) => {
  const getResultIcon = (type: 'success' | 'error') => {
    return type === 'success' ? (
      <CheckCircle className="w-5 h-5 text-terminal-success" />
    ) : (
      <XCircle className="w-5 h-5 text-terminal-error" />
    );
  };

  const getResultColor = (type: 'success' | 'error') => {
    return type === 'success'
      ? 'border-l-terminal-success bg-terminal-surface'
      : 'border-l-terminal-error bg-terminal-surface';
  };

  const renderResultContent = (result: Result) => {
    if (result.type === 'error') {
      return (
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-terminal-error mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-terminal-error font-medium">Error:</p>
            <p className="text-terminal-error text-sm">{result.data.error}</p>
          </div>
        </div>
      );
    }

    const { data } = result;
    return (
      <div className="space-y-2">
        {data.totalPhotos !== undefined && (
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-terminal-success" />
            <span className="text-terminal-success font-medium">
              Total photos: {data.totalPhotos}
            </span>
          </div>
        )}

        {data.totalNewPhotosAdded !== undefined && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-terminal-info" />
            <span className="text-terminal-info">
              New photos: {data.totalNewPhotosAdded}
            </span>
          </div>
        )}

        {data.downloadStats && (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-terminal-success" />
              <span className="text-terminal-success">
                Downloads: {data.downloadStats.newDownloads}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-terminal-info" />
              <span className="text-terminal-info">
                Already existed: {data.downloadStats.alreadyDownloaded}
              </span>
            </div>

            {data.downloadStats.failedDownloads > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-terminal-warning" />
                <span className="text-terminal-warning">
                  Failed: {data.downloadStats.failedDownloads}
                </span>
              </div>
            )}
          </>
        )}

        {data.saved && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-terminal-info" />
            <span className="text-terminal-info text-sm">
              Saved to: {data.saved}
            </span>
          </div>
        )}

        {data.photosDirectory && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-terminal-info" />
            <span className="text-terminal-info text-sm">
              Photos: {data.photosDirectory}
            </span>
          </div>
        )}

        {data.feedPhotosDirectory && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-terminal-info" />
            <span className="text-terminal-info text-sm">
              Feed: {data.feedPhotosDirectory}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="panel">
      <h2 className="text-2xl font-bold text-terminal-text mb-6 pb-3 border-b-2 border-terminal-border terminal-glow font-mono">
        OPERATION_RESULTS
      </h2>

      <div className="max-h-80 overflow-y-auto space-y-4">
        {results.length === 0 ? (
          <div className="text-center py-8 text-terminal-textMuted">
            <Info className="w-12 h-12 mx-auto mb-3 text-terminal-textDim" />
            <p className="text-lg font-medium font-mono">
              &gt; No operations completed yet
            </p>
            <p className="text-sm font-mono">
              &gt; Results will appear here after running operations
            </p>
          </div>
        ) : (
          results.map((result, index) => (
            <div
              key={index}
              className={`p-4 rounded-lg border-l-4 ${getResultColor(
                result.type
              )} animate-slide-up`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {getResultIcon(result.type)}
                  <h3 className="font-semibold text-terminal-text font-mono">
                    {result.operation}
                  </h3>
                </div>
                <span className="text-xs text-terminal-textMuted font-mono">
                  {result.timestamp}
                </span>
              </div>

              {renderResultContent(result)}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
