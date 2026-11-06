import { Controller, Get } from '@nestjs/common';

interface OsintOverviewResponse {
  status: 'ok';
  source: 'nest-api';
  saved_ips: string[];
  saved_ports: number[];
  totals: {
    saved_ips: number;
    saved_ports: number;
  };
  generatedAt: string;
}

@Controller('api/osint')
export class OsintOverviewController {
  @Get('overview')
  getOverview(): OsintOverviewResponse {
    const savedIps: string[] = [];
    const savedPorts: number[] = [];

    return {
      status: 'ok',
      source: 'nest-api',
      saved_ips: savedIps,
      saved_ports: savedPorts,
      totals: {
        saved_ips: savedIps.length,
        saved_ports: savedPorts.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
