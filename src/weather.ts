// OpenWeather API integration
import type { WeatherForecast } from './types.js';

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
  try {
    const url = `${FORECAST_ENDPOINT}?lat=${LONDON_LAT}&lon=${LONDON_LON}&units=metric&appid=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenWeather API error: ${response.status}`);
    }

    const data: OpenWeatherResponse = await response.json();

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
      const forecastDate = new Date(item.dt * 1000);
      return forecastDate >= targetDay && forecastDate <= targetDayEnd;
    });

    const dateStr = targetDay.toISOString().split('T')[0];

    if (targetDayForecasts.length === 0) {
      throw new Error(`No forecast data available for ${dateStr}`);
    }

    // Get max and min temperatures for the day
    const maxTemp = Math.max(...targetDayForecasts.map(f => f.main.temp_max));
    const minTemp = Math.min(...targetDayForecasts.map(f => f.main.temp_min));
    const description = targetDayForecasts[0].weather[0].description;

    return {
      date: dateStr,
      maxTemperature: Math.round(maxTemp * 10) / 10,
      minTemperature: Math.round(minTemp * 10) / 10,
      description
    };
  } catch (error) {
    console.error('Error fetching weather forecast:', error);
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
      console.error(`Failed to fetch weather for ${date.toISOString().split('T')[0]}:`, error);
    }
  }

  return forecasts;
}
