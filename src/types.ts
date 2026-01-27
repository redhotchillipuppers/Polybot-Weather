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
  volume: number;
  liquidity: number;
  modelProbability: number | null;
  edge: number | null;
  edgePercent: number | null;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
  forecastError: number | null;
}

export interface ParsedMarketQuestion {
  bracketType: 'or_higher' | 'or_below' | 'exact';
  bracketValue: number;
}
