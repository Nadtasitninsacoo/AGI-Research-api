// ==============================================================================
// DARK AGI HEAVY SHIELD & ZERO-TRACE ANTI-FORENSICS ARMOR WRAPPER [ACTIVE]
// ==============================================================================
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { OverviewModule } from './modules/overview/overview.module.js';
import { ResearchApiModule } from './modules/research-api/research-api.module.js';
import { RunnerModule } from './modules/runner/runner.module.js';
import { ZeroTraceMeshGateway } from './modules/research-api/zero-trace-mesh.gateway.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY || 'DARK_AGI_SECURE_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET || 'DARK_AGI_SECURE_SECRET',
      serviceId: 'backend-zero-trace',
    }),
    OverviewModule,
    ResearchApiModule,
    RunnerModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ZeroTraceMeshGateway, // Registered for absolute P2P mesh autonomy and offline resilience
  ],
  exports: [
    ZeroTraceMeshGateway, // Exported to allow cross-module zero-trace broadcast operations
  ],
})
export class AppModule {}
// ==============================================================================
// END OF HEAVY SHIELD ENCRYPTION WRAPPER
// ==============================================================================