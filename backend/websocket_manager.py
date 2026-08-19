import logging
from collections import defaultdict
from typing import Any, Dict, List

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Tracks WebSocket connections grouped by task_id and broadcasts updates to them."""

    def __init__(self):
        self.connections: Dict[str, List[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, task_id: str) -> None:
        await websocket.accept()
        self.connections[task_id].append(websocket)
        logger.debug("Client connected to task %s (%d total)", task_id, len(self.connections[task_id]))

    def disconnect(self, websocket: WebSocket, task_id: str) -> None:
        sockets = self.connections.get(task_id)
        if not sockets:
            return

        if websocket in sockets:
            sockets.remove(websocket)

        if not sockets:
            self.connections.pop(task_id, None)

    async def send_to_task(self, task_id: str, data: Any) -> None:
        """Send data to every connection subscribed to task_id.

        Dead/broken sockets are dropped instead of blowing up the whole broadcast.
        """
        sockets = self.connections.get(task_id)
        if not sockets:
            return

        stale: List[WebSocket] = []

        for websocket in list(sockets):  # snapshot, since we may mutate during iteration
            try:
                await websocket.send_json(data)
            except Exception as e:
                logger.warning("Failed to send to a socket on task %s: %s", task_id, e)
                stale.append(websocket)

        for websocket in stale:
            self.disconnect(websocket, task_id)

    def active_connection_count(self, task_id: str) -> int:
        return len(self.connections.get(task_id, []))


manager = ConnectionManager()