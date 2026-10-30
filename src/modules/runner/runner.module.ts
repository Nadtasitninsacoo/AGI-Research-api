import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AutonomousExploitEngine } from './autonomous-exploit-payload.engine.js';
import { RunnerService } from './runner.service.js';
import { AntiForensicsShredderService } from './anti-forensics-shredder.service.js';
import { StealthPayloadGeneratorService } from './stealth-payload-generator.service.js';
import { TargetLogEradicatorService } from './target-log-eradicating.service.js';
import { MeshDiscoveryV2Service } from '../mesh/mesh-discovery-v2.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    RunnerService,
    AutonomousExploitEngine,
    AntiForensicsShredderService,
    StealthPayloadGeneratorService,
    TargetLogEradicatorService,
    MeshDiscoveryV2Service, // ลงทะเบียนใน providers
  ],
  exports: [
    RunnerService,
    AutonomousExploitEngine,
    AntiForensicsShredderService,
    StealthPayloadGeneratorService,
    TargetLogEradicatorService,
    MeshDiscoveryV2Service, // ส่งออกเพื่อให้โมดูลอื่นเรียกใช้ได้
  ],
})
export class RunnerModule {}
// ==============================================================================
// END OF HEAVY SHIELD ENCRYPTION WRAPPER
// ==============================================================================
