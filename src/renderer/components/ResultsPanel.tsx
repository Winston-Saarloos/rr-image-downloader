import React from 'react';
import {
  CheckCircle,
  XCircle,
  Info,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

interface Result {
  operation: string;
  data: unknown;
  type: 'success' | 'error';
  timestamp: string;
}

interface ResultsPanelProps {
  results: Result[];
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({ results }) => {
  const getResultIcon = (type: 'success' | 'error') => {
    return type === 'success' ? (
      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
    ) : (
      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
    );
  };

  const getResultColor = (type: 'success' | 'error') => {
    return type === 'success'
      ? 'border-l-green-600 dark:border-l-green-400'
      : 'border-l-red-600 dark:border-l-red-400';
  };

  const renderResultContent = (result: Result) => {
    if (result.type === 'error') {
      const errorData = result.data as { error?: string };
      return (
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-red-600 dark:text-red-400 font-medium">Error:</p>
            <p className="text-red-600 dark:text-red-400 text-sm">
              {errorData.error || 'Unknown error'}
            </p>
          </div>
        </div>
      );
    }

    const data = result.data as {
      totalPhotos?: number;
      totalNewPhotosAdded?: number;
      downloadStats?: {
        newDownloads: number;
        alreadyDownloaded: number;
        failedDownloads: number;
      };
      saved?: string;
      photosDirectory?: string;
      feedPhotosDirectory?: string;
    };

    return (
      <div className="space-y-2">
        {data.totalPhotos !== undefined && (
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-green-600 dark:text-green-400 font-medium">
              Total photos: {data.totalPhotos}
            </span>
          </div>
        )}

        {data.totalNewPhotosAdded !== undefined && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-600 dark:text-blue-400">
              New photos: {data.totalNewPhotosAdded}
            </span>
          </div>
        )}

        {data.downloadStats && (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-green-600 dark:text-green-400">
                Downloads: {data.downloadStats.newDownloads}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-blue-600 dark:text-blue-400">
                Already existed: {data.downloadStats.alreadyDownloaded}
              </span>
            </div>

            {data.downloadStats.failedDownloads > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="text-yellow-600 dark:text-yellow-400">
                  Failed: {data.downloadStats.failedDownloads}
                </span>
              </div>
            )}
          </>
        )}

        {data.saved && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-600 dark:text-blue-400 text-sm">
              Saved to: {data.saved}
            </span>
          </div>
        )}

        {data.photosDirectory && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-600 dark:text-blue-400 text-sm">
              Photos: {data.photosDirectory}
            </span>
          </div>
        )}

        {data.feedPhotosDirectory && (
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-600 dark:text-blue-400 text-sm">
              Feed: {data.feedPhotosDirectory}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Operation Results
        </CardTitle>
        <CardDescription>
          View results from completed operations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-80 overflow-y-auto space-y-4">
          {results.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Info className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-lg font-medium">No operations completed yet</p>
              <p className="text-sm">
                Results will appear here after running operations
              </p>
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border-l-4 ${getResultColor(
                  result.type
                )} bg-card`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getResultIcon(result.type)}
                    <h3 className="font-semibold">{result.operation}</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {result.timestamp}
                  </span>
                </div>

                {renderResultContent(result)}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};
