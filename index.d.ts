declare module 'lwa-credential-rotation-alert' {
  export const DEFAULTS: {
    CLIENT_SECRET_ROTATION_DAYS: number;
    REFRESH_TOKEN_ROTATION_DAYS: number;
  };

  export const DEFAULT_ALERT_MILESTONES: number[];

  export const DEFAULT_FIELDS: Record<string, string>;

  export interface CredentialRecord {
    id?: string;
    projectName?: string;
    marketplace?: string;
    label?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    clientSecretRotationIntervalDays?: number;
    lastClientSecretRotatedAt?: Date | string;
    nextClientSecretRotationAt?: Date | string;
    refreshTokenRotationIntervalDays?: number;
    lastRefreshTokenRotatedAt?: Date | string;
    nextRefreshTokenRotationAt?: Date | string;
    [key: string]: unknown;
  }

  export interface CheckResult {
    type: 'CLIENT_SECRET' | 'REFRESH_TOKEN';
    dueDate: Date;
    daysLeft: number;
    overdue: boolean;
    shouldAlert: boolean;
    severity: 'critical' | 'warning' | 'info';
    milestone: number | null;
  }

  export interface Evaluation {
    credentialId?: string;
    projectName?: string;
    marketplace?: string;
    label: string;
    checks: CheckResult[];
    shouldAlert: boolean;
    severity?: 'critical' | 'warning' | 'info';
    missingNextDate?: boolean;
    alertSkipped?: string;
    alerted?: boolean;
    dryRun?: boolean;
    alertError?: string;
  }

  export interface CheckSummary {
    checkedAt: Date;
    total: number;
    alerting: number;
    alerted: number;
    skippedDedupe: number;
    missingNextDate: number;
    dryRun: boolean;
  }

  export interface StoreAdapter {
    getAllCredentials(): Promise<CredentialRecord[]>;
    getCredential?(id: string): Promise<CredentialRecord | null | undefined>;
    saveCredential?(data: Partial<CredentialRecord>): Promise<CredentialRecord>;
    markClientSecretRotated?(
      id: string,
      opts?: { newClientSecret?: string; intervalDays?: number }
    ): Promise<CredentialRecord>;
    markRefreshTokenRotated?(
      id: string,
      opts?: { newRefreshToken?: string; intervalDays?: number }
    ): Promise<CredentialRecord>;
    fields?: Record<string, string>;
  }

  export class MemoryStore implements StoreAdapter {
    getAllCredentials(): Promise<CredentialRecord[]>;
    getCredential(id: string): Promise<CredentialRecord | undefined>;
    saveCredential(data: Partial<CredentialRecord>): Promise<CredentialRecord>;
    markClientSecretRotated(
      id: string,
      opts?: { newClientSecret?: string; intervalDays?: number }
    ): Promise<CredentialRecord>;
    markRefreshTokenRotated(
      id: string,
      opts?: { newRefreshToken?: string; intervalDays?: number }
    ): Promise<CredentialRecord>;
  }

  export function createStore(opts: {
    model?: any;
    filter?: any;
    fields?: Partial<Record<string, string | false | null>>;
    getAll?: () => Promise<any[]>;
    getOne?: (id: string) => Promise<any>;
    create?: (data: any) => Promise<any>;
    updateById?: (id: string, patch: any) => Promise<any>;
  }): StoreAdapter;

  export interface RotationMonitorOptions {
    store: StoreAdapter;
    /** Continuous alerts when daysLeft ≤ this (default 7) */
    alertBeforeDays?: number;
    /** Also alert on these exact days-left values (default [30,14,7,3,1]) */
    alertMilestones?: number[];
    cronExpression?: string;
    timezone?: string;
    onAlert?: (evaluation: Evaluation, credential: CredentialRecord) => void | Promise<void>;
    onCheckComplete?: (summary: CheckSummary, results: Evaluation[]) => void | Promise<void>;
    runOnStart?: boolean;
    enabled?: boolean;
    dryRun?: boolean;
    trackClientSecret?: boolean;
    trackRefreshToken?: boolean;
    /** Suppress repeat alerts for same store within N hours (unless severity worsens) */
    minRepeatHours?: number;
    warnMissingNextDate?: boolean;
    projectName?: string;
    email?: boolean | {
      to?: string;
      from?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      auth?: { user?: string; pass?: string };
      transporter?: any;
      transporterOptions?: any;
      mailOptions?: any;
    };
    console?: boolean;
    slackWebhook?: string;
    webhookUrl?: string;
  }

  export class RotationMonitor {
    constructor(opts: RotationMonitorOptions);
    checkNow(): Promise<Evaluation[]>;
    start(): any;
    stop(): void;
    clearAlertHistory(): void;
  }

  export function computeNextRotation(
    lastRotatedAt: Date | string,
    intervalDays: number
  ): Date;
  export function daysUntil(targetDate: Date | string): number;
  export function severityForDaysLeft(daysLeft: number): 'critical' | 'warning' | 'info';
  export function evaluateCredential(
    credential: CredentialRecord,
    alertBeforeDays?: number,
    opts?: {
      trackClientSecret?: boolean;
      trackRefreshToken?: boolean;
      alertMilestones?: number[];
      projectName?: string;
    }
  ): Evaluation;
  export function normalizeCredential(
    row: any,
    fields?: Record<string, string | false | null>
  ): CredentialRecord | null;

  export const alerts: {
    formatMessage(input: any): string;
    slackAlert(webhookUrl: string, evaluation: Evaluation): Promise<void>;
    genericWebhookAlert(url: string, evaluation: Evaluation): Promise<void>;
    emailAlert(
      transporterOrOptions: any,
      mailOptions: { from?: string; to: string; subject?: string; text?: string; html?: string; [k: string]: any },
      evaluation: Evaluation
    ): Promise<void>;
    consoleAlert(evaluation: Evaluation): void;
    sendAlerts(
      channels: {
        slackWebhook?: string;
        webhookUrl?: string;
        email?: boolean | {
          to?: string;
          from?: string;
          host?: string;
          port?: number;
          secure?: boolean;
          auth?: { user?: string; pass?: string };
          transporter?: any;
          transporterOptions?: any;
          mailOptions?: any;
        };
        console?: boolean;
      },
      evaluation: Evaluation
    ): Promise<void>;
    emailAlertFromConfig(emailConfig: any, evaluation: Evaluation): Promise<void>;
  };
}
