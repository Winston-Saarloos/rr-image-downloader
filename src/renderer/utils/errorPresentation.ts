import type {
  ErrorContext,
  OperationResultErrorData,
  UserErrorCategory,
  UserFacingIncident,
} from '../../shared/types';

const DOWNLOAD_RESUME = [
  'Anything already saved on disk is still available.',
  'Run the same download again to continue. Existing files are skipped automatically.',
  'You do not need to delete the output folder to resume.',
] as const;

function truncateDetail(s: string, max = 220): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function detectCategory(message: string): UserErrorCategory {
  if (/^operation cancelled$/i.test(message)) return 'cancelled';
  if (/account not found/i.test(message)) return 'account';
  if (/token|401|403|unauthorized|forbidden/i.test(message)) return 'auth';
  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|ENETUNREACH|fetch failed|getaddrinfo|socket hang|network|timed out|offline/i.test(
      message
    )
  ) {
    return 'network';
  }
  if (
    /ENOSPC|EACCES|EPERM|ENOENT|no space|permission denied|disk full|not writable|path.*not found/i.test(
      message
    )
  ) {
    return 'disk';
  }
  return 'unknown';
}

function pickTitle(context: ErrorContext, category: UserErrorCategory): string {
  if (category === 'cancelled') return 'Download cancelled';

  if (context === 'download') {
    if (category === 'account') return 'We could not find that account';
    if (category === 'auth') return 'Access was denied';
    if (category === 'network') return 'Could not reach RecNet';
    if (category === 'disk') return 'Could not use your save folder';
    return 'Download could not finish';
  }
  if (context === 'settings') return 'Could not load settings';
  if (context === 'photos') return 'Could not load photos';
  if (context === 'updateSettings') return 'Could not save settings';
  return 'Something went wrong';
}

function buildGuidance(
  context: ErrorContext,
  category: UserErrorCategory,
  message: string
): string[] {
  const g: string[] = [];

  if (context === 'download') {
    if (category !== 'cancelled') {
      g.push(...DOWNLOAD_RESUME);
    }
    if (category === 'auth' || /token|401|403/i.test(message)) {
      g.push(
        'Paste a fresh access token in Download if you need private photos, then try again.'
      );
    }
    if (category === 'account') {
      g.push(
        'Check the spelling of the RecNet username or use the exact @name from the profile.'
      );
    }
    if (category === 'network') {
      g.push(
        'Check your internet connection, then use Retry or run Download again.'
      );
    }
    if (category === 'disk') {
      g.push(
        'Pick a folder you can download to, confirm there is free disk space, and try again.'
      );
    }
    if (category === 'unknown') {
      g.push('Use View details for logs, or try Retry after a moment.');
    }
    if (category === 'cancelled') {
      g.push(
        'Run Download again anytime; files already saved are kept and skipped automatically.'
      );
    }
    return g;
  }

  if (category === 'network') {
    g.push('Check your internet connection and try again.');
  }
  if (
    category === 'disk' ||
    context === 'settings' ||
    context === 'updateSettings'
  ) {
    g.push(
      'Confirm the output folder exists, is on a reachable drive, and the app can read and write there.'
    );
  }
  if (context === 'photos') {
    g.push(
      'Open your output folder to verify files are present for this account.'
    );
    g.push('Use Open activity (gear) to review paths in settings if needed.');
  }
  if (context === 'settings') {
    g.push('Restart the app if this message appears every launch.');
  }
  if (context === 'updateSettings') {
    g.push(
      'Check disk space and folder permissions, then change settings again.'
    );
  }
  if (g.length === 0) {
    g.push(
      'Try again. If it keeps failing, use View details for more information.'
    );
  }
  return g;
}

export interface ClassifiedError {
  category: UserErrorCategory;
  title: string;
  detail: string;
  guidance: string[];
}

export function classifyError(
  rawMessage: string,
  context: ErrorContext
): ClassifiedError {
  const message = (rawMessage || 'Something went wrong').trim();

  if (context === 'download' && /^operation cancelled$/i.test(message)) {
    return {
      category: 'cancelled',
      title: pickTitle(context, 'cancelled'),
      detail: 'You stopped the download.',
      guidance: buildGuidance(context, 'cancelled', message),
    };
  }

  const category = detectCategory(message);
  const title = pickTitle(context, category);
  const detail = truncateDetail(message);
  const guidance = buildGuidance(context, category, message);

  return { category, title, detail, guidance };
}

export function toOperationErrorData(
  rawMessage: string,
  context: ErrorContext
): OperationResultErrorData {
  const c = classifyError(rawMessage, context);
  return {
    error: rawMessage,
    title: c.title,
    category: c.category,
    guidance: c.guidance,
  };
}

export function createUserIncident(
  source: ErrorContext,
  rawMessage: string,
  options?: { severity?: 'error' | 'warning'; technicalDetail?: string }
): UserFacingIncident {
  const c = classifyError(rawMessage, source);
  const severity =
    options?.severity ?? (c.category === 'cancelled' ? 'warning' : 'error');
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    source,
    severity,
    category: c.category,
    title: c.title,
    detail: c.detail,
    guidance: c.guidance,
    technicalDetail: options?.technicalDetail ?? rawMessage,
  };
}
