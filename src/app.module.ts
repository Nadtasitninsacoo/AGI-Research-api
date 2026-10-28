import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { OverviewModule } from './modules/overview/overview.module.js';
import { ResearchApiModule } from './modules/research-api/research-api.module.js';
import { RunnerModule } from './modules/runner/runner.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    OverviewModule,
    ResearchApiModule,
    RunnerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
