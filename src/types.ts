// TypeScript interfaces for the weather trading bot

export interface WeatherForecast {
  location: string;
  date: string;
  maxTemp: number;
  minTemp: number;
  timestamp: number;
}

export interface PolymarketMarket {
  marketId: string;
  question: string;
  outcomes: string[];
  prices: number[];
  volume: number;
  endDate: string;
}

export interface TradingEdge {
  market: PolymarketMarket;
  forecast: WeatherForecast;
  expectedValue: number;
  confidence: number;
  recommendation: 'BUY' | 'SELL' | 'SKIP';
}

export interface TradeOrder {
  marketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
}
