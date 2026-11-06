
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';

import { OverviewModule } from './modules/overview/overview.module.js';
import { ResearchApiModule } from './modules/research-api/research-api.module.js';
import { RunnerModule } from './modules/runner/runner.module.js';
import { ZeroTraceMeshGateway } from './modules/research-api/zero-trace-mesh.gateway.js';
import { RemoteModule } from './modules/remote/remote.module.js';
import { OsintModule } from './modules/osint/osint.module.js';
import { TeamTaskPlansModule } from './modules/team-task-plans/team-task-plans.module.js';
import { RunBatchesModule } from './modules/run-batches/run-batches.module.js';
import { AgentTaskQueueModule } from './modules/agent-task-queue/agent-task-queue.module.js';

export const { ObserveModule, ObserveInstrument } =
  createObserveModule();

const observeImports =
  process.env.OBSERVE_APP_KEY &&
  process.env.OBSERVE_APP_SECRET
    ? [
        ObserveModule.forRoot({
          appKey: process.env.OBSERVE_APP_KEY,
          appSecret: process.env.OBSERVE_APP_SECRET,
          serviceId: 'agi-research-backend',
        }),
      ]
    : [];

@Module({
  imports: [
    ...observeImports,
    DatabaseModule,
    OverviewModule,
    ResearchApiModule,
    RunnerModule,
    RemoteModule,
    OsintModule,
    TeamTaskPlansModule,
    RunBatchesModule,
    AgentTaskQueueModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ZeroTraceMeshGateway,
  ],
  exports: [
    ZeroTraceMeshGateway,
  ],
})
export class AppModule {}
