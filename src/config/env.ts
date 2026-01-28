import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Required environment variables for the application
 */
const REQUIRED_ENV_VARS = [
  {
    name: 'PRIVATE_KEY',
    description: 'Ethereum private key for wallet operations',
  },
  {
    name: 'OPENWEATHER_API_KEY',
    description: 'API key for OpenWeather API',
  },
] as const;

interface EnvConfig {
  PRIVATE_KEY: string;
  OPENWEATHER_API_KEY: string;
  TOMORROW_API_KEY?: string;
}

/**
 * Validates that all required environment variables are set.
 * Call this function at startup before any other initialization.
 *
 * @throws Error with clear message listing all missing variables
 */
export function validateEnv(): EnvConfig {
  const missing: string[] = [];

  for (const { name, description } of REQUIRED_ENV_VARS) {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      missing.push(`  - ${name}: ${description}`);
    }
  }

  if (missing.length > 0) {
    const errorMessage = [
      '',
      '='.repeat(60),
      'ERROR: Missing required environment variables',
      '='.repeat(60),
      '',
      'The following environment variables must be set:',
      '',
      ...missing,
      '',
      'Please create a .env file in the project root with these variables,',
      'or set them in your environment before running the application.',
      '',
      'Example .env file:',
      '  PRIVATE_KEY=your_ethereum_private_key_here',
      '  OPENWEATHER_API_KEY=your_openweather_api_key_here',
      '  TOMORROW_API_KEY=your_tomorrow_io_api_key_here',
      '',
      '='.repeat(60),
    ].join('\n');

    console.error(errorMessage);
    process.exit(1);
  }

  // Return validated environment variables
  // At this point we know they exist and are non-empty
  return {
    PRIVATE_KEY: process.env.PRIVATE_KEY!,
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY!,
    ...(process.env.TOMORROW_API_KEY ? { TOMORROW_API_KEY: process.env.TOMORROW_API_KEY } : {}),
  };
}

// Export validated config - call validateEnv() to populate
let _config: EnvConfig | null = null;

/**
 * Get validated environment configuration.
 * Validates on first call, returns cached config on subsequent calls.
 */
export function getEnvConfig(): EnvConfig {
  if (!_config) {
    _config = validateEnv();
  }
  return _config;
}
