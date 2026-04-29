// server/metrics.ts
// Lightweight in-memory runtime metrics exposed via /api/stats.
// Process-local only — fine for a single Railway container.
// If we ever scale to N replicas we'd back this with the SQLite logs table.

export interface RuntimeMetrics {
  inFlightHunts: number;
  queuedHunts: number;          // 0 today — placeholder for a future job-queue mode
  totalHuntsCompleted: number;
  totalHuntsFailed: number;
  lastSuccess: { runId: string; at: string; newLeads: number } | null;
  lastError: { runId: string; at: string; message: string } | null;
  startedAt: string;
}

class MetricsRegistry {
  private state: RuntimeMetrics = {
    inFlightHunts: 0,
    queuedHunts: 0,
    totalHuntsCompleted: 0,
    totalHuntsFailed: 0,
    lastSuccess: null,
    lastError: null,
    startedAt: new Date().toISOString(),
  };

  huntStarted() {
    this.state.inFlightHunts++;
  }

  huntFinished(runId: string, newLeads: number) {
    this.state.inFlightHunts = Math.max(0, this.state.inFlightHunts - 1);
    this.state.totalHuntsCompleted++;
    this.state.lastSuccess = {
      runId,
      at: new Date().toISOString(),
      newLeads,
    };
  }

  huntFailed(runId: string, message: string) {
    this.state.inFlightHunts = Math.max(0, this.state.inFlightHunts - 1);
    this.state.totalHuntsFailed++;
    this.state.lastError = {
      runId,
      at: new Date().toISOString(),
      message: message.slice(0, 500),
    };
  }

  snapshot(): RuntimeMetrics {
    return { ...this.state };
  }
}

export const metrics = new MetricsRegistry();
