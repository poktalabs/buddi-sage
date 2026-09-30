// When the page fakes the Worker. Decision: mock mode needs BOTH the ?mock=1 query flag
// AND a loopback host, and nothing is stored, so a production URL can never land in it
// by accident (a shared link with ?mock=1 on workers.dev still hits the real Worker).

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function mockRequested(search: string, hostname: string): boolean {
  return new URLSearchParams(search).get("mock") === "1" && LOOPBACK_HOSTS.has(hostname);
}
