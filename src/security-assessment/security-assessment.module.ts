import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { SecurityAssessmentController } from './security-assessment.controller.js';
import { SecurityAssessmentService } from './security-assessment.service.js';
import { AssessmentHandoffService } from './assessment-handoff.service.js';
import { TaskRunnerService } from './tasks/task-runner.service.js';
import { AuthModule } from '../modules/auth/auth.module.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SecurityAssessmentController],
  providers: [
    SecurityAssessmentService,
    AssessmentHandoffService,
    TaskRunnerService,
  ],
  exports: [
    SecurityAssessmentService,
    AssessmentHandoffService,
    TaskRunnerService,
  ],
})
export class SecurityAssessmentModule {}