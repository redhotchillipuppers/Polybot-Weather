// Market question parsing utilities

import type { ParsedMarketQuestion } from '../types.js';
import { formatError } from '../api-utils.js';

// Extract temperature value from market question
export function extractTemperatureFromQuestion(question: string): string | null {
  if (!question) return null;
  // Match patterns like "8°C or higher", "below 5°C", "7°C to 9°C"
  const tempMatch = question.match(/(\d+(?:\.\d+)?)\s*°?C/i);
  return tempMatch && tempMatch[1] ? tempMatch[1] : null;
}

// Parse market question to extract bracket type and value
// Note: Uses flexible regex to handle different Unicode degree symbols (°, º, etc.)
export function parseMarketQuestion(question: string): ParsedMarketQuestion | null {
  if (!question) return null;

  try {
    // Pattern: "X°C or higher" - flexible degree symbol matching
    const orHigherMatch = question.match(/(\d+(?:\.\d+)?)[°º\s]*C\s+or\s+higher/i);
    if (orHigherMatch && orHigherMatch[1]) {
      return {
        bracketType: 'or_higher',
        bracketValue: parseFloat(orHigherMatch[1]),
      };
    }

    // Pattern: "X°C or below" - flexible degree symbol matching
    const orBelowMatch = question.match(/(\d+(?:\.\d+)?)[°º\s]*C\s+or\s+below/i);
    if (orBelowMatch && orBelowMatch[1]) {
      return {
        bracketType: 'or_below',
        bracketValue: parseFloat(orBelowMatch[1]),
      };
    }

    // Pattern: exact temperature "X°C" (without "or higher" or "or below")
    // Must match "be X°C on" to distinguish from other temperature mentions
    const exactMatch = question.match(/be\s+(\d+(?:\.\d+)?)[°º\s]*C\s+on/i);
    if (exactMatch && exactMatch[1]) {
      return {
        bracketType: 'exact',
        bracketValue: parseFloat(exactMatch[1]),
      };
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse market question: ${formatError(error)}`);
    return null;
  }
}

// Extract date from market question (e.g., "on January 27" -> "2026-01-27")
export function extractDateFromQuestion(question: string): string | null {
  if (!question) return null;

  try {
    // Simplified: just look for "Month Day" pattern directly
    // This avoids issues with matching "on" from "London"
    const dateMatch = question.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);

    if (dateMatch && dateMatch[1] && dateMatch[2]) {
      const monthName = dateMatch[1];
      const day = parseInt(dateMatch[2], 10);

      const months: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3,
        may: 4, june: 5, july: 6, august: 7,
        september: 8, october: 9, november: 10, december: 11,
      };

      const monthNum = months[monthName.toLowerCase()];
      if (monthNum === undefined || isNaN(day)) {
        return null;
      }

      // Assume current year, or next year if the date has passed
      const now = new Date();
      let year = now.getFullYear();
      const testDate = new Date(year, monthNum, day);

      if (testDate < now) {
        year += 1;
      }

      const monthStr = String(monthNum + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    }

    return null;
  } catch (error) {
    console.warn(`Failed to extract date from question: ${formatError(error)}`);
    return null;
  }
}
