// OpenWeather API integration
import type { WeatherForecast } from './types.js';
import { fetchWithRetry, formatError, safeArray, safeNumber, safeString } from './api-utils.js';

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

export async function getLondonWeatherForecast(apiKey: string, targetDate?: Date): Promise<WeatherForecast> {
  const url = `${FORECAST_ENDPOINT}?lat=${LONDON_LAT}&lon=${LONDON_LON}&units=metric&appid=${apiKey}`;

  try {
    const response = await fetchWithRetry(url, undefined, {
      maxRetries: 3,
      initialDelayMs: 1000,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenWeather API error: ${response.status} - ${errorText}`);
    }

    const data: OpenWeatherResponse = await response.json();

    // Safely handle missing list data
    const forecastList = safeArray(data?.list);
    if (forecastList.length === 0) {
      throw new Error('OpenWeather API returned empty forecast data');
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
    const targetDayForecasts = forecastList.filter(item => {
      if (!item?.dt) return false;
      const forecastDate = new Date(item.dt * 1000);
      return forecastDate >= targetDay && forecastDate <= targetDayEnd;
    });

    const dateStr = targetDay.toISOString().split('T')[0] ?? '';

    if (targetDayForecasts.length === 0) {
      throw new Error(`No forecast data available for ${dateStr}`);
    }

    // Get max and min temperatures for the day, safely handling null values
    const temps = targetDayForecasts
      .map(f => ({
        max: safeNumber(f?.main?.temp_max, null as unknown as number),
        min: safeNumber(f?.main?.temp_min, null as unknown as number),
      }))
      .filter(t => t.max !== null && t.min !== null);

    if (temps.length === 0) {
      throw new Error(`No valid temperature data for ${dateStr}`);
    }

    const maxTemp = Math.max(...temps.map(t => t.max));
    const minTemp = Math.min(...temps.map(t => t.min));

    // Safely get weather description
    const firstForecast = targetDayForecasts[0];
    const weatherArray = safeArray(firstForecast?.weather);
    const description = safeString(weatherArray[0]?.description, 'No description available');

    return {
      date: dateStr,
      maxTemperature: Math.round(maxTemp * 10) / 10,
      minTemperature: Math.round(minTemp * 10) / 10,
      description
    };
  } catch (error) {
    console.error(`Error fetching weather forecast: ${formatError(error)}`);
    throw error;
  }
}

// Fetch weather forecasts for multiple dates
export async function getWeatherForDates(apiKey: string, dates: Date[]): Promise<WeatherForecast[]> {
  const forecasts: WeatherForecast[] = [];

  for (const date of dates) {
    try {
      const forecast = await getLondonWeatherForecast(apiKey, date);
      forecasts.push(forecast);
    } catch (error) {
      // Log but don't crash - continue with other dates
      const dateStr = date.toISOString().split('T')[0] ?? 'unknown';
      console.error(`Failed to fetch weather for ${dateStr}: ${formatError(error)}`);
    }
  }

  return forecasts;
}
