// OpenWeather API integration
import type { WeatherForecast } from './types.js';
import { fetchWithRetry, formatError, safeArray, safeNumber, safeString } from './api-utils.js';
import { LONDON_LAT, LONDON_LON, OPENWEATHER_FORECAST_ENDPOINT } from './config/constants.js';

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

interface TomorrowIOResponse {
  timelines?: Array<{
    timestep?: string;
    intervals?: Array<{
      startTime?: string;
      values?: {
        temperatureMax?: number;
        temperatureMin?: number;
        weatherCode?: number;
        weatherCodeFull?: string;
        weatherCodeDay?: number;
        weatherCodeNight?: number;
      };
    }>;
  }>;
  data?: {
    timelines?: {
      daily?: Array<{
        time?: string;
        values?: {
          temperatureMax?: number;
          temperatureMin?: number;
          weatherCode?: number;
          weatherCodeFull?: string;
          weatherCodeDay?: number;
          weatherCodeNight?: number;
        };
      }>;
    };
  };
}

type WeatherProvider = 'openweather' | 'tomorrow';

const TOMORROW_FORECAST_ENDPOINT = 'https://api.tomorrow.io/v4/weather/forecast';

const TOMORROW_WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Unknown',
  1000: 'Clear',
  1100: 'Mostly clear',
  1101: 'Partly cloudy',
  1102: 'Mostly cloudy',
  1001: 'Cloudy',
  2000: 'Fog',
  2100: 'Light fog',
  3000: 'Light wind',
  3001: 'Wind',
  3002: 'Strong wind',
  4000: 'Drizzle',
  4001: 'Rain',
  4200: 'Light rain',
  4201: 'Heavy rain',
  5000: 'Snow',
  5001: 'Flurries',
  5100: 'Light snow',
  5101: 'Heavy snow',
  6000: 'Freezing drizzle',
  6001: 'Freezing rain',
  6200: 'Light freezing rain',
  6201: 'Heavy freezing rain',
  7000: 'Ice pellets',
  7101: 'Heavy ice pellets',
  7102: 'Light ice pellets',
  8000: 'Thunderstorm',
};

function resolveTargetDay(targetDate?: Date): { targetDay: Date; targetDayEnd: Date; dateStr: string } {
  const targetDay = targetDate ? new Date(targetDate) : new Date();
  if (!targetDate) {
    targetDay.setDate(targetDay.getDate() + 2);
  }
  targetDay.setHours(0, 0, 0, 0);

  const targetDayEnd = new Date(targetDay);
  targetDayEnd.setHours(23, 59, 59, 999);

  const dateStr = targetDay.toISOString().split('T')[0] ?? '';
  return { targetDay, targetDayEnd, dateStr };
}

function isValidTemperature(value: number): boolean {
  return Number.isFinite(value);
}

function resolveTomorrowDescription(values: {
  weatherCode?: number;
  weatherCodeFull?: string;
  weatherCodeDay?: number;
  weatherCodeNight?: number;
} | null | undefined): string {
  const explicit = safeString(values?.weatherCodeFull, '').trim();
  if (explicit) {
    return explicit;
  }

  const weatherCode = safeNumber(values?.weatherCode, NaN);
  if (Number.isFinite(weatherCode) && TOMORROW_WEATHER_CODE_MAP[weatherCode]) {
    return TOMORROW_WEATHER_CODE_MAP[weatherCode];
  }

  const dayCode = safeNumber(values?.weatherCodeDay, NaN);
  if (Number.isFinite(dayCode) && TOMORROW_WEATHER_CODE_MAP[dayCode]) {
    return TOMORROW_WEATHER_CODE_MAP[dayCode];
  }

  const nightCode = safeNumber(values?.weatherCodeNight, NaN);
  if (Number.isFinite(nightCode) && TOMORROW_WEATHER_CODE_MAP[nightCode]) {
    return TOMORROW_WEATHER_CODE_MAP[nightCode];
  }

  return 'No description available';
}

export async function getLondonWeatherForecast(apiKey: string, targetDate?: Date): Promise<WeatherForecast> {
  const url = `${OPENWEATHER_FORECAST_ENDPOINT}?lat=${LONDON_LAT}&lon=${LONDON_LON}&units=metric&appid=${apiKey}`;

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

    const { targetDay, targetDayEnd, dateStr } = resolveTargetDay(targetDate);

    // Filter forecasts for target day
    const targetDayForecasts = forecastList.filter(item => {
      if (!item?.dt) return false;
      const forecastDate = new Date(item.dt * 1000);
      return forecastDate >= targetDay && forecastDate <= targetDayEnd;
    });

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

export async function getLondonWeatherForecastTomorrowIO(
  apiKey: string,
  targetDate?: Date
): Promise<WeatherForecast & { provider: 'tomorrow' }> {
  const url = `${TOMORROW_FORECAST_ENDPOINT}?location=${LONDON_LAT},${LONDON_LON}&timesteps=1d&units=metric&apikey=${apiKey}`;

  try {
    const response = await fetchWithRetry(url, undefined, {
      maxRetries: 3,
      initialDelayMs: 1000,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Tomorrow.io API error: ${response.status} - ${errorText}`);
    }

    const data: TomorrowIOResponse = await response.json();

    const timelineArrays = [
      safeArray(data?.timelines),
      safeArray(data?.data?.timelines as unknown as TomorrowIOResponse['timelines']),
    ];

    const dailyFromTimelines = timelineArrays
      .flatMap(timelines => timelines)
      .flatMap(t => {
        const timestep = safeString(t?.timestep, '');
        if (timestep && timestep !== '1d') {
          return [];
        }
        return safeArray(t?.intervals);
      });

    const dailyFromData = safeArray(data?.data?.timelines?.daily ?? (data as TomorrowIOResponse)?.timelines?.daily).map(
      entry => ({
        startTime: entry?.time,
        values: entry?.values,
      })
    );

    const dailyIntervals = dailyFromTimelines.length > 0
      ? dailyFromTimelines
      : dailyFromData;

    if (dailyIntervals.length === 0) {
      throw new Error('Tomorrow.io API returned empty forecast data');
    }

    const { targetDay, targetDayEnd, dateStr } = resolveTargetDay(targetDate);

    const targetDayIntervals = dailyIntervals.filter(interval => {
      const startTime = safeString(interval?.startTime, '');
      if (!startTime) return false;
      const forecastDate = new Date(startTime);
      return forecastDate >= targetDay && forecastDate <= targetDayEnd;
    });

    if (targetDayIntervals.length === 0) {
      throw new Error(`No forecast data available for ${dateStr}`);
    }

    const temps = targetDayIntervals
      .map(interval => ({
        max: safeNumber(interval?.values?.temperatureMax, null as unknown as number),
        min: safeNumber(interval?.values?.temperatureMin, null as unknown as number),
        values: interval?.values,
      }))
      .filter(t => t.max !== null && t.min !== null);

    if (temps.length === 0) {
      throw new Error(`No valid temperature data for ${dateStr}`);
    }

    const maxTemp = Math.max(...temps.map(t => t.max));
    const minTemp = Math.min(...temps.map(t => t.min));

    const description = resolveTomorrowDescription(temps[0]?.values);

    return {
      date: dateStr,
      maxTemperature: Math.round(maxTemp * 10) / 10,
      minTemperature: Math.round(minTemp * 10) / 10,
      description,
      provider: 'tomorrow',
    };
  } catch (error) {
    console.error(`Error fetching Tomorrow.io forecast: ${formatError(error)}`);
    throw error;
  }
}

export async function getLondonWeatherForecastMulti(
  keys: { openWeather?: string; tomorrow?: string },
  targetDate?: Date,
  mode: 'prefer_openweather' | 'prefer_tomorrow' | 'average' | 'best_effort' = 'best_effort'
): Promise<WeatherForecast & {
  providersUsed: Array<WeatherProvider>;
  providerData: Partial<Record<WeatherProvider, WeatherForecast>>;
  spreadC?: number;
}> {
  try {
    const providerData: Partial<Record<WeatherProvider, WeatherForecast>> = {};
    const errors: Partial<Record<WeatherProvider, Error>> = {};
    const tasks: Array<Promise<void>> = [];

    if (keys.openWeather) {
      tasks.push(
        getLondonWeatherForecast(keys.openWeather, targetDate)
          .then(data => {
            providerData.openweather = data;
          })
          .catch(error => {
            errors.openweather = error instanceof Error ? error : new Error(String(error));
          })
      );
    }

    if (keys.tomorrow) {
      tasks.push(
        getLondonWeatherForecastTomorrowIO(keys.tomorrow, targetDate)
          .then(data => {
            providerData.tomorrow = data;
          })
          .catch(error => {
            errors.tomorrow = error instanceof Error ? error : new Error(String(error));
          })
      );
    }

    if (tasks.length === 0) {
      throw new Error('No weather provider API keys supplied');
    }

    await Promise.all(tasks);

    const openForecast = providerData.openweather;
    const tomorrowForecast = providerData.tomorrow;

    const providersUsed: WeatherProvider[] = [];
    if (openForecast) providersUsed.push('openweather');
    if (tomorrowForecast) providersUsed.push('tomorrow');

    if (providersUsed.length === 0) {
      const errorMessages = [
        errors.openweather ? `OpenWeather: ${formatError(errors.openweather)}` : 'OpenWeather: unavailable',
        errors.tomorrow ? `Tomorrow.io: ${formatError(errors.tomorrow)}` : 'Tomorrow.io: unavailable',
      ].join(' | ');
      throw new Error(`Weather providers failed: ${errorMessages}`);
    }

    if (openForecast && tomorrowForecast) {
      const spreadC = Math.round(Math.abs(openForecast.maxTemperature - tomorrowForecast.maxTemperature) * 10) / 10;

      const openRange = isValidTemperature(openForecast.maxTemperature) && isValidTemperature(openForecast.minTemperature)
        ? openForecast.maxTemperature - openForecast.minTemperature
        : null;
      const tomorrowRange = isValidTemperature(tomorrowForecast.maxTemperature) && isValidTemperature(tomorrowForecast.minTemperature)
        ? tomorrowForecast.maxTemperature - tomorrowForecast.minTemperature
        : null;

      const descriptionOptions = [openForecast.description, tomorrowForecast.description]
        .map(desc => safeString(desc, '').trim())
        .filter(Boolean);
      const mergedDescription = descriptionOptions[0] ?? 'Mixed';

      switch (mode) {
        case 'average': {
          const avgMax = isValidTemperature(openForecast.maxTemperature) && isValidTemperature(tomorrowForecast.maxTemperature)
            ? (openForecast.maxTemperature + tomorrowForecast.maxTemperature) / 2
            : openForecast.maxTemperature;
          const avgMin = isValidTemperature(openForecast.minTemperature) && isValidTemperature(tomorrowForecast.minTemperature)
            ? (openForecast.minTemperature + tomorrowForecast.minTemperature) / 2
            : openForecast.minTemperature;

          return {
            date: openForecast.date || tomorrowForecast.date,
            maxTemperature: Math.round(avgMax * 10) / 10,
            minTemperature: Math.round(avgMin * 10) / 10,
            description: mergedDescription,
            providersUsed,
            providerData,
            spreadC,
          };
        }
        case 'prefer_tomorrow':
          return {
            ...tomorrowForecast,
            providersUsed,
            providerData,
            spreadC,
          };
        case 'prefer_openweather':
          return {
            ...openForecast,
            providersUsed,
            providerData,
            spreadC,
          };
        case 'best_effort':
        default: {
          if (!isValidTemperature(openForecast.maxTemperature) || !isValidTemperature(openForecast.minTemperature)) {
            return {
              ...tomorrowForecast,
              providersUsed,
              providerData,
              spreadC,
            };
          }
          if (!isValidTemperature(tomorrowForecast.maxTemperature) || !isValidTemperature(tomorrowForecast.minTemperature)) {
            return {
              ...openForecast,
              providersUsed,
              providerData,
              spreadC,
            };
          }

          if (openRange !== null && tomorrowRange !== null) {
            const preferred = tomorrowRange < openRange ? tomorrowForecast : openForecast;
            return {
              ...preferred,
              providersUsed,
              providerData,
              spreadC,
            };
          }

          return {
            ...openForecast,
            providersUsed,
            providerData,
            spreadC,
          };
        }
      }
    }

    const fallback = openForecast ?? tomorrowForecast;
    if (!fallback) {
      throw new Error('No forecast data available from weather providers');
    }
    return {
      ...fallback,
      providersUsed,
      providerData,
    };
  } catch (error) {
    console.error(`Error fetching multi-provider forecast: ${formatError(error)}`);
    throw error;
  }
}

export async function getWeatherForDatesMulti(
  keys: { openWeather?: string; tomorrow?: string },
  dates: Date[],
  mode: 'prefer_openweather' | 'prefer_tomorrow' | 'average' | 'best_effort' = 'best_effort'
): Promise<WeatherForecast[]> {
  const forecasts: WeatherForecast[] = [];

  for (const date of dates) {
    try {
      const forecast = await getLondonWeatherForecastMulti(keys, date, mode);
      const { providerData, providersUsed, spreadC, ...baseForecast } = forecast;
      const providerTemps: WeatherForecast['providerTemps'] = {};
      if (providerData.openweather) {
        providerTemps.openweather = {
          max: providerData.openweather.maxTemperature,
          min: providerData.openweather.minTemperature,
        };
      }
      if (providerData.tomorrow) {
        providerTemps.tomorrow = {
          max: providerData.tomorrow.maxTemperature,
          min: providerData.tomorrow.minTemperature,
        };
      }

      const enrichedForecast: WeatherForecast = {
        ...baseForecast,
        weatherProvidersUsed: providersUsed,
        providerTemps,
      };
      if (spreadC !== undefined) {
        enrichedForecast.weatherSpreadC = spreadC;
      }
      forecasts.push(enrichedForecast);
    } catch (error) {
      const dateStr = date.toISOString().split('T')[0] ?? 'unknown';
      console.error(`Failed to fetch weather for ${dateStr}: ${formatError(error)}`);
    }
  }

  return forecasts;
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

export async function getLondonWeatherForecastsNextThreeDays(apiKey: string): Promise<WeatherForecast[]> {
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  const dates = [0, 1, 2].map(offset => {
    const target = new Date(baseDate);
    target.setDate(baseDate.getDate() + offset);
    return target;
  });

  return getWeatherForDates(apiKey, dates);
}
