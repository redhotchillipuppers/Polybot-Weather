import type { WeatherForecast } from './types.js';

/**
 * Fetches weather forecast for London from OpenWeather API
 * @param apiKey OpenWeather API key
 * @returns Weather forecast with max temperature prediction
 */
export async function fetchLondonWeatherForecast(
  apiKey: string
): Promise<WeatherForecast> {
  // TODO: Implement OpenWeather API call
  // API endpoint: https://api.openweathermap.org/data/2.5/forecast
  // Parameters: lat=51.5074, lon=-0.1278 (London), appid=apiKey

  throw new Error('Not implemented');
}

/**
 * Parses OpenWeather API response to extract max temperature forecast
 * @param apiResponse Raw API response from OpenWeather
 * @returns Parsed weather forecast
 */
export function parseWeatherData(apiResponse: any): WeatherForecast {
  // TODO: Parse API response and extract relevant temperature data

  throw new Error('Not implemented');
}
