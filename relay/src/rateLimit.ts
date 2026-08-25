// janela fixa simples — mesmo princípio do rate limit em Settlement.sol, só que
// aqui é defesa de infraestrutura (evitar spam), não trava de fundo
export class FixedWindowRateLimiter {
  private windowMs: number;
  private maxPerWindow: number;
  private windowStart = new Map<string, number>();
  private countInWindow = new Map<string, number>();

  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  tryConsume(key: string): boolean {
    const now = Date.now();
    const start = this.windowStart.get(key) ?? 0;

    if (now - start > this.windowMs) {
      this.windowStart.set(key, now);
      this.countInWindow.set(key, 0);
    }

    const count = (this.countInWindow.get(key) ?? 0) + 1;
    this.countInWindow.set(key, count);
    return count <= this.maxPerWindow;
  }
}
