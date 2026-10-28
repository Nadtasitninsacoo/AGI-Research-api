
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { Logger } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  // Load .env before any provider (e.g. DatabaseService) reads process.env.
  // Variables already set in the environment are not overridden.
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);

  Logger.log(
    `AGI Research API is running at http://localhost:${port}`,
    'Bootstrap',
  );
}

await bootstrap();