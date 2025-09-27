import React, { useState, useEffect } from 'react';
import { SettingsPanel } from './components/SettingsPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { LogPanel } from './components/LogPanel';
import { RecNetSettings, Progress } from '../shared/types';

function App() {
  const [settings, setSettings] = useState<RecNetSettings>({
    outputRoot: 'output',
    cdnBase: 'https://img.rec.net/',
    globalMaxConcurrentDownloads: 1,
    interPageDelayMs: 500,
  });

  const [progress, setProgress] = useState<Progress>({
    isRunning: false,
    currentStep: 'Ready',
    progress: 0,
    total: 0,
    current: 0,
  });

  const [logs, setLogs] = useState<
    Array<{
      message: string;
      type: 'info' | 'success' | 'error' | 'warning';
      timestamp: string;
    }>
  >([]);
  const [results, setResults] = useState<
    Array<{
      operation: string;
      data: any;
      type: 'success' | 'error';
      timestamp: string;
    }>
  >([]);

  useEffect(() => {
    // Load settings on app start
    loadSettings();

    // Set up progress monitoring
    if (window.electronAPI) {
      window.electronAPI.onProgress((event, progressData) => {
        setProgress(progressData);
      });
    }
  }, []);

  const loadSettings = async () => {
    try {
      if (window.electronAPI) {
        const loadedSettings = await window.electronAPI.getSettings();
        setSettings(loadedSettings);
        addLog('Settings loaded', 'success');
      }
    } catch (error) {
      addLog(`Failed to load settings: ${error}`, 'error');
    }
  };

  const updateSettings = async (newSettings: Partial<RecNetSettings>) => {
    try {
      if (window.electronAPI) {
        const updatedSettings =
          await window.electronAPI.updateSettings(newSettings);
        setSettings(updatedSettings);
        addLog('Settings updated', 'success');
      }
    } catch (error) {
      addLog(`Failed to update settings: ${error}`, 'error');
    }
  };

  const addLog = (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning' = 'info'
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-99), { message, type, timestamp }]);
  };

  const addResult = (
    operation: string,
    data: any,
    type: 'success' | 'error'
  ) => {
    const timestamp = new Date().toLocaleString();
    setResults(prev => [
      { operation, data, type, timestamp },
      ...prev.slice(0, 9),
    ]);
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Log cleared', 'info');
    setResults([]);
  };

  return (
    <div className="h-screen bg-terminal-bg overflow-hidden">
      <div className="container mx-auto px-4 py-6 max-w-6xl h-full overflow-y-auto">
        {/* Header */}
        <header className="text-left mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-terminal-text mb-3 font-mono">
            &gt;_ PHOTO_DOWNLOADER.EXE
          </h1>
          <p className="text-xl text-terminal-textDim font-mono mb-4">v1.0</p>

          {/* Log Panel - Full Width */}
          <LogPanel logs={logs} onClearLogs={clearLogs} />
        </header>
        {/* Main Content */}
        <main className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <SettingsPanel
                settings={settings}
                onUpdateSettings={updateSettings}
                onLog={addLog}
              />

              <ControlsPanel
                onLog={addLog}
                onResult={addResult}
                onProgressChange={setProgress}
              />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <ProgressPanel progress={progress} settings={settings} />
              <ResultsPanel results={results} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
