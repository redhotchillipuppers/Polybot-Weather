// TypeScript interfaces

export interface WeatherForecast {
  date: string;
  maxTemperature: number;
  minTemperature: number;
  description: string;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: string[];
  prices: number[];
  endDate: string;
  volume: number;
  liquidity: number;
}

export interface MarketSnapshot {
  marketId: string;
  question: string;
  temperatureValue: string | null;
  outcomes: string[];
  prices: number[];
  yesPrice: number | null;
  endDate: string;
  minutesToClose: number | null;
  volume: number;
  liquidity: number;
  modelProbability: number | null;
  edge: number | null;
  edgePercent: number | null;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
  forecastError: number | null;
  isTradeable: boolean;
  executed: boolean;
  // Entry fields - only set when executed === true
  entrySide: 'YES' | 'NO' | null;
  entryYesPrice: number | null;
  entryNoPrice: number | null;
  // Settlement fields - set after market resolves
  resolvedOutcome: 'YES' | 'NO' | null;
  tradePnl: number | null;
}

export interface DailyPnlSummary {
  date: string;  // Settlement date (YYYY-MM-DD)
  trades: number;
  dailyPnl: number;
  settledMarkets: {
    marketId: string;
    entrySide: 'YES' | 'NO';
    resolvedOutcome: 'YES' | 'NO';
    tradePnl: number;
  }[];
}

export interface ParsedMarketQuestion {
  bracketType: 'or_higher' | 'or_below' | 'exact';
  bracketValue: number;
}
