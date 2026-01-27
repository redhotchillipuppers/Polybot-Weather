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

// Position tracking for early closing system
export interface Position {
  marketId: string;
  dateKey: string;        // YYYY-MM-DD from endDate
  question: string;
  entrySide: 'YES' | 'NO';
  size: number;           // Use 1 for now
  entryYesPrice: number;
  entryNoPrice: number;
  openedAt: string;       // ISO timestamp
  isOpen: boolean;
  closedAt: string | null;
  exitYesPrice: number | null;
  exitNoPrice: number | null;
  closeReason: 'DECIDED_95' | 'OFFICIAL_SETTLEMENT' | null;
  realizedPnl: number | null;
}

export interface DecidedDateInfo {
  streakCount: number;
  decidedAt: string | null;
  triggerMarketId: string | null;
  triggerQuestion: string | null;
  triggerYesPrice: number | null;
}

export interface PositionsFile {
  positions: { [marketId: string]: Position };
  decidedDates: { [dateKey: string]: DecidedDateInfo };
  reportedDates: string[];  // Array of dateKeys already reported
}

export interface ClosedPositionDetail {
  marketId: string;
  question: string;
  entrySide: 'YES' | 'NO';
  entryYesPrice: number;
  entryNoPrice: number;
  exitYesPrice: number;
  exitNoPrice: number;
  realizedPnl: number;
  openedAt: string;
  closedAt: string;
}

export interface EarlyCloseReport {
  dateKey: string;
  decidedAt: string;
  decidedMarketId: string;
  decidedQuestion: string;
  decidedYesPrice: number;
  numberOfPositionsClosed: number;
  totalRealizedPnl: number;
  breakdownByEntrySide: {
    YES: { count: number; totalPnl: number };
    NO: { count: number; totalPnl: number };
  };
  closedPositions: ClosedPositionDetail[];
}
