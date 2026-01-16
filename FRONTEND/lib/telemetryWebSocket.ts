import { useTelemetryStore } from "@/stores/telemetryStore";

type WebSocketMessageHandler = (data: any) => void;
type DroneType = "vtol" | "delivery";

/**
 * NIDAR Dual WebSocket Client
 * 
 * Connects to TWO independent WebSocket servers:
 *   - VTOL WebSocket: ws://localhost:8765 (VTOL logs & telemetry only)
 *   - Delivery WebSocket: ws://localhost:8766 (Delivery logs & telemetry only)
 * 
 * Each drone has completely independent log streams.
 */
class DualTelemetryWebSocketClient {
  // VTOL WebSocket (port 8765)
  private vtolWs: WebSocket | null = null;
  private vtolUrl: string = "ws://localhost:8765";
  private vtolReconnectTimer: NodeJS.Timeout | null = null;
  private vtolConnected: boolean = false;

  // Delivery WebSocket (port 8766)
  private deliveryWs: WebSocket | null = null;
  private deliveryUrl: string = "ws://localhost:8766";
  private deliveryReconnectTimer: NodeJS.Timeout | null = null;
  private deliveryConnected: boolean = false;

  private reconnectInterval: number = 3000;
  private messageHandlers: WebSocketMessageHandler[] = [];

  constructor() {
    // URLs are fixed for the dual-drone system
  }

  /**
   * Connect to both WebSocket servers
   */
  public async connect(): Promise<void> {
    await Promise.allSettled([
      this.connectVtol(),
      this.connectDelivery()
    ]);
  }

  /**
   * Connect to VTOL WebSocket (port 8765)
   */
  private connectVtol(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.vtolWs = new WebSocket(this.vtolUrl);

        this.vtolWs.onopen = () => {
          console.log("[VTOL_WS] ✅ Connected to VTOL server (ws://localhost:8765)");
          this.vtolConnected = true;
          if (this.vtolReconnectTimer) {
            clearInterval(this.vtolReconnectTimer);
            this.vtolReconnectTimer = null;
          }
          resolve();
        };

        this.vtolWs.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleVtolMessage(message);
            this.messageHandlers.forEach((handler) => handler({ ...message, _source: "vtol" }));
          } catch (e) {
            console.error("[VTOL_WS] Failed to parse message:", e);
          }
        };

        this.vtolWs.onerror = (error) => {
          console.error("[VTOL_WS] WebSocket error:", error);
        };

        this.vtolWs.onclose = () => {
          console.log("[VTOL_WS] Disconnected from VTOL server");
          this.vtolWs = null;
          this.vtolConnected = false;
          this.attemptVtolReconnect();
        };
      } catch (e) {
        console.error("[VTOL_WS] Failed to create WebSocket:", e);
        reject(e);
      }
    });
  }

  /**
   * Connect to Delivery WebSocket (port 8766)
   */
  private connectDelivery(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.deliveryWs = new WebSocket(this.deliveryUrl);

        this.deliveryWs.onopen = () => {
          console.log("[DELIVERY_WS] ✅ Connected to Delivery server (ws://localhost:8766)");
          this.deliveryConnected = true;
          if (this.deliveryReconnectTimer) {
            clearInterval(this.deliveryReconnectTimer);
            this.deliveryReconnectTimer = null;
          }
          resolve();
        };

        this.deliveryWs.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleDeliveryMessage(message);
            this.messageHandlers.forEach((handler) => handler({ ...message, _source: "delivery" }));
          } catch (e) {
            console.error("[DELIVERY_WS] Failed to parse message:", e);
          }
        };

        this.deliveryWs.onerror = (error) => {
          console.error("[DELIVERY_WS] WebSocket error:", error);
        };

        this.deliveryWs.onclose = () => {
          console.log("[DELIVERY_WS] Disconnected from Delivery server");
          this.deliveryWs = null;
          this.deliveryConnected = false;
          this.attemptDeliveryReconnect();
        };
      } catch (e) {
        console.error("[DELIVERY_WS] Failed to create WebSocket:", e);
        reject(e);
      }
    });
  }

  /**
   * Disconnect from both WebSocket servers
   */
  public disconnect(): void {
    if (this.vtolReconnectTimer) {
      clearInterval(this.vtolReconnectTimer);
      this.vtolReconnectTimer = null;
    }
    if (this.deliveryReconnectTimer) {
      clearInterval(this.deliveryReconnectTimer);
      this.deliveryReconnectTimer = null;
    }

    if (this.vtolWs) {
      this.vtolWs.close();
      this.vtolWs = null;
    }
    if (this.deliveryWs) {
      this.deliveryWs.close();
      this.deliveryWs = null;
    }

    console.log("[WS] Disconnected from both servers");
  }

  private attemptVtolReconnect(): void {
    if (this.vtolReconnectTimer) return;
    console.log(`[VTOL_WS] Attempting to reconnect in ${this.reconnectInterval}ms...`);
    this.vtolReconnectTimer = setInterval(() => {
      this.connectVtol().catch(() => { });
    }, this.reconnectInterval);
  }

  private attemptDeliveryReconnect(): void {
    if (this.deliveryReconnectTimer) return;
    console.log(`[DELIVERY_WS] Attempting to reconnect in ${this.reconnectInterval}ms...`);
    this.deliveryReconnectTimer = setInterval(() => {
      this.connectDelivery().catch(() => { });
    }, this.reconnectInterval);
  }

  /**
   * Handle VTOL messages - adds to VTOL-specific log
   */
  private handleVtolMessage(message: any): void {
    if (message.action === "log") {
      this.handleLogMessage(message.data, "vtol");
    } else if (message.action === "telemetry") {
      this.handleTelemetryMessage(message.data, "vtol");
    } else if (message.action === "detection") {
      // Human detection event
      useTelemetryStore.getState().addLog({
        time: new Date().toLocaleTimeString(),
        source: "VTOL",
        level: "WARN",
        message: `🚨 HUMAN DETECTED at ${message.data?.lat?.toFixed(6)}, ${message.data?.lon?.toFixed(6)}`,
      });
    }
  }

  /**
   * Handle Delivery messages - adds to Delivery-specific log
   */
  private handleDeliveryMessage(message: any): void {
    if (message.action === "log") {
      this.handleLogMessage(message.data, "delivery");
    } else if (message.action === "telemetry") {
      this.handleTelemetryMessage(message.data, "delivery");
    } else if (message.action === "reload_timer") {
      // Broadcast reload timer to store
      useTelemetryStore.getState().setState({
        reloadTimer: message.data
      });
    }
  }

  /**
   * Handle log messages - routes to correct log panel
   */
  private handleLogMessage(logData: any, source: DroneType): void {
    const { time, level, message } = logData;

    // Force correct source based on which WebSocket received it
    const logSource = source === "vtol" ? "VTOL" : "DRONE";

    useTelemetryStore.getState().addLog({
      time: time || new Date().toLocaleTimeString(),
      source: logSource,
      level: level || "INFO",
      message: message || "",
    });

    console.log(`[${logSource}] [${level}]: ${message}`);
  }

  /**
   * Handle telemetry messages
   */
  private handleTelemetryMessage(telemetryData: any, source: DroneType): void {
    useTelemetryStore.getState().setState(telemetryData);
  }

  /**
   * Send command to VTOL drone
   */
  public sendVtolCommand(command: string): void {
    if (this.vtolWs && this.vtolConnected) {
      this.vtolWs.send(JSON.stringify({ action: "command", command }));
      console.log(`[VTOL_WS] Sent command: ${command}`);
    } else {
      console.warn("[VTOL_WS] Not connected, cannot send command");
    }
  }

  /**
   * Send command to Delivery drone
   */
  public sendDeliveryCommand(command: string): void {
    if (this.deliveryWs && this.deliveryConnected) {
      this.deliveryWs.send(JSON.stringify({ action: "command", command }));
      console.log(`[DELIVERY_WS] Sent command: ${command}`);
    } else {
      console.warn("[DELIVERY_WS] Not connected, cannot send command");
    }
  }

  /**
   * Send terminal command to VTOL
   */
  public sendVtolTerminalCommand(command: string): void {
    if (this.vtolWs && this.vtolConnected) {
      this.vtolWs.send(JSON.stringify({ action: "terminal_command", command }));
    }
  }

  /**
   * Send terminal command to Delivery drone
   */
  public sendDeliveryTerminalCommand(command: string): void {
    if (this.deliveryWs && this.deliveryConnected) {
      this.deliveryWs.send(JSON.stringify({ action: "terminal_command", command }));
    }
  }

  /**
   * Register a custom message handler
   */
  public onMessage(handler: WebSocketMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Check if VTOL is connected
   */
  public isVtolConnected(): boolean {
    return this.vtolWs !== null && this.vtolWs.readyState === WebSocket.OPEN;
  }

  /**
   * Check if Delivery is connected
   */
  public isDeliveryConnected(): boolean {
    return this.deliveryWs !== null && this.deliveryWs.readyState === WebSocket.OPEN;
  }

  /**
   * Check if any connection is active
   */
  public isConnected(): boolean {
    return this.isVtolConnected() || this.isDeliveryConnected();
  }

  /**
   * Get VTOL WebSocket instance (for KML upload, etc.)
   */
  public getVtolWsInstance(): WebSocket | null {
    return this.vtolWs;
  }
}

// Singleton instance
let wsClient: DualTelemetryWebSocketClient | null = null;

/**
 * Get or create the WebSocket client instance
 */
export function getTelemetryWebSocketClient(): DualTelemetryWebSocketClient {
  if (!wsClient) {
    wsClient = new DualTelemetryWebSocketClient();
  }
  return wsClient;
}

/**
 * Initialize WebSocket connections to both VTOL and Delivery servers
 */
export async function initTelemetryWebSocket(): Promise<void> {
  const client = getTelemetryWebSocketClient();
  try {
    await client.connect();
  } catch (e) {
    console.error("[WS] Failed to connect to telemetry WebSockets:", e);
    // Will auto-retry
  }
}
