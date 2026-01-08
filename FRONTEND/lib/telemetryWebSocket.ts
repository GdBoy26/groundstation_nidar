import { useTelemetryStore } from "@/stores/telemetryStore";

type WebSocketMessageHandler = (data: any) => void;

class TelemetryWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 3000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageHandlers: WebSocketMessageHandler[] = [];

  constructor(url: string = "ws://localhost:8765/telemetry") {
    this.url = url;
  }

  /**
   * Connect to the WebSocket server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("[WS] Connected to telemetry server");
          if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
            this.messageHandlers.forEach((handler) => handler(message));
          } catch (e) {
            console.error("[WS] Failed to parse message:", e);
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WS] WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("[WS] Disconnected from telemetry server");
          this.ws = null;
          this.attemptReconnect();
        };
      } catch (e) {
        console.error("[WS] Failed to create WebSocket:", e);
        reject(e);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log("[WS] Disconnected");
  }

  /**
   * Attempt to reconnect to the server
   */
  private attemptReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(
      `[WS] Attempting to reconnect in ${this.reconnectInterval}ms...`
    );

    this.reconnectTimer = setInterval(() => {
      this.connect().catch(() => {
        // Will retry again in reconnectInterval
      });
    }, this.reconnectInterval);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    if (message.action === "log") {
      this.handleLogMessage(message.data);
    } else if (message.action === "telemetry") {
      this.handleTelemetryMessage(message.data);
    }
  }

  /**
   * Handle log messages from the drone
   */
  private handleLogMessage(logData: any): void {
    const { time, source, level, message } = logData;

    // Add log to telemetry store
    useTelemetryStore.getState().addLog({
      time: time || new Date().toLocaleTimeString(),
      source: source || "SYSTEM",
      level: level || "INFO",
      message: message || "",
    });

    console.log(`[LOG] ${source} [${level}]: ${message}`);
  }

  /**
   * Handle telemetry messages from the drone
   */
  private handleTelemetryMessage(telemetryData: any): void {
    // Update the telemetry store with new data
    useTelemetryStore.getState().setState(telemetryData);
  }

  /**
   * Register a custom message handler
   */
  public onMessage(handler: WebSocketMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsClient: TelemetryWebSocketClient | null = null;

/**
 * Get or create the WebSocket client instance
 */
export function getTelemetryWebSocketClient(): TelemetryWebSocketClient {
  if (!wsClient) {
    wsClient = new TelemetryWebSocketClient();
  }
  return wsClient;
}

/**
 * Initialize WebSocket connection
 */
export async function initTelemetryWebSocket(): Promise<void> {
  const client = getTelemetryWebSocketClient();
  try {
    await client.connect();
  } catch (e) {
    console.error("[WS] Failed to connect to telemetry WebSocket:", e);
    // Will auto-retry
  }
}
