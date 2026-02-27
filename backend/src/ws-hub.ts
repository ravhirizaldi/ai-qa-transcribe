type Subscription = {
  batches: Set<string>;
  jobs: Set<string>;
};

type Socket = {
  OPEN: number;
  readyState: number;
  send: (data: string) => void;
};

const subscriptions = new Map<Socket, Subscription>();

export const registerClient = (socket: Socket) => {
  subscriptions.set(socket, { batches: new Set(), jobs: new Set() });
};

export const unregisterClient = (socket: Socket) => {
  subscriptions.delete(socket);
};

export const handleSubscriptionMessage = (socket: Socket, data: unknown) => {
  if (typeof data !== "object" || data === null) return;
  const payload = data as {
    event?: string;
    batchId?: string;
    jobId?: string;
  };
  const sub = subscriptions.get(socket);
  if (!sub) return;

  if (payload.event === "subscribe.batch" && payload.batchId) {
    sub.batches.add(payload.batchId);
  }
  if (payload.event === "subscribe.job" && payload.jobId) {
    sub.jobs.add(payload.jobId);
  }
};

export const broadcastEvent = (event: {
  batchId?: string;
  jobId?: string;
  [k: string]: unknown;
}) => {
  const raw = JSON.stringify(event);
  for (const [socket, sub] of subscriptions.entries()) {
    if (socket.readyState !== socket.OPEN) continue;
    const batchAllowed = event.batchId ? sub.batches.has(String(event.batchId)) : false;
    const jobAllowed = event.jobId ? sub.jobs.has(String(event.jobId)) : false;
    if (batchAllowed || jobAllowed) {
      socket.send(raw);
    }
  }
};
