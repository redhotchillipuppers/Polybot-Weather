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

export async function getLondonWeatherForecast(apiKey: string): Promise<WeatherForecast> {
  try {
    const url = `${FORECAST_ENDPOINT}?lat=${LONDON_LAT}&lon=${LONDON_LON}&units=metric&appid=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenWeather API error: ${response.status}`);
    }

    const data: OpenWeatherResponse = await response.json();

    // Calculate the date for day after tomorrow
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    dayAfterTomorrow.setHours(0, 0, 0, 0);

    const dayAfterTomorrowEnd = new Date(dayAfterTomorrow);
    dayAfterTomorrowEnd.setHours(23, 59, 59, 999);

    // Filter forecasts for day after tomorrow
    const targetDayForecasts = data.list.filter(item => {
      const forecastDate = new Date(item.dt * 1000);
      return forecastDate >= dayAfterTomorrow && forecastDate <= dayAfterTomorrowEnd;
    });

    if (targetDayForecasts.length === 0) {
      throw new Error('No forecast data available for day after tomorrow');
    }

    // Get max and min temperatures for the day
    const maxTemp = Math.max(...targetDayForecasts.map(f => f.main.temp_max));
    const minTemp = Math.min(...targetDayForecasts.map(f => f.main.temp_min));
    const description = targetDayForecasts[0].weather[0].description;

    return {
      date: dayAfterTomorrow.toISOString().split('T')[0],
      maxTemperature: Math.round(maxTemp * 10) / 10,
      minTemperature: Math.round(minTemp * 10) / 10,
      description
    };
  } catch (error) {
    console.error('Error fetching weather forecast:', error);
    throw error;
  }
}
