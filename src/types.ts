// TypeScript interfaces

export interface WeatherForecast {
  date: string;
  maxTemperature: number;
  minTemperature: number;
  description: string;
  weatherProvidersUsed?: Array<'openweather' | 'tomorrow'>;
  weatherSpreadC?: number;
  providerTemps?: {
    openweather?: { max: number; min: number };
    tomorrow?: { max: number; min: number };
  };
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
  noPrice: number | null;
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
  entryStrikeTempC: number | null;
  entryBracketType: ParsedMarketQuestion['bracketType'] | null;
  openedAt: string;       // ISO timestamp
  // Model inputs at execution time (for post-mortems)
  modelProbability: number | null;
  edge: number | null;
  isOpen: boolean;
  closedAt: string | null;
  exitYesPrice: number | null;
  exitNoPrice: number | null;
  closeReason: 'DECIDED_95' | 'OFFICIAL_SETTLEMENT' | 'STOP_PROXIMITY' | 'STOP_EDGE_FLIP' | null;
  realizedPnl: number | null;
  // Correlation IDs for tracing back to logs
  snapshotId?: string | undefined;    // Reference to MonitoringSnapshot that led to this position
  decisionId?: string | undefined;    // Reference to DecisionRecord that led to this position
}

export interface DecidedDateInfo {
  streakCount: number;
  decidedAt: string | null;
  decided95At?: string | null;
  triggerMarketId: string | null;
  triggerQuestion: string | null;
  triggerYesPrice: number | null;
  triggerSide: 'YES' | 'NO' | null;
  triggerNoPrice?: number | null;
}

export interface CandidateState {
  bestCandidateKey: string | null;
  bestScore: number | null;
  bestStreakCount: number;
  bestSince: string | null;
}

export interface CandidateSelection {
  dateKey: string;
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  strikeTempC: number;
  bracketType: ParsedMarketQuestion['bracketType'];
  yesPrice: number | null;
  noPrice: number | null;
  modelTempC: number;
  modelProbability: number | null;
  marketImpliedProb: number | null;
  edge: number;
  proximityAbsC: number;
  score: number;
  computedAt: string;
}

export interface StopExitInfo {
  dateKey: string;
  marketId: string;
  closeReason: 'STOP_PROXIMITY' | 'STOP_EDGE_FLIP';
  modelTempC: number;
  proximityAbsC: number;
  edgeNow: number;
  yesPrice: number | null;
  noPrice: number | null;
}

export interface PositionsFile {
  positions: { [marketId: string]: Position };
  decidedDates: { [dateKey: string]: DecidedDateInfo };
  candidateState: { [dateKey: string]: CandidateState };
  stoppedOutDates: { [dateKey: string]: number };  // Counter of stop-outs per date
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

// ============================================================
// SPLIT LOGGING TYPES
// ============================================================

// Raw market observation data (excludes decision/signal fields)
export interface MarketObservation {
  marketId: string;
  question: string;
  temperatureValue: string | null;
  outcomes: string[];
  prices: number[];
  yesPrice: number | null;
  noPrice: number | null;
  endDate: string;
  minutesToClose: number | null;
  volume: number;
  liquidity: number;
  isTradeable: boolean;
}

// Monitoring snapshot record (raw observation data)
export interface MonitoringSnapshot {
  snapshotId: string;           // UUID for correlation
  timestamp: string;            // ISO timestamp
  entryType: 'market_check' | 'weather_check';
  weatherForecasts: WeatherForecast[];
  markets: MarketObservation[];
  modelTempsByDate: { [dateKey: string]: number };
  bestCandidatesByDate: CandidateSelection[];
}

// Skip reasons for decision gating
export type SkipReason = 'LADDER_INCOHERENT' | 'DATEKEY_ALREADY_HAS_POSITION' | null;

// Decision output for a single market
export interface MarketDecision {
  marketId: string;
  dateKey: string;              // Target market date (YYYY-MM-DD)
  modelProbability: number | null;
  edge: number | null;
  edgePercent: number | null;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
  forecastError: number | null;
  executed: boolean;
  entrySide: 'YES' | 'NO' | null;
  entryYesPrice: number | null;
  entryNoPrice: number | null;
  skipReason?: SkipReason;      // Reason for forcing HOLD (if any)
}

export interface DecisionActionRecord {
  dateKey: string;
  action: 'EXECUTED_ENTRY' | 'BLOCKED_LOCK' | 'HOLD' | 'STOP_EXIT';
  selectedBestCandidate: CandidateSelection | null;
  bestStreakCount: number;
  confirmCycles: number;
  stopReason?: 'STOP_PROXIMITY' | 'STOP_EDGE_FLIP';
  stopDetails?: {
    modelTempC: number | null;
    proximityAbsC: number | null;
    edgeNow: number | null;
    yesPrice?: number | null;
    noPrice?: number | null;
  };
  skipReason?: SkipReason;
}

// Decision record (model outputs and signals)
export interface DecisionRecord {
  decisionId: string;           // UUID for correlation
  snapshotId: string;           // Reference to monitoring snapshot
  timestamp: string;            // ISO timestamp
  decisions: MarketDecision[];
  bestCandidatesByDate: CandidateSelection[];
  actions: DecisionActionRecord[];
}
