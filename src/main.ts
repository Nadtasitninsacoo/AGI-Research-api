
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import {
  Logger,
  ValidationPipe,
} from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const bootstrapLogger = new Logger('AGI_BOOTSTRAP');

  try {
    // Load environment before importing AppModule.
    const envPath = resolve(process.cwd(), '.env');

    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    const portValue = process.env.PORT ?? '3001';
    const port = Number(portValue);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid PORT configuration.');
    }

    // Import AppModule only after environment variables are loaded.
    const { AppModule, ObserveInstrument } =
      await import('./app.module.js');

    const app = await NestFactory.create(AppModule, {
      instrument: ObserveInstrument,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    app.enableShutdownHooks();

    await app.listen(port, '0.0.0.0');

    bootstrapLogger.log(
      `AGI Research API is running on port ${port}`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown bootstrap error';

    bootstrapLogger.error(
      `Backend bootstrap failed: ${message}`,
    );

    process.exitCode = 1;
  }
}

void bootstrap();
