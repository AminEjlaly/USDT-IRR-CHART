export const TIMEFRAMES = {
  '1m': { seconds: 60, wallex: '1' },
  '5m': { seconds: 300, wallex: '5' },
  '15m': { seconds: 900, wallex: '15' },
  '1h': { seconds: 3600, wallex: '60' },
  '4h': { seconds: 14400, wallex: '240' },
  '1d': { seconds: 86400, wallex: '1D' }
};
export function floorTime(date, seconds) {
  const epoch = Math.floor(date.getTime() / 1000);
  return new Date(Math.floor(epoch / seconds) * seconds * 1000);
}
