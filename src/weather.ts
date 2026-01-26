// OpenWeather API integration
import type { WeatherForecast } from './types.js';
import { fetchWithRetry, formatForLog, getErrorMessage } from './api-utils.js';

const LONDON_LAT = 51.5074;
const LONDON_LON = -0.1278;
const FORECAST_ENDPOINT = 'https://api.openweathermap.org/data/2.5/forecast';

interface OpenWeatherResponse {
  list: Array<{
    dt: number;
    dt_txt: string;
    main: {
      temp: number;
      temp_min: number;
      temp_max: number;
    };
    weather: Array<{
      description: string;
    }>;
  }>;
}

export async function getLondonWeatherForecast(apiKey: string, targetDate?: Date): Promise<WeatherForecast | null> {
  try {
    const url = `${FORECAST_ENDPOINT}?lat=${LONDON_LAT}&lon=${LONDON_LON}&units=metric&appid=${apiKey}`;

    const response = await fetchWithRetry(url, undefined, {
      maxRetries: 3,
      retryOn429: true,
    });

    if (!response) {
      console.error('  Failed to fetch weather data after retries');
      return null;
    }

    if (!response.ok) {
      console.error(`  OpenWeather API error: ${response.status} ${response.statusText}`);
      return null;
    }

    let data: OpenWeatherResponse;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`  Failed to parse weather response: ${getErrorMessage(parseError)}`);
      return null;
    }

    // Validate response structure
    if (!data || !Array.isArray(data.list) || data.list.length === 0) {
      console.error('  Weather API returned invalid or empty data');
      return null;
    }

    // Use provided target date or default to day after tomorrow
    const targetDay = targetDate ? new Date(targetDate) : new Date();
    if (!targetDate) {
      targetDay.setDate(targetDay.getDate() + 2);
    }
    targetDay.setHours(0, 0, 0, 0);

    const targetDayEnd = new Date(targetDay);
    targetDayEnd.setHours(23, 59, 59, 999);

    // Filter forecasts for target day
    const targetDayForecasts = data.list.filter(item => {
      if (!item || typeof item.dt !== 'number') return false;
      const forecastDate = new Date(item.dt * 1000);
      return forecastDate >= targetDay && forecastDate <= targetDayEnd;
    });

    const dateStr = targetDay.toISOString().split('T')[0] ?? 'unknown';

    if (targetDayForecasts.length === 0) {
      console.log(`  No forecast data available for ${dateStr}`);
      return null;
    }

    // Get max and min temperatures for the day, with null safety
    const temps = targetDayForecasts
      .filter(f => f?.main?.temp_max != null && f?.main?.temp_min != null)
      .map(f => ({ max: f.main.temp_max, min: f.main.temp_min }));

    if (temps.length === 0) {
      console.log(`  No valid temperature data for ${dateStr}`);
      return null;
    }

    const maxTemp = Math.max(...temps.map(t => t.max));
    const minTemp = Math.min(...temps.map(t => t.min));

    // Safely get description
    const description = targetDayForecasts[0]?.weather?.[0]?.description ?? 'No description';

    return {
      date: dateStr,
      maxTemperature: Math.round(maxTemp * 10) / 10,
      minTemperature: Math.round(minTemp * 10) / 10,
      description
    };
  } catch (error) {
    console.error(`  Error fetching weather forecast: ${getErrorMessage(error)}`);
    return null;
  }
}

// Fetch weather forecasts for multiple dates
export async function getWeatherForDates(apiKey: string, dates: Date[]): Promise<WeatherForecast[]> {
  const forecasts: WeatherForecast[] = [];

  for (const date of dates) {
    try {
      const dateStr = date.toISOString().split('T')[0] ?? 'unknown';
      const forecast = await getLondonWeatherForecast(apiKey, date);
      if (forecast) {
        forecasts.push(forecast);
      } else {
        console.log(`  Skipping date ${dateStr} - no forecast available`);
      }
    } catch (error) {
      const dateStr = date.toISOString().split('T')[0] ?? 'unknown';
      console.error(`  Failed to fetch weather for ${dateStr}: ${getErrorMessage(error)}`);
    }
  }

  return forecasts;
}
