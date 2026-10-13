/**
 * Sends a plain-text alert to SLACK_WEBHOOK_URL when set.
 * Non-fatal: logs and swallows errors so callers are never blocked.
 */
export async function sendAlert(message: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      console.error("[Alert] Slack webhook error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[Alert] Failed to send alert:", err);
  }
}
