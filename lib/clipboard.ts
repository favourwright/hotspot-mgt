/**
 * Copies text to the clipboard, working on both secure (HTTPS/localhost) and
 * insecure (plain HTTP) origins.
 *
 * navigator.clipboard.writeText only works in a secure context — on a plain
 * HTTP deployment (as this app currently is, pending a domain + SSL) it's
 * either undefined or silently rejects. Falls back to the older
 * document.execCommand('copy') approach, which still works over HTTP.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy fallback below.
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful;
  } catch {
    return false;
  }
}
