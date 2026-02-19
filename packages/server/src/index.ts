import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.PORT ?? "8765", 10);

const producers = new Set<WebSocket>();
const consumers = new Set<WebSocket>();

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        producers: producers.size,
        consumers: consumers.size,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

function parseRole(req: IncomingMessage): "producer" | "consumer" | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const role = url.searchParams.get("role");
  if (role === "producer" || role === "consumer") return role;
  return null;
}

wss.on("connection", (ws, req) => {
  const role = parseRole(req);

  if (!role) {
    console.log("[ws] rejected connection: missing/invalid role param");
    ws.close(4000, "role query param required (producer|consumer)");
    return;
  }

  const pool = role === "producer" ? producers : consumers;
  pool.add(ws);
  console.log(`[ws] ${role} connected (${pool.size} total)`);

  if (role === "producer") {
    ws.on("message", (data) => {
      const msg = typeof data === "string" ? data : data.toString();
      for (const consumer of consumers) {
        if (consumer.readyState === WebSocket.OPEN) {
          consumer.send(msg);
        }
      }
    });
  }

  ws.on("close", () => {
    pool.delete(ws);
    console.log(`[ws] ${role} disconnected (${pool.size} remaining)`);
  });

  ws.on("error", (err) => {
    console.error(`[ws] ${role} error:`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
