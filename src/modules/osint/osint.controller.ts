import { Controller, Get } from '@nestjs/common';
import { OsintService } from './osint.service.js';

@Controller('api/osint')
export class OsintController {
  constructor(private readonly osintService: OsintService) {}

  @Get('overview')
  getOverview() {
    return this.osintService.getOverview();
  }
}
