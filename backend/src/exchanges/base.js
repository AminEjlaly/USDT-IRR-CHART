export class ExchangeAdapter {
  constructor(code, displayName, priceMultiplier = 1) {
    this.code = code;
    this.displayName = displayName;
    this.priceMultiplier = priceMultiplier;
  }
  normalizePrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${this.code}: invalid price`);
    return n * this.priceMultiplier;
  }
}
