import httpx


def send_ntfy(server: str, topic: str, title: str, message: str, click_url: str | None = None, priority: int = 4) -> bool:
    """Publish via ntfy's JSON API (avoids header-encoding issues with '€')."""
    if not topic:
        return False
    payload = {"topic": topic, "title": title, "message": message, "priority": priority, "tags": ["moneybag"]}
    if click_url:
        payload["click"] = click_url
    r = httpx.post(server.rstrip("/"), json=payload, timeout=15)
    r.raise_for_status()
    return True
